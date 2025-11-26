// services/payment.service.js
import { DatabaseHelper } from '../config/database.js';
import logger from '../middleware/logger.js';
import { ValidationError } from '../middleware/errors.js';
import { v4 as uuidv4 } from 'uuid';
import dotenv from 'dotenv';
import MpesaService from './mpesa.services.js';
import CardService from './card.services.js';

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
            transaction_id, status, metadata, created_at, updated_at, is_deleted, is_active
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0, 1)
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
            'pending', // Temporary pending record
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
            transaction_id, status, metadata, created_at, updated_at, is_deleted, is_active
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0, 1)
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
            transaction_id, status, metadata, created_at, updated_at, is_deleted, is_active
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0, 1)
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

      // Find the pending payment
      const payment = await DatabaseHelper.executeQuery(
        'SELECT * FROM payments WHERE transaction_id = $1 AND is_deleted = 0 AND status = \'pending\'',
        [transactionId]
      );

      if (payment.rows.length === 0) {
        logger.warn(`No pending payment found for transaction ${transactionId}`);
        return { success: false, message: 'Payment not found' };
      }

      const paymentRecord = payment.rows[0];

      if (processed.success) {
        // Verify amount and phone number for security
        if (Number(processed.amount) !== Number(paymentRecord.amount) || Number(processed.phoneNumber) !==  Number(paymentRecord.phone_number)) {
          logger.error(`Data mismatch in callback for payment ${paymentRecord.id}: amount ${processed.amount} vs ${paymentRecord.amount}, phone ${processed.phoneNumber} vs ${paymentRecord.phone_number}`);
          return { success: false, message: 'Data mismatch in callback' };
        }

        // Update payment status to success and add metadata
        const mpesaMetadata = {
          mpesa_receipt: processed.mpesaReceiptNumber,
          confirmed_amount: processed.amount,
          transaction_date: processed.transactionDate,
          phone_number: processed.phoneNumber
        };

        const updatedPayment = await DatabaseHelper.executeQuery(
          `UPDATE payments 
           SET status = $1, 
               metadata = metadata || $2::jsonb,
               updated_at = CURRENT_TIMESTAMP 
           WHERE id = $3 
           RETURNING *`,
          ['success', JSON.stringify(mpesaMetadata), paymentRecord.id]
        );

        logger.info(`Payment ${paymentRecord.id} confirmed successfully via M-Pesa`);

        // NOW upgrade user tier after confirmation
        try {
          const fullMetadata = { ...paymentRecord.metadata || {}, ...mpesaMetadata };
          await this.upgradeUserTier(paymentRecord.user_id, paymentRecord.plan, fullMetadata);
          logger.info(`User ${paymentRecord.user_id} upgraded to ${paymentRecord.plan} after successful M-Pesa payment`);
        } catch (upgradeError) {
          logger.error(`Failed to upgrade user ${paymentRecord.user_id} after payment: ${upgradeError.message}`);
          // Payment is successful but upgrade failed - mark for manual review
          await DatabaseHelper.executeQuery(
            `UPDATE payments 
             SET metadata = metadata || $1::jsonb
             WHERE id = $2`,
            [JSON.stringify({ upgrade_error: upgradeError.message }), paymentRecord.id]
          );
        }

        return { 
          success: true, 
          message: 'Payment confirmed and user upgraded',
          payment: updatedPayment.rows[0]
        };

      } else {
        // Payment failed or cancelled - DELETE the pending record (no failed records kept)
        await DatabaseHelper.executeQuery(
          `DELETE FROM payments WHERE id = $1`,
          [paymentRecord.id]
        );

        logger.warn(`Payment initiation ${paymentRecord.id} failed or cancelled: ${processed.resultDesc}. Record deleted.`);

        return { 
          success: false, 
          message: 'Payment failed or cancelled',
          reason: processed.resultDesc 
        };
      }
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

  static async getPaymentById(paymentId, userId) {
    try {
      const result = await DatabaseHelper.executeQuery(
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
      
      // If not pending, return as is
      if (payment.status !== 'pending' || payment.payment_mode !== 'mpesa' || !payment.transaction_id) {
        return payment;
      }

      // Query M-Pesa API for pending M-Pesa payments
      try {
        const mpesaStatus = await MpesaService.querySTKPush(payment.transaction_id);
        logger.info(`M-Pesa status check for ${paymentId}: ${JSON.stringify(mpesaStatus)}`);
        
        // Check query success (ResponseCode '0')
        if (mpesaStatus.ResponseCode !== '0') {
          throw new Error(`Query failed: ${mpesaStatus.ResponseDescription || 'Unknown error'}`);
        }

        // Check transaction result (ResultCode '0' for success)
        if (mpesaStatus.ResultCode === '0') {
          // Extract metadata
          const callbackMetadata = mpesaStatus.CallbackMetadata?.Item || [];
          const amount = callbackMetadata.find(item => item.Name === 'Amount')?.Value;
          const mpesaReceiptNumber = callbackMetadata.find(item => item.Name === 'MpesaReceiptNumber')?.Value;
          const transactionDate = callbackMetadata.find(item => item.Name === 'TransactionDate')?.Value;
          const phoneNumber = callbackMetadata.find(item => item.Name === 'PhoneNumber')?.Value;

          // Verify amount and phone for security
          if (amount !== payment.amount || String(phoneNumber) !== payment.phone_number) {
            logger.error(`Data mismatch in query for payment ${paymentId}: amount ${amount} vs ${payment.amount}, phone ${phoneNumber} vs ${payment.phone_number}`);
            throw new Error('Data mismatch in query response');
          }

          // Update to success with metadata
          const mpesaMetadata = {
            mpesa_receipt: mpesaReceiptNumber,
            confirmed_amount: amount,
            transaction_date: transactionDate,
            phone_number: phoneNumber
          };

          const updatedPayment = await DatabaseHelper.executeQuery(
            `UPDATE payments 
             SET status = $1, 
                 metadata = metadata || $2::jsonb,
                 updated_at = CURRENT_TIMESTAMP 
             WHERE id = $3 
             RETURNING *`,
            ['success', JSON.stringify(mpesaMetadata), paymentId]
          );

          // Upgrade user
          const fullMetadata = { ...payment.metadata || {}, ...mpesaMetadata };
          await this.upgradeUserTier(payment.user_id, payment.plan, fullMetadata);

          return updatedPayment.rows[0];
        } else {
          // Failure (e.g., ResultCode '1032' for cancel, or others)
          await DatabaseHelper.executeQuery(
            `DELETE FROM payments WHERE id = $1`,
            [paymentId]
          );
          throw new ValidationError(`Payment failed: ${mpesaStatus.ResultDesc || 'Unknown error'}`);
        }
      } catch (queryError) {
        logger.warn(`Could not query M-Pesa status for ${paymentId}: ${queryError.message}`);
        // Assume still pending if query fails (e.g., transaction processing)
        return payment;
      }
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