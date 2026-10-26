import { DatabaseHelper } from '../config/database.js';
import logger from '../middleware/logger.js';
import { ValidationError } from '../middleware/errors.js';

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const TRIAL_DAYS = 30;

const run = (client, sql, params) => (client ? client.query(sql, params) : DatabaseHelper.executeQuery(sql, params));

const addMonths = (date, months) => {
  const result = new Date(date);
  result.setUTCMonth(result.getUTCMonth() + months);
  return result;
};

class SubscriptionService {
  static async createTrialSubscription(userId, startedAt = new Date(), client = null) {
    const existing = await run(client,
      `SELECT * FROM subscriptions WHERE user_id = $1 AND status = 'trial' AND is_active = 1
       ORDER BY created_at DESC LIMIT 1`,
      [userId]
    );
    if (existing.rows.length) return existing.rows[0];
    const trialStart = new Date(startedAt);
    const trialEnd = new Date(trialStart.getTime() + TRIAL_DAYS * DAY_IN_MS);
    const result = await run(client,
      `INSERT INTO subscriptions (user_id, current_plan, status, trial_start_date, trial_end_date, payment_status)
       VALUES ($1, 'trial', 'trial', $2, $3, 'pending') RETURNING *`,
      [userId, trialStart.toISOString(), trialEnd.toISOString()]
    );
    logger.info(`Created trial subscription for user ${userId}`);
    return result.rows[0];
  }

  static async getUserSubscription(userId, client = null) {
    const result = await run(client,
      `SELECT s.*, sp.name AS plan_name, sp.duration_months, sp.price, sp.currency,
              -- Billing cycle of the payment that started this subscription (monthly / yearly).
              COALESCE(p.metadata->>'plan_period', CASE WHEN s.status = 'active' THEN 'monthly' END) AS billing_period
       FROM subscriptions s
       LEFT JOIN subscription_plans sp ON s.plan_id = sp.id
       LEFT JOIN payments p ON p.id = s.payment_id
       WHERE s.user_id = $1 AND s.is_active = 1
       ORDER BY s.created_at DESC LIMIT 1`,
      [userId]
    );
    return result.rows[0] ?? null;
  }

  static async getAvailablePlans() {
    const result = await DatabaseHelper.executeQuery(
      'SELECT id, name, duration_months, price, currency, description FROM subscription_plans WHERE is_active = 1 ORDER BY price ASC, name ASC'
    );
    return result.rows;
  }

  /** Downgrades the user to the free tier once their trial or paid period has ended. */
  static async reconcileSubscription(userId, now = new Date()) {
    const subscription = await this.getUserSubscription(userId);
    if (!subscription || subscription.status === 'expired') return subscription;
    const end = subscription.expiry_date ?? subscription.trial_end_date;
    if (!end || now.getTime() <= new Date(end).getTime()) return subscription;

    await DatabaseHelper.withTransaction(async client => {
      await client.query(
        `UPDATE subscriptions SET status = 'expired', payment_status = 'expired' WHERE id = $1`,
        [subscription.id]
      );
      await client.query(
        `UPDATE users SET role_id = (SELECT id FROM roles WHERE name = 'free'), subscription_end = LEAST(subscription_end, CURRENT_TIMESTAMP)
         WHERE id = $1 AND is_deleted = 0`,
        [userId]
      );
    });
    logger.info(`Subscription ${subscription.id} expired for user ${userId}; access revoked.`);
    return { ...subscription, status: 'expired' };
  }

  /**
   * Activates (or extends) a paid plan for a successful payment. Must run in the
   * same transaction that marks the payment successful. The unique payment_id on
   * subscriptions makes a second activation for the same payment a no-op.
   */
  static async activatePaidSubscription(client, { userId, planName, paymentId, durationMonths }) {
    const plan = await client.query(
      'SELECT * FROM subscription_plans WHERE name = $1 AND is_active = 1',
      [planName]
    );
    if (!plan.rows.length) throw new ValidationError(`Plan ${planName} not found`);
    const role = await client.query(
      'SELECT id FROM roles WHERE name = $1 AND is_active = 1 AND is_deleted = 0',
      [planName]
    );
    if (!role.rows.length) throw new ValidationError(`Role for plan ${planName} not found`);

    // Serialise activations per user so two payments cannot both read the same expiry.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`subscription:${userId}`]);
    const current = await this.getUserSubscription(userId, client);
    const now = new Date();
    const currentExpiry = current?.status === 'active' && current.expiry_date ? new Date(current.expiry_date) : null;
    const start = currentExpiry && currentExpiry > now ? currentExpiry : now;
    const months = Math.max(1, Number(durationMonths ?? plan.rows[0].duration_months) || 1);
    const expiry = addMonths(start, months);

    const inserted = await client.query(
      `INSERT INTO subscriptions (user_id, plan_id, payment_id, current_plan, status, start_date, expiry_date, payment_status)
       VALUES ($1, $2, $3, $4, 'active', $5, $6, 'paid')
       ON CONFLICT (payment_id) DO NOTHING
       RETURNING *`,
      [userId, plan.rows[0].id, paymentId, planName, start.toISOString(), expiry.toISOString()]
    );
    if (!inserted.rows.length) return null;

    await client.query(
      `UPDATE users SET role_id = $1, subscription_start = COALESCE(subscription_start, $2), subscription_end = $3
       WHERE id = $4 AND is_deleted = 0`,
      [role.rows[0].id, start.toISOString(), expiry.toISOString(), userId]
    );
    logger.info(`Activated ${planName} for user ${userId} until ${expiry.toISOString()} (payment ${paymentId})`);
    return inserted.rows[0];
  }
}

export default SubscriptionService;
