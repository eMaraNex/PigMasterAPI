import express from 'express';
import BreedingController from '../controllers/breed.controllers.js';
import authMiddleware from '../middleware/auth.middleware.js';
import { requireActiveSubscription } from '../middleware/subscription.middleware.js';
import { validateRequest } from '../middleware/validateRequest.js';
import { breedingSchema, breedingUpdateSchema, kitSchema, kitUpdateSchema } from '../utils/validator.js';

const router = express.Router();
const enforceActivePlan = requireActiveSubscription();

/**
 * @swagger
 * components:
 *   schemas:
 *     BreedingRecord:
 *       type: object
 *       required:
 *         - farm_id
 *         - sow_id
 *         - boar_id
 *         - mating_date
 *         - expected_birth_date
 *       properties:
 *         farm_id:
 *           type: string
 *           format: uuid
 *           description: The ID of the farm
 *         sow_id:
 *           type: string
 *           description: The ID of the sow (female pig)
 *         boar_id:
 *           type: string
 *           description: The ID of the boar (male pig)
 *         mating_date:
 *           type: string
 *           format: date
 *           description: The date of mating
 *         expected_birth_date:
 *           type: string
 *           format: date
 *           description: The expected birth date
 *         actual_birth_date:
 *           type: string
 *           format: date
 *           description: The actual birth date
 *           nullable: true
 *         number_of_kits:
 *           type: integer
 *           description: Number of kits born
 *           nullable: true
 *         notes:
 *           type: string
 *           description: Additional notes
 *           nullable: true
 *         alert_date:
 *           type: string
 *           format: date
 *           description: Date for pregnancy confirmation alert
 *         is_deleted:
 *           type: integer
 *           enum: [0, 1]
 *           description: Soft delete flag
 *         created_at:
 *           type: string
 *           format: date-time
 *           description: Creation timestamp
 *         updated_at:
 *           type: string
 *           format: date-time
 *           description: Last update timestamp
 *         kits:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/KitRecord'
 *       example:
 *         farm_id: 123e4567-e89b-12d3-a456-426614174000
 *         sow_id: A1
 *         boar_id: A7
 *         mating_date: 2025-06-03
 *         expected_birth_date: 2025-07-01
 *         actual_birth_date: 2025-07-01
 *         number_of_kits: 6
 *         notes: Successful mating
 *         alert_date: 2025-06-24
 *         is_deleted: 0
 *         created_at: 2025-06-03T02:13:00Z
 *         updated_at: 2025-06-03T02:13:00Z
 *         kits:
 *           - id: 987fcdeb-4567-89ab-cdef-0123456789ab
 *             kit_number: 1
 *             birth_weight: 0.75
 *             gender: male
 *             color: white
 *             status: alive
 *             weaning_date: 2025-08-12
 *             weaning_weight: 1.5
 *             notes: Healthy kit
 *     KitRecord:
 *       type: object
 *       required:
 *         - breeding_record_id
 *         - kit_number
 *         - birth_weight
 *         - gender
 *         - color
 *       properties:
 *         breeding_record_id:
 *           type: string
 *           format: uuid
 *           description: The ID of the breeding record
 *         kit_number:
 *           type: integer
 *           description: The kit's number in the litter
 *         birth_weight:
 *           type: number
 *           description: Birth weight in kilograms
 *         gender:
 *           type: string
 *           enum: [male, female]
 *           description: The gender of the kit
 *         color:
 *           type: string
 *           description: The color of the kit
 *         status:
 *           type: string
 *           description: The status of the kit (e.g., alive, deceased)
 *         weaning_date:
 *           type: string
 *           format: date
 *           description: The weaning date
 *         weaning_weight:
 *           type: number
 *           description: Weight at weaning in kilograms
 *           nullable: true
 *         notes:
 *           type: string
 *           description: Additional notes
 *           nullable: true
 *         is_deleted:
 *           type: integer
 *           enum: [0, 1]
 *           description: Soft delete flag
 *         created_at:
 *           type: string
 *           format: date-time
 *           description: Creation timestamp
 *         updated_at:
 *           type: string
 *           format: date-time
 *           description: Last update timestamp
 *       example:
 *         breeding_record_id: 123e4567-e89b-12d3-a456-426614174000
 *         kit_number: 1
 *         birth_weight: 0.75
 *         gender: male
 *         color: white
 *         status: alive
 *         weaning_date: 2025-08-12
 *         weaning_weight: 1.5
 *         notes: Healthy kit
 *         is_deleted: 0
 *         created_at: 2025-07-01T02:13:00Z
 *         updated_at: 2025-07-01T02:13:00Z
 */

