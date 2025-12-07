import { DatabaseHelper } from "../config/database.js";
import logger from "../middleware/logger.js";
import { ValidationError } from "../middleware/errors.js";

class EarningsService {
  static async createEarnings(earningsData, userId) {
    const {
      farm_id,
      type,
      pig_id,
      amount,
      currency = "USD",
      date,
      weight,
      sale_type,
      includes_urine = false,
      includes_manure = false,
      buyer_name,
      notes,
      pen_id,
    } = earningsData;

    if (!farm_id || !type || !amount || !date) {
      throw new ValidationError("Missing required earnings fields");
    }

    if (currency && !/^[A-Z]{3}$/.test(currency)) {
      throw new ValidationError("Currency must be a valid 3-letter code");
    }
    if (amount <= 0) {
      throw new ValidationError("Amount must be positive");
    }

    try {
      // Validate pig_id if provided
      // if (pig_id) {
      //     const pigResult = await DatabaseHelper.executeQuery(
      //         'SELECT 1 FROM pigs WHERE pig_id = $1 AND farm_id = $2 AND is_deleted = 0',
      //         [pig_id, farm_id]
      //     );
      //     if (pigResult.rows.length === 0) {
      //         throw new ValidationError('Pig not found');
      //     }
      // }

      // Validate pen_id if provided
      if (pen_id) {
        const penResult = await DatabaseHelper.executeQuery(
          "SELECT 1 FROM pens WHERE id = $1 AND farm_id = $2 AND is_deleted = 0",
          [pen_id, farm_id]
        );
        if (penResult.rows.length === 0) {
          throw new ValidationError("Pen not found");
        }
      }

      const result = await DatabaseHelper.executeQuery(
        `INSERT INTO earnings_records (
                    farm_id, type, pig_id, amount, currency, date, weight, sale_type,
                    includes_urine, includes_manure, buyer_name, notes, pen_id,
                    created_at, updated_at, is_deleted
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0)
                RETURNING *`,
        [
          farm_id,
          type,
          pig_id || null,
          amount,
          currency,
          date,
          weight || null,
          sale_type || null,
          includes_urine,
          includes_manure,
          buyer_name || null,
          notes || null,
          pen_id || null,
        ]
      );
      logger.info(`Earnings record created by user ${userId}`);
      return result.rows[0];
    } catch (error) {
      logger.error(`Error creating earnings: ${error.message}`);
      throw error;
    }
  }

  static async getEarningsById(id, farmId) {
    try {
      const result = await DatabaseHelper.executeQuery(
        `SELECT er.*, r.pig_id, r.name AS pig_name, h.id AS pen_id
                FROM earnings_records er
                LEFT JOIN pigs r ON er.pig_id = r.pig_id AND r.farm_id = $2
                LEFT JOIN pens h ON er.pen_id = h.id AND h.farm_id = $2
                WHERE er.id = $1 AND er.farm_id = $2 AND er.is_deleted = 0`,
        [id, farmId]
      );
      if (result.rows.length === 0) {
        throw new ValidationError("Earnings record not found");
      }
      return result.rows[0];
    } catch (error) {
      logger.error(`Error getting earnings ${id}: ${error.message}`);
      throw error;
    }
  }

  static async getAllEarnings(
    farmId,
    { type, date_from, date_to, limit, offset }
  ) {
    try {
      let query = `
                SELECT er.*, r.pig_id, r.name AS pig_name, h.id AS pen_id
                FROM earnings_records er
                LEFT JOIN pigs r ON er.pig_id = r.pig_id AND r.farm_id = $1
                LEFT JOIN pens h ON er.pen_id = h.id AND h.farm_id = $1
                WHERE er.farm_id = $1 AND er.is_deleted = 0`;
      const params = [farmId];
      let paramIndex = 2;

      if (type) {
        query += ` AND er.type = $${paramIndex}`;
        params.push(type);
        paramIndex++;
      }
      if (date_from) {
        query += ` AND er.date >= $${paramIndex}`;
        params.push(date_from);
        paramIndex++;
      }
      if (date_to) {
        query += ` AND er.date <= $${paramIndex}`;
        params.push(date_to);
        paramIndex++;
      }

      query += " ORDER BY er.date DESC";

      if (limit !== undefined) {
        query += ` LIMIT $${paramIndex}`;
        params.push(limit);
        paramIndex++;
      }
      if (offset !== undefined) {
        query += ` OFFSET $${paramIndex}`;
        params.push(offset);
      }

      const result = await DatabaseHelper.executeQuery(query, params);
      return result.rows;
    } catch (error) {
      logger.error(
        `Error getting earnings for farm ${farmId}: ${error.message}`
      );
      throw error;
    }
  }

