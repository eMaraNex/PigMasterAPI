import { v4 as uuidv4 } from 'uuid';
import { DatabaseHelper } from '../config/database.js';
import logger from '../middleware/logger.js';
import { ValidationError } from '../middleware/errors.js';
import { pool } from '../config/database.js';

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const MONTH_IN_MS = 30 * DAY_IN_MS;

class SubscriptionService {
  static async ensureDefaultPlans() {
    const defaultPlans = [
      {
        name: 'free',
        duration_months: 0,
        price: 0,
        currency: 'USD',
        description: 'Free plan with basic access',
        is_active: 1,
      },
      {
        name: 'standard',
        duration_months: 1,
        price: 1,
        currency: 'USD',
        description: 'Standard monthly plan',
        is_active: 1,
      },
      {
        name: 'advanced',
        duration_months: 1,
        price: 2,
        currency: 'USD',
        description: 'Advanced monthly plan',
        is_active: 1,
      },
    ];

    for (const plan of defaultPlans) {
      await DatabaseHelper.executeQuery(
        `INSERT INTO subscription_plans (id, name, duration_months, price, currency, description, is_active, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT (name) DO NOTHING`,
        [uuidv4(), plan.name, plan.duration_months, plan.price, plan.currency, plan.description, plan.is_active]
      );
    }
  }

  static async createTrialSubscription(userId, startedAt = new Date()) {
    try {
      await this.ensureDefaultPlans();

      const existing = await DatabaseHelper.executeQuery(
        `SELECT * FROM subscriptions
         WHERE user_id = $1 AND status = 'trial' AND is_active = 1
         ORDER BY created_at DESC LIMIT 1`,
        [userId]
      );

      if (existing.rows.length > 0) {
        return existing.rows[0];
      }

      const trialStart = new Date(startedAt);
      const trialEnd = new Date(trialStart.getTime() + 30 * DAY_IN_MS);

      const result = await DatabaseHelper.executeQuery(
        `INSERT INTO subscriptions (
          id, user_id, current_plan, status, trial_start_date, trial_end_date, start_date, expiry_date, payment_status,
          is_active, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, NULL, NULL, $7, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        RETURNING *`,
        [uuidv4(), userId, 'trial', 'trial', trialStart.toISOString(), trialEnd.toISOString(), 'pending']
      );

      logger.info(`Created trial subscription for user ${userId}`);
      return result.rows[0];
    } catch (error) {
      logger.error(`Error creating trial subscription for user ${userId}: ${error.message}`);
      throw error;
    }
  }

  static async getUserSubscription(userId) {
    try {
      const result = await DatabaseHelper.executeQuery(
        `SELECT s.*, sp.name AS plan_name, sp.duration_months, sp.price, sp.currency
         FROM subscriptions s
         LEFT JOIN subscription_plans sp ON s.plan_id = sp.id
         WHERE s.user_id = $1 AND s.is_active = 1
         ORDER BY s.created_at DESC LIMIT 1`,
        [userId]
      );

      if (result.rows.length === 0) {
        return null;
      }

      return result.rows[0];
    } catch (error) {
      logger.error(`Error fetching subscription for user ${userId}: ${error.message}`);
      throw error;
    }
  }

  static async getAvailablePlans() {
    try {
      const result = await DatabaseHelper.executeQuery(
        `SELECT * FROM subscription_plans WHERE is_active = 1 ORDER BY price ASC, name ASC`
      );
      return result.rows;
    } catch (error) {
      logger.error(`Error fetching subscription plans: ${error.message}`);
      throw error;
    }
  }

