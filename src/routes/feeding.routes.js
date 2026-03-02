import express from "express";
import FeedingController from "../controllers/feeding.controllers.js";
import authMiddleware from "../middleware/auth.middleware.js";
import { requireActiveSubscription } from "../middleware/subscription.middleware.js";
import { validateRequest } from "../middleware/validateRequest.js";
import {
  feedingRecordSchema,
  feedingRecordUpdateSchema,
  feedingScheduleSchema,
  feedingScheduleUpdateSchema,
  feedingPeriodRecordSchema,
} from "../utils/validator.js";

const router = express.Router();
const enforceActivePlan = requireActiveSubscription();

// Feeding records (daily - individual pig/pen)
router.post(
  "/record/:farmId",
  authMiddleware,
  enforceActivePlan,
  validateRequest(feedingRecordSchema),
  FeedingController.createRecord,
);
// Add this route to your feeding routes
router.get(
  "/record/farm/:farmId",
  authMiddleware,
  enforceActivePlan,
  FeedingController.getByFarm,
);
router.get(
  "/record/:id",
  authMiddleware,
  enforceActivePlan,
  FeedingController.getRecord,
);
router.get(
  "/record/pig/:pigId",
  authMiddleware,
  enforceActivePlan,
  FeedingController.getByPig,
);
router.delete(
  "/record/:id",
  authMiddleware,
  enforceActivePlan,
  FeedingController.deleteRecord,
);
router.put(
  "/record/:id",
  authMiddleware,
  enforceActivePlan,
  validateRequest(feedingRecordUpdateSchema),
  FeedingController.updateRecord,
);

// Period feeding records (weekly/monthly - farm-wide)
router.post(
  "/record/period/:farmId",
  authMiddleware,
  enforceActivePlan,
  validateRequest(feedingPeriodRecordSchema),
  FeedingController.createPeriodRecord,
);
router.get(
  "/record/period/farm/:farmId",
  authMiddleware,
  enforceActivePlan,
  FeedingController.getPeriodRecordsByFarm,
);
router.delete(
  "/record/period/:id",
  authMiddleware,
  enforceActivePlan,
  FeedingController.deletePeriodRecord,
);

// Feeding schedules
router.post(
  "/schedule/:farmId",
  authMiddleware,
  enforceActivePlan,
  validateRequest(feedingScheduleSchema),
  FeedingController.createSchedule,
);
router.get(
  "/schedule/pig/:pigId",
  authMiddleware,
  enforceActivePlan,
  FeedingController.getScheduleForPig,
);
router.put(
  "/schedule/:id",
  authMiddleware,
  enforceActivePlan,
  validateRequest(feedingScheduleUpdateSchema),
  FeedingController.updateSchedule,
);
router.delete(
  "/schedule/:id",
  authMiddleware,
  enforceActivePlan,
  FeedingController.deleteSchedule,
);

export default router;