  static async updateEarnings(id, farmId, earningsData, userId) {
    const {
      type,
      pig_id,
      amount,
      currency,
      date,
      weight,
      sale_type,
      includes_urine,
      includes_manure,
      buyer_name,
      notes,
      pen_id,
      farm_id,
    } = earningsData;

    try {
      if (
        type &&
        !["pig_sale", "urine_sale", "manure_sale", "other"].includes(type)
      ) {
        throw new ValidationError(
          "Type must be pig_sale, urine_sale, manure_sale, or other"
        );
      }
      if (sale_type && !["whole", "processed", "live"].includes(sale_type)) {
        throw new ValidationError(
          "Sale type must be whole, processed, or live"
        );
      }
      if (currency && !/^[A-Z]{3}$/.test(currency)) {
        throw new ValidationError("Currency must be a valid 3-letter code");
      }
      if (pig_id) {
        const pigResult = await DatabaseHelper.executeQuery(
          "SELECT 1 FROM pigs WHERE pig_id = $1 AND is_deleted = FALSE AND farm_id = $2",
          [pig_id, farm_id]
        );
        if (pigResult.rows.length === 0) {
          throw new ValidationError("Not found pig");
        }
      }

      if (pen_id) {
        const penResult = await DatabaseHelper.executeQuery(
          "SELECT 1 FROM pens WHERE id = $1 AND farm_id = $2 AND is_deleted = FALSE",
          [pen_id, farm_id]
        );
        if (penResult.rows.length === 0) {
          throw new ValidationError("Not found pen");
        }
      }

      const result = await DatabaseHelper.executeQuery(
        `UPDATE earnings_records
                SET type = COALESCE($3, type),
                    pig_id = COALESCE($4, pig_id),
                    amount = COALESCE($5, amount),
                    currency = COALESCE($6, currency),
                    date = COALESCE($7, date),
                    weight = COALESCE($8, weight),
                    sale_type = COALESCE($9, sale_type),
                    includes_urine = COALESCE($10, includes_urine),
                    includes_manure = COALESCE($11, includes_manure),
                    buyer_name = COALESCE($12, buyer_name),
                    notes = COALESCE($13, notes),
                    pen_id = COALESCE($14, pen_id),
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = $1 AND farm_id = $2 AND is_deleted = 0
                RETURNING *`,
        [
          id,
          farmId,
          type,
          pig_id || null,
          amount,
          currency || null,
          date,
          weight || null,
          sale_type || null,
          includes_urine,
          includes_manure,
          buyer_name || null,
          notes || null,
          pen_id || null,
        ]
      );
      if (result.rows.length === 0) {
        throw new ValidationError("Not found earnings record");
      }
      logger.info(`Earnings record ${id} updated by user ${userId}`);
      return result.rows[0];
    } catch (error) {
      logger.error(`Error updating earnings ${id}: ${error.message}`);
      throw error;
    }
  }

  static async deleteEarnings(id, farmId, userId) {
    try {
      const result = await DatabaseHelper.executeQuery(
        `UPDATE earnings_records
                SET is_deleted = 1, updated_at = CURRENT_TIMESTAMP
                WHERE id = $1 AND farm_id = $2 AND is_deleted = 0
                RETURNING *`,
        [id, farmId]
      );
      if (result.rows.length === 0) {
        throw new ValidationError("Earnings record not found");
      }
      logger.info(`Earnings record ${id} soft deleted by user ${userId}`);
      return result.rows[0];
    } catch (error) {
      logger.error(`Error deleting earnings ${id}: ${error.message}`);
      throw error;
    }
  }
}

export default EarningsService;
