import { DatabaseHelper } from "../config/database.js";
import logger from "../middleware/logger.js";
import { ValidationError } from "../middleware/errors.js";
import { v4 as uuidv4 } from "uuid";
import { pool } from "../config/database.js";
import AlertService from "./alerts.services.js";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";

dayjs.extend(utc);
dayjs.extend(timezone);

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

class BreedingService {
  static async createBreedingRecord(breedingData, userId) {
    const {
      farm_id,
      sow_id,
      boar_id,
      mating_date,
      expected_birth_date,
      notes,
      immediate_notify_date,
      alert_message,
    } = breedingData;

    if (
      !farm_id ||
      !sow_id ||
      !boar_id ||
      !mating_date ||
      !expected_birth_date
    ) {
      throw new ValidationError("Missing required breeding record fields");
    }

    // Validate dates
    const matingDateUTC = dayjs(mating_date).utc();
    if (!matingDateUTC.isValid()) {
      throw new ValidationError(
        "Invalid mating_date format; must be a valid date"
      );
    }
    const expectedBirthDateUTC = dayjs(expected_birth_date).utc();
    if (!expectedBirthDateUTC.isValid()) {
      throw new ValidationError(
        "Invalid expected_birth_date format; must be a valid date"
      );
    }

    // Handle immediate_notify_date
    let notifyOnDate = immediate_notify_date;
    if (notifyOnDate && !dayjs(notifyOnDate, "YYYY-MM-DD", true).isValid()) {
      throw new ValidationError(
        "Invalid immediate_notify_date format; must be YYYY-MM-DD"
      );
    }
    // Convert to UTC and format as YYYY-MM-DD[T00:00:00Z]
    notifyOnDate = notifyOnDate
      ? dayjs(notifyOnDate).utc().format("YYYY-MM-DD") + "T00:00:00Z"
      : getUTCDateString(matingDateUTC) + "T00:00:00Z";

    try {
      // Validate sow and boar
      const sowResult = await DatabaseHelper.executeQuery(
        "SELECT 1 FROM pigs WHERE pig_id = $1 AND farm_id = $2 AND gender = $3 AND is_deleted = 0",
        [sow_id, farm_id, "female"]
      );
      if (sowResult.rows.length === 0) {
        throw new ValidationError("Sow not found or invalid");
      }

      const boarResult = await DatabaseHelper.executeQuery(
        "SELECT 1 FROM pigs WHERE pig_id = $1 AND farm_id = $2 AND gender = $3 AND is_deleted = 0",
        [boar_id, farm_id, "male"]
      );
      if (boarResult.rows.length === 0) {
        throw new ValidationError("Boar not found or invalid");
      }

      // Check if the boar has served within the last 3 days
      // Removing this for now to get more feedback from users/farmers
      // const recentService = await DatabaseHelper.executeQuery(
      //     `SELECT 1 FROM breeding_records
      //      WHERE boar_id = $1 AND farm_id = $2 AND mating_date >= $3 AND is_deleted = 0`,
      //     [boar_id, farm_id, matingDateUTC.subtract(3, 'day').toDate()]
      // );
      // if (recentService.rows.length > 0) {
      //     throw new ValidationError('Boar has served within the last 3 days');
      // }

      // Check if the sow was served within the last week post-weaning
      const recentSowService = await DatabaseHelper.executeQuery(
        `SELECT actual_birth_date, number_of_piglets FROM breeding_records 
                 WHERE sow_id = $1 AND farm_id = $2 AND actual_birth_date IS NOT NULL AND is_deleted = 0 
                 ORDER BY actual_birth_date DESC LIMIT 1`,
        [sow_id, farm_id]
      );
      if (recentSowService.rows.length > 0) {
        const lastBirth = dayjs(recentSowService.rows[0].actual_birth_date);
        const weaningDate = lastBirth.add(42, "day");
        const oneWeekAfterWeaning = weaningDate.add(7, "day");
        if (matingDateUTC.isBefore(oneWeekAfterWeaning)) {
          throw new ValidationError(
            "Sow cannot be served within 1 week of weaning"
          );
        }
      }

      // Set alert date for pregnancy confirmation
      const alertDate = matingDateUTC.add(21, "day").toDate();

      // Insert breeding record
      const breedingResult = await DatabaseHelper.executeQuery(
        `INSERT INTO breeding_records (id, farm_id, sow_id, boar_id, mating_date, expected_birth_date, notes, alert_date, created_at, is_deleted)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP, 0) RETURNING *`,
        [
          uuidv4(),
          farm_id,
          sow_id,
          boar_id,
          mating_date,
          expected_birth_date,
          notes || null,
          alertDate,
        ]
      );
      const breedingRecord = breedingResult.rows[0];

      // // Update sow's pregnancy status
      // await DatabaseHelper.executeQuery(
      //     `UPDATE pigs SET is_pregnant = true, pregnancy_start_date = $1, expected_birth_date = $2, updated_at = CURRENT_TIMESTAMP
      //      WHERE pig_id = $3 AND farm_id = $4 AND is_deleted = 0`,
      //     [mating_date, expected_birth_date, sow_id, farm_id]
      // );

      // Get pen_id for alerts
      const penResult = await DatabaseHelper.executeQuery(
        "SELECT pen_id FROM pigs WHERE pig_id = $1 AND farm_id = $2 AND is_deleted = 0",
        [sow_id, farm_id]
      );
      const pen_id = penResult.rows[0]?.pen_id;

      // Create immediate breeding success alert
      const defaultMessage = `Breeding recorded for sow ${sow_id} and boar ${boar_id} on ${formatLocalDate(
        mating_date,
        "Africa/Nairobi"
      )}. Expected birth date: ${formatLocalDate(
        expected_birth_date,
        "Africa/Nairobi"
      )}`;
      await AlertService.createAlert({
        farm_id,
        user_id: userId,
        pig_id: sow_id,
        pen_id,
        name: `Breeding Success for ${sow_id} and ${boar_id}`,
        alert_start_date: getUTCDateString(matingDateUTC) + "T00:00:00Z",
        alert_type: "breeding",
        severity: "medium",
        message: alert_message || defaultMessage,
        notify_on: [notifyOnDate],
      });

      // Create scheduled alerts (trigger day before and on the date)
      // Pig gestation period: 114 days (3 months, 3 weeks, 3 days)
      const alerts = [
        {
          name: `Add Nesting Box for ${sow_id}`,
          alert_start_date:
            getUTCDateString(matingDateUTC.add(110, "day").toDate()) +
            "T00:00:00Z",
          alert_type: "breeding",
          severity: "high",
          message: `Add nesting box for pig ${sow_id} on pen ${
            pen_id || "unknown"
          } by ${formatLocalDate(
            matingDateUTC.add(110, "day"),
            "Africa/Nairobi"
          )}`,
          notify_on: [
            getUTCDateString(matingDateUTC.add(109, "day").toDate()) +
              "T00:00:00Z",
            getUTCDateString(matingDateUTC.add(110, "day").toDate()) +
              "T00:00:00Z",
          ],
        },
        // Birth check alerts (days 110-114) - pig gestation period
        ...Array.from({ length: 5 }, (_, i) => ({
          name: `Check Birth for ${sow_id}`,
          alert_start_date:
            getUTCDateString(matingDateUTC.add(110 + i, "day").toDate()) +
            "T00:00:00Z",
          alert_type: "birth",
          severity: "high",
          message: `Check for birth of pig ${sow_id} on pen ${
            pen_id || "unknown"
          } on ${formatLocalDate(
            matingDateUTC.add(110 + i, "day"),
            "Africa/Nairobi"
          )}`,
          notify_on: [
            getUTCDateString(matingDateUTC.add(109 + i, "day").toDate()) +
              "T00:00:00Z",
            getUTCDateString(matingDateUTC.add(110 + i, "day").toDate()) +
              "T00:00:00Z",
          ],
        })),
      ];

      for (const alert of alerts) {
        await AlertService.createAlert({
          farm_id,
          user_id: userId,
          pig_id: sow_id,
          pen_id,
          ...alert,
        });
      }
      logger.info(
        `Breeding record created for sow ${sow_id} by user ${userId}`
      );
      return breedingRecord;
    } catch (error) {
      logger.error(`Error creating breeding record: ${error.message}`);
      throw error;
    }
  }

