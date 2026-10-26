import axios from 'axios';
import logger from '../middleware/logger.js';
import { isConnectionError, isRetryableStatus, isTimeout, withRetry } from '../utils/retry.js';

const baseUrl = () => (process.env.MPESA_ENV === 'production'
  ? 'https://api.safaricom.co.ke'
  : 'https://sandbox.safaricom.co.ke');

/** Daraja returns HTTP 500 with this code while the customer has not answered the prompt yet. */
const STILL_PROCESSING = '500.001.1001';
// Status-query answers that mean "not decided yet" (the customer may still be on a
// Fuliza offer or the PIN screen): never treat these as a failure.
const PENDING_RESULT_CODES = new Set(['', '4999', STILL_PROCESSING]);
// Daraja error codes that only mean "ask again later" (rate limit, system busy).
const RETRY_LATER_ERRORS = new Set([STILL_PROCESSING, '500.003.02', '500.003.03', '429.001.01']);

export class MpesaError extends Error {
  constructor(message, { ambiguous = false, code } = {}) {
    super(message);
    this.name = 'MpesaError';
    // True when Safaricom may have accepted the request even though we did not get an answer.
    this.ambiguous = ambiguous;
    this.code = code;
  }
}

let tokenCache = { value: null, expiresAt: 0 };

const requireConfig = () => {
  const missing = ['MPESA_CONSUMER_KEY', 'MPESA_CONSUMER_SECRET', 'MPESA_SHORTCODE', 'MPESA_PASSKEY', 'MPESA_CALLBACK_URL']
    .filter(key => !process.env[key]);
  if (missing.length) throw new MpesaError(`M-Pesa is not configured: missing ${missing.join(', ')}`);
};

const timestamp = (now = new Date()) => {
  // Daraja expects East Africa Time (UTC+3), formatted YYYYMMDDHHmmss.
  const eat = new Date(now.getTime() + 3 * 3600_000);
  return eat.toISOString().replace(/[-:T]/g, '').slice(0, 14);
};

class MpesaService {
  static resetTokenCache() {
    tokenCache = { value: null, expiresAt: 0 };
  }

  static async getAccessToken() {
    if (tokenCache.value && Date.now() < tokenCache.expiresAt) return tokenCache.value;
    const credentials = Buffer.from(`${process.env.MPESA_CONSUMER_KEY.trim()}:${process.env.MPESA_CONSUMER_SECRET.trim()}`).toString('base64');
    let response;
    try {
      response = await withRetry(
        () => axios.get(`${baseUrl()}/oauth/v1/generate?grant_type=client_credentials`, {
          headers: { Authorization: `Basic ${credentials}` },
          timeout: 10_000,
        }),
        { retries: 2, shouldRetry: error => isConnectionError(error) || isTimeout(error) || isRetryableStatus(error) }
      );
    } catch (error) {
      // 400/401 here means the keys do not belong to this environment (sandbox keys on production or vice versa).
      const status = error.response?.status;
      logger.error(`M-Pesa login failed on ${process.env.MPESA_ENV ?? 'sandbox'} (HTTP ${status ?? 'no response'}): ${JSON.stringify(error.response?.data ?? error.message)}`);
      throw new MpesaError(status
        ? `M-Pesa login failed (HTTP ${status}). Check MPESA_CONSUMER_KEY/SECRET belong to the ${process.env.MPESA_ENV === 'production' ? 'production (Go-Live)' : 'sandbox'} app.`
        : 'Could not reach M-Pesa. Please try again.', { ambiguous: false });
    }
    const ttlSeconds = Number(response.data.expires_in) || 3599;
    tokenCache = { value: response.data.access_token, expiresAt: Date.now() + (ttlSeconds - 60) * 1000 };
    return tokenCache.value;
  }

  static password(time) {
    return Buffer.from(`${process.env.MPESA_SHORTCODE}${process.env.MPESA_PASSKEY}${time}`).toString('base64');
  }

  /**
   * POSTs to Daraja with a cached token. A rejected token is refreshed once.
   * Only failures where Safaricom cannot have acted are retried unless `retryTimeouts` is set.
   */
  static async post(path, body, { retryTimeouts }) {
    let refreshed = false;
    return withRetry(async () => {
      const token = await this.getAccessToken();
      try {
        return await axios.post(`${baseUrl()}${path}`, body, {
          headers: { Authorization: `Bearer ${token}` },
          timeout: 20_000,
        });
      } catch (error) {
        if (error.response?.status === 401 && !refreshed) {
          refreshed = true;
          this.resetTokenCache();
          error.retryAfterRefresh = true;
        }
        throw error;
      }
    }, {
      retries: 3,
      shouldRetry: error => error.retryAfterRefresh
        || isConnectionError(error)
        || isRetryableStatus(error)
        || (retryTimeouts && isTimeout(error)),
      onRetry: (error, attempt) => logger.warn(`M-Pesa ${path} retry ${attempt + 1}: ${error.code ?? error.response?.status ?? error.message}`),
    });
  }

