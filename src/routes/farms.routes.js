import express from 'express';
import FarmsController from '../controllers/farms.controllers.js';
import { validateRequest } from '../middleware/validateRequest.js';
import { farmSchema, farmUpdateSchema } from '../utils/validator.js';
import authMiddleware from '../middleware/auth.middleware.js';

const router = express.Router();

/**
 * @swagger
 * components:
 *   schemas:
 *     Farm:
 *       type: object
 *       required:
 *         - name
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *           description: The unique ID of the farm (auto-generated)
 *         name:
 *           type: string
 *           description: The name of the farm
 *         location:
 *           type: string
 *           description: The physical location or address of the farm
 *           nullable: true
 *         latitude:
 *           type: number
 *           description: The latitude coordinate of the farm
 *           nullable: true
 *         longitude:
 *           type: number
 *           description: The longitude coordinate of the farm
 *           nullable: true
 *         size:
 *           type: number
 *           description: The size of the farm in square meters
 *           nullable: true
 *         description:
 *           type: string
 *           description: Optional description of the farm
 *           nullable: true
 *         timezone:
 *           type: string
 *           description: The timezone of the farm (e.g., UTC, America/New_York)
 *           default: UTC
 *         created_by:
 *           type: string
 *           format: uuid
 *           description: The ID of the user who created the farm
 *         created_at:
 *           type: string
 *           format: date-time
 *           description: Creation timestamp
 *         updated_at:
 *           type: string
 *           format: date-time
 *           description: Last update timestamp
 *         is_deleted:
 *           type: integer
 *           enum: [0, 1]
 *           description: Soft delete flag (0 = active, 1 = deleted)
 *       example:
 *         id: 123e4567-e89b-12d3-a456-426614174000
 *         name: Sunny Acres
 *         location: 123 Farm Road, Springfield
 *         latitude: 40.7128
 *         longitude: -74.0060
 *         size: 1000
 *         description: Main pig breeding farm
 *         timezone: America/New_York
 *         created_by: 987fcdeb-4321-56ef-1234-567890abcdef
 *         created_at: 2025-01-01T00:00:00Z
 *         updated_at: 2025-01-01T00:05:00Z
 *         is_deleted: 0
 *   securitySchemes:
 *     bearerAuth:
 *       type: http
 *       scheme: bearer
 *       bearerFormat: JWT
 */

/**
 * @swagger
 * /api/v1/farms:
 *   post:
 *     summary: Create a new farm
 *     tags: [Farms]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Farm'
 *     responses:
 *       201:
 *         description: Farm created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Farm created successfully
 *                 data:
 *                   $ref: '#/components/schemas/Farm'
 *       400:
 *         description: Invalid input
 *       409:
 *         description: Farm name already exists
 *       401:
 *         description: Unauthorized
 */
router.post('/', authMiddleware, validateRequest(farmSchema), FarmsController.createFarm);

/**
 * @swagger
 * /api/v1/farms/{farmId}:
 *   get:
 *     summary: Get a farm by ID
 *     tags: [Farms]
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
 *         description: Farm retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Farm retrieved successfully
 *                 data:
 *                   $ref: '#/components/schemas/Farm'
 *       404:
 *         description: Farm not found
 *       401:
 *         description: Unauthorized
 */
router.get('/:farmId', authMiddleware, FarmsController.getFarmById);

/**
 * @swagger
 * /api/v1/farms:
 *   get:
 *     summary: Get all farms for a user
 *     tags: [Farms]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of farms retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Farms retrieved successfully
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Farm'
 *       401:
 *         description: Unauthorized
 */
router.get('/', authMiddleware, FarmsController.getAllFarms);

/**
 * @swagger
 * /api/v1/farms/{farmId}:
 *   put:
 *     summary: Update a farm
 *     tags: [Farms]
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
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 description: Updated name of the farm
 *               location:
 *                 type: string
 *                 description: Updated location of the farm
 *                 nullable: true
 *               latitude:
 *                 type: number
 *                 description: Updated latitude coordinate
 *                 nullable: true
 *               longitude:
 *                 type: number
 *                 description: Updated longitude coordinate
 *                 nullable: true
 *               size:
 *                 type: number
 *                 description: Updated size in square meters
 *                 nullable: true
 *               description:
 *                 type: string
 *                 description: Updated description
 *                 nullable: true
 *               timezone:
 *                 type: string
 *                 description: Updated timezone
 *             example:
 *               name: Sunny Acres Updated
 *               location: 456 Farm Lane, Springfield
 *               latitude: 40.7128
 *               longitude: -74.0060
 *               size: 1500
 *               description: Updated pig breeding farm
 *               timezone: America/New_York
 *     responses:
 *       200:
 *         description: Farm updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Farm updated successfully
 *                 data:
 *                   $ref: '#/components/schemas/Farm'
 *       400:
 *         description: Invalid input
 *       404:
 *         description: Farm not found
 *       401:
 *         description: Unauthorized
 */
router.put('/:farmId', authMiddleware, validateRequest(farmUpdateSchema), FarmsController.updateFarm);

/**
 * @swagger
 * /api/v1/farms/{farmId}:
 *   delete:
 *     summary: Soft delete a farm
 *     tags: [Farms]
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
 *         description: Farm deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Farm deleted successfully
 *                 data:
 *                   $ref: '#/components/schemas/Farm'
 *       404:
 *         description: Farm not found
 *       401:
 *         description: Unauthorized
 */
router.delete('/:farmId', authMiddleware, FarmsController.deleteFarm);

export default router;