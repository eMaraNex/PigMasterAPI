import jwt from 'jsonwebtoken';
import { pool } from '../config/database.js';
import { ForbiddenError, UnauthorizedError } from './errors.js';

const readCookie = (header, cookieName) => {
  const item = header?.split(';').map(value => value.trim())
    .find(value => value.startsWith(`${cookieName}=`));
  return item ? decodeURIComponent(item.slice(cookieName.length + 1)) : null;
};

export const requireAdmin = async (req, _res, next) => {
  try {
    const token = readCookie(req.headers.cookie, 'pigmaster_admin_token');
    if (!token || !process.env.ADMIN_JWT_SECRET) {
      throw new UnauthorizedError('Admin authentication required');
    }
    const revoked = await pool.query(
      'SELECT 1 FROM token_blacklist WHERE token = $1 AND expires_at > CURRENT_TIMESTAMP AND is_deleted = 0',
      [token]
    );
    if (revoked.rows.length) throw new UnauthorizedError('Admin session has been revoked');
    const claims = jwt.verify(token, process.env.ADMIN_JWT_SECRET, {
      audience: 'pigmaster-admin',
      issuer: 'pigmaster-api',
      algorithms: ['HS256'],
    });
    if (claims.realm !== 'admin' || !claims.userId) {
      throw new UnauthorizedError('Invalid admin session');
    }
    const result = await pool.query(
      `SELECT u.id, u.email, u.name, r.name AS role_name
       FROM users u JOIN roles r ON r.id = u.role_id
       WHERE u.id = $1 AND u.is_active = 1 AND u.is_deleted = 0
         AND r.name IN ('superadmin', 'partner')
         AND r.is_active = 1 AND r.is_deleted = 0`,
      [claims.userId]
    );
    if (!result.rows.length) throw new UnauthorizedError('Admin account is inactive');
    req.admin = result.rows[0];
    req.adminRole = result.rows[0].role_name === 'superadmin' ? 'SUPER_ADMIN' : 'PARTNER';
    next();
  } catch (error) {
    next(error);
  }
};

/** Restricts a route to the given admin roles and records denied attempts. */
export const requireAdminRoles = roles => async (req, _res, next) => {
  if (!roles || roles.includes(req.adminRole)) return next();
  try {
    await pool.query(
      `INSERT INTO admin_audit_logs (actor_user_id, action, ip_address, filters)
       VALUES ($1, 'authorization.denied', $2, $3::jsonb)`,
      [req.admin.id, req.ip, JSON.stringify({ path: req.originalUrl })]
    );
  } catch (error) {
    return next(error);
  }
  return next(new ForbiddenError('Your admin role cannot access this resource'));
};
