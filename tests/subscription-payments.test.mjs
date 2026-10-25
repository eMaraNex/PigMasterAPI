import { jest } from '@jest/globals';
import { generateKeyPairSync } from 'node:crypto';
import jwt from 'jsonwebtoken';

const executeQueryMock = jest.fn();
const withTransactionMock = jest.fn();
const initiateSTKPushMock = jest.fn();
const firebaseCertificateRequestMock = jest.fn();

jest.unstable_mockModule('axios', () => ({
  default: { get: firebaseCertificateRequestMock },
}));

jest.unstable_mockModule('../src/config/database.js', () => ({
  DatabaseHelper: {
    executeQuery: executeQueryMock,
    withTransaction: withTransactionMock,
  },
  pool: {
    connect: jest.fn(),
  },
}));

jest.unstable_mockModule('../src/services/mpesa.services.js', () => {
  class MpesaError extends Error {
    constructor(message, { ambiguous = false } = {}) {
      super(message);
      this.ambiguous = ambiguous;
    }
  }
  return {
    MpesaError,
    default: {
      initiateSTKPush: initiateSTKPushMock,
      processCallback: jest.fn(() => ({
        success: true,
        checkoutRequestId: 'checkout-1',
        merchantRequestId: 'merchant-1',
        resultCode: '0',
        amount: 130,
        mpesaReceiptNumber: 'ABC123',
        transactionDate: '20261023120000',
        phoneNumber: 254700000000,
      })),
    },
  };
});

jest.unstable_mockModule('../src/services/email.services.js', () => ({
  default: class EmailService {
    constructor() {
      this.logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    }
    async sendEmail() {
      return { success: true, message: 'mocked email' };
    }
  },
}));

const { default: PaymentService } = await import('../src/services/payment.service.js');
const { default: AuthService } = await import('../src/services/auth.services.js');
const { withRetry } = await import('../src/utils/retry.js');

