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
    if (payment.status !== 'pending') return { changed: false, payment };

    if (outcome.state === 'success' && outcome.source === 'callback') {
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
          JSON.stringify({ confirmed_by: outcome.source, transaction_date: outcome.transactionDate ?? null })]
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
        JSON.stringify({ result_code: outcome.resultCode ?? null, needs_review: Boolean(outcome.review) })]
    );
    return { changed: true, payment: updated.rows[0] };
  }

  /** Safaricom callback. The token in the URL identifies the payment and proves the request came from our STK push. */
  static async handleMpesaCallback(token, callbackData) {
    const processed = MpesaService.processCallback(callbackData);
    return DatabaseHelper.withTransaction(async client => {
      const result = await client.query(
        'SELECT * FROM payments WHERE callback_token = $1 AND is_deleted = 0 FOR UPDATE',
        [token]
      );
      const payment = result.rows[0];
      if (!payment || !tokensMatch(payment.callback_token, token)) {
        logger.warn('M-Pesa callback rejected: unknown callback token');
        return { accepted: false };
      }
      if (payment.checkout_request_id && payment.checkout_request_id !== processed.checkoutRequestId) {
        logger.warn(`M-Pesa callback rejected for payment ${payment.id}: checkout id mismatch`);
        return { accepted: false };
      }
      await client.query(
        `UPDATE payments SET callback_payload = $2::jsonb,
           checkout_request_id = COALESCE(checkout_request_id, $3), merchant_request_id = COALESCE(merchant_request_id, $4)
         WHERE id = $1`,
        [payment.id, JSON.stringify({ ...callbackData, received_at: new Date().toISOString() }),
          processed.checkoutRequestId, processed.merchantRequestId]
      );
      const outcome = processed.success
        ? { state: 'success', source: 'callback', ...processed }
        : { state: 'failed', source: 'callback', resultCode: processed.resultCode, resultDesc: processed.resultDesc };
      const { changed } = await this.finalizePayment(client, payment, outcome);
      if (!changed) logger.info(`Duplicate M-Pesa callback for payment ${payment.id} ignored`);
      return { accepted: true, duplicate: !changed };
    });
  }

  /** Queries Safaricom for one pending payment and finalises it if the result is definitive. */
  static async refreshFromMpesa(paymentId) {
    const { rows } = await DatabaseHelper.executeQuery(
      `UPDATE payments SET status_checks = status_checks + 1, last_checked_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND status = 'pending' AND checkout_request_id IS NOT NULL
         AND (last_checked_at IS NULL OR last_checked_at < CURRENT_TIMESTAMP - make_interval(secs => $2))
       RETURNING checkout_request_id`,
      [paymentId, STATUS_CHECK_INTERVAL_SECONDS]
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
    await DatabaseHelper.withTransaction(async client => {
      const locked = await client.query('SELECT * FROM payments WHERE id = $1 FOR UPDATE', [paymentId]);
      await this.finalizePayment(client, locked.rows[0], { ...outcome, source: 'query' });
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
               failure_reason = COALESCE(failure_reason, 'No confirmation from M-Pesa')
           WHERE status = 'pending' AND is_deleted = 0
             AND created_at < CURRENT_TIMESTAMP - make_interval(mins => $1)
           RETURNING id`,
          [PENDING_EXPIRY_MINUTES]
        );
        return { checked: rows.length, expired: expired.rowCount };
      } finally {
        await client.query("SELECT pg_advisory_unlock(hashtext('payments:reconcile'))");
      }
    } finally {
      client.release();
    }
  }
}

export default PaymentService;
