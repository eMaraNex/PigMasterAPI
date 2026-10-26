import express from 'express';
import rateLimit from 'express-rate-limit';
import PaymentsController from '../controllers/payments.controller.js';
import authMiddleware from '../middleware/auth.middleware.js';
import logger from '../middleware/logger.js';

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

// Optional source check: set MPESA_CALLBACK_ALLOWED_IPS to Safaricom's published callback IPs in
// production (needs TRUST_PROXY=true behind a proxy). Unset = not enforced, e.g. local ngrok tests.
const allowedCallbackIps = new Set((process.env.MPESA_CALLBACK_ALLOWED_IPS ?? '').split(',').map(ip => ip.trim()).filter(Boolean));
const callbackSource = (req, res, next) => {
  const ip = String(req.ip ?? '').replace(/^::ffff:/, '');
  if (!allowedCallbackIps.size || allowedCallbackIps.has(ip)) return next();
  logger.warn(`M-Pesa callback blocked from unlisted IP ${ip}`);
  return res.status(403).json({ ResultCode: 1, ResultDesc: 'Rejected' });
};

// Safaricom callback: per-payment secret token in the URL, optional IP allowlist, then
// request-id matching and an independent status query before anything is granted.
router.post('/mpesa/callback/:token([a-f0-9]{48})', callbackLimit, callbackSource, PaymentsController.mpesaCallback);
// Same handler at a path without "mpesa": Daraja production rejects callback URLs containing
// words like "mpesa" or "safaricom" ("Invalid CallBackURL"). Use this one in production.
router.post('/stk/callback/:token([a-f0-9]{48})', callbackLimit, callbackSource, PaymentsController.mpesaCallback);

router.get('/quote', authMiddleware, PaymentsController.getPaymentQuote);
router.post('/', authMiddleware, createLimit, PaymentsController.createPayment);
router.get('/', authMiddleware, PaymentsController.getPayments);
router.get('/:paymentId', authMiddleware, PaymentsController.getPaymentById);
router.post('/:paymentId/cancel', authMiddleware, PaymentsController.cancelPayment);

export default router;
