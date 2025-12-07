import { DatabaseHelper } from "../config/database.js";
import logger from "../middleware/logger.js";
import { ValidationError } from "../middleware/errors.js";

class RowsService {
  static generateLevels(numLevels) {
    return Array.from({ length: numLevels }, (_, i) =>
      String.fromCharCode(65 + i)
    ); // A, B, C, etc.
  }

  static distributePensAcrossLevels(capacity, levels) {
    const basePensPerLevel = Math.floor(capacity / levels.length);
    const remainder = capacity % levels.length;
    const distribution = {};

    levels.forEach((level, index) => {
      distribution[level] = basePensPerLevel + (index < remainder ? 1 : 0);
    });

    return distribution;
  }
  static async createRow(rowData, userId) {
    const { farm_id, name, description, capacity, levels } = rowData;
    if (
      !farm_id ||
      !name ||
      !capacity ||
      capacity < 1 ||
      !levels ||
      levels.length < 1
    ) {
      throw new ValidationError(
        "Farm ID, name, valid capacity, and levels are required"
      );
    }

    try {
      // Check if row exists
      const existingRow = await DatabaseHelper.executeQuery(
        "SELECT id FROM rows WHERE name = $1 AND farm_id = $2 AND is_deleted = 0",
        [name, farm_id]
      );
      if (existingRow.rows.length > 0) {
        throw new ValidationError("Row already exists");
      }

      // Insert row
      const rowResult = await DatabaseHelper.executeQuery(
        "INSERT INTO rows (id, name, farm_id, description, capacity, levels, occupied, created_at, is_deleted) VALUES (uuid_generate_v4(), $1, $2, $3, $4, $5, 0, CURRENT_TIMESTAMP, 0) RETURNING *",
        [name, farm_id, description || null, capacity, levels]
      );
      let result = {};
      result.rows = rowResult.rows[0];

      const distribution = this.distributePensAcrossLevels(capacity, levels);
      const pens = [];

      for (const [level, count] of Object.entries(distribution)) {
        for (let position = 1; position <= count; position++) {
          const penName = `${name}-${level}${position}`;
          pens.push([
            result.rows.id,
            farm_id,
            penName,
            level,
            position,
            "medium",
            "wire",
            JSON.stringify(["water bottle", "feeder"]),
            false,
            0,
          ]);
        }
      }

      // Insert pens with auto-generated UUID for id
      for (const pen of pens) {
        await DatabaseHelper.executeQuery(
          "INSERT INTO pens (id, row_id, farm_id, name, level, position, size, material, features, is_occupied, created_at, is_deleted) VALUES (uuid_generate_v4(), $1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP, $10)",
          pen
        );
      }
      const penResults = await DatabaseHelper.executeQuery(
        `SELECT * FROM pens WHERE row_id = $1`,
        [result.rows.id]
      );
      result.pens = penResults.rows;
      logger.info(
        `Row ${result.rows.id} (${name}) created with ${
          pens.length
        } pens (${JSON.stringify(distribution)}) by user ${userId}`
      );
      return result;
    } catch (error) {
      logger.error(`Error creating row: ${error.message}`);
      throw error;
    }
  }

  static async expandRowCapacity(
    name,
    farmId,
    additionalCapacity,
    userId,
    row_id
  ) {
    if (!additionalCapacity || additionalCapacity < 1) {
      throw new ValidationError("Additional capacity must be at least 1");
    }

    try {
      // Get current row
      const rowResult = await DatabaseHelper.executeQuery(
        "SELECT * FROM rows WHERE id = $1 AND farm_id = $2 AND is_deleted = 0",
        [row_id, farmId]
      );
      if (rowResult.rows.length === 0) {
        throw new ValidationError("Row not found");
      }

      const currentRow = rowResult.rows[0];
      const newCapacity = currentRow.capacity + additionalCapacity;
      const currentLevels = currentRow.levels || ["A", "B", "C"];

      // Update row capacity
      const updatedRowResult = await DatabaseHelper.executeQuery(
        "UPDATE rows SET capacity = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND farm_id = $3 AND is_deleted = 0 RETURNING *",
        [newCapacity, row_id, farmId]
      );
      logger.info(
        `Row ${row_id} (${currentRow.name}) expanded by ${additionalCapacity} pens to total capacity ${newCapacity} by user ${userId}`
      );
      return updatedRowResult.rows[0];
    } catch (error) {
      logger.error(`Error expanding row ${row_id}: ${error.message}`);
      throw error;
    }
  }

  static async getRowById(rowId, farmId) {
    try {
      const result = await DatabaseHelper.executeQuery(
        "SELECT * FROM rows WHERE id = $1 AND farm_id = $2 AND is_deleted = 0",
        [rowId, farmId]
      );
      if (result.rows.length === 0) {
        throw new ValidationError("Row not found");
      }
      return result.rows[0];
    } catch (error) {
      logger.error(`Error fetching row ${rowId}: ${error.message}`);
      throw error;
    }
  }

  static async getAllRows(farmId) {
    try {
      const result = await DatabaseHelper.executeQuery(
        "SELECT * FROM rows WHERE farm_id = $1 AND is_deleted = 0 ORDER BY created_at DESC",
        [farmId]
      );
      return result.rows;
    } catch (error) {
      logger.error(`Error fetching rows for farm ${farmId}: ${error.message}`);
      throw error;
    }
  }

  static async updateRow(rowId, farmId, rowData, userId) {
    const { capacity, description, levels, name } = rowData ?? {};
    try {
      const result = await DatabaseHelper.executeQuery(
        "UPDATE rows SET capacity = $1, description = $2, levels = $3, name = $4, updated_at = CURRENT_TIMESTAMP WHERE id = $5 AND farm_id = $6 AND is_deleted = 0 RETURNING *",
        [capacity, description || null, levels, name, rowId, farmId]
      );
      if (result.rows.length === 0) {
        throw new ValidationError("Row not found");
      }
      logger.info(
        `Row ${rowId} (${result.rows[0].name}) updated by user ${userId}`
      );
      return result.rows[0];
    } catch (error) {
      logger.error(`Error updating row ${rowId}: ${error.message}`);
      throw error;
    }
  }

  static async deleteRow(rowId, farmId, userId) {
    try {
      // Check if row has pens with pigs inside first. If they have pigs, cannot delete
      const pigs = await DatabaseHelper.executeQuery(
        `SELECT * FROM pigs
                INNER JOIN pens h ON h.id = pigs.pen_id AND h.row_id = $1
                WHERE pigs.is_deleted = 0    
                `,
        [rowId]
      );
      const hasPigs = pigs.rows.length > 0;
      if (hasPigs) {
        throw new Error(`Cannot delete a row with ${pigs.rows.length} pigs!`);
      }
      const result = await DatabaseHelper.executeQuery(
        "UPDATE rows SET is_deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND farm_id = $2 AND is_deleted = 0 RETURNING *",
        [rowId, farmId]
      );
      if (result.rows.length === 0) {
        throw new ValidationError("Row not found");
      }

      await DatabaseHelper.executeQuery(
        "UPDATE pens SET is_deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE row_id = $1 AND farm_id = $2 AND is_deleted = 0",
        [rowId, farmId]
      );
      logger.info(
        `Row ${rowId} (${result.rows[0].name}) soft deleted by user ${userId}`
      );
      return result.rows[0];
    } catch (error) {
      logger.error(`Error deleting row ${rowId}: ${error.message}`);
      throw error;
    }
  }
}

export default RowsService;