  static async reconcileSubscription(userId, now = new Date()) {
    try {
      const result = await DatabaseHelper.executeQuery(
        `SELECT * FROM subscriptions
         WHERE user_id = $1 AND is_active = 1
         ORDER BY created_at DESC LIMIT 1`,
        [userId]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const subscription = result.rows[0];
      const nowTime = now.getTime();
      const trialEnd = subscription.trial_end_date ? new Date(subscription.trial_end_date).getTime() : null;
      const expiry = subscription.expiry_date ? new Date(subscription.expiry_date).getTime() : null;

      const isExpired = (trialEnd && nowTime > trialEnd) || (expiry && nowTime > expiry);
      if (!isExpired) {
        return subscription;
      }

      const freeRole = await DatabaseHelper.executeQuery(
        `SELECT id FROM roles WHERE name = 'free' AND is_active = 1 AND is_deleted = 0 LIMIT 1`
      );

      if (freeRole.rows.length === 0) {
        return subscription;
      }

      await DatabaseHelper.executeQuery(
        `UPDATE subscriptions
         SET status = 'expired',
             payment_status = 'expired',
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [subscription.id]
      );

      await DatabaseHelper.executeQuery(
        `UPDATE users
         SET role_id = $1,
             subscription_end = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $2 AND is_deleted = 0`,
        [freeRole.rows[0].id, userId]
      );

      logger.info(`Subscription ${subscription.id} expired for user ${userId}; access revoked.`);
      return { ...subscription, status: 'expired' };
    } catch (error) {
      logger.error(`Error reconciling subscription for user ${userId}: ${error.message}`);
      throw error;
    }
  }

  static async activatePaidSubscription(userId, planName, options = {}) {
    try {
      const client = options.client || null;
      await this.ensureDefaultPlans();

      const planResult = client
        ? await client.query(
            `SELECT * FROM subscription_plans WHERE name = $1 AND is_active = 1 LIMIT 1`,
            [planName]
          )
        : await DatabaseHelper.executeQuery(
            `SELECT * FROM subscription_plans WHERE name = $1 AND is_active = 1 LIMIT 1`,
            [planName]
          );

      if (planResult.rows.length === 0) {
        throw new ValidationError(`Plan ${planName} not found`);
      }

      const plan = planResult.rows[0];
      const now = new Date();
      const existing = await this.getUserSubscription(userId);
      const existingExpiry = existing?.expiry_date ? new Date(existing.expiry_date) : null;

      let startDate = options.startDate ? new Date(options.startDate) : now;
      let expiryDate = options.expiryDate ? new Date(options.expiryDate) : new Date(startDate.getTime() + Math.max(1, Number(plan.duration_months || 1)) * MONTH_IN_MS);

      if (existing && existing.expiry_date && existingExpiry && existingExpiry.getTime() > now.getTime()) {
        startDate = existingExpiry;
        expiryDate = new Date(existingExpiry.getTime() + Math.max(1, Number(plan.duration_months || 1)) * MONTH_IN_MS);
      }

      const roleResult = client
        ? await client.query(
            `SELECT id FROM roles WHERE name = $1 AND is_active = 1 AND is_deleted = 0 LIMIT 1`,
            [planName]
          )
        : await DatabaseHelper.executeQuery(
            `SELECT id FROM roles WHERE name = $1 AND is_active = 1 AND is_deleted = 0 LIMIT 1`,
            [planName]
          );

      if (roleResult.rows.length === 0) {
        throw new ValidationError(`Role for plan ${planName} not found`);
      }

      const result = client
        ? await client.query(
            `INSERT INTO subscriptions (
              id, user_id, plan_id, current_plan, status, start_date, expiry_date, trial_start_date, trial_end_date, payment_status,
              is_active, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            RETURNING *`,
            [
              uuidv4(),
              userId,
              plan.id,
              plan.name,
              'active',
              startDate.toISOString(),
              expiryDate.toISOString(),
              null,
              null,
              'paid',
            ]
          )
        : await DatabaseHelper.executeQuery(
            `INSERT INTO subscriptions (
              id, user_id, plan_id, current_plan, status, start_date, expiry_date, trial_start_date, trial_end_date, payment_status,
              is_active, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            RETURNING *`,
            [
              uuidv4(),
              userId,
              plan.id,
              plan.name,
              'active',
              startDate.toISOString(),
              expiryDate.toISOString(),
              null,
              null,
              'paid',
            ]
          );

      if (client) {
        await client.query(
          `UPDATE users
           SET role_id = $1,
               subscription_start = $2,
               subscription_end = $3,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $4 AND is_deleted = 0`,
          [roleResult.rows[0].id, startDate.toISOString(), expiryDate.toISOString(), userId]
        );
      } else {
        await DatabaseHelper.executeQuery(
          `UPDATE users
           SET role_id = $1,
               subscription_start = $2,
               subscription_end = $3,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $4 AND is_deleted = 0`,
          [roleResult.rows[0].id, startDate.toISOString(), expiryDate.toISOString(), userId]
        );
      }

      logger.info(`Activated subscription for user ${userId} with plan ${planName}`);
      return result.rows[0];
    } catch (error) {
      logger.error(`Error activating paid subscription for user ${userId}: ${error.message}`);
      throw error;
    }
  }
}

export default SubscriptionService;
