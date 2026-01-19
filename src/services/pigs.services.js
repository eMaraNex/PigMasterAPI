import { DatabaseHelper } from "../config/database.js";
import logger from "../middleware/logger.js";
import { ValidationError } from "../middleware/errors.js";
import { v4 as uuidv4 } from "uuid";

class PigsService {
  static async createPig(pigData, userId) {
    const {
      farm_id,
      pig_id,
      name,
      gender,
      breed,
      color,
      birth_date,
      weight,
      pen_id,
      parent_male_id,
      parent_female_id,
      acquisition_type,
      acquisition_date,
      acquisition_cost,
      is_pregnant,
      pregnancy_start_date,
      expected_birth_date,
      status,
      notes,
    } = pigData;
    if (
      !farm_id ||
      !pig_id ||
      !gender ||
      !breed ||
      !color ||
      !birth_date ||
      !weight
    ) {
      throw new ValidationError("Missing required pig fields");
    }

    try {
      // Check if pig_id is unique
      const existingPig = await DatabaseHelper.executeQuery(
        "SELECT 1 FROM pigs WHERE pig_id = $1 AND farm_id = $2 AND is_deleted = 0",
        [pig_id, farm_id]
      );
      if (existingPig.rows.length > 0) {
        throw new ValidationError("Pig ID already exists");
      }

      // Validate pen
      let is_occupied = false;
      if (pen_id) {
        const penResult = await DatabaseHelper.executeQuery(
          "SELECT 1 FROM pens WHERE id = $1 AND farm_id = $2 AND is_deleted = 0",
          [pen_id, farm_id]
        );
        if (penResult.rows.length === 0) {
          throw new ValidationError("Pen not found");
        }
        // Check pig count to enforce max 6 pigs per pen
        const pigCount = await DatabaseHelper.executeQuery(
          "SELECT COUNT(*) FROM pigs WHERE pen_id = $1 AND farm_id = $2 AND is_deleted = 0",
          [pen_id, farm_id]
        );
        if (parseInt(pigCount?.rows[0]?.count || 0) >= 6) {
          throw new ValidationError("Pen cannot have more than 6 pigs");
        }
        is_occupied = true;
      }

      // // Validate parent IDs if provided
      // if (parent_male_id) {
      //     const maleResult = await DatabaseHelper.executeQuery(
      //         'SELECT 1 FROM pigs WHERE pig_id = $1 AND farm_id = $2 AND gender = $3 AND is_deleted = 0',
      //         [parent_male_id, farm_id, 'male']
      //     );
      //     if (maleResult.rows.length === 0) {
      //         throw new ValidationError('Parent male pig not found or invalid');
      //     }
      // }
      // if (parent_female_id) {
      //     const femaleResult = await DatabaseHelper.executeQuery(
      //         'SELECT 1 FROM pigs WHERE pig_id = $1 AND farm_id = $2 AND gender = $3 AND is_deleted = 0',
      //         [parent_female_id, farm_id, 'female']
      //     );
      //     if (femaleResult.rows.length === 0) {
      //         throw new ValidationError('Parent female pig not found or invalid');
      //     }
      // }

      // Insert pig
      const pigResult = await DatabaseHelper.executeQuery(
        `INSERT INTO pigs (
                    id, farm_id, pig_id, name, gender, breed, color, birth_date, weight, pen_id,
                    parent_male_id, parent_female_id, acquisition_type, acquisition_date, acquisition_cost,
                    is_pregnant, pregnancy_start_date, expected_birth_date, status, notes, created_at, is_deleted
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, CURRENT_TIMESTAMP, 0)
                RETURNING *`,
        [
          uuidv4(),
          farm_id,
          pig_id,
          name || null,
          gender,
          breed,
          color,
          birth_date,
          weight,
          pen_id || null,
          parent_male_id || null,
          parent_female_id || null,
          acquisition_type || "birth",
          acquisition_date || null,
          acquisition_cost || null,
          is_pregnant || false,
          pregnancy_start_date || null,
          expected_birth_date || null,
          status || "active",
          notes || null,
        ]
      );
      const pig = pigResult.rows[0];

      // Update pen is_occupied
      if (pen_id) {
        await DatabaseHelper.executeQuery(
          "UPDATE pens SET is_occupied = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND farm_id = $3",
          [is_occupied, pen_id, farm_id]
        );

        // Insert into pen_pig_history
        await DatabaseHelper.executeQuery(
          `INSERT INTO pen_pig_history (id, pen_id, pig_id, farm_id, assigned_at, created_at, is_deleted)
                    VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0)`,
          [uuidv4(), pen_id, pig.pig_id, farm_id]
        );
      }
      logger.info(`Pig ${pig_id} created by user ${userId}`);
      return pig;
    } catch (error) {
      logger.error(`Error creating pig: ${error.message}`);
      throw error;
    }
  }

