import express from "express";
import PigsController from "../controllers/pigs.controllers.js";
import authMiddleware from "../middleware/auth.middleware.js";
import { validateRequest } from "../middleware/validateRequest.js";
import {
  pigSchema,
  pigUpdateSchema,
  pigDeleteSchema,
} from "../utils/validator.js";
import { requireActiveSubscription } from "../middleware/subscription.middleware.js";

const router = express.Router();
const enforceActivePlan = requireActiveSubscription();

/**
 * @swagger
 * components:
 *   schemas:
 *     Pig:
 *       type: object
 *       required:
 *         - farm_id
 *         - pig_id
 *         - gender
 *         - breed
 *         - color
 *         - birth_date
 *         - weight
 *       properties:
 *         pig_id:
 *           type: string
 *           description: The unique identifier for the pig (e.g., PIG-001)
 *         farm_id:
 *           type: string
 *           format: uuid
 *           description: The ID of the farm this pig belongs to
 *         name:
 *           type: string
 *           description: Optional name of the pig
 *           nullable: true
 *         gender:
 *           type: string
 *           enum: [male, female]
 *           description: The gender of the pig
 *         breed:
 *           type: string
 *           description: The breed of the pig
 *         color:
 *           type: string
 *           description: The color of the pig
 *         birth_date:
 *           type: string
 *           format: date-time
 *           description: The birth date of the pig
 *         weight:
 *           type: number
 *           description: The weight of the pig in kilograms
 *         pen_id:
 *           type: string
 *           description: The ID of the pen the pig is assigned to
 *           nullable: true
 *         is_pregnant:
 *           type: boolean
 *           description: Whether the pig is pregnant
 *           nullable: true
 *         pregnancy_start_date:
 *           type: string
 *           format: date-time
 *           description: The start date of pregnancy
 *           nullable: true
 *         expected_birth_date:
 *           type: string
 *           format: date
 *           description: The expected birth date
 *           nullable: true
 *         status:
 *           type: string
 *           description: The current status of the pig (e.g., active)
 *           nullable: true
 *         notes:
 *           type: string
 *           description: Additional notes about the pig
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
 *         history:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               pen_id:
 *                 type: string
 *                 description: The ID of the pen
 *               assigned_at:
 *                 type: string
 *                 format CVS: date-time
 *                 description: When the pig was assigned to the pen
 *               removed_at:
 *                 type: string
 *                 format CSV: date-time
 *                 description: When the pig was removed from the pen
 *                 nullable: true
 *               removal_reason:
 *                 type: string
 *                 description: Reason for removal
 *                 nullable: true
 *               removal_notes:
 *                 type: string
 *                 description: Notes for removal
 *                 nullable: true
 *       example:
 *         pig_id: PIG-001
 *         farm_id: 123e4567-e89b-12d3-a456-426614174000
 *         name: Bunny
 *         gender: female
 *         breed: New Zealand White
 *         color: White
 *         birth_date: 2024-01-15T00:00:00Z
 *         weight: 4.5
 *         pen_id: Venus-A1
 *         is_pregnant: false
 *         status: active
 *         notes: Healthy breeding pig
 *         is_deleted: 0
 *         created_at: 2024-01-20T00:00:00Z
 *         updated_at: 2024-01-20T00:05:00Z
 *         history:
 *           - pen_id: Venus-A1
 *             assigned_at: 2024-01-20T00:00:00Z
 *             removed_at: null
 *             removal_reason: null
 *             removal_notes: null
 *     RemovalData:
 *       type: object
 *       required:
 *         - reason
 *       properties:
 *         reason:
 *           type: string
 *           description: The reason for removing the pig (e.g., sold, deceased, transferred)
 *         notes:
 *           type: string
 *           description: Additional notes for the removal
 *           nullable: true
 *         sale_amount:
 *           type: number
 *           description: The sale price if the pig was sold
 *           nullable: true
 *         sale_date:
 *           type: string
 *           format: date
 *           description: The date of the sale
 *           nullable: true
 *         sale_weight:
 *           type: number
 *           description: The weight of the pig at the time of sale
 *           nullable: true
 *         sold_to:
 *           type: string
 *           description: The name of the buyer if the pig was sold
 *           nullable: true
 *       example:
 *         reason: sold
 *         notes: Sold to John Doe
 *         sale_amount: 150.00
 *         sale_date: 2024-05-27
 *         sale_weight: 4.2
 *         sold_to: John Doe
 *   securitySchemes:
 *     bearerAuth:
 *       type: http
 *       scheme: bearer
 *       bearerFormat: JWT
 */

/**
 * @swagger
 * /api/v1/pigs:
 *   post:
 *     summary: Create a new pig
 *     tags:
 *       - Pigs
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Pig'
 *     responses:
 *       201:
 *         description: Pig created successfully
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
 *                   example: Pig created successfully
 *                 data:
 *                   $ref: '#/components/schemas/Pig'
 *       400:
 *         description: Invalid input
 *       409:
 *         description: Pig ID already exists
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Pen not found
 */
router.post(
  "/:farmId",
  authMiddleware,
  enforceActivePlan,
  validateRequest(pigSchema),
  PigsController.createPig
);

/**
 * @swagger
 * /api/v1/pigs/{farmId}:
 *   get:
 *     summary: Get all pigs for a farm
 *     tags:
 *       - Pigs
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
 *       - in: query
 *         name: penId
 *         schema:
 *           type: string
 *         description: Filter by pen ID
 *     responses:
 *       200:
 *         description: List of pigs retrieved successfully
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
 *                   example: Pigs retrieved successfully
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Pig'
 *       401:
 *         description: Unauthorized
 */
