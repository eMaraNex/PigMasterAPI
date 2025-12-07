import PensService from "../services/pens.services.js";
import { SuccessResponse } from "../middleware/responses.js";
import logger from "../middleware/logger.js";
import { ValidationError } from "../middleware/errors.js";

class PensController {
  static async createPen(req, res, next) {
    try {
      const penData = { ...req.body, farm_id: req.body.farm_id };
      const userId = req.user?.id;
      if (!userId) {
        throw new ValidationError("User not authenticated");
      }
      const pen = await PensService.createPen(penData, userId);
      return SuccessResponse(res, 201, "Pen created successfully", pen);
    } catch (error) {
      logger.error(`Create pen error: ${error.message}`);
      next(error);
    }
  }

  static async getPen(req, res, next) {
    try {
      const { id, farmId } = req.params;
      if (!farmId || !id) {
        throw new ValidationError("Missing farmId or pen id");
      }
      const pen = await PensService.getPenById(id, farmId);
      return SuccessResponse(res, 200, "Pen retrieved successfully", pen);
    } catch (error) {
      logger.error(`Get pen error: ${error.message}`);
      next(error);
    }
  }

  static async getAllPens(req, res, next) {
    try {
      const { farmId } = req.params;
      const { rowName, limit, offset, is_occupied } = req.query;
      if (!farmId) {
        throw new ValidationError("Missing farmId");
      }
      // Validate query params
      const parsedLimit = limit ? parseInt(limit) : undefined;
      const parsedOffset = offset ? parseInt(offset) : undefined;
      if ((limit && isNaN(parsedLimit)) || (offset && isNaN(parsedOffset))) {
        throw new ValidationError("Limit and offset must be valid integers");
      }
      const filters = {
        rowName: rowName || undefined,
        limit: parsedLimit,
        offset: parsedOffset,
        is_occupied:
          is_occupied === "true"
            ? true
            : is_occupied === "false"
            ? false
            : undefined,
      };
      const pens = await PensService.getAllPens(farmId, filters);
      return SuccessResponse(res, 200, "Pens retrieved successfully", pens);
    } catch (error) {
      logger.error(`Get all pens error: ${error.message}`);
      next(error);
    }
  }

  static async updatePen(req, res, next) {
    try {
      const { id, farmId } = req.params;
      const penData = req.body;
      const userId = req.user?.id;
      if (!userId) {
        throw new ValidationError("User not authenticated");
      }
      if (!farmId || !id) {
        throw new ValidationError("Missing farmId or pen id");
      }
      const pen = await PensService.updatePen(id, farmId, penData, userId);
      return SuccessResponse(res, 200, "Pen updated successfully", pen);
    } catch (error) {
      logger.error(`Update pen error: ${error.message}`);
      next(error);
    }
  }

  static async getPenRemovedPigHistory(req, res, next) {
    try {
      const { farmId, penId } = req.params;
      if (!farmId || !penId) {
        throw new ValidationError("Missing farmId or penId");
      }
      const history = await PensService.getPenRemovedPigHistory(farmId, penId);
      return SuccessResponse(
        res,
        200,
        "Pen pig history retrieved successfully",
        history
      );
    } catch (error) {
      logger.error(`Retrieving pen history error: ${error.message}`);
      next(error);
    }
  }

  static async deletePen(req, res, next) {
    try {
      const { id, farmId } = req.params;
      const userId = req.user?.id;
      if (!userId) {
        throw new ValidationError("User not authenticated");
      }
      if (!farmId || !id) {
        throw new ValidationError("Missing farmId or pen id");
      }
      const pen = await PensService.deletePen(id, farmId, userId);
      return SuccessResponse(res, 200, "Pen deleted successfully", pen);
    } catch (error) {
      logger.error(`Delete pen error: ${error.message}`);
      next(error);
    }
  }
}

export default PensController;