  static async getPigById(pigId, farmId) {
    try {
      const result = await DatabaseHelper.executeQuery(
        `
                SELECT r.*, h.id AS pen_id, h.name AS pen_name,
                    (SELECT JSON_AGG(
                        JSON_BUILD_OBJECT(
                            'pen_id', hr.pen_id,
                            'assigned_at', hr.assigned_at,
                            'removed_at', hr.removed_at,
                            'removal_reason', hr.removal_reason,
                            'removal_notes', hr.removal_notes
                        )
                    )
                    FROM pen_pig_history hr
                    WHERE hr.pig_id = r.pig_id AND hr.is_deleted = 0) AS pen_history,
                    (SELECT JSON_AGG(
                        JSON_BUILD_OBJECT(
                            'birth_date', rbh.birth_date,
                            'number_of_piglets', rbh.number_of_piglets,
                            'breeding_record_id', rbh.breeding_record_id,
                            'notes', rbh.notes,
                            'piglets', (
                                SELECT JSON_AGG(
                                    JSON_BUILD_OBJECT(
                                        'id', kr.id,
                                        'piglet_number', kr.piglet_number,
                                        'birth_weight', kr.birth_weight,
                                        'gender', kr.gender,
                                        'color', kr.color,
                                        'status', kr.status
                                    )
                                )
                                FROM piglet_records kr
                                WHERE kr.breeding_record_id = rbh.breeding_record_id AND kr.is_deleted = 0
                            )
                        )
                    )
                    FROM pig_birth_history rbh
                    WHERE rbh.sow_id = r.pig_id AND rbh.farm_id = r.farm_id AND rbh.is_deleted = 0) AS birth_history,
                    (SELECT JSON_AGG(
                        JSON_BUILD_OBJECT(
                            'id', hr.id,
                            'type', hr.type,
                            'description', hr.description,
                            'date', hr.date,
                            'next_due', hr.next_due,
                            'status', hr.status,
                            'veterinarian', hr.veterinarian,
                            'notes', hr.notes,
                            'created_at', hr.created_at
                        ) ORDER BY hr.date DESC
                    ) FROM health_records hr WHERE hr.pig_id = r.pig_id AND hr.is_deleted = 0) AS healthRecords,
                    (SELECT JSON_BUILD_OBJECT(
                        'id', fs.id,
                        'dailyAmount', fs.daily_amount,
                        'feedType', fs.feed_type,
                        'times', fs.times,
                        'specialDiet', fs.special_diet,
                        'lastFed', fs.last_fed,
                        'isActive', fs.is_active
                    ) FROM feeding_schedules fs WHERE fs.pig_id = r.pig_id AND fs.is_deleted = 0 LIMIT 1) AS feedingSchedule
                FROM pigs r
                LEFT JOIN pens h ON r.pen_id = h.id AND r.farm_id = h.farm_id
                WHERE r.pig_id = $1 AND r.farm_id = $2 AND r.is_deleted = 0
                `,
        [pigId, farmId]
      );
      if (result.rows.length === 0) {
        throw new ValidationError("Pig not found");
      }
      return result.rows[0];
    } catch (error) {
      logger.error(`Error fetching pig ${pigId}: ${error.message}`);
      throw error;
    }
  }

