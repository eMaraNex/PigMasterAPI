import PaymentService from '../services/payment.service.js';
import { SuccessResponse } from '../middleware/responses.js';
import logger from '../middleware/logger.js';

class PaymentsController {
  static async getPaymentQuote(req, res, next) {
    try {
      const quote = await PaymentService.quotePayment(req.query.plan, req.query.period || 'monthly');
      return SuccessResponse(res, 200, 'Payment quote', quote);
    } catch (error) {
      next(error);
    }
  }

  static async createPayment(req, res, next) {
    try {
      const payment = await PaymentService.createPayment(req.user, req.body, req.get('idempotency-key') || null);
      return SuccessResponse(
        res,
        payment.replayed ? 200 : 201,
        payment.replayed ? 'Payment already in progress' : 'Check your phone to complete the M-Pesa payment',
        payment
      );
    } catch (error) {
      next(error);
    }
  }

  static async getPayments(req, res, next) {
    try {
      const result = await PaymentService.listPayments(req.user.id, req.query);
      res.json({ success: true, ...result });
    } catch (error) {
      next(error);
    }
  }

  static async getPaymentById(req, res, next) {
    try {
      const payment = await PaymentService.getPaymentStatus(req.params.paymentId, req.user.id);
      return SuccessResponse(res, 200, 'Payment retrieved', payment);
    } catch (error) {
      next(error);
    }
  }

  static async cancelPayment(req, res, next) {
    try {
      const payment = await PaymentService.cancelPayment(req.params.paymentId, req.user.id);
      return SuccessResponse(res, 200, 'Payment cancelled', payment);
    } catch (error) {
      next(error);
    }
  }

  /** Always answers Safaricom with 200 so it does not retry a callback we have already stored. */
  static async mpesaCallback(req, res) {
    try {
      const result = await PaymentService.handleMpesaCallback(req.params.token, req.body, { ip: req.ip });
      return res.status(200).json({
        ResultCode: result.accepted ? 0 : 1,
        ResultDesc: result.accepted ? 'Accepted' : 'Rejected',
      });
    } catch (error) {
      logger.error(`M-Pesa callback error: ${error.message}`);
      return res.status(500).json({ ResultCode: 1, ResultDesc: 'Failed' });
    }
  }
}

export default PaymentsController;
