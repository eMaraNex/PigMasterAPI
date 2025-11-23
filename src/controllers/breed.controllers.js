import BreedingService from '../services/breed.services.js';
import { SuccessResponse } from '../middleware/responses.js';
import logger from '../middleware/logger.js';

class BreedingController {
    static async createBreedingRecord(req, res, next) {
        try {
            const breedingData = { ...req.body, farm_id: req.body.farm_id };
            const userId = req.user.id;
            const breedingRecord = await BreedingService.createBreedingRecord(breedingData, userId);
            return SuccessResponse(res, 201, 'Breeding record created successfully', breedingRecord);
        } catch (error) {
            logger.error(`Create breeding record error: ${error.message}`);
            next(error);
        }
    }

    static async getBreedingRecordById(req, res, next) {
        try {
            const { recordId, farmId } = req.params;
            const breedingRecord = await BreedingService.getBreedingRecordById(recordId, farmId);
            return SuccessResponse(res, 200, 'Breeding record retrieved successfully', breedingRecord);
        } catch (error) {
            logger.error(`Get breeding record error: ${error.message}`);
            next(error);
        }
    }

    static async getBreedingHistoryByPigId(req, res, next) {
        try {
            const { farmId, pigId } = req.params;
            const breedingHistory = await BreedingService.getBreedingHistoryByPigId(farmId, pigId);
            return SuccessResponse(res, 200, 'Breeding history retrieved successfully', breedingHistory);
        }
        catch (error) {
            logger.error(`Get breeding history by pig ID error: ${error.message}`);
            next(error);
        }
    }

    static async getAllBreedingRecords(req, res, next) {
        try {
            const { farmId } = req.params;
            const breedingRecords = await BreedingService.getAllBreedingRecords(farmId);
            return SuccessResponse(res, 200, 'Breeding records retrieved successfully', breedingRecords);
        } catch (error) {
            logger.error(`Get all breeding records error: ${error.message}`);
            next(error);
        }
    }

    static async updateBreedingRecord(req, res, next) {
        try {
            const { recordId, farmId } = req.params;
            const updateData = req.body;
            const userId = req.user.id;
            const breedingRecord = await BreedingService.updateBreedingRecord(recordId, farmId, updateData, userId);
            return SuccessResponse(res, 200, 'Breeding record updated successfully', breedingRecord);
        } catch (error) {
            logger.error(`Update breeding record error: ${error.message}`);
            next(error);
        }
    }

    static async deleteBreedingRecord(req, res, next) {
        try {
            const { recordId, farmId } = req.params;
            const userId = req.user.id;
            const deletedRecord = await BreedingService.deleteBreedingRecord(recordId, farmId, userId);
            return SuccessResponse(res, 200, 'Breeding record deleted successfully', deletedRecord);
        } catch (error) {
            logger.error(`Delete breeding record error: ${error.message}`);
            next(error);
        }
    }

    static async createKitRecord(req, res, next) {
        try {
            const { farmId } = req.params;
            const kitData = { ...req.body };
            const userId = req.user.id;
            const kitRecord = await BreedingService.createKitRecord(kitData, farmId, userId);
            return SuccessResponse(res, 201, 'Kit record created successfully', kitRecord);
        } catch (error) {
            logger.error(`Create kit record error: ${error.message}`);
            next(error);
        }
    }

    static async updateKitRecord(req, res, next) {
        try {
            const { kitId } = req.params;
            const updateData = req.body;
            const userId = req.user.id;
            const kitRecord = await BreedingService.updateKitRecord(kitId, updateData, userId);
            return SuccessResponse(res, 200, 'Kit record updated successfully', kitRecord);
        } catch (error) {
            logger.error(`Update kit record error: ${error.message}`);
            next(error);
        }
    }
}

export default BreedingController;