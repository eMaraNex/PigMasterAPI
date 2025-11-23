import jwt from 'jsonwebtoken';
import { pool } from '../config/database.js';
import logger from './logger.js';
import { UnauthorizedError } from './errors.js';

const authMiddleware = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            throw new UnauthorizedError('No token provided');
        }

        const token = authHeader.split(' ')[1];

        // Check if token is blacklisted
        const blacklistResult = await pool.query(
            'SELECT 1 FROM token_blacklist WHERE token = $1 AND expires_at > CURRENT_TIMESTAMP AND is_deleted = 0',
            [token]
        );
        if (blacklistResult.rows.length > 0) {
            throw new UnauthorizedError('Token is blacklisted');
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // Fetch user with role and permissions
        const userResult = await pool.query(
            `SELECT u.id, u.email, u.name, u.role_id, r.name AS role_name, r.permissions
       FROM users u
       JOIN roles r ON u.role_id = r.id
       WHERE u.id = $1 AND u.is_deleted = 0 AND u.is_active = 1
       AND r.is_deleted = 0 AND r.is_active = 1`,
            [decoded.userId]
        );

        if (userResult.rows.length === 0) {
            throw new UnauthorizedError('User not found or inactive');
        }

        req.user = userResult.rows[0];
        next();
    } catch (error) {
        logger.error(`Auth middleware error: ${error.message}`);
        next(error);
    }
};

export default authMiddleware;