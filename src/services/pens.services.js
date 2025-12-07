import { DatabaseHelper } from "../config/database.js";
import logger from "../middleware/logger.js";
import { ValidationError } from "../middleware/errors.js";

class PensService {
  static async createPen(penData, userId) {
    const {
      farm_id,
      row_id,
      level,
      position,
      size = "medium",
      material = "wire",
      features,
      last_cleaned,
      is_occupied = false,
      is_deleted = 0,
      name,
    } = penData;
    if (!farm_id || !name || !level || !position || !size || !material) {
      throw new ValidationError("Missing required pen fields");
    }
    if (typeof is_occupied !== "boolean") {
      throw new ValidationError("is_occupied must be a boolean");
    }
    if (![0, 1].includes(is_deleted)) {
      throw new ValidationError("is_deleted must be 0 or 1");
    }

    try {
      const farmResult = await DatabaseHelper.executeQuery(
        "SELECT id FROM farms WHERE id = $1 AND is_deleted = 0",
        [farm_id]
      );
      if (farmResult.rows.length === 0) {
        throw new ValidationError("Farm not found");
      }
      const rowResult = await DatabaseHelper.executeQuery(
        "SELECT levels, capacity, name AS row_name FROM rows WHERE id = $1 AND farm_id = $2 AND is_deleted = 0",
        [row_id, farm_id]
      );
      if (rowResult.rows.length === 0) {
        throw new ValidationError("Row not found");
      }

      const row = rowResult.rows[0];
      const rowLevels = row.levels || ["A", "B", "C"];
      if (!rowLevels.includes(level)) {
        throw new ValidationError(
          `Level must be one of ${rowLevels.join(", ")}`
        );
      }

      // Check row capacity
      const rowPensResult = await DatabaseHelper.executeQuery(
        "SELECT COUNT(*) FROM pens WHERE row_id = $1 AND farm_id = $2 AND is_deleted = 0",
        [row_id, farm_id]
      );
      const currentPenCount = parseInt(rowPensResult.rows[0].count);
      if (currentPenCount >= row.capacity) {
        throw new ValidationError(
          "Row capacity reached. Please expand row capacity."
        );
      }

      // Check for duplicate position
      const duplicateResult = await DatabaseHelper.executeQuery(
        "SELECT 1 FROM pens WHERE row_id = $1 AND level = $2 AND position = $3 AND farm_id = $4 AND is_deleted = 0",
        [row_id, level, position, farm_id]
      );
      if (duplicateResult.rows.length > 0) {
        throw new ValidationError(
          `Position ${position} at level ${level} is already occupied in this row`
        );
      }

      // Generate pen name if not provided
      const penName = name || `${row.row_name}-${level}${position}`;

      // Validate pen name uniqueness
      const existingPen = await DatabaseHelper.executeQuery(
        "SELECT 1 FROM pens WHERE name = $1 AND farm_id = $2 AND is_deleted = 0",
        [penName, farm_id]
      );
      if (existingPen.rows.length > 0) {
        throw new ValidationError(`Pen name ${penName} already exists`);
      }

      // Validate provided name matches expected format
      if (name && name !== penName) {
        throw new ValidationError(
          `Pen name must be ${penName} for row ${row.row_name}, level ${level}, position ${position}`
        );
      }

      const insertValues = [
        row_id,
        farm_id,
        penName,
        level,
        position,
        size,
        material,
        JSON.stringify(features || ["water bottle", "feeder"]),
        is_occupied,
        last_cleaned || null,
        is_deleted,
      ];
      const result = await DatabaseHelper.executeQuery(
        `INSERT INTO pens (id, row_id, farm_id, name, level, position, size, material, features, is_occupied, last_cleaned, created_at, updated_at, is_deleted)
                 VALUES (uuid_generate_v4(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, $11) 
                 RETURNING *`,
        insertValues
      );
      logger.info(`Pen ${penName} created by user ${userId}`);
      return result.rows[0];
    } catch (error) {
      logger.error(`Error creating pen: ${error.message}`);
      throw error;
    }
  }

