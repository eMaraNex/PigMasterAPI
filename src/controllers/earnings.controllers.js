import { SuccessResponse } from '../middleware/responses.js';
import logger from '../middleware/logger.js';
import { ValidationError } from '../middleware/errors.js';
import EarningsService from '../services/earnings.services.js';

class EarningsController {
    static async createEarnings(req, res, next) {
        try {
            const earningsData = { ...req.body, farm_id: req.body.farm_id };
            const userId = req.user?.id;
            if (!userId) {
                throw new ValidationError('User not authenticated');
            }
            const earnings = await EarningsService.createEarnings(earningsData, userId);
            return SuccessResponse(res, 201, 'Earnings record created successfully', earnings);
        } catch (error) {
            logger.error(`Create earnings error: ${error.message}`);
            next(error);
        }
    }

    static async getEarnings(req, res, next) {
        try {
            const { id, farmId } = req.params;
            if (!farmId || !id) {
                throw new ValidationError('Missing farmId or earnings ID');
            }
            const earnings = await EarningsService.getEarningsById(id, farmId);
            if (!earnings) {
                throw new ValidationError('Earnings record not found');
            }
            return SuccessResponse(res, 200, 'Earnings record retrieved successfully', earnings);
        } catch (error) {
            logger.error(`Get earnings error: ${error.message}`);
            next(error);
        }
    }

    static async getAllEarnings(req, res, next) {
        try {
            const { farmId } = req.params;
            const { type, date_from, date_to, limit, offset } = req.query;
            if (!farmId) {
                throw new ValidationError('Missing farmId');
            }
            const parsedLimit = limit ? parseInt(limit, 10) : undefined;
            const parsedOffset = offset ? parseInt(offset, 10) : undefined;
            if ((limit && isNaN(parsedLimit)) || (offset && isNaN(parsedOffset))) {
                throw new ValidationError('Limit and offset must be valid integers');
            }
            const filters = {
                type: type || undefined,
                date_from: date_from || undefined,
                date_to: date_to || undefined,
                limit: parsedLimit,
                offset: parsedOffset,
            };
            const earnings = await EarningsService.getAllEarnings(farmId, filters);
            return SuccessResponse(res, 200, 'Earnings records retrieved successfully', earnings);
        } catch (error) {
            logger.error(`Get all earnings error: ${error.message}`);
            next(error);
        }
    }

    static async updateEarnings(req, res, next) {
        try {
            const { id, farmId } = req.params;
            const earningsData = req.body;
            const userId = req.user?.id;
            if (!userId) {
                throw new ValidationError('User not authenticated');
            }
            if (!farmId || !id) {
                throw new ValidationError('Missing farmId or earnings ID');
            }
            const earnings = await EarningsService.updateEarnings(id, farmId, earningsData, userId);
            if (!earnings) {
                throw new ValidationError('Earnings record not found');
            }
            return SuccessResponse(res, 200, 'Earnings record updated successfully', earnings);
        } catch (error) {
            logger.error(`Update earnings error: ${error.message}`);
            next(error);
        }
    }

    static async deleteEarnings(req, res, next) {
        try {
            const { id, farmId } = req.params;
            const userId = req.user?.id;
            if (!userId) {
                throw new ValidationError('User not authenticated');
            }
            if (!farmId || !id) {
                throw new ValidationError('Missing farmId or earnings ID');
            }
            const earnings = await EarningsService.deleteEarnings(id, farmId, userId);
            if (!earnings) {
                throw new ValidationError('Earnings record not found');
            }
            return SuccessResponse(res, 200, 'Earnings record deleted successfully', earnings);
        } catch (error) {
            logger.error(`Delete earnings error: ${error.message}`);
            next(error);
        }
    }
}

export default EarningsController;