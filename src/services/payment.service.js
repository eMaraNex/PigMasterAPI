import { randomBytes, timingSafeEqual } from 'node:crypto';
import Joi from 'joi';
import { DatabaseHelper, pool } from '../config/database.js';
import logger from '../middleware/logger.js';
import { NotFoundError, ValidationError } from '../middleware/errors.js';
import { ConflictError } from '../business/helpers.js';
import MpesaService, { MpesaError } from './mpesa.services.js';
import SubscriptionService from './subscription.service.js';

const PENDING_REUSE_WINDOW_SECONDS = 120;
const PENDING_EXPIRY_MINUTES = 30;
const STATUS_CHECK_INTERVAL_SECONDS = 10;
const RECONCILE_BATCH = 50;
// The prompt can stay open for minutes (Fuliza offer, then PIN). Until then a "failed"
// status-query answer is not trusted: M-Pesa can still complete the payment.
const CONFIRMATION_GRACE_SECONDS = 180;
// Only an explicit cancel by the customer is final straight away.
const DEFINITIVE_QUERY_FAILURES = new Set(['1032']);
// Payments failed by a status query or timeout are re-checked this long, so a late success is never lost.
const LATE_RECOVERY_HOURS = 24;
const RECOVERY_CHECK_MINUTES = 5;
const RECOVERY_MAX_CHECKS = 60;
const PUBLIC_COLUMNS = `id, plan, amount, currency, payment_mode, phone_number, status, failure_reason,
  mpesa_receipt_number, checkout_request_id, metadata, created_at, updated_at, completed_at`;

export const paymentRequestSchema = Joi.object({
  plan: Joi.string().trim().max(50).required(),
  plan_period: Joi.string().valid('monthly', 'yearly').default('monthly'),
  payment_mode: Joi.string().valid('mpesa').required().messages({
    'any.only': 'Only M-Pesa payments are currently supported',
  }),
  phone_number: Joi.string().pattern(/^254[17]\d{8}$/).required().messages({
    'string.pattern.base': 'Enter the M-Pesa number as 2547XXXXXXXX or 2541XXXXXXXX',
  }),
  amount: Joi.number().positive().required(),
  currency: Joi.string().valid('KES').required(),
  // Older clients send the billing period inside metadata.
  metadata: Joi.object({ plan_period: Joi.string().valid('monthly', 'yearly') }).unknown(true),
});

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,100}$/;

const publicPayment = payment => {
  if (!payment) return payment;
  const { callback_token: _token, callback_payload: _payload, idempotency_key: _key, ...rest } = payment;
  return rest;
};

const tokensMatch = (expected, supplied) => {
  if (!expected || !supplied || expected.length !== supplied.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(supplied));
};

class PaymentService {
  /** Prices always come from the plan table and the server-side exchange rate. */
  static async quotePayment(planName, planPeriod = 'monthly') {
    if (!['monthly', 'yearly'].includes(planPeriod)) {
      throw new ValidationError('Billing period must be monthly or yearly');
    }
    const result = await DatabaseHelper.executeQuery(
      `SELECT name, price, currency, duration_months
       FROM subscription_plans WHERE name = $1 AND is_active = 1 LIMIT 1`,
      [planName]
    );
    const plan = result.rows[0];
    if (!plan || plan.name === 'free' || Number(plan.price) <= 0) throw new ValidationError('Paid subscription plan not found');
    const durationMonths = Math.max(1, Number(plan.duration_months) || 1) * (planPeriod === 'yearly' ? 12 : 1);
    // 16% discount for yearly billing, calculated on the server from the plan price.
    let amount = Number(plan.price) * durationMonths * (planPeriod === 'yearly' ? 0.84 : 1);
    if (plan.currency !== 'KES') {
      const rate = Number(process.env.USD_TO_KES_RATE);
      if (plan.currency !== 'USD' || !Number.isFinite(rate) || rate <= 0) {
        throw new ValidationError('A valid server-side USD_TO_KES_RATE is required to quote M-Pesa in KES');
      }
      amount *= rate;
    }
    return { plan: plan.name, planPeriod, durationMonths, amount: Math.max(1, Math.round(amount)), currency: 'KES' };
  }

