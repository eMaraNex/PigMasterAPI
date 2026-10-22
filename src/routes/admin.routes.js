import express from 'express';
import Joi from 'joi';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import authMiddleware from '../middleware/auth.middleware.js';
import { requireAdmin, requireSuperAdmin } from '../middleware/admin.middleware.js';
import { validateRequest } from '../middleware/validateRequest.js';
import { SuccessResponse } from '../middleware/responses.js';
import { UnauthorizedError } from '../middleware/errors.js';
import AdminService from '../services/admin.service.js';
import { DatabaseHelper } from '../config/database.js';

const router = express.Router();
const loginLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many admin login attempts; try again later.' },
});
const otpLimit = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 8,
  standardHeaders: true,
  legacyHeaders: false,
});

const loginSchema = Joi.object({
  email: Joi.string().email().max(255).required(),
  password: Joi.string().min(1).max(200).required(),
}).strict();
const mfaSchema = Joi.object({
  challengeToken: Joi.string().max(4096).required(),
  otp: Joi.string().pattern(/^\d{6}$/).required(),
}).strict();
const setupSchema = Joi.object({ otp: Joi.string().pattern(/^\d{6}$/).optional() }).strict();

const cookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  path: '/',
  maxAge: 2 * 60 * 60 * 1000,
});

const pagination = query => {
  const page = Math.max(1, Math.min(Number.parseInt(query.page, 10) || 1, 100000));
  const pageSize = Math.max(1, Math.min(Number.parseInt(query.pageSize, 10) || 25, 100));
  return { page, pageSize };
};

router.post('/auth/login', loginLimit, validateRequest(loginSchema), async (req, res, next) => {
  try {
    const result = await AdminService.login(req.body.email, req.body.password);
    return SuccessResponse(res, 200, 'MFA verification required', result);
  } catch (error) {
    next(error);
  }
});

router.post('/auth/mfa/verify', otpLimit, validateRequest(mfaSchema), async (req, res, next) => {
  try {
    const result = await AdminService.verifyMfa(req.body.challengeToken, req.body.otp);
    res.cookie('pigmaster_admin_token', result.token, cookieOptions());
    return SuccessResponse(res, 200, 'Admin login successful', { role: result.role });
  } catch (error) {
    next(error);
  }
});

router.post('/auth/mfa/setup', authMiddleware, validateRequest(setupSchema), async (req, res, next) => {
  try {
    if (!['superadmin', 'partner'].includes(req.user.role_name)) {
      throw new UnauthorizedError('Admin account required');
    }
    const result = await AdminService.enrollMfa(req.user.id, req.body.otp);
    return SuccessResponse(res, 200, result.enabled ? 'MFA enabled' : 'Scan the QR enrollment URL', result);
  } catch (error) {
    next(error);
  }
});

router.get('/auth/me', requireAdmin, async (req, res, next) => {
  try {
    await DatabaseHelper.executeQuery(
      'INSERT INTO admin_audit_logs (actor_user_id, action, ip_address) VALUES ($1, $2, $3)',
      [req.admin.id, 'auth.session.read', req.ip]
    );
    return SuccessResponse(res, 200, 'Admin session', {
      id: req.admin.id,
      role: req.adminRole,
    });
  } catch (error) {
    next(error);
  }
});

router.post('/auth/logout', requireAdmin, async (req, res, next) => {
  try {
    const token = decodeURIComponent(req.headers.cookie?.split(';').map(value => value.trim())
      .find(value => value.startsWith('pigmaster_admin_token='))?.slice('pigmaster_admin_token='.length) || '');
    const claims = token ? jwt.decode(token) : null;
    if (token && claims?.exp) {
      await DatabaseHelper.executeQuery(
        `INSERT INTO token_blacklist (token, user_id, expires_at)
         VALUES ($1, $2, to_timestamp($3))`,
        [token, req.admin.id, claims.exp]
      );
    }
    await DatabaseHelper.executeQuery(
      'INSERT INTO admin_audit_logs (actor_user_id, action, ip_address) VALUES ($1, $2, $3)',
      [req.admin.id, 'auth.logout', req.ip]
    );
    res.clearCookie('pigmaster_admin_token', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
    });
    return SuccessResponse(res, 200, 'Logged out');
  } catch (error) {
    next(error);
  }
});

router.get('/analytics/overview', requireAdmin, async (req, res, next) => {
  try {
    const data = await AdminService.overview(req.admin, req.ip, req.query.period || '30d');
    return SuccessResponse(res, 200, 'Platform overview', data);
  } catch (error) {
    next(error);
  }
});

router.get('/analytics/revenue', requireAdmin, async (req, res, next) => {
  try {
    const data = await AdminService.revenue(req.admin, req.ip, req.query.period || '30d');
    return SuccessResponse(res, 200, 'Revenue analytics', data);
  } catch (error) {
    next(error);
  }
});

router.get('/analytics/herd', requireAdmin, async (req, res, next) => {
  try {
    const data = await AdminService.herd(req.admin, req.ip, req.query.period || '30d');
    return SuccessResponse(res, 200, 'Herd analytics', data);
  } catch (error) {
    next(error);
  }
});

router.get('/customers', requireAdmin, requireSuperAdmin, async (req, res, next) => {
  try {
    const data = await AdminService.customers(req.admin, req.ip, {
      ...pagination(req.query),
      search: String(req.query.search || '').slice(0, 100),
    });
    return SuccessResponse(res, 200, 'Customers', data);
  } catch (error) {
    next(error);
  }
});

router.get('/audit', requireAdmin, requireSuperAdmin, async (req, res, next) => {
  try {
    const data = await AdminService.audit(req.admin, req.ip, pagination(req.query));
    return SuccessResponse(res, 200, 'Admin audit log', data);
  } catch (error) {
    next(error);
  }
});

export default router;
