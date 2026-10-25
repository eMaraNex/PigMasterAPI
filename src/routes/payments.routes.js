import express from 'express';
import rateLimit from 'express-rate-limit';
import PaymentsController from '../controllers/payments.controller.js';
import authMiddleware from '../middleware/auth.middleware.js';

const router = express.Router();

const createLimit = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 10,
  keyGenerator: req => req.user?.id ?? req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many payment attempts. Please wait a few minutes.' },
});
const callbackLimit = rateLimit({ windowMs: 60 * 1000, limit: 120, standardHeaders: true, legacyHeaders: false });

// Safaricom callback: authenticated by the per-payment token in the URL.
router.post('/mpesa/callback/:token([a-f0-9]{48})', callbackLimit, PaymentsController.mpesaCallback);

router.get('/quote', authMiddleware, PaymentsController.getPaymentQuote);
router.post('/', authMiddleware, createLimit, PaymentsController.createPayment);
router.get('/', authMiddleware, PaymentsController.getPayments);
router.get('/:paymentId', authMiddleware, PaymentsController.getPaymentById);
router.post('/:paymentId/cancel', authMiddleware, PaymentsController.cancelPayment);

export default router;
