// services/payment.service.js
import { DatabaseHelper } from '../config/database.js';
import logger from '../middleware/logger.js';
import { ValidationError } from '../middleware/errors.js';
import { v4 as uuidv4 } from 'uuid';
import dotenv from 'dotenv';
import MpesaService from './mpesa.services.js';
import CardService from './card.services.js';
import SubscriptionService from './subscription.service.js';

dotenv.config();

class PaymentService {
  static async createPayment(paymentData, userId, farmId = null) {
    const { plan, amount, payment_mode, phone_number, currency, metadata = {}, tier } = paymentData;

    if (!plan || !amount || !payment_mode || !currency) {
      throw new ValidationError('Plan, amount, payment_mode, and currency are required');
    }

    const paymentId = uuidv4();
    let finalAmount = amount;
    let finalCurrency = currency;
    const validModes = ['mpesa', 'dpogroup', 'card', 'stripe', 'paypal'];

    if (!validModes.includes(payment_mode)) {
      throw new ValidationError(`Invalid payment mode: ${payment_mode}`);
    }

    let transactionId = null;
    let status = 'pending';

    try {
      // Handle different payment modes
      if (payment_mode === 'mpesa') {
        if (!phone_number || !phone_number.startsWith('254')) {
          throw new ValidationError('Valid M-Pesa phone number is required (254...)');
        }
        if (currency !== 'KES') {
          throw new ValidationError('M-Pesa payments must be in KES');
        }

        // Initiate STK Push
        const checkoutRequestID = await MpesaService.initiateSTKPush(
          phone_number,
          finalAmount,
          `Pig Master`,
          `Subscription for ${tier || plan}`
        );

        transactionId = checkoutRequestID;

        // Insert as pending - temporary until callback confirms
        const result = await DatabaseHelper.executeQuery(
          `INSERT INTO payments (
            id, user_id, farm_id, plan, amount, currency, payment_mode, phone_number,
            transaction_id, checkout_request_id, merchant_request_id, status, metadata, created_at, updated_at, is_deleted, is_active
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0, 1)
          RETURNING *`,
          [
            paymentId,
            userId,
            farmId,
            plan,
            finalAmount,
            finalCurrency,
            payment_mode,
            phone_number || null,
            transactionId,
            transactionId,
            null,
            'pending',
            JSON.stringify({
              ...metadata,
              initiated_at: new Date().toISOString(),
              tier: tier || plan
            })
          ]
        );

        logger.info(`M-Pesa STK Push initiated for payment ${paymentId}. Awaiting callback confirmation.`);

        // Return pending payment - DO NOT upgrade user yet
        return {
          ...result.rows[0],
          message: 'Payment initiated. Please complete the payment on your phone.',
          stk_push_response: transactionId
        };

      } else if (payment_mode === 'card' || payment_mode === 'stripe') {
        if (!metadata.card_details) {
          throw new ValidationError('Card details are required for card/stripe payment');
        }

        // Process card payment synchronously
        transactionId = await CardService.processPayment(
          metadata.card_details,
          finalAmount,
          finalCurrency,
          `Payment_${paymentId}`,
          `Subscription for ${tier || plan}`
        );

        status = 'success'; // Card payments are immediate

        const result = await DatabaseHelper.executeQuery(
          `INSERT INTO payments (
            id, user_id, farm_id, plan, amount, currency, payment_mode, phone_number,
            transaction_id, checkout_request_id, merchant_request_id, status, metadata, created_at, updated_at, is_deleted, is_active
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0, 1)
          RETURNING *`,
          [
            paymentId,
            userId,
            farmId,
            plan,
            finalAmount,
            finalCurrency,
            payment_mode,
            phone_number || null,
            transactionId,
            transactionId,
            null,
            status,
            JSON.stringify({
              ...metadata,
              initiated_at: new Date().toISOString(),
              tier: tier || plan
            })
          ]
        );

        // Upgrade user immediately for successful card payments
        if (status === 'success') {
          await this.upgradeUserTier(userId, plan, metadata);
        }

        return {
          ...result.rows[0],
          message: 'Payment successful',
          stk_push_response: transactionId
        };

      } else {
        // Other payment modes (simulated for now)
        transactionId = `SIM_${uuidv4()}`;
        status = 'success';

        const result = await DatabaseHelper.executeQuery(
          `INSERT INTO payments (
            id, user_id, farm_id, plan, amount, currency, payment_mode, phone_number,
            transaction_id, checkout_request_id, merchant_request_id, status, metadata, created_at, updated_at, is_deleted, is_active
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0, 1)
          RETURNING *`,
          [
            paymentId,
            userId,
            farmId,
            plan,
            finalAmount,
            finalCurrency,
            payment_mode,
            phone_number || null,
            transactionId,
            transactionId,
            null,
            status,
            JSON.stringify({
              ...metadata,
              initiated_at: new Date().toISOString(),
              tier: tier || plan
            })
          ]
        );

        if (status === 'success') {
          await this.upgradeUserTier(userId, plan, metadata);
        }

        return {
          ...result.rows[0],
          message: 'Payment successful',
          stk_push_response: transactionId
        };
      }
    } catch (error) {
      logger.error(`Error creating payment: ${error.message}`);
      throw error;
    }
  }

