import HealthService from '../services/health.services.js';
import { SuccessResponse } from '../middleware/responses.js';
import logger from '../middleware/logger.js';
import { ValidationError } from '../middleware/errors.js';

class HealthController {
  static async createRecord(req, res, next) {
    try {
      const data = req.body;
      const userId = req.user?.id;
      if (!userId) throw new ValidationError('User not authenticated');

      const rec = await HealthService.createHealthRecord(data, userId);
      return SuccessResponse(res, 201, 'Health record created successfully', rec);
    } catch (err) {
      logger.error(`Create health record error: ${err.message}`);
      next(err);
    }
  }

  static async getRecord(req, res, next) {
    try {
      const { id } = req.params;
      const rec = await HealthService.getHealthById(id);
      return SuccessResponse(res, 200, 'Health record retrieved successfully', rec);
    } catch (err) {
      logger.error(`Get health record error: ${err.message}`);
      next(err);
    }
  }

  static async getForPig(req, res, next) {
    try {
      const { pigId } = req.params;
      const { limit, offset, date_from, date_to } = req.query;
      const parsedLimit = limit ? parseInt(limit, 10) : undefined;
      const parsedOffset = offset ? parseInt(offset, 10) : undefined;

      const records = await HealthService.getHealthForPig(pigId, { limit: parsedLimit, offset: parsedOffset, date_from, date_to });
      return SuccessResponse(res, 200, 'Health records retrieved successfully', records);
    } catch (err) {
      logger.error(`Get health records for pig error: ${err.message}`);
      next(err);
    }
  }

  static async updateRecord(req, res, next) {
    try {
      const { id } = req.params;
      const data = req.body;
      const userId = req.user?.id;
      if (!userId) throw new ValidationError('User not authenticated');

      const rec = await HealthService.updateHealthRecord(id, data, userId);
      return SuccessResponse(res, 200, 'Health record updated successfully', rec);
    } catch (err) {
      logger.error(`Update health record error: ${err.message}`);
      next(err);
    }
  }

  static async deleteRecord(req, res, next) {
    try {
      const { id } = req.params;
      const userId = req.user?.id;
      if (!userId) throw new ValidationError('User not authenticated');

      const rec = await HealthService.deleteHealthRecord(id, userId);
      return SuccessResponse(res, 200, 'Health record deleted successfully', rec);
    } catch (err) {
      logger.error(`Delete health record error: ${err.message}`);
      next(err);
    }
  }
}

export default HealthController;
