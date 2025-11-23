import { DatabaseHelper } from '../config/database.js';
import logger from '../middleware/logger.js';
import { ValidationError } from '../middleware/errors.js';
import { v4 as uuidv4 } from 'uuid';

class FarmsService {
    static async createFarm(farmData, userId) {
        const { name, location, latitude, longitude, size, description, timezone, breeds = [], colors = [] } = farmData;
        if (!name) {
            throw new ValidationError('Farm name is required');
        }

        try {
            // Check if farm name is unique for the user
            const existingFarm = await DatabaseHelper.executeQuery(
                'SELECT 1 FROM farms WHERE name = $1 AND created_by = $2 AND is_deleted = 0',
                [name, userId]
            );
            if (existingFarm.rows.length > 0) {
                throw new ValidationError('Farm name already exists for this user');
            }

            // Generate UUID for farm
            const farmId = uuidv4();

            // Insert farm
            const farmResult = await DatabaseHelper.executeQuery(
                `INSERT INTO farms (
                    id, name, location, latitude, longitude, size, description, timezone,
                    breeds, colors,
                    created_by, created_at, is_deleted
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CURRENT_TIMESTAMP, 0) RETURNING *`,
                [
                    farmId,
                    name,
                    location || null,
                    latitude || null,
                    longitude || null,
                    size || null,
                    description || null,
                    timezone || 'UTC',
                    JSON.stringify(breeds),
                    JSON.stringify(colors),
                    userId
                ]
            );

            // Update user's farm_id if none exists (optional, for default farm)
            const userFarmCheck = await DatabaseHelper.executeQuery(
                'SELECT farm_id FROM users WHERE id = $1 AND is_deleted = 0',
                [userId]
            );
            if (!userFarmCheck.rows[0]?.farm_id) {
                await DatabaseHelper.executeQuery(
                    'UPDATE users SET farm_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
                    [farmId, userId]
                );
            }
            logger.info(`Farm ${name} (ID: ${farmId}) created by user ${userId}`);
            return farmResult.rows[0];
        } catch (error) {
            logger.error(`Error creating farm: ${error.message}`);
            throw error;
        }
    }

    static async getFarmById(farmId, userId) {
        try {
            const result = await DatabaseHelper.executeQuery(
                'SELECT * FROM farms WHERE id = $1 AND created_by = $2 AND is_deleted = 0',
                [farmId, userId]
            );
            if (result.rows.length === 0) {
                throw new ValidationError('Farm not found');
            }
            return result.rows[0];
        } catch (error) {
            logger.error(`Error fetching farm ${farmId}: ${error.message}`);
            throw error;
        }
    }

    static async getAllFarms(userId) {
        try {
            const result = await DatabaseHelper.executeQuery(
                'SELECT * FROM farms WHERE is_deleted = 0 ORDER BY created_at DESC'
            );
            return result.rows;
        } catch (error) {
            logger.error(`Error fetching farms for user ${userId}: ${error.message}`);
            throw error;
        }
    }

    static async updateFarm(farmId, farmData, userId) {
        const { name, location, latitude, longitude, size, description, timezone, breeds, colors } = farmData;
        try {
            let query = `UPDATE farms SET
                    updated_at = CURRENT_TIMESTAMP`;
            const params = [];
            let paramIndex = 1;

            if (name !== undefined) {
                query += `, name = $${paramIndex++}`;
                params.push(name);
            }
            if (location !== undefined) {
                query += `, location = $${paramIndex++}`;
                params.push(location);
            }
            if (latitude !== undefined) {
                query += `, latitude = $${paramIndex++}`;
                params.push(latitude);
            }
            if (longitude !== undefined) {
                query += `, longitude = $${paramIndex++}`;
                params.push(longitude);
            }
            if (size !== undefined) {
                query += `, size = $${paramIndex++}`;
                params.push(size);
            }
            if (description !== undefined) {
                query += `, description = $${paramIndex++}`;
                params.push(description);
            }
            if (timezone !== undefined) {
                query += `, timezone = $${paramIndex++}`;
                params.push(timezone);
            }
            if (breeds !== undefined) {
                query += `, breeds = $${paramIndex++}`;
                params.push(JSON.stringify(breeds));
            }
            if (colors !== undefined) {
                query += `, colors = $${paramIndex++}`;
                params.push(JSON.stringify(colors));
            }

            query += ` WHERE id = $${paramIndex++} AND created_by = $${paramIndex++} AND is_deleted = 0 RETURNING *`;
            params.push(farmId, userId);

            const result = await DatabaseHelper.executeQuery(query, params);
            if (result.rows.length === 0) {
                throw new ValidationError('Farm not found');
            }
            logger.info(`Farm ${farmId} updated by user ${userId}`);
            return result.rows[0];
        } catch (error) {
            logger.error(`Error updating farm ${farmId}: ${error.message}`);
            throw error;
        }
    }

    static async deleteFarm(farmId, userId) {
        try {
            const result = await DatabaseHelper.executeQuery(
                'UPDATE farms SET is_deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND created_by = $2 AND is_deleted = 0 RETURNING *',
                [farmId, userId]
            );
            if (result.rows.length === 0) {
                throw new ValidationError('Farm not found');
            }

            // Soft delete related entities (rows, hutches, pigs, etc.)
            await DatabaseHelper.executeQuery(
                'UPDATE rows SET is_deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE farm_id = $1 AND is_deleted = 0',
                [farmId]
            );
            await DatabaseHelper.executeQuery(
                'UPDATE hutches SET is_deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE farm_id = $1 AND is_deleted = 0',
                [farmId]
            );
            await DatabaseHelper.executeQuery(
                'UPDATE pigs SET is_deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE farm_id = $1 AND is_deleted = 0',
                [farmId]
            );
            logger.info(`Farm ${farmId} soft deleted by user ${userId}`);
            return result.rows[0];
        } catch (error) {
            logger.error(`Error deleting farm ${farmId}: ${error.message}`);
            throw error;
        }
    }
}

export default FarmsService;