  static async upgradeUserTier(userId, plan, metadata) {
    if (plan === 'free') {
      logger.info(`No upgrade needed for free plan for user ${userId}`);
      return;
    }

    if (!metadata.subscription_startdate || !metadata.subscription_enddate) {
      throw new ValidationError('Subscription start and end dates are required in metadata');
    }

    try {
      // Get role_id for the plan
      const roleResult = await DatabaseHelper.executeQuery(
        'SELECT id FROM roles WHERE name = $1 AND is_active = 1 AND is_deleted = 0',
        [plan]
      );

      if (roleResult.rows.length === 0) {
        throw new ValidationError(`Role for plan ${plan} not found`);
      }

      const roleId = roleResult.rows[0].id;

      // Use dates from metadata
      const startDate = metadata.subscription_startdate;
      const endDate = metadata.subscription_enddate;

      // Update user's role_id, subscription_start, subscription_end
      const updateResult = await DatabaseHelper.executeQuery(
        `UPDATE users 
         SET role_id = $1, 
             subscription_start = $2, 
             subscription_end = $3, 
             updated_at = CURRENT_TIMESTAMP 
         WHERE id = $4 AND is_deleted = 0 
         RETURNING *`,
        [roleId, startDate, endDate, userId]
      );

      if (updateResult.rows.length === 0) {
        throw new ValidationError('User not found');
      }

      logger.info(`User ${userId} upgraded to ${plan} tier (role_id: ${roleId}) from ${startDate} to ${endDate}`);
    } catch (error) {
      logger.error(`Error upgrading user tier for ${userId}: ${error.message}`);
      throw error;
    }
  }

static async handleMpesaCallback(callbackData) {
  try {
    logger.info(`Received M-Pesa callback: ${JSON.stringify(callbackData)}`);

    const processed = MpesaService.processCallback(callbackData);
    const transactionId = processed.checkoutRequestID;

    if (!transactionId) {
      return { success: false, message: 'Invalid callback payload' };
    }

    const connection = await DatabaseHelper.getConnection();
    let paymentRecord = null;

    try {
      await connection.query('BEGIN');

      const paymentResult = await connection.query(
        `SELECT * FROM payments 
         WHERE checkout_request_id = $1 AND is_deleted = 0 
         ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
        [transactionId]
      );

      if (paymentResult.rows.length === 0) {
        logger.warn(`No payment found for transaction ${transactionId}`);
        await connection.query('ROLLBACK');
        return { success: false, message: 'Unknown checkout request' };
      }

      paymentRecord = paymentResult.rows[0];

      if (paymentRecord.status !== 'pending') {
        logger.info(`Callback ignored for already processed payment ${paymentRecord.id}`);
        await connection.query('COMMIT');
        return { success: false, message: 'Payment already processed' };
      }

      const callbackPayload = {
        ...callbackData,
        processed_at: new Date().toISOString(),
      };

      if (!processed.success) {
        await connection.query(
          `UPDATE payments
           SET status = 'failed',
               metadata = metadata || $1::jsonb,
               callback_payload = $2::jsonb,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $3`,
          [
            JSON.stringify({ callback_error: processed.resultDesc || 'Payment failed' }),
            JSON.stringify(callbackPayload),
            paymentRecord.id,
          ]
        );
        await connection.query('COMMIT');
        return { success: false, message: 'Payment failed', reason: processed.resultDesc };
      }

      // Validate amount and phone
      const normalize = (p) => String(p ?? '').replace(/\D/g, '').slice(-9);
      const phoneMatch = normalize(processed.phoneNumber) === normalize(paymentRecord.phone_number);
      const amountMatch = Math.abs(Number(processed.amount) - Number(paymentRecord.amount)) <= 1;

      if (!phoneMatch || !amountMatch) {
        logger.error(`Data mismatch in callback for payment ${paymentRecord.id}`);
        await connection.query(
          `UPDATE payments 
           SET status = 'failed', 
               metadata = metadata || $1::jsonb, 
               callback_payload = $2::jsonb, 
               updated_at = CURRENT_TIMESTAMP 
           WHERE id = $3`,
          [
            JSON.stringify({ callback_error: 'Data mismatch in callback' }),
            JSON.stringify(callbackPayload),
            paymentRecord.id,
          ]
        );
        await connection.query('COMMIT');
        return { success: false, message: 'Data mismatch in callback' };
      }

      // Mark payment success — do this inside the transaction
      const mpesaMetadata = {
        mpesa_receipt: processed.mpesaReceiptNumber,
        confirmed_amount: processed.amount,
        transaction_date: processed.transactionDate,
        phone_number: processed.phoneNumber,
        result_desc: processed.resultDesc,
      };

      await connection.query(
        `UPDATE payments
         SET status = 'success',
             metadata = metadata || $1::jsonb,
             callback_payload = $2::jsonb,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $3`,
        [JSON.stringify(mpesaMetadata), JSON.stringify(callbackPayload), paymentRecord.id]
      );

      await connection.query('COMMIT');
    } catch (error) {
      await connection.query('ROLLBACK');
      throw error;
    } finally {
      // ✅ Always release the connection before doing subscription work
      if (connection && typeof connection.release === 'function') {
        connection.release();
      }
    }

    // ✅ Activate subscription AFTER releasing the DB connection
    // This uses a fresh connection from the pool, avoiding timeout
    try {
      await SubscriptionService.activatePaidSubscription(
        paymentRecord.user_id,
        paymentRecord.plan,
        { startDate: new Date(), expiryDate: null }
        // No client passed — gets its own fresh connection
      );
      logger.info(`Subscription activated for user ${paymentRecord.user_id}, payment ${paymentRecord.id}`);
    } catch (activationError) {
      // Payment is already marked success — log but don't fail the callback
      // A separate reconciliation job can fix subscriptions that didn't activate
      logger.error(`Subscription activation failed for payment ${paymentRecord.id}: ${activationError.message}`);

      // Mark the activation error in metadata so you can find and fix it
      await DatabaseHelper.executeQuery(
        `UPDATE payments 
         SET metadata = metadata || $1::jsonb, updated_at = CURRENT_TIMESTAMP 
         WHERE id = $2`,
        [JSON.stringify({ activation_error: activationError.message, needs_manual_activation: true }), paymentRecord.id]
      );

      // Still return success to Safaricom — they already took the money
      return {
        success: true,
        message: 'Payment confirmed, subscription activation pending',
        payment: { ...paymentRecord, status: 'success' },
      };
    }

    return {
      success: true,
      message: 'Payment confirmed and subscription activated',
      payment: { ...paymentRecord, status: 'success' },
    };

  } catch (error) {
    logger.error(`Error handling M-Pesa callback: ${error.message}`);
    throw error;
  }
}

  static async getPaymentsByUser(userId, farmId = null, limit = 50, offset = 0) {
    try {
      let query = `
        SELECT * FROM payments 
        WHERE user_id = $1 AND is_deleted = 0 AND status != 'pending'  -- Exclude pending to show only completed
      `;
      const params = [userId];

      if (farmId) {
        query += ` AND farm_id = $${params.length + 1}`;
        params.push(farmId);
      }

      query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
      params.push(limit, offset);

      const result = await DatabaseHelper.executeQuery(query, params);
      return result.rows;
    } catch (error) {
      logger.error(`Error fetching payments for user ${userId}: ${error.message}`);
      throw error;
    }
  }

// payment.service.js
static async getPaymentById(paymentId, userId) {
  try {
    const result = await DatabaseHelper.executeQuery(
      // Remove any status filter — polling needs to see pending AND success AND failed
      'SELECT * FROM payments WHERE id = $1 AND user_id = $2 AND is_deleted = 0',
      [paymentId, userId]
    );
    if (result.rows.length === 0) {
      throw new ValidationError('Payment not found');
    }
    return result.rows[0];
  } catch (error) {
    logger.error(`Error fetching payment ${paymentId}: ${error.message}`);
    throw error;
  }
}

  static async checkPaymentStatus(paymentId, userId) {
    try {
      const payment = await this.getPaymentById(paymentId, userId);

      // Not pending or not M-Pesa — return as-is, nothing to query
      if (payment.status !== 'pending' || payment.payment_mode !== 'mpesa' || !payment.transaction_id) {
        return payment;
      }

      let mpesaStatus;
      try {
        mpesaStatus = await MpesaService.querySTKPush(payment.transaction_id);
        logger.info(`M-Pesa status check for ${paymentId}: ${JSON.stringify(mpesaStatus)}`);
      } catch (queryError) {
        // Network/timeout error reaching Safaricom — treat as still pending
        logger.warn(`Could not reach M-Pesa for ${paymentId}: ${queryError.message}`);
        return payment;
      }

      // Safaricom couldn't process the query itself (not the transaction result)
      if (mpesaStatus.ResponseCode !== '0') {
        logger.warn(`STK query returned non-zero ResponseCode for ${paymentId}: ${mpesaStatus.ResponseDescription}`);
        return payment; // Still pending — query may succeed on next poll
      }

      const resultCode = String(mpesaStatus.ResultCode ?? '');

      // ── SUCCESS ──────────────────────────────────────────────
      if (resultCode === '0') {
        const items = mpesaStatus.CallbackMetadata?.Item || [];
        const find = (name) => items.find((i) => i.Name === name)?.Value;

        const confirmedAmount = find('Amount');
        const mpesaReceipt = find('MpesaReceiptNumber');
        const transactionDate = find('TransactionDate');
        const confirmedPhone = find('PhoneNumber');

        // Normalize phones for comparison: strip all non-digits, compare last 9 digits
        const normalize = (p) => String(p ?? '').replace(/\D/g, '').slice(-9);
        const phoneMatch = normalize(confirmedPhone) === normalize(payment.phone_number);

        // Normalize amounts: both to float, allow ±1 rounding tolerance
        const amountMatch = Math.abs(parseFloat(confirmedAmount) - parseFloat(payment.amount)) <= 1;

        if (!phoneMatch || !amountMatch) {
          logger.error(
            `Security mismatch for payment ${paymentId}: ` +
            `amount [${confirmedAmount} vs ${payment.amount}] ` +
            `phone [${confirmedPhone} vs ${payment.phone_number}]`
          );
          // Mark failed — do NOT upgrade
          await DatabaseHelper.executeQuery(
            `UPDATE payments
           SET status = 'failed',
               metadata = metadata || $1::jsonb,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $2`,
            [JSON.stringify({ failure_reason: 'amount_or_phone_mismatch' }), paymentId]
          );
          throw new ValidationError('Payment data mismatch — contact support');
        }

        // Build dates for subscription activation
        const existingMeta = payment.metadata || {};
        const startDate = new Date();
        const endDate = new Date(startDate);
        const period = existingMeta.plan_period || 'monthly';
        if (period === 'yearly') {
          endDate.setFullYear(endDate.getFullYear() + 1);
        } else {
          endDate.setMonth(endDate.getMonth() + 1);
        }

        const mpesaMetadata = {
          mpesa_receipt: mpesaReceipt,
          confirmed_amount: confirmedAmount,
          transaction_date: transactionDate,
          phone_number: confirmedPhone,
        };

        const updatedPayment = await DatabaseHelper.executeQuery(
          `UPDATE payments
         SET status = 'success',
             metadata = metadata || $1::jsonb,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $2
         RETURNING *`,
          [JSON.stringify(mpesaMetadata), paymentId]
        );

        // upgradeUserTier needs subscription dates in metadata
        const fullMetadata = {
          ...existingMeta,
          ...mpesaMetadata,
          subscription_startdate: startDate.toISOString().split('T')[0],
          subscription_enddate: endDate.toISOString().split('T')[0],
        };

        await this.upgradeUserTier(payment.user_id, payment.plan, fullMetadata);
        logger.info(`Payment ${paymentId} confirmed via STK query and user upgraded`);
        return updatedPayment.rows[0];
      }

      // ── FAILURE (user cancelled, wrong PIN, timeout, etc.) ───
      // ResultCode 1032 = cancelled, 1037 = timeout, 2001 = wrong PIN, etc.
      logger.warn(`Payment ${paymentId} failed with ResultCode ${resultCode}: ${mpesaStatus.ResultDesc}`);
      const failedPayment = await DatabaseHelper.executeQuery(
        `UPDATE payments
       SET status = 'failed',
           metadata = metadata || $1::jsonb,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2
       RETURNING *`,
        [
          JSON.stringify({
            failure_reason: mpesaStatus.ResultDesc || 'Payment failed',
            result_code: resultCode,
          }),
          paymentId,
        ]
      );
      return failedPayment.rows[0]; // Return it so frontend sees status: 'failed'

    } catch (error) {
      logger.error(`Error checking payment status ${paymentId}: ${error.message}`);
      throw error;
    }
  }

  static async updatePaymentStatus(paymentId, status, userId, metadata = {}) {
    try {
      const result = await DatabaseHelper.executeQuery(
        `UPDATE payments 
         SET status = $1, metadata = metadata || $2::jsonb, updated_at = CURRENT_TIMESTAMP 
         WHERE id = $3 AND user_id = $4 AND is_deleted = 0 
         RETURNING *`,
        [status, JSON.stringify(metadata), paymentId, userId]
      );

      if (result.rows.length === 0) {
        throw new ValidationError('Payment not found or unauthorized');
      }

      return result.rows[0];
    } catch (error) {
      logger.error(`Error updating payment ${paymentId}: ${error.message}`);
      throw error;
    }
  }
}

export default PaymentService;