  /**
   * Sends the STK prompt. Returns Safaricom's request ids.
   * Throws MpesaError; `ambiguous` means the prompt may still reach the customer.
   */
  static async initiateSTKPush({ phoneNumber, amount, callbackToken, reference, description }) {
    requireConfig();
    const phone = String(phoneNumber).replace(/\D/g, '');
    if (!/^254[17]\d{8}$/.test(phone)) throw new MpesaError('Phone number must be in the format 2547XXXXXXXX or 2541XXXXXXXX');
    const time = timestamp();
    const callbackBase = process.env.MPESA_CALLBACK_URL.trim().replace(/\/+$/, '');
    const body = {
      BusinessShortCode: process.env.MPESA_SHORTCODE,
      Password: this.password(time),
      Timestamp: time,
      TransactionType: process.env.MPESA_TRANSACTION_TYPE || 'CustomerPayBillOnline',
      Amount: Math.max(1, Math.round(Number(amount))),
      PartyA: phone,
      PartyB: process.env.MPESA_PARTY_B || process.env.MPESA_SHORTCODE,
      PhoneNumber: phone,
      CallBackURL: `${callbackBase}/${callbackToken}`,
      AccountReference: String(reference).slice(0, 12),
      TransactionDesc: String(description).slice(0, 13),
    };
    try {
      // Never retry a timed-out push: the customer may already have the prompt on their phone.
      const response = await this.post('/mpesa/stkpush/v1/processrequest', body, { retryTimeouts: false });
      if (response.data.ResponseCode !== '0') {
        throw new MpesaError(response.data.ResponseDescription || 'M-Pesa rejected the payment request', { code: response.data.ResponseCode });
      }
      return {
        checkoutRequestId: response.data.CheckoutRequestID,
        merchantRequestId: response.data.MerchantRequestID,
      };
    } catch (error) {
      if (error instanceof MpesaError) throw error;
      const ambiguous = isTimeout(error) || (error.response?.status ?? 0) >= 500;
      // Show Safaricom's own reason (e.g. "Bad Request - Invalid CallBackURL"), not just the HTTP status.
      const body = error.response?.data;
      const detail = body?.errorMessage ?? body?.ResponseDescription ?? (body ? JSON.stringify(body).slice(0, 300) : error.message);
      logger.error(`STK push failed (${ambiguous ? 'ambiguous' : 'rejected'}): ${detail}`);
      throw new MpesaError(ambiguous ? 'M-Pesa did not respond in time' : `M-Pesa rejected the request: ${detail}`, { ambiguous });
    }
  }

  /**
   * Asks Safaricom for the outcome of a prompt.
   * Returns { state: 'pending' } | { state: 'success' | 'failed', resultCode, resultDesc }.
   */
  static async querySTKPush(checkoutRequestId) {
    requireConfig();
    const time = timestamp();
    try {
      const response = await this.post('/mpesa/stkpushquery/v1/query', {
        BusinessShortCode: process.env.MPESA_SHORTCODE,
        Password: this.password(time),
        Timestamp: time,
        CheckoutRequestID: checkoutRequestId,
      }, { retryTimeouts: true });
      const resultCode = String(response.data.ResultCode ?? '');
      if (PENDING_RESULT_CODES.has(resultCode)) return { state: 'pending', resultCode, resultDesc: response.data.ResultDesc };
      return { state: resultCode === '0' ? 'success' : 'failed', resultCode, resultDesc: response.data.ResultDesc };
    } catch (error) {
      if (RETRY_LATER_ERRORS.has(error.response?.data?.errorCode)) return { state: 'pending', resultCode: error.response.data.errorCode };
      throw error;
    }
  }

  /** Normalises the STK callback body. */
  static processCallback(callbackData) {
    const callback = callbackData?.Body?.stkCallback;
    if (!callback?.CheckoutRequestID) throw new MpesaError('Invalid callback payload');
    const items = callback.CallbackMetadata?.Item ?? [];
    const item = name => items.find(entry => entry.Name === name)?.Value;
    return {
      success: Number(callback.ResultCode) === 0,
      checkoutRequestId: callback.CheckoutRequestID,
      merchantRequestId: callback.MerchantRequestID,
      resultCode: String(callback.ResultCode),
      resultDesc: callback.ResultDesc,
      amount: item('Amount'),
      mpesaReceiptNumber: item('MpesaReceiptNumber'),
      transactionDate: item('TransactionDate'),
      phoneNumber: item('PhoneNumber'),
    };
  }
}

export default MpesaService;
