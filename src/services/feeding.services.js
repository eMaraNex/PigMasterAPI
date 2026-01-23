import { DatabaseHelper } from "../config/database.js";
import logger from "../middleware/logger.js";
import { ValidationError } from "../middleware/errors.js";

class FeedingService {
  // Daily feeding record (individual pig or pen)
  static async createFeedingRecord(data, userId) {
    const {
      pig_id,
      pen_id,
      farm_id,
      feed_type,
      amount,
      unit = "grams",
      feeding_time,
      notes,
      record_type = "daily",
    } = data;

    if (!farm_id || !feed_type || !amount || !feeding_time) {
      throw new ValidationError("Missing required feeding record fields");
    }

    // For daily records, require either pig_id or pen_id
    if (record_type === "daily" && !pig_id && !pen_id) {
      throw new ValidationError(
        "Daily feeding records require either pig_id or pen_id",
      );
    }

    try {
      // Validate pig (if provided) belongs to farm
      if (pig_id) {
        const pigResult = await DatabaseHelper.executeQuery(
          "SELECT pig_id FROM pigs WHERE pig_id = $1 AND farm_id = $2 AND is_deleted = 0",
          [pig_id, farm_id],
        );
        if (pigResult.rows.length === 0) {
          throw new ValidationError("Pig not found for provided farm");
        }
      }

      // Validate pen (if provided) belongs to farm
      if (pen_id) {
        const penResult = await DatabaseHelper.executeQuery(
          "SELECT id FROM pens WHERE id = $1 AND farm_id = $2 AND is_deleted = 0",
          [pen_id, farm_id],
        );
        if (penResult.rows.length === 0) {
          throw new ValidationError("Pen not found for provided farm");
        }
      }

      const result = await DatabaseHelper.executeQuery(
        `INSERT INTO feeding_records (
          id, pig_id, pen_id, farm_id, feed_type, amount, unit, feeding_time, fed_by, notes, record_type, is_deleted, created_at
        ) VALUES (uuid_generate_v4(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 0, CURRENT_TIMESTAMP) RETURNING *`,
        [
          pig_id || null,
          pen_id || null,
          farm_id,
          feed_type,
          amount,
          unit,
          feeding_time,
          userId || null,
          notes || null,
          record_type,
        ],
      );
      logger.info(
        `Feeding record created by user ${userId} for farm ${farm_id}`,
      );
      return result.rows[0];
    } catch (error) {
      logger.error(`Error creating feeding record: ${error.message}`);
      throw error;
    }
  }

  // Period feeding record (weekly/monthly - farm-wide)
  static async createPeriodRecord(data, userId) {
    const {
      farm_id,
      pen_id,
      record_type,
      feed_type,
      total_amount,
      unit = "kg",
      start_date,
      end_date,
      pigs_in_pen = [],
      notes,
    } = data;

    if (
      !farm_id ||
      !record_type ||
      !feed_type ||
      !total_amount ||
      !start_date ||
      !end_date
    ) {
      throw new ValidationError(
        "Missing required period feeding record fields",
      );
    }

    if (!["weekly", "monthly"].includes(record_type)) {
      throw new ValidationError(
        "Period record type must be 'weekly' or 'monthly'",
      );
    }

    try {
      // Validate pen if provided
      if (pen_id) {
        const penResult = await DatabaseHelper.executeQuery(
          "SELECT id FROM pens WHERE id = $1 AND farm_id = $2 AND is_deleted = 0",
          [pen_id, farm_id],
        );
        if (penResult.rows.length === 0) {
          throw new ValidationError("Pen not found for provided farm");
        }
      }

      const result = await DatabaseHelper.executeQuery(
        `INSERT INTO feeding_period_records (
          id, farm_id, pen_id, record_type, feed_type, total_amount, unit, start_date, end_date, pigs_in_pen, notes, fed_by, is_deleted, created_at
        ) VALUES (uuid_generate_v4(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 0, CURRENT_TIMESTAMP) RETURNING *`,
        [
          farm_id,
          pen_id || null,
          record_type,
          feed_type,
          total_amount,
          unit,
          start_date,
          end_date,
          JSON.stringify(pigs_in_pen),
          notes || null,
          userId || null,
        ],
      );
      logger.info(
        `Period feeding record (${record_type}) created by user ${userId} for farm ${farm_id}`,
      );
      return result.rows[0];
    } catch (error) {
      logger.error(`Error creating period feeding record: ${error.message}`);
      throw error;
    }
  }