  static async getBreedingRecordById(recordId, farmId) {
    try {
      const result = await DatabaseHelper.executeQuery(
        `SELECT br.*, 
                        (SELECT JSON_AGG(
                            JSON_BUILD_OBJECT(
                                'id', kr.id,
                                'piglet_number', kr.piglet_number,
                                'birth_weight', kr.birth_weight,
                                'gender', kr.gender,
                                'color', kr.color,
                                'status', kr.status,
                                'weaning_date', kr.weaning_date,
                                'weaning_weight', kr.weaning_weight,
                                'notes', kr.notes
                            )
                        )
                        FROM piglet_records kr
                        WHERE kr.breeding_record_id = br.id AND kr.is_deleted = 0) AS piglets
                 FROM breeding_records br
                 WHERE br.id = $1 AND br.farm_id = $2 AND br.is_deleted = 0`,
        [recordId, farmId]
      );
      if (result.rows.length === 0) {
        throw new ValidationError("Breeding record not found");
      }
      return result.rows[0];
    } catch (error) {
      logger.error(
        `Error fetching breeding record ${recordId}: ${error.message}`
      );
      throw error;
    }
  }

  static async getBreedingHistoryByPigId(farmId, pigId) {
    try {
      const result = await DatabaseHelper.executeQuery(
        `SELECT br.*
                 FROM breeding_records br
                 WHERE br.sow_id = $1 AND br.farm_id = $2 AND br.is_deleted = 0`,
        [pigId, farmId]
      );
      if (result.rows.length === 0) {
        throw new ValidationError("Breeding record not found");
      }
      return result.rows;
    } catch (error) {
      logger.error(
        `Error fetching breeding record ${recordId}: ${error.message}`
      );
      throw error;
    }
  }
  static async getAllBreedingRecords(farmId) {
    try {
      const result = await DatabaseHelper.executeQuery(
        `SELECT br.*,
                        (SELECT JSON_AGG(
                            JSON_BUILD_OBJECT(
                                'id', kr.id,
                                'piglet_number', kr.piglet_number,
                                'birth_weight', kr.birth_weight,
                                'gender', kr.gender,
                                'color', kr.color,
                                'status', kr.status,
                                'weaning_date', kr.weaning_date,
                                'weaning_weight', kr.weaning_weight,
                                'notes', kr.notes
                            )
                        )
                        FROM piglet_records kr
                        WHERE kr.breeding_record_id = br.id AND kr.is_deleted = 0) AS piglets
                 FROM breeding_records br
                 WHERE br.farm_id = $1 AND br.is_deleted = 0
                 ORDER BY br.created_at DESC`,
        [farmId]
      );
      return result.rows;
    } catch (error) {
      logger.error(
        `Error fetching breeding records for farm ${farmId}: ${error.message}`
      );
      throw error;
    }
  }

