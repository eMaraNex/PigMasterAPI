import FarmsService from '../services/farms.services.js';
import { SuccessResponse } from '../middleware/responses.js';
import logger from '../middleware/logger.js';

class FarmsController {
    static async createFarm(req, res, next) {
        try {
            const farmData = req.body;
            const userId = req.user.id;
            const farm = await FarmsService.createFarm(farmData, userId);
            return SuccessResponse(res, 201, 'Farm created successfully', farm);
        } catch (error) {
            logger.error(`Create farm error: ${error.message}`);
            next(error);
        }
    }

    static async getFarmById(req, res, next) {
        try {
            const { farmId } = req.params;
            const userId = req.user.id;
            const farm = await FarmsService.getFarmById(farmId, userId);
            return SuccessResponse(res, 200, 'Farm retrieved successfully', farm);
        } catch (error) {
            logger.error(`Get farm error: ${error.message}`);
            next(error);
        }
    }

    static async getAllFarms(req, res, next) {
        try {
            const farms = await FarmsService.getAllFarms();
            return SuccessResponse(res, 200, 'Farms retrieved successfully', farms);
        } catch (error) {
            logger.error(`Get all farms error: ${error.message}`);
            next(error);
        }
    }

    static async updateFarm(req, res, next) {
        try {
            const { farmId } = req.params;
            const farmData = req.body;
            const userId = req.user.id;
            const farm = await FarmsService.updateFarm(farmId, farmData, userId);
            return SuccessResponse(res, 200, 'Farm updated successfully', farm);
        } catch (error) {
            logger.error(`Update farm error: ${error.message}`);
            next(error);
        }
    }

    static async deleteFarm(req, res, next) {
        try {
            const { farmId } = req.params;
            const userId = req.user.id;
            const farm = await FarmsService.deleteFarm(farmId, userId);
            return SuccessResponse(res, 200, 'Farm deleted successfully', farm);
        } catch (error) {
            logger.error(`Delete farm error: ${error.message}`);
            next(error);
        }
    }
}

export default FarmsController;