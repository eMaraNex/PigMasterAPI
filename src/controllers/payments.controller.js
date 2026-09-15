// controllers/payments.controller.js
import PaymentService from '../services/payment.service.js';
import { SuccessResponse } from '../middleware/responses.js';
import logger from '../middleware/logger.js';

class PaymentsController {
  static async createPayment(req, res, next) {
    try {
      const paymentData = req.body;
      const userId = req.user.id;
      const farmId = req.user.farm_id; // Assuming farm_id from user context
      const payment = await PaymentService.createPayment(paymentData, userId, farmId);
      return SuccessResponse(res, 201, 'Payment initiated successfully', payment);
    } catch (error) {
      logger.error(`Create payment error: ${error.message}`);
      next(error);
    }
  }

  static async getPayments(req, res, next) {
    try {
      const userId = req.user.id;
      const farmId = req.query.farm_id || req.user.farm_id;
      const { limit = 50, offset = 0 } = req.query;
      const payments = await PaymentService.getPaymentsByUser(userId, farmId, parseInt(limit), parseInt(offset));
      return SuccessResponse(res, 200, 'Payments retrieved successfully', payments);
    } catch (error) {
      logger.error(`Get payments error: ${error.message}`);
      next(error);
    }
  }

  static async getPaymentById(req, res, next) {
    try {
      const { paymentId } = req.params;
      const userId = req.user.id;
      const payment = await PaymentService.getPaymentById(paymentId, userId);
      return SuccessResponse(res, 200, 'Payment retrieved successfully', payment);
    } catch (error) {
      logger.error(`Get payment error: ${error.message}`);
      next(error);
    }
  }

  static async updatePaymentStatus(req, res, next) {
    try {
      const { paymentId } = req.params;
      const { status, metadata } = req.body;
      const userId = req.user.id;
      const payment = await PaymentService.updatePaymentStatus(paymentId, status, userId, metadata);
      return SuccessResponse(res, 200, 'Payment status updated successfully', payment);
    } catch (error) {
      logger.error(`Update payment status error: ${error.message}`);
      next(error);
    }
  }

  static async mpesaCallback(req, res) {
    try {
      const callbackSecret = req.get('x-callback-secret') || req.get('x-mpesa-callback-secret');
      if (process.env.MPESA_CALLBACK_SECRET && callbackSecret !== process.env.MPESA_CALLBACK_SECRET) {
        return res.status(401).json({ ResultCode: 1, ResultDesc: 'Unauthorized' });
      }

      const callbackData = req.body;
      const result = await PaymentService.handleMpesaCallback(callbackData);
      return res.status(200).json({
        ResultCode: result.success ? 0 : 1,
        ResultDesc: result.success ? 'Accepted' : result.message || 'Rejected',
      });
    } catch (error) {
      logger.error(`M-Pesa callback error: ${error.message}`);
      return res.status(500).json({ ResultCode: 1, ResultDesc: 'Failed' });
    }
  }
}

export default PaymentsController;