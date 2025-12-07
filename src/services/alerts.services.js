import { DatabaseHelper } from "../config/database.js";
import logger from "../middleware/logger.js";
import { ValidationError } from "../middleware/errors.js";
import { v4 as uuidv4 } from "uuid";
import EmailService from "./email.services.js";
import path from "path";
import { fileURLToPath } from "url";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";

dayjs.extend(utc);
dayjs.extend(timezone);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Utility function to get UTC date as YYYY-MM-DD
function getUTCDateString(date) {
  return dayjs(date).utc().format("YYYY-MM-DD");
}

// Utility function to get local date as YYYY-MM-DD (default Africa/Nairobi)
function getLocalDateString(date, timezone = "Africa/Nairobi") {
  return dayjs(date).tz(timezone).format("YYYY-MM-DD");
}

// Utility function to format date for display (default Africa/Nairobi)
function formatLocalDate(date, timezone = "Africa/Nairobi") {
  return dayjs(date).tz(timezone).format("MMMM D, YYYY");
}

class AlertService {
  constructor() {
    this.emailService = new EmailService();
  }

  /**
   * Create a new alert
   * @param {Object} alertData - Alert data including required fields
   * @returns {Promise<Object>} - Created alert
   */
  async createAlert(alertData) {
    const {
      farm_id,
      user_id,
      pig_id,
      pen_id,
      name,
      alert_start_date,
      alert_end_date,
      alert_type,
      severity,
      message,
      status = "pending",
      notify_on,
    } = alertData;

    if (
      !farm_id ||
      !name ||
      !alert_start_date ||
      !alert_type ||
      !severity ||
      !message
    ) {
      throw new ValidationError("Missing required alert fields");
    }

    // Validate severity
    const validSeverities = ["low", "medium", "high"];
    if (!validSeverities.includes(severity)) {
      throw new ValidationError(
        `Invalid severity value: ${severity}. Must be one of ${validSeverities.join(
          ", "
        )}`
      );
    }

    // Validate notify_on dates
    if (notify_on) {
      for (const date of notify_on) {
        if (!dayjs(date, "YYYY-MM-DD", true).isValid()) {
          throw new ValidationError(
            `Invalid notify_on date: ${date}. Must be YYYY-MM-DD`
          );
        }
      }
    }

    // Parse alert_start_date as UTC
    const startDateUTC = dayjs(alert_start_date).utc();
    if (!startDateUTC.isValid()) {
      throw new ValidationError("Invalid alert_start_date format");
    }

    // Default notify_on to day before and on alert_start_date in UTC if not provided
    const defaultNotifyOn = notify_on || [
      getUTCDateString(startDateUTC.subtract(1, "day").toDate()),
      getUTCDateString(startDateUTC.toDate()),
    ];

    try {
      const result = await DatabaseHelper.executeQuery(
        `INSERT INTO alerts (
                    id, name, alert_start_date, alert_end_date, alert_type, severity, message, status,
                    farm_id, user_id, pig_id, pen_id, notify_on, created_on, updated_on, is_active, is_deleted
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, true, false)
                RETURNING *`,
        [
          uuidv4(),
          name,
          alert_start_date,
          alert_end_date || null,
          alert_type,
          severity,
          message,
          status,
          farm_id,
          user_id || null,
          pig_id || null,
          pen_id || null,
          defaultNotifyOn,
        ]
      );

      const alert = result.rows[0];
      logger.info(`Alert ${alert.id} created for farm ${farm_id}`);

      // Send notification if current local date (Africa/Nairobi) is in notify_on
      const currentLocalDate = getLocalDateString(new Date(), "Africa/Nairobi");
      const currentDate = dayjs(currentLocalDate, "YYYY-MM-DD", true);

      const shouldNotify = alert.notify_on.some(notifyDate => {
        const alertDate = dayjs(notifyDate).tz("Africa/Nairobi");
        return currentDate.isSame(alertDate, "day");
      });

      if (shouldNotify) {
        await this.sendAlertNotification(alert);
      }

      return alert;
    } catch (error) {
      logger.error(`Error creating alert: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get due alerts for processing
   * @returns {Promise<Array>} - List of due alerts
   */
  async getDueAlerts() {
    try {
      const currentDate = getUTCDateString(new Date());
      const result = await DatabaseHelper.executeQuery(
        `SELECT * FROM alerts
                 WHERE $1::date = ANY(notify_on)
                 AND status = 'pending'
                 AND is_active = true
                 AND is_deleted = false`,
        [currentDate]
      );
      return result.rows;
    } catch (error) {
      logger.error(`Error fetching due alerts: ${error.message}`);
      throw error;
    }
  }

  /**
   * Send alert notification
   * @param {Object} alert - Alert object
   * @returns {Promise<Object>} - Notification result
   */
  async sendAlertNotification(alert) {
    try {
      // Get user email
      const userResult = await DatabaseHelper.executeQuery(
        "SELECT email FROM users WHERE id = $1 AND is_deleted = 0",
        [alert.user_id]
      );
      const userEmail = userResult.rows[0]?.email;
      const templatePath = path.join(
        __dirname,
        "../templates/alert_notification.html"
      );

      if (userEmail) {
        const emailResult = await this.emailService.sendEmail({
          ...alert,
          from: process.env.DEFAULT_SENDER_EMAIL,
          to: userEmail,
          subject: `Pig Farming Alert: ${alert.name}`,
          text: alert.message,
          templatePath: templatePath,
          appName: "Pig Farm Management",
        });

        if (!emailResult.success) {
          throw new Error(`Failed to send email: ${emailResult.message}`);
        }
      }

      // Update alert status
      await DatabaseHelper.executeQuery(
        `UPDATE alerts SET status = 'sent', updated_on = CURRENT_TIMESTAMP
                 WHERE id = $1`,
        [alert.id]
      );
      logger.info(`Notification sent for alert ${alert.id}`);
      return { success: true, message: "Notification sent successfully" };
    } catch (error) {
      logger.error(
        `Error sending alert notification ${alert.id}: ${error.message}`
      );
      throw error;
    }
  }

  /**
   * Process due alerts (called by scheduler)
   */
  async processDueAlerts() {
    try {
      const dueAlerts = await this.getDueAlerts(farmId);
      const results = [];

      for (const alert of dueAlerts) {
        const result = await this.sendAlertNotification(alert);
        results.push({ alertId: alert.id, ...result });
      }

      return results;
    } catch (error) {
      logger.error(`Error processing due alerts: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get alerts for a farm where notify_on matches today's date in Africa/Nairobi
   * @param {string} farmId - Farm UUID
   * @returns {Promise<Array>} - List of alerts
   */
  async getFarmAlerts(farmId) {
    const currentLocalDate = getLocalDateString(new Date(), "Africa/Nairobi");
    const query = `
            SELECT * FROM alerts
            WHERE farm_id = $1
            AND EXISTS (
                SELECT 1 FROM unnest(notify_on) AS notify_date
                WHERE DATE(notify_date) = $2
            )
            AND is_active = true
            AND is_deleted = false
            ORDER BY severity DESC, alert_start_date ASC
        `;
    const params = [farmId, currentLocalDate];

    try {
      const result = await DatabaseHelper.executeQuery(query, params);
      return result.rows;
    } catch (error) {
      logger.error(
        `Error fetching alerts for farm ${farmId}: ${error.message}`
      );
      throw error;
    }
  }

  /**
   * Update alert status
   * @param {string} alertId - Alert UUID
   * @param {string} status - New status
   * @param {Array} [notify_on] - Optional new notify_on dates
   * @returns {Promise<Object>} - Updated alert
   */
  async updateAlertStatus(alertId, status, notify_on = null) {
    try {
      let query = `UPDATE alerts SET status = $1, updated_on = CURRENT_TIMESTAMP`;
      const params = [status, alertId];
      let paramCount = 3;

      if (notify_on) {
        for (const date of notify_on) {
          if (!dayjs(date, "YYYY-MM-DD", true).isValid()) {
            throw new ValidationError(
              `Invalid notify_on date: ${date}. Must be YYYY-MM-DD`
            );
          }
        }
        query += `, notify_on = $${paramCount++}`;
        params.push(notify_on);
      }

      query += ` WHERE id = $2 AND is_deleted = false RETURNING *`;

      const result = await DatabaseHelper.executeQuery(query, params);

      if (result.rows.length === 0) {
        throw new ValidationError("Alert not found");
      }

      logger.info(`Alert ${alertId} status updated to ${status}`);
      return result.rows[0];
    } catch (error) {
      logger.error(`Error updating alert ${alertId} status: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get active farm id for logged in user
   * @returns {Promise<Object>} - Farm ID object
   */
  async getActiveFarm(email) {
    const query = `
            SELECT f.id from farms f
            INNER JOIN users u ON u.farm_id = f.id
            WHERE f.is_deleted = 0 AND u.is_active = 1 AND u.email = $1
        `;
    try {
      const result = await DatabaseHelper.executeQuery(query, [email]);
      return result.rows.map(row => ({ farm_id: row.id }));
    } catch (error) {
      logger.error(`Error fetching active farms: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get alerts for a farm where notify_on matches today's date in Africa/Nairobi
   * @param {string} farmId - Farm UUID
   * @returns {Promise<Array>} - List of alerts
   */
  async getFarmCalendarAlerts(farmId) {
    const query = `
            SELECT * FROM alerts
            WHERE farm_id = $1
            AND is_active = true
            AND is_deleted = false
            ORDER BY severity DESC, alert_start_date ASC
        `;
    const params = [farmId];
    try {
      const result = await DatabaseHelper.executeQuery(query, params);
      return result.rows;
    } catch (error) {
      logger.error(
        `Error fetching alerts for farm ${farmId}: ${error.message}`
      );
      throw error;
    }
  }
}

export default new AlertService();
