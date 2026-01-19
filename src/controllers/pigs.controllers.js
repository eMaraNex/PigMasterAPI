import PigsService from "../services/pigs.services.js";
import { SuccessResponse } from "../middleware/responses.js";
import logger from "../middleware/logger.js";

class PigsController {
  static async createPig(req, res, next) {
    try {
      const pigData = { ...req.body, farm_id: req.body.farm_id };
      const userId = req.user.id;
      const pig = await PigsService.createPig(pigData, userId);
      return SuccessResponse(res, 201, "Pig created successfully", pig);
    } catch (error) {
      logger.error(`Create pig error: ${error.message}`);
      next(error);
    }
  }

  static async getPigById(req, res, next) {
    try {
      const { pigId, farmId } = req.params;
      const pig = await PigsService.getPigById(pigId, farmId);
      return SuccessResponse(res, 200, "Pig retrieved successfully", pig);
    } catch (error) {
      logger.error(`Get pig error: ${error.message}`);
      next(error);
    }
  }

  static async getAllPigs(req, res, next) {
    try {
      const { farmId } = req.params;
      const { penId } = req.query;
      const pigs = await PigsService.getAllPigs(farmId, penId);
      return SuccessResponse(res, 200, "Pigs retrieved successfully", pigs);
    } catch (error) {
      logger.error(`Get all pigs error: ${error.message}`);
      next(error);
    }
  }

  static async updatePig(req, res, next) {
    try {
      const { pigId, farmId } = req.params;
      const pigData = req.body;
      const userId = req.user.id;
      const pig = await PigsService.updatePig(pigId, farmId, pigData, userId);
      return SuccessResponse(res, 200, "Pig updated successfully", pig);
    } catch (error) {
      logger.error(`Update pig error: ${error.message}`);
      next(error);
    }
  }

  static async deletePig(req, res, next) {
    try {
      const { pigId, farmId } = req.params;
      const removalData = req.body;
      const userId = req.user.id;
      const pig = await PigsService.deletePig(
        pigId,
        farmId,
        removalData,
        userId
      );
      return SuccessResponse(res, 200, "Pig deleted successfully", pig);
    } catch (error) {
      logger.error(`Delete pig error: ${error.message}`);
      next(error);
    }
  }

  static async getAllPigDetails(req, res, next) {
    try {
      const { farmId } = req.params;
      const options = req.body;
      const pigs = await PigsService.getAllPigDetails(farmId, options);
      return SuccessResponse(res, 200, "Pigs retrieved successfully", pigs);
    } catch (error) {
      logger.error(`Get all pigs error: ${error.message}`);
      next(error);
    }
  }
  static async transferPig(req, res, next) {
    try {
      const { pigId, farmId } = req.params;
      const transferData = req.body;
      const userId = req.user.id;
      const pig = await PigsService.transferPig(pigId, farmId, transferData, userId);
      return SuccessResponse(res, 200, "Pig transferred successfully", pig);
    } catch (error) {
      logger.error(`Transfer pig error: ${error.message}`);
      next(error);
    }
  }

  static async getPigTransferHistory(req, res, next) {
    try {
      const { pigId, farmId } = req.params;
      const history = await PigsService.getPigTransferHistory(pigId, farmId);
      return SuccessResponse(res, 200, "Transfer history retrieved successfully", history);
    } catch (error) {
      logger.error(`Get transfer history error: ${error.message}`);
      next(error);
    }
  }}

export default PigsController;
