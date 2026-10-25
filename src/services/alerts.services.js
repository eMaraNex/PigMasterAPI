import path from 'path';
import { fileURLToPath } from 'url';
import { DatabaseHelper, pool } from '../config/database.js';
import logger from '../middleware/logger.js';
import EmailService from './email.services.js';
import { FARM_TIMEZONE } from '../business/hooks/alerts.js';

const templatePath = path.join(path.dirname(fileURLToPath(import.meta.url)), '../templates/alert_notification.html');

class AlertService {
  constructor() {
    this.emailService = null;
  }

  mailer() {
    this.emailService ??= new EmailService();
    return this.emailService;
  }

  /**
   * Emails every pending alert due today (farm timezone) and marks it sent.
   * Runs from the scheduler under an advisory lock so instances never double-send.
   */
  async processDueAlerts() {
    const client = await pool.connect();
    try {
      const lock = await client.query("SELECT pg_try_advisory_lock(hashtext('alerts:process')) AS acquired");
      if (!lock.rows[0].acquired) return { skipped: true };
      try {
        const { rows } = await client.query(
          `SELECT a.*, u.email
           FROM alerts a JOIN users u ON u.id = a.user_id AND u.is_deleted = 0
           WHERE (CURRENT_TIMESTAMP AT TIME ZONE $1)::date = ANY(a.notify_on)
             AND a.status = 'pending' AND a.is_active = true AND a.is_deleted = false
           ORDER BY a.alert_start_date LIMIT 500`,
          [FARM_TIMEZONE]
        );
        let sent = 0;
        for (const alert of rows) {
          const result = await this.mailer().sendEmail({
            to: alert.email,
            subject: `Pig Farming Alert: ${alert.name}`,
            text: alert.message,
            templatePath,
            appName: 'PigMaster',
            user_id: alert.user_id,
            farm_id: alert.farm_id,
          });
          if (!result.success) {
            logger.warn(`Alert ${alert.id} email not sent: ${result.message}`);
            if (result.status === 'limit_reached') break;
            continue;
          }
          await DatabaseHelper.executeQuery("UPDATE alerts SET status = 'sent' WHERE id = $1", [alert.id]);
          sent += 1;
        }
        return { due: rows.length, sent };
      } finally {
        await client.query("SELECT pg_advisory_unlock(hashtext('alerts:process'))");
      }
    } finally {
      client.release();
    }
  }
}

export default new AlertService();
