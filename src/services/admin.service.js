import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { DatabaseHelper } from '../config/database.js';
import { UnauthorizedError } from '../middleware/errors.js';

export default class AdminService {
  /** Email + password sign-in for super admins and partners; returns a signed admin session token. */
  static async login(email, password) {
    const userResult = await DatabaseHelper.executeQuery(
      `SELECT u.id, u.password_hash, r.name AS role_name
       FROM users u JOIN roles r ON r.id = u.role_id
       WHERE lower(u.email) = lower($1) AND u.is_active = 1 AND u.is_deleted = 0
         AND r.name IN ('superadmin', 'partner') AND r.is_active = 1 AND r.is_deleted = 0`,
      [email]
    );
    const user = userResult.rows[0];
    if (!user || !user.password_hash || !(await bcrypt.compare(password, user.password_hash))) {
      throw new UnauthorizedError('Invalid email or password');
    }
    if (!process.env.ADMIN_JWT_SECRET || process.env.ADMIN_JWT_SECRET.length < 32) {
      throw new Error('ADMIN_JWT_SECRET must contain at least 32 characters');
    }
    await DatabaseHelper.executeQuery(
      'UPDATE users SET last_login = CURRENT_TIMESTAMP, login_count = login_count + 1 WHERE id = $1',
      [user.id]
    );
    const token = jwt.sign(
      { userId: user.id, realm: 'admin', role: user.role_name },
      process.env.ADMIN_JWT_SECRET,
      { expiresIn: '2h', audience: 'pigmaster-admin', issuer: 'pigmaster-api' }
    );
    return { userId: user.id, token, role: user.role_name === 'superadmin' ? 'SUPER_ADMIN' : 'PARTNER' };
  }
}
