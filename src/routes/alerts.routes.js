import express from 'express';
import AlertsController from '../controllers/alerts.controller.js';
import authMiddleware from '../middleware/auth.middleware.js';
import { requireActiveSubscription } from '../middleware/subscription.middleware.js';
import FarmsService from '../services/farms.services.js';

const router = express.Router();

const authorizeFarm = async (req, res, next) => {
    try {
        await FarmsService.getFarmById(req.params.farmId, req.user.id);
        next();
    } catch (error) {
        next(error);
    }
};

router.get('/:farmId', authMiddleware, authorizeFarm, AlertsController.getFarmAlerts);
router.get('/calendar/:farmId', authMiddleware, authorizeFarm, AlertsController.getFarmCalendarAlerts);
router.get('/mail/:farmId', authMiddleware, authorizeFarm, AlertsController.getFarmAlerts);
const enforceActivePlan = requireActiveSubscription();

router.get('/active', authMiddleware, enforceActivePlan, AlertsController.getActiveFarm);

export default router;