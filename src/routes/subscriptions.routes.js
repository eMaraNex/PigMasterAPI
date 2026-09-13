import express from 'express';
import SubscriptionsController from '../controllers/subscriptions.controller.js';
import authMiddleware from '../middleware/auth.middleware.js';

const router = express.Router();

router.get('/me', authMiddleware, SubscriptionsController.getSubscription);
router.get('/plans', authMiddleware, SubscriptionsController.getPlans);

export default router;