/**
 * @swagger
 * /api/v1/breeding:
 *   post:
 *     summary: Create a new breeding record
 *     tags:
 *       - Breeding
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/BreedingRecord'
 *     responses:
 *       201:
 *         description: Breeding record created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   $ref: '#/components/schemas/BreedingRecord'
 *       400:
 *         description: Invalid input
 *       401:
 *         description: Unauthorized
 */
router.post('/:farmId', authMiddleware, enforceActivePlan, validateRequest(breedingSchema), BreedingController.createBreedingRecord);

/**
 * @swagger
 * /api/v1/breeding/{farmId}:
 *   get:
 *     summary: Get all breeding records for a farm
 *     tags:
 *       - Breeding
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: farmId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: The ID of the farm
 *     responses:
 *       200:
 *         description: Breeding records retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/BreedingRecord'
 *       401:
 *         description: Unauthorized
 */
router.get('/:farmId', authMiddleware, enforceActivePlan, BreedingController.getAllBreedingRecords);

/**
 * @swagger
 * /api/v1/breeding/{farmId}/{recordId}:
 *   get:
 *     summary: Get a breeding record by ID
 *     tags:
 *       - Breeding
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: farmId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: The ID of the farm
 *       - in: path
 *         name: recordId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: The ID of the breeding record
 *     responses:
 *       200:
 *         description: Breeding record retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   $ref: '#/components/schemas/BreedingRecord'
 *       404:
 *         description: Breeding record not found
 *       401:
 *         description: Unauthorized
 */
router.get('/:farmId/:recordId', authMiddleware, enforceActivePlan, BreedingController.getBreedingRecordById);

/**
 * @swagger
 * /api/v1/breeding/{farmId}/{recordId}:
 *   put:
 *     summary: Update a breeding record
 *     tags:
 *       - Breeding
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: farmId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: The ID of the farm
 *       - in: path
 *         name: recordId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: The ID of the breeding record
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               actual_birth_date:
 *                 type: string
 *                 format: date
 *               number_of_kits:
 *                 type: integer
 *               notes:
 *                 type: string
 *                 nullable: true
 *     responses:
 *       200:
 *         description: Breeding record updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   $ref: '#/components/schemas/BreedingRecord'
 *       400:
 *         description: Invalid input
 *       404:
 *         description: Breeding record not found
 *       401:
 *         description: Unauthorized
 */
router.put('/:farmId/:recordId', authMiddleware, enforceActivePlan, validateRequest(breedingUpdateSchema), BreedingController.updateBreedingRecord);

/**
 * @swagger
 * /api/v1/breeding/{farmId}/{recordId}:
 *   delete:
 *     summary: Soft delete a breeding record
 *     tags:
 *       - Breeding
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: farmId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: The ID of the farm
 *       - in: path
 *         name: recordId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: The ID of the breeding record
 *     responses:
 *       200:
 *         description: Breeding record deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                       format: uuid
 *       404:
 *         description: Breeding record not found
 *       401:
 *         description: Unauthorized
 */
router.delete('/:farmId/:recordId', authMiddleware, enforceActivePlan, BreedingController.deleteBreedingRecord);

/**
 * @swagger
 * /api/v1/breeding/kits/{breedingRecordId}:
 *   post:
 *     summary: Create a new kit record
 *     tags:
 *       - Breeding
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: breedingRecordId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: The ID of the breeding record
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/KitRecord'
 *     responses:
 *       201:
 *         description: Kit record created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   $ref: '#/components/schemas/KitRecord'
 *       400:
 *         description: Invalid input
 *       401:
 *         description: Unauthorized
 */
router.post('/kits/:farmId', authMiddleware, enforceActivePlan, BreedingController.createKitRecord);
// router.post('/kits/:farmId', authMiddleware, enforceActivePlan, validateRequest(kitSchema), BreedingController.createKitRecord);

/**
 * @swagger
 * /api/v1/breeding/kits/{kitId}:
 *   put:
 *     summary: Update a kit record
 *     tags:
 *       - Breeding
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: kitId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: The ID of the kit record
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               weaning_weight:
 *                 type: number
 *               status:
 *                 type: string
 *               notes:
 *                 type: string
 *                 nullable: true
 *     responses:
 *       200:
 *         description: Kit record updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   $ref: '#/components/schemas/KitRecord'
 *       400:
 *         description: Invalid input
 *       404:
 *         description: Kit record not found
 *       401:
 *         description: Unauthorized
 */
router.put('/kits/:kitId', authMiddleware, enforceActivePlan, validateRequest(kitUpdateSchema), BreedingController.updateKitRecord);

// Get breeding history of a single pig using its pig id.
router.get('/history/:farmId/:pigId', authMiddleware, enforceActivePlan, BreedingController.getBreedingHistoryByPigId);

export default router;