  /**
   * Starts an M-Pesa STK push exactly once per idempotency key.
   * Repeating the request with the same key returns the original payment instead of
   * prompting the customer again; a matching pending payment from the last two minutes
   * is also reused when no key is sent (double clicks, flaky networks).
   */
  static async createPayment(user, body, idempotencyKey = null) {
    const { error, value } = paymentRequestSchema.validate(body ?? {}, { abortEarly: false, stripUnknown: true });
    if (error) throw new ValidationError(`Validation error: ${error.details.map(detail => detail.message).join(', ')}`);
    if (idempotencyKey && !IDEMPOTENCY_KEY.test(idempotencyKey)) {
      throw new ValidationError('Idempotency-Key must be 8-100 letters, digits, "-" or "_"');
    }
    const quote = await this.quotePayment(value.plan, value.metadata?.plan_period ?? value.plan_period);
    if (Math.round(value.amount) !== quote.amount) {
      throw new ValidationError('Payment amount does not match the current plan price. Refresh and try again.');
    }

    const { payment, replayed } = await DatabaseHelper.withTransaction(async client => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`payment:${user.id}`]);
      if (idempotencyKey) {
        const existing = await client.query(
          'SELECT * FROM payments WHERE user_id = $1 AND idempotency_key = $2',
          [user.id, idempotencyKey]
        );
        if (existing.rows.length) {
          const previous = existing.rows[0];
          if (previous.plan !== quote.plan || previous.phone_number !== value.phone_number || Number(previous.amount) !== quote.amount) {
            throw new ConflictError('This Idempotency-Key was already used for a different payment');
          }
          return { payment: previous, replayed: true };
        }
      }
      const recent = await client.query(
        `SELECT * FROM payments
         WHERE user_id = $1 AND status = 'pending' AND plan = $2 AND phone_number = $3 AND amount = $4 AND is_deleted = 0
           AND created_at > CURRENT_TIMESTAMP - make_interval(secs => $5)
         ORDER BY created_at DESC LIMIT 1`,
        [user.id, quote.plan, value.phone_number, quote.amount, PENDING_REUSE_WINDOW_SECONDS]
      );
      if (recent.rows.length) return { payment: recent.rows[0], replayed: true };

