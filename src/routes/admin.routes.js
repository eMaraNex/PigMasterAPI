import express from 'express';
import Joi from 'joi';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import { requireAdmin, requireAdminPermission } from '../middleware/admin.middleware.js';
import { validateRequest } from '../middleware/validateRequest.js';
import { SuccessResponse } from '../middleware/responses.js';
import AdminService from '../services/admin.service.js';
import { buildDashboard } from '../business/analytics.js';
import { DatabaseHelper } from '../config/database.js';

const router = express.Router();
const loginLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many admin login attempts; try again later.' },
});
const loginSchema = Joi.object({
  email: Joi.string().email().max(255).required(),
  password: Joi.string().min(1).max(200).required(),
}).strict();
const cookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  path: '/',
  maxAge: 2 * 60 * 60 * 1000,
});

router.post('/auth/login', loginLimit, validateRequest(loginSchema), async (req, res, next) => {
  try {
    const result = await AdminService.login(req.body.email, req.body.password);
    res.cookie('pigmaster_admin_token', result.token, cookieOptions());
    await DatabaseHelper.executeQuery(
      'INSERT INTO admin_audit_logs (actor_user_id, action, ip_address) VALUES ($1, $2, $3)',
      [result.userId, 'auth.login', req.ip]
    );
    return SuccessResponse(res, 200, 'Admin login successful', { role: result.role });
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
      email: req.admin.email,
      name: req.admin.name,
      role: { key: req.admin.role_key, name: req.admin.role_name, is_super: req.admin.is_super },
      // "<object>.<operation>" keys (wildcards allowed); the UI hides what the role cannot do.
      permissions: req.adminPermissions,
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

// Config-driven dashboard: widgets are declared in business/analytics-config.js.
router.get('/dashboard', requireAdmin, requireAdminPermission('dashboard', 'read'), async (req, res, next) => {
  try {
    const data = await buildDashboard(req.adminPermissions, req.query);
    await DatabaseHelper.executeQuery(
      `INSERT INTO admin_audit_logs (actor_user_id, action, ip_address, filters)
       VALUES ($1, 'dashboard.read', $2, $3::jsonb)`,
      [req.admin.id, req.ip, JSON.stringify(data.range)]
    );
    return SuccessResponse(res, 200, 'Dashboard', data);
  } catch (error) {
    next(error);
  }
});

export default router;
