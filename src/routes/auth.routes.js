import express from 'express';
import AuthController from '../controllers/auth.controllers.js';
import { validateRequest } from '../middleware/validateRequest.js';
import { registerSchema, loginSchema, forgotPasswordSchema, resetPasswordSchema } from '../utils/auth.validator.js';
import rateLimitMiddleware from '../middleware/rate-limit.middleware.js';
import authMiddleware from '../middleware/auth.middleware.js';
import { resendVerificationSchema } from '../utils/validator.js';

const router = express.Router();

/**
 * @swagger
 * components:
 *   schemas:
 *     User:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *         email:
 *           type: string
 *           format: email
 *         name:
 *           type: string
 *         role_id:
 *           type: integer
 *         farm_id:
 *           type: string
 *           format: uuid
 *           nullable: true
 *         permissions:
 *           type: array
 *           items:
 *             type: string
 *     LoginResponse:
 *       type: object
 *       properties:
 *         token:
 *           type: string
 *         user:
 *           $ref: '#/components/schemas/User'
 *   securitySchemes:
 *     bearerAuth:
 *       type: http
 *       scheme: bearer
 *       bearerFormat: JWT
 */

/**
 * @swagger
 * /api/v1/auth/register:
 *   post:
 *     summary: Register a new user
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               password:
 *                 type: string
 *                 minLength: 8
 *               name:
 *                 type: string
 *               phone:
 *                 type: string
 *               role_id:
 *                 type: integer
 *               farm_id:
 *                 type: string
 *                 format: uuid
 *                 nullable: true
 *             required:
 *               - email
 *               - password
 *               - name
 *               - role_id
 *     responses:
 *       201:
 *         description: User registered successfully
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
 *                   $ref: '#/components/schemas/User'
 *       400:
 *         description: Invalid input
 *       409:
 *         description: Email already registered
 */
router.post('/register', AuthController.register);

/**
 * @swagger
 * /api/v1/auth/login:
 *   post:
 *     summary: User login
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               password:
 *                 type: string
 *             required:
 *               - email
 *               - password
 *     responses:
 *       200:
 *         description: Login successful
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
 *                   $ref: '#/components/schemas/LoginResponse'
 *       400:
 *         description: Invalid input
 *       401:
 *         description: Invalid credentials
 *       429:
 *         description: Too many requests
 */
router.post('/login', rateLimitMiddleware(5, 60 * 1000), validateRequest(loginSchema), AuthController.login);

/**
 * @swagger
 * /api/v1/auth/forgot-password:
 *   post:
 *     summary: Request password reset
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *             required:
 *               - email
 *     responses:
 *       200:
 *         description: Password reset email sent
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
 *                     message:
 *                       type: string
 *       400:
 *         description: Invalid input
 *       404:
 *         description: User not found
 *       429:
 *         description: Too many requests
 */
router.post('/forgot-password', rateLimitMiddleware(3, 60 * 1000), validateRequest(forgotPasswordSchema), AuthController.forgotPassword);

/**
 * @swagger
 * /api/v1/auth/reset-password:
 *   post:
 *     summary: Reset password
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               token:
 *                 type: string
 *               newPassword:
 *                 type: string
 *                 minLength: 8
 *             required:
 *               - token
 *               - newPassword
 *     responses:
 *       200:
 *         description: Password reset successfully
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
 *                     message:
 *                       type: string
 *       400:
 *         description: Invalid input
 *       401:
 *         description: Invalid or expired token
 */
router.post('/reset-password/:token', validateRequest(resetPasswordSchema), AuthController.resetPassword);
router.get('/reset-password/:token', AuthController.validateResetToken);
/**
 * @swagger
 * /api/v1/auth/logout:
 *   post:
 *     summary: Logout user
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Logged out successfully
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
 *                     message:
 *                       type: string
 *       401:
 *         description: Unauthorized
 */
router.post('/logout', authMiddleware, AuthController.logout);
/**
 * @swagger
 * /api/v1/auth/verify-email/{token}:
 *   get:
 *     summary: Verify email address
 *     tags: [Auth]
 *     parameters:
 *       - in: path
 *         name: token
 *         required: true
 *         schema:
 *           type: string
 *         description: Email verification token
 *     responses:
 *       200:
 *         description: Email verified successfully
 *         content:
 *           text/html:
 *             schema:
 *               type: string
 *       400:
 *         description: Invalid or expired token
 */
router.get('/verify-email/:token', AuthController.verifyEmail);

/**
 * @swagger
 * /api/v1/auth/resend-verification:
 *   post:
 *     summary: Resend email verification
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *             required:
 *               - email
 *     responses:
 *       200:
 *         description: Verification email sent
 *       400:
 *         description: Invalid email or already verified
 *       429:
 *         description: Too many requests
 */
router.post('/resend-verification', rateLimitMiddleware(3, 60 * 1000), validateRequest(resendVerificationSchema), AuthController.resendVerificationEmail);

router.post('/sso', AuthController.ssoAuth); 

export default router;