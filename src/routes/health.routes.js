import express from 'express';
import HealthController from '../controllers/health.controllers.js';
import authMiddleware from '../middleware/auth.middleware.js';
import { requireActiveSubscription } from '../middleware/subscription.middleware.js';
import { validateRequest } from '../middleware/validateRequest.js';
import { healthSchema, healthUpdateSchema } from '../utils/validator.js';

const router = express.Router();
const enforceActivePlan = requireActiveSubscription();

router.post('/:farmId', authMiddleware, enforceActivePlan, validateRequest(healthSchema), HealthController.createRecord);
router.get('/:id', authMiddleware, enforceActivePlan, HealthController.getRecord);
router.get('/pig/:pigId', authMiddleware, enforceActivePlan, HealthController.getForPig);
router.put('/:id', authMiddleware, enforceActivePlan, validateRequest(healthUpdateSchema), HealthController.updateRecord);
router.delete('/:id', authMiddleware, enforceActivePlan, HealthController.deleteRecord);

export default router;