router.get(
  "/:farmId",
  authMiddleware,
  enforceActivePlan,
  PigsController.getAllPigs
);

/**
 * @swagger
 * /api/v1/pigs/{farmId}/{pigId}:
 *   get:
 *     summary: Get a pig by ID
 *     tags:
 *       - Pigs
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
 *         name: pigId
 *         required: true
 *         schema:
 *           type: string
 *         description: The pig ID (e.g., PIG-001)
 *     responses:
 *       200:
 *         description: Pig details retrieved successfully
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
 *                   example: Pig retrieved successfully
 *                 data:
 *                   $ref: '#/components/schemas/Pig'
 *       404:
 *         description: Pig not found
 *       401:
 *         description: Unauthorized
 */
router.get(
  "/:farmId/:pigId",
  authMiddleware,
  enforceActivePlan,
  PigsController.getPigById
);

/**
 * @swagger
 * /api/v1/pigs/{farmId}/{pigId}:
 *   put:
 *     summary: Update a pig
 *     tags:
 *       - Pigs
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
 *         name: pigId
 *         required: true
 *         schema:
 *           type: string
 *         description: The ID of the pig to update
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Pig'
 *     responses:
 *       200:
 *         description: Pig updated successfully
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
 *                   example: Pig updated successfully
 *                 data:
 *                   $ref: '#/components/schemas/Pig'
 *       400:
 *         description: Invalid input
 *       404:
 *         description: Pig or pen not found
 *       401:
 *         description: Unauthorized
 */
router.put(
  "/:farmId/:pigId",
  authMiddleware,
  enforceActivePlan,
  validateRequest(pigUpdateSchema),
  PigsController.updatePig
);

/**
 * @swagger
 * /api/v1/pigs/{farmId}/{pigId}:
 *   delete:
 *     summary: Soft delete a pig
 *     tags:
 *       - Pigs
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
 *         name: pigId
 *         required: true
 *         schema:
 *           type: string
 *         description: The ID of the pig to delete (e.g., PIG-001)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/RemovalData'
 *     responses:
 *       200:
 *         description: Pig soft deleted successfully
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
 *                   example: Pig soft deleted successfully
 *                 data:
 *                   $ref: '#/components/schemas/Pig'
 *       400:
 *         description: Invalid input
 *       404:
 *         description: Pig not found
 *       401:
 *         description: Unauthorized
 */
router.post(
  "/pig_removals/:farmId/:pigId",
  authMiddleware,
  enforceActivePlan,
  validateRequest(pigDeleteSchema),
  PigsController.deletePig
);

router.all(
  "/:farmId/details",
  authMiddleware,
  enforceActivePlan,
  PigsController.getAllPigDetails
);

/**
 * @swagger
 * /api/v1/pigs/{farmId}/{pigId}/transfer:
 *   post:
 *     summary: Transfer a pig to a different pen
 *     tags:
 *       - Pigs
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
 *         name: pigId
 *         required: true
 *         schema:
 *           type: string
 *         description: The pig ID (e.g., PIG-001)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - new_pen_id
 *               - transfer_reason
 *             properties:
 *               new_pen_id:
 *                 type: string
 *                 format: uuid
 *                 description: The ID of the destination pen
 *               transfer_reason:
 *                 type: string
 *                 enum:
 *                   - quarantine
 *                   - cannibalism_prevention
 *                   - breeding_program
 *                   - overcrowding
 *                   - facility_maintenance
 *                   - social_grouping
 *                   - other
 *                 description: Reason for the transfer
 *               transfer_notes:
 *                 type: string
 *                 nullable: true
 *                 description: Optional notes about the transfer
 *     responses:
 *       200:
 *         description: Pig transferred successfully
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
 *                   example: Pig transferred successfully
 *                 data:
 *                   $ref: '#/components/schemas/Pig'
 *       400:
 *         description: Invalid input or pen at capacity
 *       404:
 *         description: Pig or pen not found
 *       401:
 *         description: Unauthorized
 */
router.post("/:farmId/:pigId/transfer",  authMiddleware,  enforceActivePlan,  PigsController.transferPig);

/**
 * @swagger
 * /api/v1/pigs/{farmId}/{pigId}/transfer-history:
 *   get:
 *     summary: Get pig transfer history
 *     tags:
 *       - Pigs
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
 *         name: pigId
 *         required: true
 *         schema:
 *           type: string
 *         description: The pig ID (e.g., PIG-001)
 *     responses:
 *       200:
 *         description: Transfer history retrieved successfully
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
 *                   example: Transfer history retrieved successfully
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                         format: uuid
 *                       pig_id:
 *                         type: string
 *                       old_pen_id:
 *                         type: string
 *                         format: uuid
 *                       new_pen_id:
 *                         type: string
 *                         format: uuid
 *                       transfer_reason:
 *                         type: string
 *                       transferred_at:
 *                         type: string
 *                         format: date-time
 *                       transferred_by_user:
 *                         type: string
 *       404:
 *         description: Pig not found
 *       401:
 *         description: Unauthorized
 */
router.get("/:farmId/:pigId/transfer-history",  authMiddleware,  enforceActivePlan,PigsController.getPigTransferHistory);

export default router;
