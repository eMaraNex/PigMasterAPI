import RowsService from '../services/rows.services.js';
import { SuccessResponse } from '../middleware/responses.js';
import logger from '../middleware/logger.js';

class RowsController {
    static async createRow(req, res, next) {
        try {
            const rowData = { ...req.body, farm_id: req.body.farm_id };
            const userId = req.user.id;
            const row = await RowsService.createRow(rowData, userId);
            return SuccessResponse(res, 201, 'Row created successfully', row);
        } catch (error) {
            logger.error(`Create row error: ${error.message}`);
            next(error);
        }
    }

    static async getRowByName(req, res, next) {
        try {
            const { name, farmId } = req.params;
            const row = await RowsService.getRowByName(name, farmId);
            return SuccessResponse(res, 200, 'Row retrieved successfully', row);
        } catch (error) {
            logger.error(`Get row error: ${error.message}`);
            next(error);
        }
    }

    static async getAllRows(req, res, next) {
        try {
            const { farmId } = req.params;
            const rows = await RowsService.getAllRows(farmId);
            return SuccessResponse(res, 200, 'Rows retrieved successfully', rows);
        } catch (error) {
            logger.error(`Get all rows error: ${error.message}`);
            next(error);
        }
    }

    static async updateRow(req, res, next) {
        try {
            const { rowId, farmId } = req.params;
            const rowData = req.body;
            const userId = req.user.id;
            const row = await RowsService.updateRow(rowId, farmId, rowData, userId);
            return SuccessResponse(res, 200, 'Row updated successfully', row);
        } catch (error) {
            logger.error(`Update row error: ${error.message}`);
            next(error);
        }
    }

    static async deleteRow(req, res, next) {
        try {
            const { rowId, farmId } = req.params;
            const userId = req.user.id;
            const row = await RowsService.deleteRow(rowId, farmId, userId);
            return SuccessResponse(res, 200, 'Row deleted successfully', row);
        } catch (error) {
            logger.error(`Delete row error: ${error.message}`);
            next(error);
        }
    }

    static async expandRowCapacity(req, res, next) {
        try {
            const { name, farm_id: farmId, additionalCapacity, row_id } = req.body;
            const userId = req.userId;
            const updatedRow = await RowsService.expandRowCapacity(name, farmId, additionalCapacity, userId, row_id);
            res.status(200).json({
                success: true,
                message: 'Row capacity expanded successfully',
                data: updatedRow,
            });
        } catch (error) {
            next(error);
        }
    }
}

export default RowsController;