  static async getAllPigs(farmId, penId) {
    try {
      const queryWithPenId = `SELECT rb.*, ht.name AS pen_name FROM pigs rb
                INNER JOIN pens ht ON ht.id = rb.pen_id
                WHERE rb.farm_id = $1 AND rb.pen_id = $2 AND rb.is_deleted = 0 ORDER BY rb.created_at DESC`;
      const queryWithNoPenId = `SELECT rb.*, ht.name AS pen_name FROM pigs rb
            INNER JOIN pens ht ON ht.id = rb.pen_id
            WHERE rb.farm_id = $1 AND rb.is_deleted = 0 ORDER BY rb.created_at DESC`;
      const query = penId ? queryWithPenId : queryWithNoPenId;
      const params = penId ? [farmId, penId] : [farmId];
      const result = await DatabaseHelper.executeQuery(query, params);
      return result.rows;
    } catch (error) {
      logger.error(`Error fetching pigs for farm ${farmId}: ${error.message}`);
      throw error;
    }
  }

  static async updatePig(pigId, farmId, pigData, userId) {
    const {
      name,
      gender,
      breed,
      color,
      birth_date,
      weight,
      parent_male_id,
      parent_female_id,
      acquisition_type,
      acquisition_date,
      acquisition_cost,
      is_pregnant,
      pregnancy_start_date,
      expected_birth_date,
      status,
      notes,
    } = pigData;

    try {
      // Get pen_id the pig is placed on
      const penDetails = await DatabaseHelper.executeQuery(
        `SELECT pen_id FROM pigs WHERE pig_id = $1`,
        [pigId]
      );
      const pen_id = penDetails?.rows[0]?.pen_id;
      // Validate pen
      let is_occupied = false;
      if (pen_id) {
        const penResult = await DatabaseHelper.executeQuery(
          "SELECT 1 FROM pens WHERE id = $1 AND farm_id = $2 AND is_deleted = 0",
          [pen_id, farmId]
        );
        if (penResult.rows.length === 0) {
          throw new ValidationError("Pen not found");
        }
        // Check pig count to enforce max 6 pigs per pen
        const pigCount = await DatabaseHelper.executeQuery(
          "SELECT COUNT(*) FROM pigs WHERE pen_id = $1 AND farm_id = $2 AND is_deleted = 0 AND pig_id != $3",
          [pen_id, farmId, pigId]
        );
        if (parseInt(pigCount.rows[0].count) >= 6) {
          throw new ValidationError("Pen cannot have more than 6 pigs");
        }
        is_occupied = true;
      }

      // // Validate parent IDs if provided
      // if (parent_male_id) {
      //     const maleResult = await DatabaseHelper.executeQuery(
      //         'SELECT 1 FROM pigs WHERE pig_id = $1 AND farm_id = $2 AND gender = $3 AND is_deleted = 0',
      //         [parent_male_id, farmId, 'male']
      //     );
      //     if (maleResult.rows.length === 0) {
      //         throw new ValidationError('Parent male pig not found or invalid');
      //     }
      // }
      // if (parent_female_id) {
      //     const femaleResult = await DatabaseHelper.executeQuery(
      //         'SELECT 1 FROM pigs WHERE pig_id = $1 AND farm_id = $2 AND gender = $3 AND is_deleted = 0',
      //         [parent_female_id, farmId, 'female']
      //     );
      //     if (femaleResult.rows.length === 0) {
      //         throw new ValidationError('Parent female pig not found or invalid');
      //     }
      // }

      // Get current pig
      const currentPig = await DatabaseHelper.executeQuery(
        "SELECT * FROM pigs WHERE pig_id = $1 AND farm_id = $2 AND is_deleted = 0",
        [pigId, farmId]
      );
      if (currentPig.rows.length === 0) {
        throw new ValidationError("Pig not found");
      }
      const pig = currentPig.rows[0];

      // Update pig
      const result = await DatabaseHelper.executeQuery(
        `UPDATE pigs
                SET name = $1, gender = $2, breed = $3, color = $4, birth_date = $5, weight = $6, pen_id = $7,
                    parent_male_id = $8, parent_female_id = $9, acquisition_type = $10, acquisition_date = $11,
                    acquisition_cost = $12, is_pregnant = $13, pregnancy_start_date = $14, expected_birth_date = $15,
                    status = $16, notes = $17, updated_at = CURRENT_TIMESTAMP
                WHERE pig_id = $18 AND farm_id = $19 AND is_deleted = 0
                RETURNING *`,
        [
          name || pig.name,
          gender || pig.gender,
          breed || pig.breed,
          color || pig.color,
          birth_date || pig.birth_date,
          weight || pig.weight,
          pen_id || pig.pen_id || null,
          parent_male_id || pig.parent_male_id,
          parent_female_id || pig.parent_female_id,
          acquisition_type || pig.acquisition_type,
          acquisition_date || pig.acquisition_date,
          acquisition_cost || pig.acquisition_cost,
          is_pregnant || pig.is_pregnant,
          pregnancy_start_date || pig.pregnancy_start_date,
          expected_birth_date || pig.expected_birth_date,
          status || pig.status,
          notes || pig.notes,
          pigId,
          farmId,
        ]
      );
      if (result.rows.length === 0) {
        throw new ValidationError("Pig not found");
      }
      const updatedPig = result.rows[0];

      // Removing this section because I dont think addign piglets to a pig should remove the pig from the pen.
      logger.info(`Pig ${pigId} updated by user ${userId}`);
      return updatedPig;
    } catch (error) {
      logger.error(`Error updating pig ${pigId}: ${error.message}`);
      throw error;
    }
  }

