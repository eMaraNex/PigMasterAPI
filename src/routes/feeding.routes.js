import express from 'express';
import FeedingController from '../controllers/feeding.controllers.js';
import authMiddleware from '../middleware/auth.middleware.js';
import { requireActiveSubscription } from '../middleware/subscription.middleware.js';
import { validateRequest } from '../middleware/validateRequest.js';
import { feedingRecordSchema, feedingRecordUpdateSchema, feedingScheduleSchema, feedingScheduleUpdateSchema } from '../utils/validator.js';

const router = express.Router();
const enforceActivePlan = requireActiveSubscription();

// Feeding records
router.post('/record/:farmId', authMiddleware, enforceActivePlan, validateRequest(feedingRecordSchema), FeedingController.createRecord);
router.get('/record/:id', authMiddleware, enforceActivePlan, FeedingController.getRecord);
router.get('/record/pig/:pigId', authMiddleware, enforceActivePlan, FeedingController.getByPig);
router.delete('/record/:id', authMiddleware, enforceActivePlan, FeedingController.deleteRecord);
router.put('/record/:id', authMiddleware, enforceActivePlan, validateRequest(feedingRecordUpdateSchema), FeedingController.updateRecord);

// Feeding schedules
router.post('/schedule/:farmId', authMiddleware, enforceActivePlan, validateRequest(feedingScheduleSchema), FeedingController.createSchedule);
router.get('/schedule/pig/:pigId', authMiddleware, enforceActivePlan, FeedingController.getScheduleForPig);
router.put('/schedule/:id', authMiddleware, enforceActivePlan, validateRequest(feedingScheduleUpdateSchema), FeedingController.updateSchedule);
router.delete('/schedule/:id', authMiddleware, enforceActivePlan, FeedingController.deleteSchedule);

export default router;
