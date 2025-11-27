import { DatabaseHelper } from '../config/database.js';
import logger from '../middleware/logger.js';
import { ValidationError } from '../middleware/errors.js';

class HealthService {
  static async createHealthRecord(data, userId) {
    const { pig_id, type, description, date, next_due, status, veterinarian, notes } = data;
    if (!pig_id || !type || !description || !date) {
      throw new ValidationError('Missing required health fields');
    }

    try {
      const pigResult = await DatabaseHelper.executeQuery(
        'SELECT pig_id FROM pigs WHERE pig_id = $1 AND is_deleted = 0',
        [pig_id]
      );
      if (pigResult.rows.length === 0) throw new ValidationError('Pig not found');

      const result = await DatabaseHelper.executeQuery(
        `INSERT INTO health_records (id, pig_id, type, description, date, next_due, status, veterinarian, notes, is_deleted, created_at, updated_at)
          VALUES (uuid_generate_v4(), $1, $2, $3, $4, $5, COALESCE($6,'completed'), $7, $8, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) RETURNING *`,
        [pig_id, type, description, date, next_due || null, status || null, veterinarian || null, notes || null]
      );

      logger.info(`Health record created by user ${userId} for pig ${pig_id}`);
      return result.rows[0];
    } catch (err) {
      logger.error(`Error creating health record: ${err.message}`);
      throw err;
    }
  }

  static async getHealthById(id) {
    try {
      const result = await DatabaseHelper.executeQuery('SELECT * FROM health_records WHERE id = $1 AND is_deleted = 0', [id]);
      if (result.rows.length === 0) throw new ValidationError('Health record not found');
      return result.rows[0];
    } catch (err) {
      logger.error(`Error fetching health record ${id}: ${err.message}`);
      throw err;
    }
  }

  static async getHealthForPig(pigId, { limit, offset, date_from, date_to } = {}) {
    try {
      let query = 'SELECT * FROM health_records WHERE pig_id = $1 AND is_deleted = 0';
      const params = [pigId];
      let idx = 2;
      if (date_from) { query += ` AND date >= $${idx++}`; params.push(date_from); }
      if (date_to) { query += ` AND date <= $${idx++}`; params.push(date_to); }
      query += ' ORDER BY date DESC';
      if (limit !== undefined) { query += ` LIMIT $${idx++}`; params.push(limit); }
      if (offset !== undefined) { query += ` OFFSET $${idx++}`; params.push(offset); }

      const result = await DatabaseHelper.executeQuery(query, params);
      return result.rows;
    } catch (err) {
      logger.error(`Error fetching health records for pig ${pigId}: ${err.message}`);
      throw err;
    }
  }

  static async updateHealthRecord(id, data, userId) {
    try {
      const { type, description, date, next_due, status, veterinarian, notes } = data;
      const result = await DatabaseHelper.executeQuery(
        `UPDATE health_records SET
            type = COALESCE($2, type),
            description = COALESCE($3, description),
            date = COALESCE($4, date),
            next_due = COALESCE($5, next_due),
            status = COALESCE($6, status),
            veterinarian = COALESCE($7, veterinarian),
            notes = COALESCE($8, notes),
            updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND is_deleted = 0 RETURNING *`,
        [id, type || null, description || null, date || null, next_due || null, status || null, veterinarian || null, notes || null]
      );
      if (result.rows.length === 0) throw new ValidationError('Health record not found');
      logger.info(`Health record ${id} updated by user ${userId}`);
      return result.rows[0];
    } catch (err) {
      logger.error(`Error updating health record ${id}: ${err.message}`);
      throw err;
    }
  }

  static async deleteHealthRecord(id, userId) {
    try {
      const result = await DatabaseHelper.executeQuery('UPDATE health_records SET is_deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND is_deleted = 0 RETURNING *', [id]);
      if (result.rows.length === 0) throw new ValidationError('Health record not found');
      logger.info(`Health record ${id} deleted by user ${userId}`);
      return result.rows[0];
    } catch (err) {
      logger.error(`Error deleting health record ${id}: ${err.message}`);
      throw err;
    }
  }
}

export default HealthService;
