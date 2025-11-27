import { DatabaseHelper } from '../config/database.js';
import logger from '../middleware/logger.js';
import { ValidationError } from '../middleware/errors.js';

class FeedingService {
    static async createFeedingRecord(data, userId) {
        const { pig_id, hutch_id, farm_id, feed_type, amount, unit = 'grams', feeding_time, notes } = data;
        if (!farm_id || !feed_type || !amount || !feeding_time) {
            throw new ValidationError('Missing required feeding record fields');
        }

        try {
            // validate pig (if provided) belongs to farm
            if (pig_id) {
                const pigResult = await DatabaseHelper.executeQuery(
                    'SELECT pig_id FROM pigs WHERE pig_id = $1 AND farm_id = $2 AND is_deleted = 0',
                    [pig_id, farm_id]
                );
                if (pigResult.rows.length === 0) {
                    throw new ValidationError('Pig not found for provided farm');
                }
            }

            const result = await DatabaseHelper.executeQuery(
                `INSERT INTO feeding_records (
                    id, pig_id, hutch_id, farm_id, feed_type, amount, unit, feeding_time, fed_by, notes, is_deleted, created_at
                ) VALUES (uuid_generate_v4(), $1, $2, $3, $4, $5, $6, $7, $8, $9, 0, CURRENT_TIMESTAMP) RETURNING *`,
                [pig_id || null, hutch_id || null, farm_id, feed_type, amount, unit, feeding_time, userId || null, notes || null]
            );
            logger.info(`Feeding record created by user ${userId} for farm ${farm_id}`);
            return result.rows[0];
        } catch (error) {
            logger.error(`Error creating feeding record: ${error.message}`);
            throw error;
        }
    }

    static async getFeedingById(id) {
        try {
            const result = await DatabaseHelper.executeQuery('SELECT * FROM feeding_records WHERE id = $1 AND is_deleted = 0', [id]);
            if (result.rows.length === 0) throw new ValidationError('Feeding record not found');
            return result.rows[0];
        } catch (error) {
            logger.error(`Error fetching feeding record ${id}: ${error.message}`);
            throw error;
        }
    }

    static async getFeedingByPig(pigId, { limit, offset, date_from, date_to } = {}) {
        try {
            let query = 'SELECT * FROM feeding_records WHERE pig_id = $1 AND is_deleted = 0';
            const params = [pigId];
            let idx = 2;
            if (date_from) {
                query += ` AND feeding_time >= $${idx++}`;
                params.push(date_from);
            }
            if (date_to) {
                query += ` AND feeding_time <= $${idx++}`;
                params.push(date_to);
            }
            query += ' ORDER BY feeding_time DESC';
            if (limit !== undefined) {
                query += ` LIMIT $${idx++}`;
                params.push(limit);
            }
            if (offset !== undefined) {
                query += ` OFFSET $${idx++}`;
                params.push(offset);
            }
            const result = await DatabaseHelper.executeQuery(query, params);
            return result.rows;
        } catch (error) {
            logger.error(`Error fetching feeding records for pig ${pigId}: ${error.message}`);
            throw error;
        }
    }

    static async deleteFeedingRecord(id, userId) {
        try {
            const result = await DatabaseHelper.executeQuery('UPDATE feeding_records SET is_deleted = 1 WHERE id = $1 AND is_deleted = 0 RETURNING *', [id]);
            if (result.rows.length === 0) throw new ValidationError('Feeding record not found');
            logger.info(`Feeding record ${id} deleted by user ${userId}`);
            return result.rows[0];
        } catch (error) {
            logger.error(`Error deleting feeding record ${id}: ${error.message}`);
            throw error;
        }
    }