  static async getPenById(id, farmId) {
    try {
      const result = await DatabaseHelper.executeQuery(
        `SELECT h.*, r.name AS row_name,
                (SELECT JSON_AGG(
                    JSON_BUILD_OBJECT(
                        'pig_id', r2.pig_id,
                        'pig_name', r2.name,
                        'pen_id', r2.pen_id,
                        'gender', r2.gender,
                        'breed', r2.breed,
                        'color', r2.color,
                        'weight', r2.weight,
                        'is_pregnant', r2.is_pregnant
                    )
                )
                FROM pigs r2
                WHERE r2.pen_id = h.id AND r2.farm_id = $2 AND r2.is_deleted = 0) AS pigs
                FROM pens h
                LEFT JOIN rows r ON h.row_id = r.id
                WHERE h.id = $1 AND h.farm_id = $2 AND h.is_deleted = 0`,
        [id, farmId]
      );
      if (result.rows.length === 0) {
        throw new ValidationError("Pen not found");
      }
      return result.rows[0];
    } catch (error) {
      logger.error(`Error fetching pen ${id}: ${error.message}`);
      throw error;
    }
  }

  static async getAllPens(farmId, { rowId, limit, offset, is_occupied }) {
    try {
      let query =
        "SELECT h.*, r.name AS row_name FROM pens h LEFT JOIN rows r ON h.row_id = r.id WHERE h.farm_id = $1 AND h.is_deleted = 0";
      const params = [farmId];
      let paramIndex = 2;

      if (rowId) {
        query += ` AND h.row_id = $${paramIndex++}`;
        params.push(rowId);
      }

      if (is_occupied !== undefined) {
        query += ` AND h.is_occupied = $${paramIndex++}`;
        params.push(is_occupied);
      }

      query += " ORDER BY level ASC, position ASC";

      if (limit) {
        query += ` LIMIT $${paramIndex++}`;
        params.push(parseInt(limit));
      }

      if (offset) {
        query += ` OFFSET $${paramIndex++}`;
        params.push(parseInt(offset));
      }

      const result = await DatabaseHelper.executeQuery(query, params);
      return result.rows;
    } catch (error) {
      logger.error(`Error fetching pens for farm ${farmId}: ${error.message}`);
      throw error;
    }
  }