  static async getPeriodRecordsByFarm(
    farmId,
    { record_type, start_date, end_date } = {},
  ) {
    try {
      let query =
        "SELECT * FROM feeding_period_records WHERE farm_id = $1 AND is_deleted = 0";
      const params = [farmId];
      let idx = 2;

      if (record_type) {
        query += ` AND record_type = $${idx++}`;
        params.push(record_type);
      }

      if (start_date) {
        query += ` AND end_date >= $${idx++}`;
        params.push(start_date);
      }

      if (end_date) {
        query += ` AND start_date <= $${idx++}`;
        params.push(end_date);
      }

      query += " ORDER BY start_date DESC, created_at DESC";

      const result = await DatabaseHelper.executeQuery(query, params);
      return result.rows.map(row => {
        if (row.pigs_in_pen && typeof row.pigs_in_pen === "string") {
          row.pigs_in_pen = JSON.parse(row.pigs_in_pen);
        }
        return row;
      });
    } catch (error) {
      logger.error(
        `Error fetching period feeding records for farm ${farmId}: ${error.message}`,
      );
      throw error;
    }
  }
  static async getFeedingByFarm(
    farmId,
    { limit, offset, date_from, date_to, record_type } = {},
  ) {
    try {
      let query =
        "SELECT * FROM feeding_records WHERE farm_id = $1 AND is_deleted = 0";
      const params = [farmId];
      let idx = 2;

      if (record_type) {
        query += ` AND record_type = $${idx++}`;
        params.push(record_type);
      }

      if (date_from) {
        query += ` AND feeding_time >= $${idx++}`;
        params.push(date_from);
      }

      if (date_to) {
        query += ` AND feeding_time <= $${idx++}`;
        params.push(date_to);
      }

      query += " ORDER BY feeding_time DESC";

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
      logger.error(
        `Error fetching feeding records for farm ${farmId}: ${error.message}`,
      );
      throw error;
    }
  }
  static async deletePeriodRecord(id, userId) {
    try {
      const result = await DatabaseHelper.executeQuery(
        "UPDATE feeding_period_records SET is_deleted = 1 WHERE id = $1 AND is_deleted = 0 RETURNING *",
        [id],
      );
      if (result.rows.length === 0)
        throw new ValidationError("Period feeding record not found");
      logger.info(`Period feeding record ${id} deleted by user ${userId}`);
      return result.rows[0];
    } catch (error) {
      logger.error(
        `Error deleting period feeding record ${id}: ${error.message}`,
      );
      throw error;
    }
  }

  static async getFeedingById(id) {
    try {
      const result = await DatabaseHelper.executeQuery(
        "SELECT * FROM feeding_records WHERE id = $1 AND is_deleted = 0",
        [id],
      );
      if (result.rows.length === 0)
        throw new ValidationError("Feeding record not found");
      return result.rows[0];
    } catch (error) {
      logger.error(`Error fetching feeding record ${id}: ${error.message}`);
      throw error;
    }
  }

  static async getFeedingByPig(
    pigId,
    { limit, offset, date_from, date_to } = {},
  ) {
    try {
      let query =
        "SELECT * FROM feeding_records WHERE pig_id = $1 AND is_deleted = 0";
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
      query += " ORDER BY feeding_time DESC";
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
      logger.error(
        `Error fetching feeding records for pig ${pigId}: ${error.message}`,
      );
      throw error;
    }
  }

  static async deleteFeedingRecord(id, userId) {
    try {
      const result = await DatabaseHelper.executeQuery(
        "UPDATE feeding_records SET is_deleted = 1 WHERE id = $1 AND is_deleted = 0 RETURNING *",
        [id],
      );
      if (result.rows.length === 0)
        throw new ValidationError("Feeding record not found");
      logger.info(`Feeding record ${id} deleted by user ${userId}`);
      return result.rows[0];
    } catch (error) {
      logger.error(`Error deleting feeding record ${id}: ${error.message}`);
      throw error;
    }
  }