  static async updateBreedingRecord(recordId, farmId, updateData, userId) {
    const { actual_birth_date, number_of_piglets, notes } = updateData;

    try {
      const recordResult = await DatabaseHelper.executeQuery(
        "SELECT * FROM breeding_records WHERE id = $1 AND farm_id = $2 AND is_deleted = 0",
        [recordId, farmId]
      );
      if (recordResult.rows.length === 0) {
        throw new ValidationError("Breeding record not found");
      }
      const breedingRecord = recordResult.rows[0];

      // If actual birth date is provided, handle culling logic and cancel pregnancy alerts
      if (actual_birth_date && number_of_piglets) {
        // Check for culling based on litter size over 3 generations
        const pastRecords = await DatabaseHelper.executeQuery(
          `SELECT number_of_piglets FROM breeding_records 
                     WHERE sow_id = $1 AND farm_id = $2 AND actual_birth_date IS NOT NULL AND is_deleted = 0 
                     ORDER BY actual_birth_date DESC LIMIT 3`,
          [breedingRecord.sow_id, farmId]
        );
        const litters = pastRecords.rows
          .map(r => r.number_of_piglets || 0)
          .filter(n => n > 0);
        if (litters.length >= 3 && litters.every(n => n < 5)) {
          const notificationId = uuidv4();
          await DatabaseHelper.executeQuery(
            `INSERT INTO notifications (id, user_id, type, title, message, data, priority, created_at, is_deleted)
                         VALUES ($1, $2, 'culling_alert', 'Sow Culling Alert', $3, $4, 'high', CURRENT_TIMESTAMP, 0)`,
            [
              notificationId,
              userId,
              `Sow ${breedingRecord.sow_id} recommended for culling due to low litter size (<5) over 3 generations.`,
              JSON.stringify({
                sow_id: breedingRecord.sow_id,
                farm_id: farmId,
              }),
            ]
          );
          logger.info(
            `Sow ${breedingRecord.sow_id} marked for culling due to low litter size over 3 generations`
          );
        } else if (number_of_piglets < 5 || number_of_piglets > 10) {
          const notificationId = uuidv4();
          await DatabaseHelper.executeQuery(
            `INSERT INTO notifications (id, user_id, type, title, message, data, priority, created_at, is_deleted)
                         VALUES ($1, $2, 'culling_alert', 'Sow Culling Alert', $3, $4, 'high', CURRENT_TIMESTAMP, 0)`,
            [
              notificationId,
              userId,
              `Sow ${breedingRecord.sow_id} recommended for culling due to litter size ${number_of_piglets}.`,
              JSON.stringify({
                sow_id: breedingRecord.sow_id,
                farm_id: farmId,
              }),
            ]
          );
          logger.info(
            `Sow ${breedingRecord.sow_id} marked for culling due to litter size ${number_of_piglets}`
          );
        }

        // Update sow's pregnancy status
        await DatabaseHelper.executeQuery(
          `UPDATE pigs SET is_pregnant = false, pregnancy_start_date = NULL, expected_birth_date = NULL, actual_birth_date = $1, updated_at = CURRENT_TIMESTAMP
                     WHERE pig_id = $2 AND farm_id = $3 AND is_deleted = 0`,
          [actual_birth_date, breedingRecord.sow_id, farmId]
        );

        // Cancel pregnancy-related alerts
        await DatabaseHelper.executeQuery(
          `UPDATE alerts SET status = 'completed', updated_on = CURRENT_TIMESTAMP
                     WHERE pig_id = $1 AND alert_type = 'breeding' AND status = 'pending' AND is_deleted = false`,
          [breedingRecord.sow_id]
        );

        // Get pen_id for alerts
        const penResult = await DatabaseHelper.executeQuery(
          "SELECT pen_id FROM pigs WHERE pig_id = $1 AND farm_id = $2 AND is_deleted = 0",
          [breedingRecord.sow_id, farmId]
        );
        const pen_id = penResult.rows[0]?.pen_id;

        // Create scheduled post-birth alerts
        const actualBirthDateUTC = dayjs(actual_birth_date).utc();
        const alerts = [
          {
            name: `Fostering Check for ${breedingRecord.sow_id}`,
            alert_start_date:
              getUTCDateString(actualBirthDateUTC.add(4, "day").toDate()) +
              "T00:00:00Z",
            alert_type: "birth",
            severity: "medium",
            message: `Check fostering needs for pig ${
              breedingRecord.sow_id
            } on pen ${pen_id || "unknown"} by ${formatLocalDate(
              actualBirthDateUTC.add(4, "day"),
              "Africa/Nairobi"
            )}`,
            notify_on: [
              getUTCDateString(actualBirthDateUTC.add(3, "day").toDate()),
              getUTCDateString(actualBirthDateUTC.add(4, "day").toDate()),
            ],
          },
          {
            name: `Remove Nesting Box for ${breedingRecord.sow_id}`,
            alert_start_date:
              getUTCDateString(actualBirthDateUTC.add(20, "day").toDate()) +
              "T00:00:00Z",
            alert_type: "birth",
            severity: "medium",
            message: `Remove nesting box for pig ${
              breedingRecord.sow_id
            } on pen ${pen_id || "unknown"} by ${formatLocalDate(
              actualBirthDateUTC.add(20, "day"),
              "Africa/Nairobi"
            )}`,
            notify_on: [
              getUTCDateString(actualBirthDateUTC.add(19, "day").toDate()),
              getUTCDateString(actualBirthDateUTC.add(20, "day").toDate()),
            ],
          },
          {
            name: `Wean Piglets for ${breedingRecord.sow_id}`,
            alert_start_date:
              getUTCDateString(actualBirthDateUTC.add(42, "day").toDate()) +
              "T00:00:00Z",
            alert_type: "birth",
            severity: "high",
            message: `Wean piglets for pig ${breedingRecord.sow_id} on pen ${
              pen_id || "unknown"
            } by ${formatLocalDate(
              actualBirthDateUTC.add(42, "day"),
              "Africa/Nairobi"
            )}`,
            notify_on: [
              getUTCDateString(actualBirthDateUTC.add(41, "day").toDate()),
              getUTCDateString(actualBirthDateUTC.add(42, "day").toDate()),
            ],
          },
        ];

        for (const alert of alerts) {
          await AlertService.createAlert({
            farm_id: farmId,
            user_id: userId,
            pig_id: breedingRecord.sow_id,
            pen_id,
            ...alert,
          });
        }
      }

      // Update breeding record
      const updatedRecordResult = await DatabaseHelper.executeQuery(
        `UPDATE breeding_records SET actual_birth_date = $1, number_of_piglets = $2, notes = $3, updated_at = CURRENT_TIMESTAMP
                 WHERE id = $4 AND farm_id = $5 AND is_deleted = 0 RETURNING *`,
        [
          actual_birth_date || breedingRecord.actual_birth_date,
          number_of_piglets || breedingRecord.number_of_piglets,
          notes || breedingRecord.notes,
          recordId,
          farmId,
        ]
      );
      const updatedRecord = updatedRecordResult.rows[0];
      logger.info(`Breeding record ${recordId} updated by user ${userId}`);
      return updatedRecord;
    } catch (error) {
      logger.error(
        `Error updating breeding record ${recordId}: ${error.message}`
      );
      throw error;
    }
  }