  static async deletePig(pigId, farmId, removalData, userId) {
    const {
      reason,
      notes,
      date,
      sale_amount,
      sale_weight,
      sold_to,
      sale_notes,
      sale_type,
      pen_id,
      currency,
    } = removalData;
    if (!reason) {
      throw new ValidationError("Removal reason is required");
    }

    try {
      const pigResult = await DatabaseHelper.executeQuery(
        "SELECT id, pig_id, pen_id FROM pigs WHERE pig_id = $1 AND farm_id = $2 AND is_deleted = 0",
        [pigId, farmId]
      );
      if (pigResult.rows.length === 0) {
        throw new ValidationError("Pig not found");
      }
      const pig = pigResult.rows[0];

      // Soft delete pig
      const result = await DatabaseHelper.executeQuery(
        "UPDATE pigs SET is_deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE pig_id = $1 AND farm_id = $2 AND is_deleted = 0 RETURNING *",
        [pigId, farmId]
      );
      const deletedPig = result.rows[0];

      // Insert removal record
      await DatabaseHelper.executeQuery(
        `INSERT INTO removal_records (
                    id, pig_id, pen_id, farm_id, reason, notes, date, sale_amount, sale_weight, sold_to, created_at, is_deleted
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP, 0)`,
        [
          uuidv4(),
          pig.pig_id,
          pen_id || pig.pen_id || null,
          farmId,
          reason,
          notes || null,
          date || new Date().toISOString().split("T")[0],
          sale_amount || null,
          sale_weight || null,
          sold_to || null,
        ]
      );

      // Update pen_pig_history
      if (pig.pen_id) {
        await DatabaseHelper.executeQuery(
          `UPDATE pen_pig_history
                    SET removed_at = CURRENT_TIMESTAMP, removal_reason = $1, removal_notes = $2,
                        sale_amount = $3, sale_date = $4, sale_weight = $5, sold_to = $6, updated_at = CURRENT_TIMESTAMP
                    WHERE pen_id = $7 AND pig_id = $8 AND farm_id = $9 AND is_deleted = 0 AND removed_at IS NULL`,
          [
            reason,
            sale_notes || notes || null,
            sale_amount || null,
            date || new Date().toISOString().split("T")[0],
            sale_weight || null,
            sold_to || null,
            pig.pen_id,
            pig.pig_id,
            farmId,
          ]
        );

        // Update pen is_occupied
        const pigCount = await DatabaseHelper.executeQuery(
          "SELECT COUNT(*) FROM pigs WHERE pen_id = $1 AND farm_id = $2 AND is_deleted = 0",
          [pig.pen_id, farmId]
        );
        if (parseInt(pigCount.rows[0].count) === 0) {
          await DatabaseHelper.executeQuery(
            "UPDATE pens SET is_occupied = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND farm_id = $2",
            [pig.pen_id, farmId]
          );
        }
      }
      logger.info(`Pig ${pigId} soft deleted by user ${userId}`);
      return deletedPig;
    } catch (error) {
      logger.error(`Error deleting pig ${pigId}: ${error.message}`);
      throw error;
    }
  }

