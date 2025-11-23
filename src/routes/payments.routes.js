// routes/payments.routes.js
import express from 'express';
import PaymentsController from '../controllers/payments.controller.js';
import { validateRequest } from '../middleware/validateRequest.js';
import { paymentSchema } from '../utils/validator.js'; 
import authMiddleware from '../middleware/auth.middleware.js';

const router = express.Router();

// Protected routes
router.post('/', authMiddleware, validateRequest(paymentSchema), PaymentsController.createPayment);
router.get('/', authMiddleware, PaymentsController.getPayments);
router.get('/:paymentId', authMiddleware, PaymentsController.getPaymentById);
router.patch('/:paymentId/status', authMiddleware, PaymentsController.updatePaymentStatus);

// Public webhook for M-Pesa callback
router.post('/mpesa/callback', PaymentsController.mpesaCallback);

export default router;