  static async deleteBreedingRecord(recordId, farmId, userId) {
    try {
      const recordResult = await DatabaseHelper.executeQuery(
        "SELECT sow_id, actual_birth_date FROM breeding_records WHERE id = $1 AND farm_id = $2 AND is_deleted = 0",
        [recordId, farmId]
      );
      if (recordResult.rows.length === 0) {
        throw new ValidationError("Breeding record not found");
      }
      const breedingRecord = recordResult.rows[0];

      // Soft delete breeding record
      await DatabaseHelper.executeQuery(
        "UPDATE breeding_records SET is_deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND farm_id = $2 AND is_deleted = 0",
        [recordId, farmId]
      );

      // Soft delete associated piglet records
      await DatabaseHelper.executeQuery(
        "UPDATE piglet_records SET is_deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE breeding_record_id = $1 AND is_deleted = 0",
        [recordId]
      );

      // Update sow's pregnancy status if necessary
      if (!breedingRecord.actual_birth_date) {
        await DatabaseHelper.executeQuery(
          `UPDATE pigs SET is_pregnant = false, pregnancy_start_date = NULL, expected_birth_date = NULL, updated_at = CURRENT_TIMESTAMP
                     WHERE pig_id = $1 AND farm_id = $2 AND is_deleted = 0`,
          [breedingRecord.sow_id, farmId]
        );

        // Cancel related alerts
        await DatabaseHelper.executeQuery(
          `UPDATE alerts SET status = 'rejected', updated_on = CURRENT_TIMESTAMP
                     WHERE pig_id = $1 AND alert_type IN ('breeding', 'birth') AND status = 'pending' AND is_deleted = false`,
          [breedingRecord.sow_id]
        );
      }
      logger.info(`Breeding record ${recordId} soft deleted by user ${userId}`);
      return { id: recordId };
    } catch (error) {
      logger.error(
        `Error deleting breeding record ${recordId}: ${error.message}`
      );
      throw error;
    }
  }
  static async createPigletRecord(piglets, farm_id, userId) {
    const { pigletz } = piglets;
    try {
      // Validate farm exists
      const farmResult = await DatabaseHelper.executeQuery(
        "SELECT id FROM farms WHERE id = $1 AND is_deleted = 0",
        [farm_id]
      );
      if (farmResult.rows.length === 0) {
        throw new ValidationError("Farm not found");
      }

      // Validate pigletz array
      if (!Array.isArray(pigletz) || pigletz.length === 0) {
        throw new ValidationError(
          "pigletz array is required and must not be empty"
        );
      }

      // Validate each piglet has required fields (only piglet_number and breeding_record_id are mandatory)
      for (const piglet of pigletz) {
        if (!piglet.breeding_record_id) {
          throw new ValidationError(
            "breeding_record_id is required for each piglet"
          );
        }
        if (!piglet.piglet_number) {
          throw new ValidationError(
            "piglet_number is required for each piglet"
          );
        }
      }

      // Validate breeding_record_id
      const breedingRecordIds = [
        ...new Set(pigletz.map(piglet => piglet.breeding_record_id)),
      ];
      const breedingResult = await DatabaseHelper.executeQuery(
        "SELECT id, sow_id, number_of_piglets FROM breeding_records WHERE id = ANY($1) AND farm_id = $2 AND is_deleted = 0",
        [breedingRecordIds, farm_id]
      );
      if (breedingResult.rows.length !== breedingRecordIds.length) {
        throw new ValidationError("One or more breeding records not found");
      }

      // Validate number of pigletz sowsn't exceed breeding record (with some flexibility)
      for (const record of breedingResult.rows) {
        const existingPiglets = await DatabaseHelper.executeQuery(
          "SELECT COUNT(*) FROM piglet_records WHERE breeding_record_id = $1 AND is_deleted = 0",
          [record.id]
        );
        const currentPigletCount = parseInt(existingPiglets.rows[0].count) || 0;
        const newPigletsForRecord = pigletz.filter(
          piglet => piglet.breeding_record_id === record.id
        ).length;

        // Allow some flexibility - warn but don't block if slightly over
        if (
          currentPigletCount + newPigletsForRecord >
          (record.number_of_piglets || 0) + 1
        ) {
          throw new ValidationError(
            `Total piglets significantly exceed breeding record litter size for breeding record ${record.id}`
          );
        }
      }

      // Validate unique piglet_numbers
      const pigletNumbers = pigletz
        .map(piglet => piglet.piglet_number)
        .filter(num => num);
      if (!pigletNumbers.length) {
        throw new ValidationError(
          "At least one valid piglet number is required"
        );
      }
      const existingPiglets = await DatabaseHelper.executeQuery(
        "SELECT piglet_number FROM piglet_records WHERE farm_id = $1 AND piglet_number = ANY($2) AND is_deleted = 0",
        [farm_id, pigletNumbers]
      );
      const duplicates = existingPiglets.rows.map(row => row.piglet_number);
      if (duplicates.length > 0) {
        throw new ValidationError(
          `Duplicate piglet numbers: ${duplicates.join(", ")}`
        );
      }

      // Validate parent IDs (only if provided)
      const parentIds = [
        ...new Set(
          pigletz
            .map(piglet => [piglet.parent_male_id, piglet.parent_female_id])
            .flat()
            .filter(id => id)
        ),
      ];
      if (parentIds.length > 0) {
        const parentResult = await DatabaseHelper.executeQuery(
          "SELECT pig_id, gender FROM pigs WHERE farm_id = $1 AND pig_id = ANY($2) AND is_deleted = 0",
          [farm_id, parentIds]
        );
        const foundIds = parentResult.rows.map(row => ({
          pig_id: row.pig_id,
          gender: row.gender,
        }));
        const missingIds = parentIds.filter(
          id => !foundIds.find(f => f.pig_id === id)
        );
        if (missingIds.length > 0) {
          console.warn(`Some parent IDs not found: ${missingIds.join(", ")}`);
          throw new ValidationError(
            `Invalid parent IDs: ${missingIds.join(", ")}`
          );
        }

        // Validate sow is female (if sow ID is provided and found)
        const sowId = pigletz[0].parent_female_id;
        if (sowId) {
          const sow = foundIds.find(f => f.pig_id === sowId);
          if (!sow || sow.gender !== "female") {
            throw new ValidationError(`Parent female ID ${sowId} is not a sow`);
          }
        }
      }

      // Create or update pig_birth_history
      const insertedPiglets = [];
      for (const piglet of pigletz) {
        const {
          breeding_record_id,
          piglet_number,
          birth_weight,
          gender,
          color,
          status,
          parent_male_id,
          parent_female_id,
          notes,
          actual_birth_date,
        } = piglet;

        // Validate breeding record matches sow and birth date
        const breedingRecord = breedingResult.rows.find(
          row => row.id === breeding_record_id
        );
        if (!breedingRecord) {
          throw new ValidationError(
            `Breeding record ${breeding_record_id} not found`
          );
        }
        // Only validate sow match if parent_female_id is provided
        if (breedingRecord.sow_id !== piglet.parent_female_id) {
          throw new ValidationError(
            `Breeding record ${breeding_record_id} sows not match sow ${piglet.parent_female_id}`
          );
        }

        // Calculate weaning date (only if birth date is provided)
        let weaningDate = null;
        if (actual_birth_date) {
          const actualBirthDateUTC = dayjs(actual_birth_date).utc();
          weaningDate = actualBirthDateUTC.add(42, "day").toDate();
        }

        // Insert into pig_birth_history if not exists
        const birthHistoryResult = await DatabaseHelper.executeQuery(
          `SELECT id FROM pig_birth_history
                 WHERE breeding_record_id = $1 AND is_deleted = 0`,
          [breeding_record_id]
        );
        let birthHistoryId = birthHistoryResult.rows[0]?.id;
        if (!birthHistoryId) {
          birthHistoryId = uuidv4();
          const newPigHistory = await DatabaseHelper.executeQuery(
            `INSERT INTO pig_birth_history (
                       id, farm_id, sow_id, breeding_record_id, birth_date, number_of_piglets, notes, created_at, is_deleted
                     ) VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP, 0)`,
            [
              birthHistoryId,
              farm_id,
              piglet.parent_female_id || breedingRecord.sow_id,
              breeding_record_id,
              actual_birth_date,
              pigletz.filter(k => k.breeding_record_id === breeding_record_id)
                .length,
              notes || null,
            ]
          );
        }

        // Insert piglet with flexible validation
        const result = await DatabaseHelper.executeQuery(
          `INSERT INTO piglet_records (
                   id, breeding_record_id, farm_id, piglet_number, birth_weight, gender, color, status,
                   weaning_date, parent_male_id, parent_female_id, notes, created_at, updated_at, is_deleted
                 ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0)
                 RETURNING id, piglet_number`,
          [
            uuidv4(),
            breeding_record_id,
            farm_id,
            piglet_number,
            birth_weight || null,
            gender || null,
            color || null,
            status || "alive",
            weaningDate,
            parent_male_id || null,
            parent_female_id || null,
            notes || null,
          ]
        );
        insertedPiglets.push(result.rows[0]);
      }

      // Create alert for relocating piglets post-weaning
      const actualBirthDateUTC = dayjs(pigletz[0].actual_birth_date).utc();
      const weaningDate = actualBirthDateUTC.add(42, "day").toDate();
      const penResult = await DatabaseHelper.executeQuery(
        "SELECT pen_id FROM pigs WHERE pig_id = $1 AND farm_id = $2 AND is_deleted = 0",
        [pigletz[0].parent_female_id, farm_id]
      );
      const pen_id = penResult.rows[0]?.pen_id;

      await AlertService.createAlert({
        farm_id,
        user_id: userId,
        pig_id: pigletz[0].parent_female_id,
        pen_id,
        name: `Relocate Piglets for ${pigletz[0].parent_female_id}`,
        alert_start_date: getUTCDateString(weaningDate) + "T00:00:00Z",
        alert_type: "birth",
        severity: "medium",
        message: `Relocate piglets for pig ${
          pigletz[0].parent_female_id
        } to individual pens by ${formatLocalDate(
          weaningDate,
          "Africa/Nairobi"
        )}`,
        notify_on: [
          getUTCDateString(dayjs(weaningDate).subtract(1, "day").toDate()),
          getUTCDateString(weaningDate),
        ],
      });
      logger.info(
        `Created ${insertedPiglets.length} piglets for farm ${farm_id} by user ${userId}`
      );
      return {
        success: true,
        message: `${insertedPiglets.length} piglets created successfully`,
        data: insertedPiglets,
      };
    } catch (error) {
      logger.error(
        `Error creating bulk piglets for farm ${farm_id}: ${error.message}`
      );
      return {
        success: false,
        message: error.message || "Failed to create piglets",
      };
    }
  }

