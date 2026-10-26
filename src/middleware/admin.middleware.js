import jwt from 'jsonwebtoken';
import { pool } from '../config/database.js';
import { ForbiddenError, UnauthorizedError } from './errors.js';
import { hasPermission } from '../business/permissions.js';

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
    // One query loads the admin and the permissions of their admin role.
    const result = await pool.query(
      `SELECT u.id, u.email, u.name, u.admin_role_id, ar.key AS role_key, ar.name AS role_name, ar.is_super, ar.permissions
       FROM users u JOIN admin_roles ar ON ar.id = u.admin_role_id
       WHERE u.id = $1 AND u.is_active = 1 AND u.is_deleted = 0 AND ar.is_active = 1 AND ar.is_deleted = 0`,
      [claims.userId]
    );
    if (!result.rows.length) throw new UnauthorizedError('Admin account is inactive');
    const { permissions, ...admin } = result.rows[0];
    req.admin = admin;
    req.adminRole = admin.role_key;
    req.adminPermissions = admin.is_super ? ['*'] : permissions ?? [];
    next();
  } catch (error) {
    next(error);
  }
};

/** Records a refused admin request in the audit log. */
const auditDenied = (req, permission) => pool.query(
  `INSERT INTO admin_audit_logs (actor_user_id, action, ip_address, filters)
   VALUES ($1, 'authorization.denied', $2, $3::jsonb)`,
  [req.admin.id, req.ip, JSON.stringify({ path: req.originalUrl, permission })]
);

/** Allows the request only when the admin's role grants `operation` on `object`. */
export const requireAdminPermission = (object, operation) => async (req, _res, next) => {
  if (hasPermission(req.adminPermissions, object, operation)) return next();
  try {
    await auditDenied(req, `${object}.${operation}`);
  } catch (error) {
    return next(error);
  }
  return next(new ForbiddenError(`Your admin role (${req.admin.role_name}) cannot ${operation} ${object.replace(/_/g, ' ')}`));
};
