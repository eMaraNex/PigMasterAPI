import express from "express";
import RowsController from "../controllers/rows.controllers.js";
import { validateRequest } from "../middleware/validateRequest.js";
import {
  rowSchema,
  rowUpdateSchema,
  rowExpandSchema,
} from "../utils/validator.js";
import authMiddleware from "../middleware/auth.middleware.js";
import { requireActiveSubscription } from "../middleware/subscription.middleware.js";

const router = express.Router();
const enforceActivePlan = requireActiveSubscription();

/**
 * @swagger
 * components:
 *   schemas:
 *     Row:
 *       type: object
 *       required:
 *         - name
 *         - farm_id
 *         - capacity
 *       properties:
 *         name:
 *           type: string
 *           description: The unique name of the row (e.g., Venus)
 *         farm_id:
 *           type: string
 *           format: uuid
 *           description: The ID of the farm this row belongs to
 *         description:
 *           type: string
 *           description: Optional description of the row
 *           nullable: true
 *         capacity:
 *           type: integer
 *           description: Maximum number of pens in the row
 *         occupied:
 *           type: integer
 *           description: Number of occupied pens
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
 *         name: Venus
 *         farm_id: 123e4567-e89b-12d3-a456-426614174000
 *         description: Secondary breeding row
 *         capacity: 12
 *         occupied: 4
 *         is_deleted: 0
 *         created_at: 2024-01-01T00:00:00Z
 *         updated_at: 2024-01-01T00:05:00Z
 *     RowExpand:
 *       type: object
 *       required:
 *         - name
 *         - farm_id
 *         - additionalCapacity
 *       properties:
 *         name:
 *           type: string
 *           description: The name of the row to expand
 *         farm_id:
 *           type: string
 *           format: uuid
 *           description: The ID of the farm
 *         additionalCapacity:
 *           type: integer
 *           description: Number of additional pens to add to the row's capacity
 *           minimum: 1
 *       example:
 *         name: Venus
 *         farm_id: 123e4567-e89b-12d3-a456-426614174000
 *         additionalCapacity: 6
 *   securitySchemes:
 *     bearerAuth:
 *       type: http
 *       scheme: bearer
 *       bearerFormat: JWT
 */

/**
 * @swagger
 * /api/v1/rows:
 *   post:
 *     summary: Create a new row
 *     tags: [Rows]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Row'
 *     responses:
 *       201:
 *         description: Row created successfully
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
 *                   example: Row created successfully
 *                 data:
 *                   $ref: '#/components/schemas/Row'
 *       400:
 *         description: Invalid input
 *       409:
 *         description: Row already exists
 *       401:
 *         description: Unauthorized
 */
router.post(
  "/create/:farmId",
  authMiddleware,
  enforceActivePlan,
  RowsController.createRow
);

/**
 * @swagger
 * /api/v1/rows/{farmId}:
 *   get:
 *     summary: Get all rows for a farm
 *     tags: [Rows]
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
 *         description: List of rows retrieved successfully
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
 *                   example: Rows retrieved successfully
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Row'
 *       401:
 *         description: Unauthorized
 */
router.get(
  "/list/:farmId",
  authMiddleware,
  RowsController.getAllRows
);

/**
 * @swagger
 * /api/v1/rows/{farmId}/{name}:
 *   get:
 *     summary: Get a row by name
 *     tags: [Rows]
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
 *         name: name
 *         required: true
 *         schema:
 *           type: string
 *         description: The name of the row (e.g., Venus)
 *     responses:
 *       200:
 *         description: Row details retrieved successfully
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
 *                   example: Row retrieved successfully
 *                 data:
 *                   $ref: '#/components/schemas/Row'
 *       404:
 *         description: Row not found
 *       401:
 *         description: Unauthorized
 */
router.get(
  "/list/:farmId/:rowId",
  authMiddleware,
  RowsController.getRowByName
);

/**
 * @swagger
 * /api/v1/rows/{farmId}/{name}:
 *   put:
 *     summary: Update a row
 *     tags: [Rows]
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
 *         name: name
 *         required: true
 *         schema:
 *           type: string
 *         description: The name of the row to update
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               description:
 *                 type: string
 *                 description: Updated description of the row
 *                 nullable: true
 *             example:
 *               description: Updated breeding row
 *     responses:
 *       200:
 *         description: Row updated successfully
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
 *                   example: Row updated successfully
 *                 data:
 *                   $ref: '#/components/schemas/Row'
 *       400:
 *         description: Invalid input
 *       404:
 *         description: Row not found
 *       401:
 *         description: Unauthorized
 */
router.put(
  "/update/:farmId/:rowId",
  authMiddleware,
  enforceActivePlan,
  RowsController.updateRow
);

/**
 * @swagger
 * /api/v1/rows/{farmId}/{name}:
 *   delete:
 *     summary: Soft delete a row
 *     tags: [Rows]
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
 *         name: name
 *         required: true
 *         schema:
 *           type: string
 *         description: The name of the row to delete
 *     responses:
 *       200:
 *         description: Row soft deleted successfully
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
 *                   example: Row soft deleted successfully
 *                 data:
 *                   $ref: '#/components/schemas/Row'
 *       404:
 *         description: Row not found
 *       401:
 *         description: Unauthorized
 */
router.delete(
  "/delete/:farmId/:rowId",
  authMiddleware,
  enforceActivePlan,
  RowsController.deleteRow
);

/**
 * @swagger
 * /api/v1/rows/expand:
 *   post:
 *     summary: Expand the capacity of a row
 *     tags: [Rows]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/RowExpand'
 *     responses:
 *       200:
 *         description: Row capacity expanded successfully
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
 *                   example: Row capacity expanded successfully
 *                 data:
 *                   $ref: '#/components/schemas/Row'
 *       400:
 *         description: Invalid input
 *       404:
 *         description: Row not found
 *       401:
 *         description: Unauthorized
 */
// router.post('/expand', authMiddleware, enforceActivePlan, validateRequest(rowExpandSchema), RowsController.expandRowCapacity);
router.post(
  "/expand",
  authMiddleware,
  enforceActivePlan,
  RowsController.expandRowCapacity
);

export default router;