      const inserted = await client.query(
        `INSERT INTO payments (user_id, farm_id, plan, amount, currency, payment_mode, phone_number,
           idempotency_key, callback_token, status, metadata)
         VALUES ($1, $2, $3, $4, 'KES', 'mpesa', $5, $6, $7, 'pending', $8::jsonb)
         RETURNING *`,
        [user.id, user.farm_id ?? null, quote.plan, quote.amount, value.phone_number, idempotencyKey,
          randomBytes(24).toString('hex'),
          JSON.stringify({ plan_period: quote.planPeriod, duration_months: quote.durationMonths })]
      );
      return { payment: inserted.rows[0], replayed: false };
    });

    if (replayed) {
      logger.info(`Payment ${payment.id} replayed for user ${user.id}; no new STK push sent`);
      return { ...publicPayment(payment), replayed: true };
    }

    try {
      const stk = await MpesaService.initiateSTKPush({
        phoneNumber: payment.phone_number,
        amount: payment.amount,
        callbackToken: payment.callback_token,
        reference: 'PigMaster',
        description: `Plan ${payment.plan}`,
      });
      const updated = await DatabaseHelper.executeQuery(
        `UPDATE payments SET checkout_request_id = $2, merchant_request_id = $3, transaction_id = $2
         WHERE id = $1 RETURNING *`,
        [payment.id, stk.checkoutRequestId, stk.merchantRequestId]
      );
      logger.info(`STK push sent for payment ${payment.id}`);
      return { ...publicPayment(updated.rows[0]), replayed: false };
    } catch (error) {
      if (error instanceof MpesaError && error.ambiguous) {
        // The prompt may still arrive; the per-payment callback URL lets us match it without a checkout id.
        const updated = await DatabaseHelper.executeQuery(
          `UPDATE payments SET failure_reason = 'Waiting for M-Pesa to confirm the request' WHERE id = $1 RETURNING *`,
          [payment.id]
        );
        return { ...publicPayment(updated.rows[0]), replayed: false };
      }
      await DatabaseHelper.executeQuery(
        `UPDATE payments SET status = 'failed', failure_reason = $2, completed_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [payment.id, error.message.slice(0, 500)]
      );
      throw new ValidationError(error instanceof MpesaError ? error.message : 'Could not start the M-Pesa payment. Please try again.');
    }
  }

  /**
   * Applies a definitive outcome to a locked, still-pending payment and activates the
   * subscription in the same transaction. Safe to call from the callback, polling and
   * the reconciler: whichever arrives second sees a non-pending payment and stops.
   */
  static async finalizePayment(client, payment, outcome) {
    // Money taken always wins: a verified success upgrades a payment we had given up on.
    const lateSuccess = payment.status === 'failed' && outcome.state === 'success';
    if (payment.status !== 'pending' && !lateSuccess) return { changed: false, payment };

    if (outcome.state === 'success' && outcome.amount !== undefined) {
      const normalize = phone => String(phone ?? '').replace(/\D/g, '').slice(-9);
      const amountOk = Math.abs(Number(outcome.amount) - Number(payment.amount)) <= 1;
      const phoneOk = !outcome.phoneNumber || normalize(outcome.phoneNumber) === normalize(payment.phone_number);
      if (!amountOk || !phoneOk) {
        logger.error(`Payment ${payment.id} callback mismatch (amount ok: ${amountOk}, phone ok: ${phoneOk}); flagged for review`);
        outcome = { state: 'failed', resultDesc: 'Paid amount or phone did not match the request; contact support', review: true };
      }
    }

    if (outcome.state === 'success') {
      const updated = await client.query(
        `UPDATE payments
         SET status = 'success', failure_reason = NULL, completed_at = CURRENT_TIMESTAMP,
             mpesa_receipt_number = COALESCE($2, mpesa_receipt_number),
             metadata = metadata || $3::jsonb
         WHERE id = $1 RETURNING *`,
        [payment.id, outcome.mpesaReceiptNumber ?? null,
          JSON.stringify({
            confirmed_by: outcome.source,
            verified_with_query: outcome.verified ?? outcome.source === 'query',
            transaction_date: outcome.transactionDate ?? null,
            recovered_late: lateSuccess,
          })]
      );
      await SubscriptionService.activatePaidSubscription(client, {
        userId: payment.user_id,
        planName: payment.plan,
        paymentId: payment.id,
        durationMonths: payment.metadata?.duration_months,
      });
      return { changed: true, payment: updated.rows[0] };
    }

    const updated = await client.query(
      `UPDATE payments
       SET status = 'failed', failure_reason = $2, completed_at = CURRENT_TIMESTAMP,
           metadata = metadata || $3::jsonb
       WHERE id = $1 RETURNING *`,
      [payment.id, String(outcome.resultDesc ?? 'Payment was not completed').slice(0, 500),
        JSON.stringify({ result_code: outcome.resultCode ?? null, needs_review: Boolean(outcome.review), final_source: outcome.source ?? null })]
    );
    return { changed: true, payment: updated.rows[0] };
  }

  /**
   * Safaricom callback. Never trusted on its own:
   *  1. the secret token in the URL must match a payment we created;
   *  2. Safaricom's CheckoutRequestID and MerchantRequestID must match that payment;
   *  3. a "success" is confirmed with Safaricom's status query before anything is granted,
   *     and the paid amount and phone must match the request (checked in finalizePayment);
   *  4. processing is idempotent: repeats change nothing, and the M-Pesa receipt is unique.
   * Declines are recorded straight away (they grant nothing) but a later verified success still wins.
   */
  static async handleMpesaCallback(token, callbackData, { ip = null } = {}) {
    let processed;
    try {
      processed = MpesaService.processCallback(callbackData);
    } catch {
      logger.warn('M-Pesa callback rejected: malformed payload');
      return { accepted: false };
    }

    const payment = await DatabaseHelper.withTransaction(async client => {
      const { rows } = await client.query('SELECT * FROM payments WHERE callback_token = $1 AND is_deleted = 0 FOR UPDATE', [token]);
      const found = rows[0];
      if (!found || !tokensMatch(found.callback_token, token)) {
        logger.warn(`M-Pesa callback rejected: unknown callback token (ip ${ip})`);
        return null;
      }
      const checkoutMismatch = found.checkout_request_id && found.checkout_request_id !== processed.checkoutRequestId;
      const merchantMismatch = found.merchant_request_id && processed.merchantRequestId && found.merchant_request_id !== processed.merchantRequestId;
      if (checkoutMismatch || merchantMismatch) {
        logger.warn(`M-Pesa callback rejected for payment ${found.id}: request ids do not match (ip ${ip})`);
        return null;
      }
      await client.query(
        `UPDATE payments SET callback_payload = $2::jsonb,
           checkout_request_id = COALESCE(checkout_request_id, $3), merchant_request_id = COALESCE(merchant_request_id, $4)
         WHERE id = $1`,
        [found.id, JSON.stringify({ ...callbackData, received_at: new Date().toISOString(), source_ip: ip }),
          processed.checkoutRequestId, processed.merchantRequestId]
      );
      return found;
    });
    if (!payment) return { accepted: false };

    if (!processed.success) {
      await DatabaseHelper.withTransaction(async client => {
        const locked = await client.query('SELECT * FROM payments WHERE id = $1 FOR UPDATE', [payment.id]);
        await this.finalizePayment(client, locked.rows[0], {
          state: 'failed', source: 'callback', resultCode: processed.resultCode, resultDesc: processed.resultDesc,
        });
      });
      return { accepted: true };
    }

    // Independent confirmation with Safaricom (retried inside the M-Pesa client).
    let verification;
    try {
      verification = await MpesaService.querySTKPush(processed.checkoutRequestId);
    } catch (error) {
      verification = { state: 'pending', error: error.message };
    }

    return DatabaseHelper.withTransaction(async client => {
      const locked = (await client.query('SELECT * FROM payments WHERE id = $1 FOR UPDATE', [payment.id])).rows[0];
      if (verification.state === 'success') {
        const { changed } = await this.finalizePayment(client, locked, { state: 'success', source: 'callback', verified: true, ...processed });
        if (!changed) {
          // Already confirmed by a status check (which carries no receipt): keep the receipt for audits.
          if (locked.status === 'success' && !locked.mpesa_receipt_number && processed.mpesaReceiptNumber) {
            await client.query(
              `UPDATE payments SET mpesa_receipt_number = $2, metadata = metadata || $3::jsonb WHERE id = $1`,
              [payment.id, processed.mpesaReceiptNumber, JSON.stringify({ transaction_date: processed.transactionDate ?? null, receipt_from_callback: true })]
            );
          }
          logger.info(`Duplicate M-Pesa callback for payment ${payment.id} ignored`);
        }
        return { accepted: true, duplicate: !changed };
      }
      if (verification.state === 'pending') {
        // Could not confirm yet: keep it pending; polling and the reconciler confirm it with Safaricom.
        await client.query(
          `UPDATE payments SET metadata = metadata || '{"awaiting_verification": true}'::jsonb WHERE id = $1`,
          [payment.id]
        );
        logger.info(`M-Pesa success callback for payment ${payment.id} awaiting confirmation from Safaricom`);
        return { accepted: true, verified: false };
      }
      // Safaricom says it did not succeed although the callback claims it did: never grant access.
      logger.error(`M-Pesa success callback for payment ${payment.id} contradicted by status query (${verification.resultCode}); flagged`);
      await client.query(
        `UPDATE payments SET metadata = metadata || $2::jsonb WHERE id = $1`,
        [payment.id, JSON.stringify({ needs_review: true, unverified_success_callback: true, query_result: verification.resultCode ?? null })]
      );
      return { accepted: true, verified: false };
    });
  }

  /**
   * Asks Safaricom for the outcome of one payment and applies it if it is definitive.
   * Pending payments are checked at most every few seconds; failed ones (by query or
   * timeout) are re-checked for LATE_RECOVERY_HOURS so a late success is recovered.
   */
  static async refreshFromMpesa(paymentId, { recovering = false } = {}) {
    const { rows } = await DatabaseHelper.executeQuery(
      `UPDATE payments SET status_checks = status_checks + 1, last_checked_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND checkout_request_id IS NOT NULL
         AND status = $3
         AND (last_checked_at IS NULL OR last_checked_at < CURRENT_TIMESTAMP - make_interval(secs => $2))
       RETURNING checkout_request_id, created_at`,
      [paymentId, recovering ? RECOVERY_CHECK_MINUTES * 60 : STATUS_CHECK_INTERVAL_SECONDS, recovering ? 'failed' : 'pending']
    );
    if (!rows.length) return;
    let outcome;
    try {
      outcome = await MpesaService.querySTKPush(rows[0].checkout_request_id);
    } catch (error) {
      logger.warn(`M-Pesa status query failed for payment ${paymentId}: ${error.message}`);
      return;
    }
    if (outcome.state === 'pending') return;
    if (recovering && outcome.state !== 'success') return;

    const ageSeconds = (Date.now() - new Date(rows[0].created_at).getTime()) / 1000;
    if (outcome.state === 'failed' && ageSeconds < CONFIRMATION_GRACE_SECONDS && !DEFINITIVE_QUERY_FAILURES.has(outcome.resultCode)) {
      // Too early to call it a failure (Fuliza/PIN still on screen); remember what M-Pesa said.
      await DatabaseHelper.executeQuery(
        `UPDATE payments SET metadata = metadata || $2::jsonb WHERE id = $1`,
        [paymentId, JSON.stringify({ last_query: { code: outcome.resultCode, desc: outcome.resultDesc, at: new Date().toISOString() } })]
      );
      return;
    }
    await DatabaseHelper.withTransaction(async client => {
      const locked = await client.query('SELECT * FROM payments WHERE id = $1 FOR UPDATE', [paymentId]);
      const { changed } = await this.finalizePayment(client, locked.rows[0], { ...outcome, source: 'query' });
      if (changed && recovering) logger.warn(`Payment ${paymentId} recovered: M-Pesa confirmed success after it was marked failed`);
    });
  }

  /** Polled by the client after an STK push; checks Safaricom at most every few seconds. */
  static async getPaymentStatus(paymentId, userId) {
    if (!/^[0-9a-f-]{36}$/i.test(paymentId)) throw new ValidationError('Invalid payment id');
    let payment = await this.getOwnPayment(paymentId, userId);
    if (payment.status === 'pending') {
      await this.refreshFromMpesa(paymentId);
      payment = await this.getOwnPayment(paymentId, userId);
    }
    return payment;
  }

  static async getOwnPayment(paymentId, userId) {
    const { rows } = await DatabaseHelper.executeQuery(
      `SELECT ${PUBLIC_COLUMNS} FROM payments WHERE id = $1 AND user_id = $2 AND is_deleted = 0`,
      [paymentId, userId]
    );
    if (!rows.length) throw new NotFoundError('Payment not found');
    return rows[0];
  }

  static async listPayments(userId, { page = 1, limit = 20 } = {}) {
    const safeLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 20, 1), 100);
    const safePage = Math.min(Math.max(Number.parseInt(page, 10) || 1, 1), 10_000);
    const [rows, count] = await Promise.all([
      DatabaseHelper.executeQuery(
        `SELECT ${PUBLIC_COLUMNS} FROM payments WHERE user_id = $1 AND is_deleted = 0
         ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
        [userId, safeLimit, (safePage - 1) * safeLimit]
      ),
      DatabaseHelper.executeQuery('SELECT COUNT(*)::int AS total FROM payments WHERE user_id = $1 AND is_deleted = 0', [userId]),
    ]);
    return { data: rows.rows, total: count.rows[0].total, page: safePage, limit: safeLimit };
  }

  /** The customer can abandon a pending payment; a late success callback still wins (money was taken). */
  static async cancelPayment(paymentId, userId) {
    const { rows } = await DatabaseHelper.executeQuery(
      `UPDATE payments SET failure_reason = 'Cancelled by customer'
       WHERE id = $1 AND user_id = $2 AND status = 'pending' AND is_deleted = 0
       RETURNING ${PUBLIC_COLUMNS}`,
      [paymentId, userId]
    );
    if (!rows.length) throw new NotFoundError('Pending payment not found');
    return rows[0];
  }

  /**
   * Background reconciliation: resolves payments whose callback never arrived and
   * expires stale ones. Runs under an advisory lock so only one instance works at a time.
   */
  static async reconcilePendingPayments() {
    const client = await pool.connect();
    try {
      const lock = await client.query("SELECT pg_try_advisory_lock(hashtext('payments:reconcile')) AS acquired");
      if (!lock.rows[0].acquired) return { skipped: true };
      try {
        const { rows } = await client.query(
          `SELECT id FROM payments
           WHERE status = 'pending' AND is_deleted = 0 AND checkout_request_id IS NOT NULL
             AND created_at < CURRENT_TIMESTAMP - INTERVAL '60 seconds'
           ORDER BY last_checked_at NULLS FIRST LIMIT $1`,
          [RECONCILE_BATCH]
        );
        for (const { id } of rows) await this.refreshFromMpesa(id);
        const expired = await client.query(
          `UPDATE payments
           SET status = 'failed', completed_at = CURRENT_TIMESTAMP,
               failure_reason = COALESCE(failure_reason, 'No confirmation from M-Pesa'),
               metadata = metadata || '{"final_source": "timeout"}'::jsonb
           WHERE status = 'pending' AND is_deleted = 0
             AND created_at < CURRENT_TIMESTAMP - make_interval(mins => $1)
           RETURNING id`,
          [PENDING_EXPIRY_MINUTES]
        );
        // Late successes: keep asking Safaricom about payments we gave up on (not customer declines).
        const late = await client.query(
          `SELECT id FROM payments
           WHERE status = 'failed' AND is_deleted = 0 AND checkout_request_id IS NOT NULL
             AND metadata->>'final_source' IN ('query', 'timeout')
             AND completed_at > CURRENT_TIMESTAMP - make_interval(hours => $1)
             AND status_checks < $2
           ORDER BY last_checked_at NULLS FIRST LIMIT $3`,
          [LATE_RECOVERY_HOURS, RECOVERY_MAX_CHECKS, RECONCILE_BATCH]
        );
        for (const { id } of late.rows) await this.refreshFromMpesa(id, { recovering: true });
        return { checked: rows.length, expired: expired.rowCount, rechecked: late.rows.length };
      } finally {
        await client.query("SELECT pg_advisory_unlock(hashtext('payments:reconcile'))");
      }
    } finally {
      client.release();
    }
  }
}

export default PaymentService;
