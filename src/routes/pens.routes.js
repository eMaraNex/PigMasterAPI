import express from "express";
import PensController from "../controllers/pens.controllers.js";
// import authMiddleware from '../middleware/auth.js';
import { validateRequest } from "../middleware/validateRequest.js";
import { penSchema, penUpdateSchema } from "../utils/validator.js";
import authMiddleware from "../middleware/auth.middleware.js";
import { requireActiveSubscription } from "../middleware/subscription.middleware.js";

const router = express.Router();
const enforceActivePlan = requireActiveSubscription();

/**
 * @swagger
 * components:
 *   schemas:
 *     Pen:
 *       type: object
 *       required:
 *         - id
 *         - farm_id
 *         - level
 *         - position
 *         - size
 *         - material
 *       properties:
 *         id:
 *           type: string
 *           description: The unique ID of the pen (e.g., Mercury-A1)
 *         farm_id:
 *           type: string
 *           format: uuid
 *           description: The ID of the farm this pen belongs to
 *         row_id:
 *           type: string
 *           format: uuid
 *           description: The ID of the row this pen belongs to (optional for standalone pens)
 *           nullable: true
 *         row_name:
 *           type: string
 *           description: The name of the row this pen belongs to (read-only, from JOIN)
 *           nullable: true
 *         level:
 *           type: string
 *           enum: [A, B, C]
 *           description: The level of the pen
 *         position:
 *           type: integer
 *           description: The position of the pen in the row
 *         size:
 *           type: string
 *           enum: [small, medium, large]
 *           description: The size of the pen
 *         material:
 *           type: string
 *           enum: [wire, wood, plastic]
 *           description: The material of the pen
 *         features:
 *           type: array
 *           items:
 *             type: string
 *           description: List of features in the pen
 *           nullable: true
 *         is_occupied:
 *           type: boolean
 *           description: Whether the pen is occupied
 *         last_cleaned:
 *           type: string
 *           format: date-time
 *           description: The last cleaning timestamp
 *           nullable: true
 *         is_deleted:
 *           type: integer
 *           enum: [0, 1]
 *           description: Soft delete flag (0 = active, 1 = deleted)
 *         created_at:
 *           type: string
 *           format: date-time
 *           description: Creation timestamp
 *         updated_at:
 *           type: string
 *           format: date-time
 *           description: Last update timestamp
 *       example:
 *         id: Mercury-A1
 *         farm_id: 123e4567-e89b-12d3-a456-426614174000
 *         row_id: 456e7890-e89b-12d3-a456-426614174001
 *         row_name: Mercury
 *         level: A
 *         position: 1
 *         size: medium
 *         material: wire
 *         features: ["water bottle", "feeder"]
 *         is_occupied: false
 *         last_cleaned: null
 *         is_deleted: 0
 *         created_at: 2024-01-01T00:00:00Z
 *         updated_at: 2024-01-01T00:00:00Z
 *   securitySchemes:
 *     bearerAuth:
 *       type: http
 *       scheme: bearer
 *       bearerFormat: JWT
 */

/**
 * @swagger
 * /api/v1/pens/{farmId}:
 *   post:
 *     summary: Create a new pen
 *     tags: [Pens]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: farmId
 *         schema:
 *           type: string
 *           format: uuid
 *         required: true
 *         description: The ID of the farm
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - id
 *               - level
 *               - position
 *               - size
 *               - material
 *             properties:
 *               id:
 *                 type: string
 *                 description: The unique ID of the pen
 *               row_id:
 *                 type: string
 *                 format: uuid
 *                 description: The ID of the row (optional)
 *                 nullable: true
 *               level:
 *                 type: string
 *                 enum: [A, B, C]
 *                 description: The level of the pen
 *               position:
 *                 type: integer
 *                 description: The position of the pen
 *               size:
 *                 type: string
 *                 enum: [small, medium, large]
 *                 description: The size of the pen
 *               material:
 *                 type: string
 *                 enum: [wire, wood, plastic]
 *                 description: The material of the pen
 *               features:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: List of features
 *                 nullable: true
 *               is_occupied:
 *                 type: boolean
 *                 description: Whether the pen is occupied
 *               last_cleaned:
 *                 type: string
 *                 format: date-time
 *                 description: The last cleaning timestamp
 *                 nullable: true
 *             example:
 *               id: Mercury-A1
 *               row_id: 456e7890-e89b-12d3-a456-426614174001
 *               level: A
 *               position: 1
 *               size: medium
 *               material: wire
 *               features: ["water bottle", "feeder"]
 *               is_occupied: false
 *               last_cleaned: null
 *     responses:
 *       201:
 *         description: Pen created successfully
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
 *                   example: Pen created successfully
 *                 data:
 *                   $ref: '#/components/schemas/Pen'
 *       400:
 *         description: Invalid input
 *       409:
 *         description: Pen already exists
 *       401:
 *         description: Unauthorized
 */
// router.post('/:farmId', authMiddleware, enforceActivePlan, validateRequest(penSchema), PensController.createPen);
router.post(
  "/:farmId",
  authMiddleware,
  enforceActivePlan,
  PensController.createPen
);

/**
 * @swagger
 * /api/v1/pens/{farmId}/{id}:
 *   get:
 *     summary: Get a pen by ID
 *     tags: [Pens]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: farmId
 *         schema:
 *           type: string
 *           format: uuid
 *         required: true
 *         description: The ID of the farm
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *         required: true
 *         description: The pen ID (e.g., Mercury-A1)
 *     responses:
 *       200:
 *         description: Pen retrieved successfully
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
 *                   example: Pen retrieved successfully
 *                 data:
 *                   $ref: '#/components/schemas/Pen'
 *       404:
 *         description: Pen not found
 *       401:
 *         description: Unauthorized
 */
