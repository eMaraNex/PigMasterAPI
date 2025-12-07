import express from "express";
import EarningsController from "../controllers/earnings.controllers.js";
import { validateRequest } from "../middleware/validateRequest.js";
import { earningsSchema, earningsUpdateSchema } from "../utils/validator.js";
import authMiddleware from "../middleware/auth.middleware.js";
import { requireActiveSubscription } from "../middleware/subscription.middleware.js";

const router = express.Router();
const enforceActivePlan = requireActiveSubscription();

/**
 * @swagger
 * components:
 *   schemas:
 *     Earnings:
 *       type: object
 *       required:
 *         - farm_id
 *         - type
 *         - amount
 *         - date
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *           description: The unique ID of the earnings record
 *         farm_id:
 *           type: string
 *           format: uuid
 *           description: The ID of the farm
 *         type:
 *           type: string
 *           enum: [pig_sale, urine_sale, manure_sale, other]
 *           description: The type of earnings
 *         pig_id:
 *           type: string
 *           description: The ID of the pig (optional)
 *           nullable: true
 *         amount:
 *           type: number
 *           format: float
 *           description: The amount earned
 *         currency:
 *           type: string
 *           description: The currency code (e.g., USD)
 *           default: USD
 *         date:
 *           type: string
 *           format: date
 *           description: The date of the earnings
 *         weight:
 *           type: number
 *           format: float
 *           description: The weight of the sold item (optional)
 *           nullable: true
 *         sale_type:
 *           type: string
 *           enum: [whole, processed, live]
 *           description: The type of sale (optional)
 *           nullable: true
 *         includes_urine:
 *           type: boolean
 *           description: Whether urine is included
 *           default: false
 *         includes_manure:
 *           type: boolean
 *           description: Whether manure is included
 *           default: false
 *         buyer_name:
 *           type: string
 *           description: The name of the buyer (optional)
 *           nullable: true
 *         notes:
 *           type: string
 *           description: Additional notes (optional)
 *           nullable: true
 *         pen_id:
 *           type: string
 *           description: The ID of the pen (optional)
 *           nullable: true
 *         is_deleted:
 *           type: boolean
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
 *         id: 550e8400-e29b-41d4-a716-446655440000
 *         farm_id: 123e4567-e89b-12d3-a456-426614174000
 *         type: pig_sale
 *         pig_id: PIG-001
 *         amount: 100.00
 *         currency: USD
 *         date: 2025-05-29
 *         weight: 2.5
 *         sale_type: whole
 *         includes_urine: true
 *         includes_manure: false
 *         buyer_name: John Doe
 *         notes: Sold whole pig
 *         pen_id: Mercury-A1
 *         is_deleted: false
 *         created_at: 2025-05-29T17:00:00Z
 *         updated_at: 2025-05-29T17:00:00Z
 *   securitySchemes:
 *     bearerAuth:
 *       type: http
 *       scheme: bearer
 *       bearerFormat: JWT
 */

/**
 * @swagger
 * /api/v1/earnings:
 *   post:
 *     summary: Create a new earnings record
 *     tags: [Earnings]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Earnings'
 *     responses:
 *       201:
 *         description: Earnings record created successfully
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
 *                   $ref: '#/components/schemas/Earnings'
 *       400:
 *         description: Invalid input
 *       401:
 *         description: Unauthorized
 */
router.post(
  "/:farmId",
  authMiddleware,
  enforceActivePlan,
  validateRequest(earningsSchema),
  EarningsController.createEarnings
);

/**
 * @swagger
 * /api/v1/earnings/{farmId}/{id}:
 *   get:
 *     summary: Get an earnings record by ID
 *     tags: [Earnings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: farmId
 *         schema:
 *           type: string
 *           format: uuid
 *         required: true
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *           format: uuid
 *         required: true
 *     responses:
 *       200:
 *         description: Earnings record retrieved successfully
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
 *                   $ref: '#/components/schemas/Earnings'
 *       404:
 *         description: Earnings record not found
 *       401:
 *         description: Unauthorized
 */
router.get(
  "/:farmId/:id",
  authMiddleware,
  enforceActivePlan,
  EarningsController.getEarnings
);

/**
 * @swagger
 * /api/v1/earnings/{farmId}:
 *   get:
 *     summary: Get all earnings records for a farm
 *     tags: [Earnings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: farmId
 *         schema:
 *           type: string
 *           format: uuid
 *         required: true
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [pig_sale, urine_sale, manure_sale, other]
 *       - in: query
 *         name: date_from
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: date_to
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Earnings records retrieved successfully
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
 *                     $ref: '#/components/schemas/Earnings'
 *       401:
 *         description: Unauthorized
 */
router.get(
  "/:farmId",
  authMiddleware,
  enforceActivePlan,
  EarningsController.getAllEarnings
);

/**
 * @swagger
 * /api/v1/earnings/{farmId}/{id}:
 *   put:
 *     summary: Update an earnings record
 *     tags: [Earnings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: farmId
 *         schema:
 *           type: string
 *           format: uuid
 *         required: true
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *           format: uuid
 *         required: true
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               type:
 *                 type: string
 *                 enum: [pig_sale, urine_sale, manure_sale, other]
 *               pig_id:
 *                 type: string
 *                 nullable: true
 *               amount:
 *                 type: number
 *                 format: float
 *               currency:
 *                 type: string
 *               date:
 *                 type: string
 *                 format: date
 *               weight:
 *                 type: number
 *                 format: float
 *                 nullable: true
 *               sale_type:
 *                 type: string
 *                 enum: [whole, processed, live]
 *                 nullable: true
 *               includes_urine:
 *                 type: boolean
 *               includes_manure:
 *                 type: boolean
 *               buyer_name:
 *                 type: string
 *                 nullable: true
 *               notes:
 *                 type: string
 *                 nullable: true
 *               pen_id:
 *                 type: string
 *                 nullable: true
 *     responses:
 *       200:
 *         description: Earnings record updated successfully
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
 *                   $ref: '#/components/schemas/Earnings'
 *       400:
 *         description: Invalid input
 *       404:
 *         description: Earnings record not found
 *       401:
 *         description: Unauthorized
 */
router.put(
  "/:farmId/:id",
  authMiddleware,
  enforceActivePlan,
  validateRequest(earningsUpdateSchema),
  EarningsController.updateEarnings
);

/**
 * @swagger
 * /api/v1/earnings/{farmId}/{id}:
 *   delete:
 *     summary: Soft delete an earnings record
 *     tags: [Earnings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: farmId
 *         schema:
 *           type: string
 *           format: uuid
 *         required: true
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *           format: uuid
 *         required: true
 *     responses:
 *       200:
 *         description: Earnings record soft deleted successfully
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
 *                   $ref: '#/components/schemas/Earnings'
 *       404:
 *         description: Earnings record not found
 *       401:
 *         description: Unauthorized
 */
router.delete(
  "/:farmId/:id",
  authMiddleware,
  enforceActivePlan,
  EarningsController.deleteEarnings
);

export default router;
