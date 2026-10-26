import SubscriptionService from '../services/subscription.service.js';
import { SuccessResponse } from '../middleware/responses.js';
import logger from '../middleware/logger.js';

class SubscriptionsController {
  static async getSubscription(req, res, next) {
    try {
      // Team members work under the farm owner's plan.
      const ownerId = req.farmAccess?.ownerId ?? req.user.id;
      const subscription = await SubscriptionService.getUserSubscription(ownerId);
      const access = req.accessControl ?? {};
      return SuccessResponse(res, 200, 'Subscription retrieved successfully', {
        ...(subscription ?? {}),
        is_farm_owner: ownerId === req.user.id,
        has_active_subscription: Boolean(access.hasActiveSubscription),
        is_trial_active: Boolean(access.isTrialActive),
        trial_ends_at: access.trialEndsAt ?? null,
      });
    } catch (error) {
      logger.error(`Get subscription error: ${error.message}`);
      next(error);
    }
  }

  static async getPlans(req, res, next) {
    try {
      const plans = await SubscriptionService.getAvailablePlans();
      return SuccessResponse(res, 200, 'Plans retrieved successfully', plans);
    } catch (error) {
      logger.error(`Get plans error: ${error.message}`);
      next(error);
    }
  }
}

export default SubscriptionsController;