    static async updateFeedingRecord(id, data, userId) {
        try {
            const { pig_id, hutch_id, feed_type, amount, unit, feeding_time, notes } = data;
            const result = await DatabaseHelper.executeQuery(
                `UPDATE feeding_records SET
                    pig_id = COALESCE($2, pig_id),
                    hutch_id = COALESCE($3, hutch_id),
                    feed_type = COALESCE($4, feed_type),
                    amount = COALESCE($5, amount),
                    unit = COALESCE($6, unit),
                    feeding_time = COALESCE($7, feeding_time),
                    notes = COALESCE($8, notes),
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = $1 AND is_deleted = 0 RETURNING *`,
                [id, pig_id || null, hutch_id || null, feed_type || null, amount || null, unit || null, feeding_time || null, notes || null]
            );
            if (result.rows.length === 0) throw new ValidationError('Feeding record not found');
            logger.info(`Feeding record ${id} updated by user ${userId}`);
            return result.rows[0];
        } catch (error) {
            logger.error(`Error updating feeding record ${id}: ${error.message}`);
            throw error;
        }
    }

    /** Feeding schedule functions */
    static async createFeedingSchedule(data, userId) {
        const { pig_id, daily_amount, feed_type, times, special_diet, last_fed, is_active = false } = data;
        if (!pig_id || !daily_amount || !feed_type || !times) {
            throw new ValidationError('Missing required feeding schedule fields');
        }

        try {
            // validate pig exists
            const pigResult = await DatabaseHelper.executeQuery('SELECT pig_id FROM pigs WHERE pig_id = $1 AND is_deleted = 0', [pig_id]);
            if (pigResult.rows.length === 0) {
                throw new ValidationError('Pig not found');
            }

            const result = await DatabaseHelper.executeQuery(
                `INSERT INTO feeding_schedules (
                    id, pig_id, daily_amount, feed_type, times, special_diet, last_fed, is_active, is_deleted, created_at, updated_at
                ) VALUES (uuid_generate_v4(), $1, $2, $3, $4, $5, $6, $7, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) RETURNING *`,
                [pig_id, daily_amount, feed_type, JSON.stringify(times), special_diet || null, last_fed || null, is_active ? 1 : 0]
            );
            logger.info(`Feeding schedule created by user ${userId} for pig ${pig_id}`);
            return result.rows[0];
        } catch (error) {
            logger.error(`Error creating feeding schedule: ${error.message}`);
            throw error;
        }
    }

    static async getScheduleByPig(pigId) {
        try {
            const result = await DatabaseHelper.executeQuery('SELECT * FROM feeding_schedules WHERE pig_id = $1 AND is_deleted = 0', [pigId]);
            return result.rows;
        } catch (error) {
            logger.error(`Error fetching feeding schedule for pig ${pigId}: ${error.message}`);
            throw error;
        }
    }

    static async updateFeedingSchedule(id, data, userId) {
        try {
            const { daily_amount, feed_type, times, special_diet, last_fed, is_active } = data;
            const result = await DatabaseHelper.executeQuery(
                `UPDATE feeding_schedules SET
                    daily_amount = COALESCE($2, daily_amount),
                    feed_type = COALESCE($3, feed_type),
                    times = COALESCE($4, times),
                    special_diet = COALESCE($5, special_diet),
                    last_fed = COALESCE($6, last_fed),
                    is_active = COALESCE($7, is_active),
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = $1 AND is_deleted = 0 RETURNING *`,
                [id, daily_amount || null, feed_type || null, times ? JSON.stringify(times) : null, special_diet || null, last_fed || null, is_active === undefined ? null : (is_active ? 1 : 0)]
            );
            if (result.rows.length === 0) throw new ValidationError('Feeding schedule not found');
            logger.info(`Feeding schedule ${id} updated by user ${userId}`);
            return result.rows[0];
        } catch (error) {
            logger.error(`Error updating feeding schedule ${id}: ${error.message}`);
            throw error;
        }
    }

    static async deleteFeedingSchedule(id, userId) {
        try {
            const result = await DatabaseHelper.executeQuery('UPDATE feeding_schedules SET is_deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND is_deleted = 0 RETURNING *', [id]);
            if (result.rows.length === 0) throw new ValidationError('Feeding schedule not found');
            logger.info(`Feeding schedule ${id} deleted by user ${userId}`);
            return result.rows[0];
        } catch (error) {
            logger.error(`Error deleting feeding schedule ${id}: ${error.message}`);
            throw error;
        }
    }
}

export default FeedingService;
