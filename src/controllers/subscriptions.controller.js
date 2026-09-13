import SubscriptionService from '../services/subscription.service.js';
import { SuccessResponse } from '../middleware/responses.js';
import logger from '../middleware/logger.js';

class SubscriptionsController {
  static async getSubscription(req, res, next) {
    try {
      const subscription = await SubscriptionService.getUserSubscription(req.user.id);
      return SuccessResponse(res, 200, 'Subscription retrieved successfully', subscription);
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