  static async updateFeedingRecord(id, data, userId) {
    try {
      const { pig_id, pen_id, feed_type, amount, unit, feeding_time, notes } =
        data;
      const result = await DatabaseHelper.executeQuery(
        `UPDATE feeding_records SET
          pig_id = COALESCE($2, pig_id),
          pen_id = COALESCE($3, pen_id),
          feed_type = COALESCE($4, feed_type),
          amount = COALESCE($5, amount),
          unit = COALESCE($6, unit),
          feeding_time = COALESCE($7, feeding_time),
          notes = COALESCE($8, notes),
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND is_deleted = 0 RETURNING *`,
        [
          id,
          pig_id || null,
          pen_id || null,
          feed_type || null,
          amount || null,
          unit || null,
          feeding_time || null,
          notes || null,
        ],
      );
      if (result.rows.length === 0)
        throw new ValidationError("Feeding record not found");
      logger.info(`Feeding record ${id} updated by user ${userId}`);
      return result.rows[0];
    } catch (error) {
      logger.error(`Error updating feeding record ${id}: ${error.message}`);
      throw error;
    }
  }

  /** Feeding schedule functions */
  static async createFeedingSchedule(data, userId) {
    const {
      pig_id,
      daily_amount,
      feed_type,
      times,
      frequency = "daily",
      frequency_interval = 1,
      days = [],
      special_diet,
      last_fed,
      is_active = false,
    } = data;
    if (!pig_id || !daily_amount || !feed_type || !times) {
      throw new ValidationError("Missing required feeding schedule fields");
    }

    try {
      const pigResult = await DatabaseHelper.executeQuery(
        "SELECT pig_id FROM pigs WHERE pig_id = $1 AND is_deleted = 0",
        [pig_id],
      );
      if (pigResult.rows.length === 0) {
        throw new ValidationError("Pig not found");
      }

      const timesPayload =
        typeof times === "string"
          ? times
          : JSON.stringify({ times, frequency, frequency_interval, days });

      const result = await DatabaseHelper.executeQuery(
        `INSERT INTO feeding_schedules (
          id, pig_id, daily_amount, feed_type, times, special_diet, last_fed, is_active, is_deleted, created_at, updated_at
        ) VALUES (uuid_generate_v4(), $1, $2, $3, $4, $5, $6, $7, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) RETURNING *`,
        [
          pig_id,
          daily_amount,
          feed_type,
          timesPayload,
          special_diet || null,
          last_fed || null,
          is_active ? 1 : 0,
        ],
      );
      logger.info(
        `Feeding schedule created by user ${userId} for pig ${pig_id}`,
      );
      return result.rows[0];
    } catch (error) {
      logger.error(`Error creating feeding schedule: ${error.message}`);
      throw error;
    }
  }

  static async getScheduleByPig(pigId) {
    try {
      const result = await DatabaseHelper.executeQuery(
        "SELECT * FROM feeding_schedules WHERE pig_id = $1 AND is_deleted = 0",
        [pigId],
      );
      return result.rows.map(r => {
        try {
          if (r.times && typeof r.times === "string") {
            r.times = JSON.parse(r.times);
          }
        } catch (e) {
          // leave as-is
        }
        return r;
      });
    } catch (error) {
      logger.error(
        `Error fetching feeding schedule for pig ${pigId}: ${error.message}`,
      );
      throw error;
    }
  }

  static async updateFeedingSchedule(id, data, userId) {
    try {
      const {
        daily_amount,
        feed_type,
        times,
        special_diet,
        last_fed,
        is_active,
      } = data;
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
        [
          id,
          daily_amount || null,
          feed_type || null,
          times
            ? typeof times === "string"
              ? times
              : JSON.stringify(times)
            : null,
          special_diet || null,
          last_fed || null,
          is_active === undefined ? null : is_active ? 1 : 0,
        ],
      );
      if (result.rows.length === 0)
        throw new ValidationError("Feeding schedule not found");
      logger.info(`Feeding schedule ${id} updated by user ${userId}`);
      return result.rows[0];
    } catch (error) {
      logger.error(`Error updating feeding schedule ${id}: ${error.message}`);
      throw error;
    }
  }

  static async deleteFeedingSchedule(id, userId) {
    try {
      const result = await DatabaseHelper.executeQuery(
        "UPDATE feeding_schedules SET is_deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND is_deleted = 0 RETURNING *",
        [id],
      );
      if (result.rows.length === 0)
        throw new ValidationError("Feeding schedule not found");
      logger.info(`Feeding schedule ${id} deleted by user ${userId}`);
      return result.rows[0];
    } catch (error) {
      logger.error(`Error deleting feeding schedule ${id}: ${error.message}`);
      throw error;
    }
  }
}

export default FeedingService;