  static async getAllPigDetails(farmId, options = {}) {
    try {
      const {
        page = 1,
        limit = 10,
        sortField = "created_at",
        sortOrder = "desc",
        searchTerm = null,
        filters = {},
      } = options;
      const offset = (page - 1) * limit;
      const allowedSortFields = [
        "name",
        "gender",
        "breed",
        "created_at",
        "updated_at",
        "birth_date",
        "weight",
        "color",
        "pen_name",
      ];
      const validSortField = allowedSortFields.includes(sortField)
        ? sortField
        : "created_at";
      const validSortOrder = ["asc", "desc"].includes(sortOrder.toLowerCase())
        ? sortOrder.toUpperCase()
        : "DESC";

      // Base where clause for farm
      const baseWhereClause = "WHERE r.farm_id = $1 AND r.is_deleted = 0";
      const baseParams = [farmId];

      // Build filter conditions for search/filters (for paginated data only)
      let filteredWhereClause = baseWhereClause;
      const filteredParams = [...baseParams];
      let paramIndex = 2;
      if (searchTerm && searchTerm.trim()) {
        filteredWhereClause += ` AND (
                LOWER(r.name) LIKE $${paramIndex} OR
                LOWER(r.breed) LIKE $${paramIndex} OR
                LOWER(r.pig_id) LIKE $${paramIndex} OR
                LOWER(r.gender) LIKE $${paramIndex} OR
                LOWER(r.color) LIKE $${paramIndex}
            )`;
        filteredParams.push(`%${searchTerm.trim().toLowerCase()}%`);
        paramIndex++;
      }

      // Apply additional filters if provided
      if (filters.gender && filters.gender.length > 0) {
        const genderPlaceholders = filters.gender
          .map(() => `$${paramIndex++}`)
          .join(",");
        filteredWhereClause += ` AND r.gender IN (${genderPlaceholders})`;
        filteredParams.push(...filters.gender);
      }

      if (filters.breed && filters.breed.length > 0) {
        const breedPlaceholders = filters.breed
          .map(() => `$${paramIndex++}`)
          .join(",");
        filteredWhereClause += ` AND r.breed IN (${breedPlaceholders})`;
        filteredParams.push(...filters.breed);
      }

      if (filters.isPregnant !== undefined) {
        filteredWhereClause += ` AND r.is_pregnant = $${paramIndex}`;
        filteredParams.push(filters.isPregnant);
        paramIndex++;
      }

      if (filters.ageRange && filters.ageRange !== "all") {
        if (filters.ageRange === "young") {
          filteredWhereClause += ` AND r.birth_date > NOW() - INTERVAL '6 MONTHS'`;
        } else if (filters.ageRange === "adult") {
          filteredWhereClause += ` AND r.birth_date <= NOW() - INTERVAL '6 MONTHS' AND r.birth_date > NOW() - INTERVAL '24 MONTHS'`;
        } else if (filters.ageRange === "senior") {
          filteredWhereClause += ` AND r.birth_date <= NOW() - INTERVAL '24 MONTHS'`;
        }
      }

      // Get overall farm statistics (unfiltered)
      const statsQuery = `
            SELECT 
                COUNT(*) as total_pigs,
                COUNT(CASE WHEN r.gender = 'male' THEN 1 END) as male_count,
                COUNT(CASE WHEN r.gender = 'female' THEN 1 END) as female_count,
                COUNT(CASE WHEN r.is_pregnant = true THEN 1 END) as pregnant_count,
                COUNT(CASE WHEN r.gender = 'male' AND EXISTS(
                    SELECT 1 FROM breeding_records br 
                    WHERE br.boar_id = r.pig_id AND br.farm_id = r.farm_id AND br.is_deleted = 0
                ) THEN 1 END) as breeder_boar_count,
                JSON_AGG(
                    JSON_BUILD_OBJECT(
                        'breed', COALESCE(r.breed, 'Unknown'),
                        'gender', r.gender
                    )
                ) as breed_gender_data
            FROM pigs r
            ${baseWhereClause}
        `;

      const statsResult = await DatabaseHelper.executeQuery(
        statsQuery,
        baseParams
      );
      const stats = statsResult.rows[0];

      // Process breed distribution
      const breedDistribution = {};
      if (stats.breed_gender_data) {
        stats.breed_gender_data.forEach(item => {
          const breed = item.breed || "Unknown";
          if (!breedDistribution[breed]) {
            breedDistribution[breed] = { males: 0, females: 0, total: 0 };
          }
          if (item.gender === "male") {
            breedDistribution[breed].males++;
          } else if (item.gender === "female") {
            breedDistribution[breed].females++;
          }
          breedDistribution[breed].total++;
        });
      }

      // Get filtered count for pagination
      const countQuery = `
            SELECT COUNT(*) as total
            FROM pigs r
            LEFT JOIN pens h ON r.pen_id = h.id AND r.farm_id = h.farm_id
            ${filteredWhereClause}
        `;

      const countResult = await DatabaseHelper.executeQuery(
        countQuery,
        filteredParams
      );
      const filteredTotalItems = Number.parseInt(countResult.rows[0].total);

      // Get paginated data with filters applied
      const mainQuery = `
            SELECT r.*, h.id AS pen_id, h.name AS pen_name,
                (SELECT JSON_AGG(
                    JSON_BUILD_OBJECT(
                        'pen_id', hr.pen_id,
                        'assigned_at', hr.assigned_at,
                        'removed_at', hr.removed_at,
                        'removal_reason', hr.removal_reason,
                        'removal_notes', hr.removal_notes
                    )
                )
                FROM pen_pig_history hr
                    WHERE hr.pig_id = r.pig_id AND hr.is_deleted = 0) AS pen_history,
                (SELECT JSON_AGG(
                    JSON_BUILD_OBJECT(
                        'birth_date', rbh.birth_date,
                        'number_of_piglets', rbh.number_of_piglets,
                        'breeding_record_id', rbh.breeding_record_id,
                        'notes', rbh.notes,
                        'piglets', (
                            SELECT JSON_AGG(
                                JSON_BUILD_OBJECT(
                                    'id', kr.id,
                                    'piglet_number', kr.piglet_number,
                                    'birth_weight', kr.birth_weight,
                                    'gender', kr.gender,
                                    'color', kr.color,
                                    'status', kr.status
                                )
                            )
                            FROM piglet_records kr
                            WHERE kr.breeding_record_id = rbh.breeding_record_id AND kr.is_deleted = 0
                        )
                    )
                )
                FROM pig_birth_history rbh
                WHERE rbh.sow_id = r.pig_id AND rbh.farm_id = r.farm_id AND rbh.is_deleted = 0) AS birth_history,
                    (SELECT JSON_AGG(
                        JSON_BUILD_OBJECT(
                            'id', hr.id,
                            'type', hr.type,
                            'description', hr.description,
                            'date', hr.date,
                            'next_due', hr.next_due,
                            'status', hr.status,
                            'veterinarian', hr.veterinarian,
                            'notes', hr.notes,
                            'created_at', hr.created_at
                        ) ORDER BY hr.date DESC
                    ) FROM health_records hr WHERE hr.pig_id = r.pig_id AND hr.is_deleted = 0) AS healthRecords,
                    (SELECT JSON_BUILD_OBJECT(
                        'id', fs.id,
                        'dailyAmount', fs.daily_amount,
                        'feedType', fs.feed_type,
                        'times', fs.times,
                        'specialDiet', fs.special_diet,
                        'lastFed', fs.last_fed,
                        'isActive', fs.is_active
                    ) FROM feeding_schedules fs WHERE fs.pig_id = r.pig_id AND fs.is_deleted = 0 LIMIT 1) AS feedingSchedule
            FROM pigs r
            LEFT JOIN pens h ON r.pen_id = h.id AND r.farm_id = h.farm_id
            ${filteredWhereClause}
            ORDER BY ${
              validSortField === "pen_name" ? "h.name" : "r." + validSortField
            } ${validSortOrder}
            LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
        `;

      filteredParams.push(limit, offset);
      const result = await DatabaseHelper.executeQuery(
        mainQuery,
        filteredParams
      );

      return {
        data: result.rows,
        pagination: {
          currentPage: page,
          totalItems: filteredTotalItems,
          totalPages: Math.ceil(filteredTotalItems / limit),
          pageSize: limit,
          hasNextPage: page < Math.ceil(filteredTotalItems / limit),
          hasPreviousPage: page > 1,
        },
        statistics: {
          totalPigs: Number.parseInt(stats.total_pigs),
          maleCount: Number.parseInt(stats.male_count),
          femaleCount: Number.parseInt(stats.female_count),
          pregnantCount: Number.parseInt(stats.pregnant_count),
          breederBoarCount: Number.parseInt(stats.breeder_boar_count),
          breedDistribution: breedDistribution,
        },
      };
    } catch (error) {
      logger.error(
        `Error fetching paginated pig details for farm ${farmId}: ${error.message}`
      );
      throw error;
    }
  }