  static async updatePen(id, farmId, penData, userId) {
    const {
      row_id,
      level,
      position,
      size,
      material,
      features,
      is_occupied,
      last_cleaned,
      name,
    } = penData;
    try {
      if (row_id) {
        const rowResult = await DatabaseHelper.executeQuery(
          "SELECT levels, name AS row_name FROM rows WHERE id = $1 AND farm_id = $2 AND is_deleted = 0",
          [row_id, farmId]
        );
        if (rowResult.rows.length === 0) {
          throw new ValidationError("Row not found");
        }
        if (level && !rowResult.rows[0].levels.includes(level)) {
          throw new ValidationError(
            `Level must be one of ${rowResult.rows[0].levels.join(", ")}`
          );
        }
        // Validate pen name format if name and level/position are provided
        if (name && level && position) {
          const expectedName = `${rowResult.rows[0].row_name}-${level}${position}`;
          if (name !== expectedName) {
            throw new ValidationError(
              `Pen name must be in the format ${expectedName}`
            );
          }
        }
      }

      // Check for duplicate name if provided
      if (name) {
        const existingPen = await DatabaseHelper.executeQuery(
          "SELECT 1 FROM pens WHERE name = $1 AND farm_id = $2 AND id != $3 AND is_deleted = 0",
          [name, farmId, id]
        );
        if (existingPen.rows.length > 0) {
          throw new ValidationError("Pen name already exists");
        }
      }

      // Check for duplicate position if level and position are provided
      if (row_id && level && position) {
        const duplicateResult = await DatabaseHelper.executeQuery(
          "SELECT 1 FROM pens WHERE row_id = $1 AND level = $2 AND position = $3 AND farm_id = $4 AND id != $5 AND is_deleted = 0",
          [row_id, level, position, farmId, id]
        );
        if (duplicateResult.rows.length > 0) {
          throw new ValidationError(
            `Position ${position} at level ${level} is already occupied in this row`
          );
        }
      }

      const result = await DatabaseHelper.executeQuery(
        `UPDATE pens SET row_id = COALESCE($1, row_id), level = COALESCE($2, level), position = COALESCE($3, position), 
                 size = COALESCE($4, size), material = COALESCE($5, material), features = COALESCE($6, features), 
                 is_occupied = COALESCE($7, is_occupied), last_cleaned = $8, name = COALESCE($9, name), updated_at = CURRENT_TIMESTAMP
                 WHERE id = $10 AND farm_id = $11 AND is_deleted = 0 RETURNING *`,
        [
          row_id || null,
          level,
          position,
          size,
          material,
          features ? JSON.stringify(features) : null,
          is_occupied,
          last_cleaned || null,
          name,
          id,
          farmId,
        ]
      );
      if (result.rows.length === 0) {
        throw new ValidationError("Pen not found");
      }
      logger.info(`Pen ${id} updated by user ${userId}`);
      return result.rows[0];
    } catch (error) {
      logger.error(`Error updating pen ${id}: ${error.message}`);
      throw error;
    }
  }

  static async deletePen(id, farmId, userId) {
    try {
      const pigResult = await DatabaseHelper.executeQuery(
        "SELECT 1 FROM pigs WHERE pen_id = $1 AND farm_id = $2 AND is_deleted = 0",
        [id, farmId]
      );
      if (pigResult.rows.length > 0) {
        throw new ValidationError(
          "Cannot delete pen with pigs. Please remove pigs first."
        );
      }

      // Check if the pen has any breeding history
      const historyResult = await DatabaseHelper.executeQuery(
        "SELECT 1 FROM pen_pig_history WHERE pen_id = $1 AND farm_id = $2",
        [id, farmId]
      );

      let result;
      if (historyResult.rows.length > 0) {
        // Soft delete if there is breeding history to preserve historical data
        result = await DatabaseHelper.executeQuery(
          "UPDATE pens SET is_deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND farm_id = $2 AND is_deleted = 0 RETURNING *",
          [id, farmId]
        );
        if (result.rows.length === 0) {
          throw new ValidationError("Pen not found");
        }
        logger.info(`Pen ${id} soft deleted by user ${userId}`);
      } else {
        // Hard delete if no breeding history to free up the pen position
        result = await DatabaseHelper.executeQuery(
          "DELETE FROM pens WHERE id = $1 AND farm_id = $2 AND is_deleted = 0 RETURNING *",
          [id, farmId]
        );
        if (result.rows.length === 0) {
          throw new ValidationError("Pen not found");
        }
        logger.info(
          `Pen ${id} permanently deleted by user ${userId} to free up position`
        );
      }
      return result.rows[0];
    } catch (error) {
      logger.error(`Error deleting pen ${id}: ${error.message}`);
      throw error;
    }
  }

  static async getPenRemovedPigHistory(farm_id, pen_id) {
    try {
      const result = await DatabaseHelper.executeQuery(
        `SELECT * FROM pen_pig_history
                 WHERE farm_id = $1 AND pen_id = $2 AND is_deleted = 0
                 ORDER BY updated_at DESC`,
        [farm_id, pen_id]
      );
      return result.rows;
    } catch (error) {
      logger.error(
        `Error fetching pen data history for ${pen_id}: ${error.message}`
      );
      throw error;
    }
  }
}

export default PensService;
