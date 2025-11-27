import express from 'express';
import AlertsController from '../controllers/alerts.controller.js';
import authMiddleware from '../middleware/auth.middleware.js';
import { requireActiveSubscription } from '../middleware/subscription.middleware.js';

const router = express.Router();

router.get('/:farmId', AlertsController.getFarmAlerts);
router.get('/calendar/:farmId', AlertsController.getFarmCalendarAlerts);
router.get('/mail/:farmId', AlertsController.getFarmAlerts);
const enforceActivePlan = requireActiveSubscription();

router.get('/active', authMiddleware, enforceActivePlan, AlertsController.getActiveFarm);

export default router;