describe('subscription and payment flow', () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  const publicCertificate = publicKey.export({
    format: 'pem',
    type: 'spki',
  });

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.FIREBASE_PROJECT_ID = 'pigmaster-test';
    process.env.JWT_SECRET = 'test-jwt-secret-with-enough-entropy';
    firebaseCertificateRequestMock.mockResolvedValue({
      data: { 'test-kid': publicCertificate },
      headers: { 'cache-control': 'max-age=60' },
    });
    process.env.USD_TO_KES_RATE = '130';
    executeQueryMock.mockImplementation((query) => {
      if (query.includes('INSERT INTO roles')) {
        return { rowCount: 1, rows: [] };
      }
      if (query.includes('SELECT id, name, permissions FROM roles WHERE id')) {
        return { rows: [{ id: 1, name: 'free', permissions: [] }] };
      }
      if (query.includes('SELECT id FROM roles WHERE name')) {
        return { rows: [{ id: 1 }] };
      }
      if (query.includes('SELECT id FROM users WHERE email')) {
        return { rows: [] };
      }
      if (query.includes('SELECT * FROM users WHERE email = $1')) {
        return { rows: [{
          id: 'user-1',
          email: 'verified@example.com',
          name: 'Verified User',
          role_id: 1,
          farm_id: null,
          email_verified: true,
          permissions: [],
        }] };
      }
      if (query.includes('INSERT INTO users')) {
        return { rows: [{ id: 'user-1', email: 'new@example.com', name: 'New User', role_id: 1, farm_id: null, email_verified: false, is_active: 1, is_deleted: 0, created_at: new Date() }] };
      }
      if (query.includes('INSERT INTO subscription_plans')) {
        return { rowCount: 1, rows: [] };
      }
      if (query.includes('SELECT s.*, sp.name AS plan_name')) {
        return { rows: [] };
      }
      if (query.includes('INSERT INTO subscriptions')) {
        return { rows: [{ id: 'subscription-1' }] };
      }
      return { rows: [] };
    });
  });

  test('register creates a trial subscription for a new user', async () => {
    const result = await AuthService.register({
      email: 'new@example.com',
      password: 'Password123!',
      name: 'New User',
      phone: '254700000000',
      role_id: 1,
      farm_id: null,
      privacy_policy_accepted: true,
      marketing_consent: false,
    });

    expect(result).toBeDefined();
    expect(executeQueryMock).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO subscriptions'),
      expect.any(Array)
    );
  });

  test('register requires explicit privacy consent before creating an account', async () => {
    await expect(AuthService.register({
      email: 'consent@example.com',
      password: 'Password123!',
      name: 'Consent User',
      phone: '254700000001',
      role_id: 1,
      farm_id: null,
      privacy_policy_accepted: false,
    })).rejects.toThrow('privacy policy consent');
  });

  test('SSO rejects caller-supplied identity without a Firebase ID token', async () => {
    await expect(AuthService.ssoAuth({
      email: 'victim@example.com',
      name: 'Victim',
      provider: 'google',
    })).rejects.toThrow('Firebase ID token is required');
    expect(executeQueryMock).not.toHaveBeenCalled();
  });

  test('SSO verifies Firebase token claims before resolving an account', async () => {
    const idToken = jwt.sign({
      sub: 'firebase-user-1',
      email: 'verified@example.com',
      email_verified: true,
      name: 'Verified User',
      aud: 'pigmaster-test',
      iss: 'https://securetoken.google.com/pigmaster-test',
    }, privateKey, {
      algorithm: 'RS256',
      keyid: 'test-kid',
      expiresIn: '5m',
    });

    const result = await AuthService.ssoAuth({ idToken });
    expect(result.user.email).toBe('verified@example.com');
    expect(firebaseCertificateRequestMock).toHaveBeenCalledTimes(1);
    expect(executeQueryMock).toHaveBeenCalledWith(
      expect.stringContaining('SELECT * FROM users WHERE email = $1'),
      ['verified@example.com']
    );
  });

  const callbackToken = 'a'.repeat(48);
  const pendingPayment = (overrides = {}) => ({
    id: 'payment-1', user_id: 'user-1', plan: 'standard', amount: '130.00', phone_number: '254700000000',
    status: 'pending', metadata: { duration_months: 1 }, checkout_request_id: 'checkout-1',
    callback_token: callbackToken, ...overrides,
  });
  const planQuote = sql => sql.includes('FROM subscription_plans WHERE name = $1 AND is_active = 1 LIMIT 1');

  /** Fake transactional client whose responses are chosen by SQL fragment. */
  const fakeClient = handlers => ({
    query: jest.fn(async sql => {
      for (const [fragment, result] of handlers) {
        if (sql.includes(fragment)) return typeof result === 'function' ? result() : result;
      }
      return { rows: [], rowCount: 0 };
    }),
  });

  test('only M-Pesa can be used and nothing is written for other methods', async () => {
    await expect(PaymentService.createPayment({ id: 'user-1' }, {
      plan: 'standard', amount: 130, currency: 'KES', payment_mode: 'paypal', phone_number: '254700000000',
    })).rejects.toThrow('Only M-Pesa');
    expect(withTransactionMock).not.toHaveBeenCalled();
    expect(initiateSTKPushMock).not.toHaveBeenCalled();
  });

  test('retrying with the same Idempotency-Key returns the first payment without a second STK push', async () => {
    executeQueryMock.mockImplementation(async sql => (planQuote(sql)
      ? { rows: [{ name: 'standard', price: '1', currency: 'USD', duration_months: 1 }] }
      : { rows: [] }));
    const client = fakeClient([['idempotency_key = $2', { rows: [pendingPayment({ idempotency_key: 'key-12345678' })] }]]);
    withTransactionMock.mockImplementation(fn => fn(client));

    const result = await PaymentService.createPayment({ id: 'user-1' }, {
      plan: 'standard', amount: 130, currency: 'KES', payment_mode: 'mpesa', phone_number: '254700000000',
    }, 'key-12345678');

    expect(result.replayed).toBe(true);
    expect(result.callback_token).toBeUndefined();
    expect(initiateSTKPushMock).not.toHaveBeenCalled();
    expect(client.query).not.toHaveBeenCalledWith(expect.stringContaining('INSERT INTO payments'), expect.anything());
  });

  test('client-side amount tampering is rejected before any payment is created', async () => {
    executeQueryMock.mockImplementation(async sql => (planQuote(sql)
      ? { rows: [{ name: 'standard', price: '1', currency: 'USD', duration_months: 1 }] }
      : { rows: [] }));
    await expect(PaymentService.createPayment({ id: 'user-1' }, {
      plan: 'standard', amount: 1, currency: 'KES', payment_mode: 'mpesa', phone_number: '254700000000',
    })).rejects.toThrow('does not match');
    expect(withTransactionMock).not.toHaveBeenCalled();
  });

  test('a callback with an unknown token is rejected and changes nothing', async () => {
    const client = fakeClient([['WHERE callback_token = $1', { rows: [] }]]);
    withTransactionMock.mockImplementation(fn => fn(client));
    const result = await PaymentService.handleMpesaCallback('b'.repeat(48), { Body: { stkCallback: {} } });
    expect(result.accepted).toBe(false);
    expect(client.query).not.toHaveBeenCalledWith(expect.stringContaining("SET status = 'success'"), expect.anything());
  });

  test('a duplicate callback does not activate the subscription twice', async () => {
    let status = 'pending';
    const client = fakeClient([
      ['WHERE callback_token = $1', () => ({ rows: [pendingPayment({ status })] })],
      ["SET status = 'success'", () => { status = 'success'; return { rows: [pendingPayment({ status })] }; }],
      ['FROM subscription_plans WHERE name = $1', { rows: [{ id: 'plan-1', name: 'standard', duration_months: 1 }] }],
      ['SELECT id FROM roles WHERE name = $1', { rows: [{ id: 2 }] }],
      ['INSERT INTO subscriptions', { rows: [{ id: 'subscription-1' }] }],
    ]);
    withTransactionMock.mockImplementation(fn => fn(client));

    const first = await PaymentService.handleMpesaCallback(callbackToken, { Body: { stkCallback: {} } });
    const second = await PaymentService.handleMpesaCallback(callbackToken, { Body: { stkCallback: {} } });

    expect(first).toEqual({ accepted: true, duplicate: false });
    expect(second).toEqual({ accepted: true, duplicate: true });
    const activations = client.query.mock.calls.filter(([sql]) => sql.includes('INSERT INTO subscriptions'));
    expect(activations).toHaveLength(1);
  });

  test('retry helper retries transient failures and stops on permanent ones', async () => {
    const transient = Object.assign(new Error('reset'), { code: 'ECONNRESET' });
    const fn = jest.fn().mockRejectedValueOnce(transient).mockResolvedValueOnce('ok');
    await expect(withRetry(fn, { delay: async () => {}, shouldRetry: error => error.code === 'ECONNRESET' })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);

    const permanent = jest.fn().mockRejectedValue(new Error('bad request'));
    await expect(withRetry(permanent, { delay: async () => {}, shouldRetry: () => false })).rejects.toThrow('bad request');
    expect(permanent).toHaveBeenCalledTimes(1);
  });
});