  static async updatePigletRecord(pigletId, updateData, userId) {
    const {
      weaning_weight,
      status,
      notes,
      parent_male_id,
      parent_female_id,
      birth_weight,
      gender,
      color,
    } = updateData;

    try {
      const pigletResult = await DatabaseHelper.executeQuery(
        "SELECT piglet_number, breeding_record_id, farm_id FROM piglet_records WHERE id = $1 AND is_deleted = 0",
        [pigletId]
      );
      if (pigletResult.rows.length === 0) {
        throw new ValidationError("Piglet record not found");
      }
      const pigletRecord = pigletResult.rows[0];

      // Validate parent IDs if provided (flexible validation)
      if (parent_male_id) {
        const maleResult = await DatabaseHelper.executeQuery(
          "SELECT pig_id FROM pigs WHERE pig_id = $1 AND farm_id = $2 AND is_deleted = 0",
          [parent_male_id, pigletRecord.farm_id]
        );
        if (maleResult.rows.length === 0) {
          console.warn(
            `Parent male pig ${parent_male_id} not found, but allowing update`
          );
        }
      }
      if (parent_female_id) {
        const femaleResult = await DatabaseHelper.executeQuery(
          "SELECT pig_id, gender FROM pigs WHERE pig_id = $1 AND farm_id = $2 AND is_deleted = 0",
          [parent_female_id, pigletRecord.farm_id]
        );
        if (femaleResult.rows.length === 0) {
          console.warn(
            `Parent female pig ${parent_female_id} not found, but allowing update`
          );
        } else if (femaleResult.rows[0].gender !== "female") {
          throw new ValidationError("Parent female pig must be a sow (female)");
        }
      }

      // Validate birth_weight if provided
      if (
        birth_weight !== undefined &&
        birth_weight !== null &&
        birth_weight !== ""
      ) {
        const weightNum = parseFloat(birth_weight);
        if (isNaN(weightNum) || weightNum <= 0) {
          throw new ValidationError("Birth weight must be a positive number");
        }
      }

      // Validate weaning_weight if provided
      if (
        weaning_weight !== undefined &&
        weaning_weight !== null &&
        weaning_weight !== ""
      ) {
        const weightNum = parseFloat(weaning_weight);
        if (isNaN(weightNum) || weightNum <= 0) {
          throw new ValidationError("Weaning weight must be a positive number");
        }
      }

      const updatedPigletResult = await DatabaseHelper.executeQuery(
        `UPDATE piglet_records
                 SET weaning_weight = $1, status = $2, notes = $3, parent_male_id = $4, parent_female_id = $5, updated_at = CURRENT_TIMESTAMP
                 WHERE id = $6 AND is_deleted = 0
                 RETURNING *`,
        [
          weaning_weight || null,
          status || null,
          notes || null,
          parent_male_id || null,
          parent_female_id || null,
          pigletId,
        ]
      );

      if (updatedPigletResult.rows.length === 0) {
        throw new ValidationError(
          "Piglet record not found or could not be updated"
        );
      }

      const updatedPiglet = updatedPigletResult.rows[0];
      logger.info(`Piglet record ${pigletId} updated by user ${userId}`);
      return updatedPiglet;
    } catch (error) {
      logger.error(
        `Error updating piglet record ${pigletId}: ${error.message}`
      );
      throw error;
    }
  }
}

export default BreedingService;