  static async transferPig(pigId, farmId, transferData, userId) {
    const {
      new_pen_id,
      transfer_reason,
      transfer_notes
    } = transferData;

    if (!new_pen_id || !transfer_reason) {
      throw new ValidationError("Missing required transfer fields");
    }

    try {
      // Get current pig
      const pigResult = await DatabaseHelper.executeQuery(
        "SELECT * FROM pigs WHERE pig_id = $1 AND farm_id = $2 AND is_deleted = 0",
        [pigId, farmId]
      );

      if (pigResult.rows.length === 0) {
        throw new ValidationError("Pig not found");
      }

      const currentPig = pigResult.rows[0];
      const oldPenId = currentPig.pen_id;

      // Validate new pen exists
      const newPenResult = await DatabaseHelper.executeQuery(
        "SELECT * FROM pens WHERE id = $1 AND farm_id = $2 AND is_deleted = 0",
        [new_pen_id, farmId]
      );

      if (newPenResult.rows.length === 0) {
        throw new ValidationError("Destination pen not found");
      }

      // Prevent self-transfer
      if (oldPenId === new_pen_id) {
        throw new ValidationError("Pig is already in this pen");
      }

      // Check new pen capacity (max 6 pigs per pen)
      const pigCountResult = await DatabaseHelper.executeQuery(
        "SELECT COUNT(*) as count FROM pigs WHERE pen_id = $1 AND farm_id = $2 AND is_deleted = 0",
        [new_pen_id, farmId]
      );

      const currentPigCount = parseInt(pigCountResult.rows[0].count || 0);
      if (currentPigCount >= 6) {
        throw new ValidationError("Destination pen is at maximum capacity (6 pigs)");
      }

      // Update pig with new pen
      const updatedPigResult = await DatabaseHelper.executeQuery(
        `UPDATE pigs 
         SET pen_id = $1, updated_at = CURRENT_TIMESTAMP 
         WHERE pig_id = $2 AND farm_id = $3 
         RETURNING *`,
        [new_pen_id, pigId, farmId]
      );

      const transferredPig = updatedPigResult.rows[0];

      // Get pen names for history
      let oldPenName = "Unknown";
      let newPenName = "Unknown";

      if (oldPenId) {
        const oldPenNameResult = await DatabaseHelper.executeQuery(
          "SELECT name FROM pens WHERE id = $1",
          [oldPenId]
        );
        if (oldPenNameResult.rows.length > 0) {
          oldPenName = oldPenNameResult.rows[0].name;
        }
      }

      const newPenNameResult = await DatabaseHelper.executeQuery(
        "SELECT name FROM pens WHERE id = $1",
        [new_pen_id]
      );
      if (newPenNameResult.rows.length > 0) {
        newPenName = newPenNameResult.rows[0].name;
      }

      // Insert transfer history record
      const { v4: uuidv4 } = await import("uuid");
      await DatabaseHelper.executeQuery(
        `INSERT INTO pig_transfer_history (id, farm_id, pig_id, old_pen_id, new_pen_id, transfer_reason, transfer_notes, transferred_by, transferred_at, created_at, is_deleted)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0)`,
        [
          uuidv4(),
          farmId,
          pigId,
          oldPenId || null,
          new_pen_id,
          transfer_reason,
          transfer_notes || null,
          userId,
        ]
      );

      // Update old pen status if it has no more pigs
      if (oldPenId) {
        const oldPenPigCount = await DatabaseHelper.executeQuery(
          "SELECT COUNT(*) as count FROM pigs WHERE pen_id = $1 AND farm_id = $2 AND is_deleted = 0",
          [oldPenId, farmId]
        );
        const newCount = parseInt(oldPenPigCount.rows[0].count || 0);
        if (newCount === 0) {
          await DatabaseHelper.executeQuery(
            "UPDATE pens SET is_occupied = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1",
            [oldPenId]
          );
        }
      }

      // Update new pen status
      await DatabaseHelper.executeQuery(
        "UPDATE pens SET is_occupied = true, updated_at = CURRENT_TIMESTAMP WHERE id = $1",
        [new_pen_id]
      );

      // Add pen_pig_history entry
      await DatabaseHelper.executeQuery(
        `INSERT INTO pen_pig_history (id, pen_id, pig_id, farm_id, assigned_at, created_at, is_deleted)
         VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0)`,
        [uuidv4(), new_pen_id, pigId, farmId]
      );

      logger.info(`Pig ${pigId} transferred from ${oldPenName} to ${newPenName} by user ${userId}`);

      return {
        ...transferredPig,
        transfer_details: {
          old_pen_id: oldPenId,
          old_pen_name: oldPenName,
          new_pen_id: new_pen_id,
          new_pen_name: newPenName,
          transfer_reason,
          transferred_at: new Date().toISOString()
        }
      };
    } catch (error) {
      logger.error(`Error transferring pig: ${error.message}`);
      throw error;
    }
  }

  static async getPigTransferHistory(pigId, farmId) {
    try {
      const result = await DatabaseHelper.executeQuery(
        `SELECT 
          pth.*,
          p.name AS pig_name,
          p.pig_id,
          op.name AS old_pen_name,
          np.name AS new_pen_name,
          u.name AS transferred_by_user
         FROM pig_transfer_history pth
         LEFT JOIN pigs p ON pth.pig_id = p.pig_id AND pth.farm_id = p.farm_id
         LEFT JOIN pens op ON pth.old_pen_id = op.id
         LEFT JOIN pens np ON pth.new_pen_id = np.id
         LEFT JOIN users u ON pth.transferred_by = u.id
         WHERE pth.pig_id = $1 AND pth.farm_id = $2 AND pth.is_deleted = 0
         ORDER BY pth.transferred_at DESC`,
        [pigId, farmId]
      );
      return result.rows;
    } catch (error) {
      logger.error(`Error fetching transfer history for pig ${pigId}: ${error.message}`);
      throw error;
    }
  }
}

export default PigsService;
