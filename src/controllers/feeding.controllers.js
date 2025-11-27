import FeedingService from '../services/feeding.services.js';
import { SuccessResponse } from '../middleware/responses.js';
import { ValidationError } from '../middleware/errors.js';
import logger from '../middleware/logger.js';

class FeedingController {
    static async createRecord(req, res, next) {
        try {
            const data = req.body;
            const userId = req.user?.id;
            if (!userId) throw new ValidationError('User not authenticated');

            const rec = await FeedingService.createFeedingRecord(data, userId);
            return SuccessResponse(res, 201, 'Feeding record created successfully', rec);
        } catch (error) {
            logger.error(`Create feeding record error: ${error.message}`);
            next(error);
        }
    }

    static async getRecord(req, res, next) {
        try {
            const { id } = req.params;
            const rec = await FeedingService.getFeedingById(id);
            return SuccessResponse(res, 200, 'Feeding record retrieved successfully', rec);
        } catch (error) {
            logger.error(`Get feeding record error: ${error.message}`);
            next(error);
        }
    }

    static async getByPig(req, res, next) {
        try {
            const { pigId } = req.params;
            const { limit, offset, date_from, date_to } = req.query;
            const parsedLimit = limit ? parseInt(limit, 10) : undefined;
            const parsedOffset = offset ? parseInt(offset, 10) : undefined;

            const records = await FeedingService.getFeedingByPig(pigId, { limit: parsedLimit, offset: parsedOffset, date_from, date_to });
            return SuccessResponse(res, 200, 'Feeding records retrieved successfully', records);
        } catch (error) {
            logger.error(`Get feeding records by pig error: ${error.message}`);
            next(error);
        }
    }

    static async deleteRecord(req, res, next) {
        try {
            const { id } = req.params;
            const userId = req.user?.id;
            if (!userId) throw new ValidationError('User not authenticated');
            const rec = await FeedingService.deleteFeedingRecord(id, userId);
            return SuccessResponse(res, 200, 'Feeding record deleted successfully', rec);
        } catch (error) {
            logger.error(`Delete feeding record error: ${error.message}`);
            next(error);
        }
    }

    static async updateRecord(req, res, next) {
        try {
            const { id } = req.params;
            const userId = req.user?.id;
            if (!userId) throw new ValidationError('User not authenticated');
            const data = req.body;
            const rec = await FeedingService.updateFeedingRecord(id, data, userId);
            return SuccessResponse(res, 200, 'Feeding record updated successfully', rec);
        } catch (error) {
            logger.error(`Update feeding record error: ${error.message}`);
            next(error);
        }
    }

    // schedules
    static async createSchedule(req, res, next) {
        try {
            const userId = req.user?.id;
            if (!userId) throw new ValidationError('User not authenticated');
            const data = req.body;
            const schedule = await FeedingService.createFeedingSchedule(data, userId);
            return SuccessResponse(res, 201, 'Feeding schedule created successfully', schedule);
        } catch (error) {
            logger.error(`Create feeding schedule error: ${error.message}`);
            next(error);
        }
    }

    static async getScheduleForPig(req, res, next) {
        try {
            const { pigId } = req.params;
            const schedules = await FeedingService.getScheduleByPig(pigId);
            return SuccessResponse(res, 200, 'Feeding schedule retrieved successfully', schedules);
        } catch (error) {
            logger.error(`Get feeding schedule error: ${error.message}`);
            next(error);
        }
    }

    static async updateSchedule(req, res, next) {
        try {
            const { id } = req.params;
            const userId = req.user?.id;
            if (!userId) throw new ValidationError('User not authenticated');
            const data = req.body;
            const schedule = await FeedingService.updateFeedingSchedule(id, data, userId);
            return SuccessResponse(res, 200, 'Feeding schedule updated successfully', schedule);
        } catch (error) {
            logger.error(`Update feeding schedule error: ${error.message}`);
            next(error);
        }
    }

    static async deleteSchedule(req, res, next) {
        try {
            const { id } = req.params;
            const userId = req.user?.id;
            if (!userId) throw new ValidationError('User not authenticated');
            const schedule = await FeedingService.deleteFeedingSchedule(id, userId);
            return SuccessResponse(res, 200, 'Feeding schedule deleted successfully', schedule);
        } catch (error) {
            logger.error(`Delete feeding schedule error: ${error.message}`);
            next(error);
        }
    }
}

export default FeedingController;