router.get(
  "/:farmId/:id",
  authMiddleware,
  // enforceActivePlan,
  PensController.getPen
);

/**
 * @swagger
 * /api/v1/pens/{farmId}:
 *   get:
 *     summary: Get all pens for a farm
 *     tags: [Pens]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: farmId
 *         schema:
 *           type: string
 *           format: uuid
 *         required: true
 *         description: The ID of the farm
 *       - in: query
 *         name: rowId
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Filter by row ID
 *       - in: query
 *         name: rowName
 *         schema:
 *           type: string
 *         description: Filter by row name
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         description: Number of pens to return
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *         description: Number of pens to skip
 *       - in: query
 *         name: is_occupied
 *         schema:
 *           type: boolean
 *         description: Filter by occupied status
 *     responses:
 *       200:
 *         description: Pens retrieved successfully
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
 *                   example: Pens retrieved successfully
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Pen'
 *       401:
 *         description: Unauthorized
 */
router.get(
  "/:farmId",
  authMiddleware,
  // enforceActivePlan,
  PensController.getAllPens
);

/**
 * @swagger
 * /api/v1/pens/{farmId}/{id}:
 *   put:
 *     summary: Update a pen
 *     tags: [Pens]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: farmId
 *         schema:
 *           type: string
 *           format: uuid
 *         required: true
 *         description: The ID of the farm
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *         required: true
 *         description: The pen ID (e.g., Mercury-A1)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               row_id:
 *                 type: string
 *                 format: uuid
 *                 description: The ID of the row (optional)
 *                 nullable: true
 *               level:
 *                 type: string
 *                 enum: [A, B, C]
 *                 description: The level of the pen
 *               position:
 *                 type: integer
 *                 description: The position of the pen
 *               size:
 *                 type: string
 *                 enum: [small, medium, large]
 *                 description: The size of the pen
 *               material:
 *                 type: string
 *                 enum: [wire, wood, plastic]
 *                 description: The material of the pen
 *               features:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: List of features
 *                 nullable: true
 *               is_occupied:
 *                 type: boolean
 *                 description: Whether the pen is occupied
 *               last_cleaned:
 *                 type: string
 *                 format: date-time
 *                 description: The last cleaning timestamp
 *                 nullable: true
 *             example:
 *               row_id: 456e7890-e89b-12d3-a456-426614174001
 *               level: A
 *               position: 1
 *               size: medium
 *               material: wire
 *               features: ["water bottle", "feeder"]
 *               is_occupied: false
 *               last_cleaned: null
 *     responses:
 *       200:
 *         description: Pen updated successfully
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
 *                   example: Pen updated successfully
 *                 data:
 *                   $ref: '#/components/schemas/Pen'
 *       400:
 *         description: Invalid input
 *       404:
 *         description: Pen not found
 *       401:
 *         description: Unauthorized
 */
router.put(
  "/:farmId/:id",
  authMiddleware,
  enforceActivePlan,
  validateRequest(penUpdateSchema),
  PensController.updatePen
);

/**
 * @swagger
 * /api/v1/pens/{farmId}/{id}:
 *   delete:
 *     summary: Soft delete a pen
 *     tags: [Pens]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: farmId
 *         schema:
 *           type: string
 *           format: uuid
 *         required: true
 *         description: The ID of the farm
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *         required: true
 *         description: The pen ID (e.g., Mercury-A1)
 *     responses:
 *       200:
 *         description: Pen soft deleted successfully
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
 *                   example: Pen soft deleted successfully
 *                 data:
 *                   $ref: '#/components/schemas/Pen'
 *       404:
 *         description: Pen not found
 *       401:
 *         description: Unauthorized
 */
router.delete(
  "/:farmId/:id",
  authMiddleware,
  enforceActivePlan,
  PensController.deletePen
);

/**
 * @swagger
 * /api/v1/pens/{farmId}/{penId}/history:
 *   get:
 *     summary: Get history of pigs removed from a pen
 *     tags: [Pens]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: farmId
 *         schema:
 *           type: string
 *           format: uuid
 *         required: true
 *         description: The ID of the farm
 *       - in: path
 *         name: penId
 *         schema:
 *           type: string
 *         required: true
 *         description: The pen ID (e.g., Mercury-A1)
 *     responses:
 *       200:
 *         description: Pen pig history retrieved successfully
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
 *                   example: Pen pig history retrieved successfully
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                         format: uuid
 *                       pen_id:
 *                         type: string
 *                       pig_id:
 *                         type: string
 *                       pig_name:
 *                         type: string
 *                       farm_id:
 *                         type: string
 *                         format: uuid
 *                       assigned_at:
 *                         type: string
 *                         format: date-time
 *                       removed_at:
 *                         type: string
 *                         format: date-time
 *                       removal_reason:
 *                         type: string
 *                       removal_notes:
 *                         type: string
 *                       sale_amount:
 *                         type: number
 *                       sale_date:
 *                         type: string
 *                         format: date
 *                       sale_weight:
 *                         type: number
 *                       sold_to:
 *                         type: string
 *       404:
 *         description: Pen not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: Pen not found
 *       401:
 *         description: Unauthorized
 */
router.get(
  "/:farmId/:penId/history",
  authMiddleware,
  // enforceActivePlan,
  PensController.getPenRemovedPigHistory
);

export default router;
