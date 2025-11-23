import logger from '../middleware/logger.js';
import { SuccessResponse } from '../middleware/responses.js';
import alertsServices from '../services/alerts.services.js';

class AlertsController {
    static async getFarmAlerts(req, res, next) {
        try {
            const { farmId } = req.params;
            const user = await alertsServices.getFarmAlerts(farmId, req.body);
            return SuccessResponse(res, 201, 'Alerts loaded successfully', user)
        } catch (error) {
            logger.error(`Loading error: ${error.message}`);
            next(error);
        }
    }
    static async getActiveFarm(req, res, next) {
        try {
            const { email } = req.user;
            const user = await alertsServices.getActiveFarm(email, req.body);
            return SuccessResponse(res, 201, 'Farm loaded successfully', user)
        } catch (error) {
            logger.error(`Loading error: ${error.message}`);
            next(error);
        }
    }

    static async getFarmCalendarAlerts(req, res, next) {
        try {
            const { farmId } = req.params;
            const user = await alertsServices.getFarmCalendarAlerts(farmId);
            return SuccessResponse(res, 201, 'Alerts loaded successfully', user)
        } catch (error) {
            logger.error(`Loading error: ${error.message}`);
            next(error);
        }
    }
}

export default AlertsController;