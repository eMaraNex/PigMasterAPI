import jwt from 'jsonwebtoken';
import { pool } from '../config/database.js';
import logger from './logger.js';
import { UnauthorizedError } from './errors.js';

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const parseTrialPeriod = () => {
    const parsed = Number.parseInt(process.env.TRIAL_PERIOD ?? '30', 10);
    return Number.isNaN(parsed) ? 30 : Math.max(parsed, 1);
};

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

        // Fetch user with role, permissions, subscription and farm data
        const userResult = await pool.query(
            `SELECT 
                u.id,
                u.email,
                u.name,
                u.role_id,
                u.subscription_start,
                u.subscription_end,
                u.farm_id,
                r.name AS role_name,
                r.permissions,
                f.created_at AS farm_created_at
             FROM users u
             JOIN roles r ON u.role_id = r.id
             LEFT JOIN farms f ON u.farm_id = f.id
             WHERE u.id = $1 
               AND u.is_deleted = 0 
               AND u.is_active = 1
               AND r.is_deleted = 0 
               AND r.is_active = 1`,
            [decoded.userId]
        );

        if (userResult.rows.length === 0) {
            throw new UnauthorizedError('User not found or inactive');
        }

        const user = userResult.rows[0];
        const trialPeriodDays = parseTrialPeriod();
        const now = new Date();

        let trialEndsAt = null;
        let isTrialActive = false;

        if (user.farm_created_at) {
            const farmCreatedAt = new Date(user.farm_created_at);
            if (!Number.isNaN(farmCreatedAt.getTime())) {
                trialEndsAt = new Date(farmCreatedAt.getTime() + trialPeriodDays * DAY_IN_MS);
                isTrialActive = now.getTime() <= trialEndsAt.getTime();
            }
        } else {
            // No farm yet; allow access while they set up
            isTrialActive = true;
        }

        let hasActiveSubscription = false;
        if (user.subscription_end) {
            const subscriptionEndDate = new Date(user.subscription_end);
            if (!Number.isNaN(subscriptionEndDate.getTime())) {
                hasActiveSubscription = subscriptionEndDate.getTime() >= now.getTime();
            }
        }

        req.user = user;
        req.accessControl = {
            trialPeriodDays,
            trialEndsAt: trialEndsAt ? trialEndsAt.toISOString() : null,
            isTrialActive,
            hasActiveSubscription,
        };

        next();
    } catch (error) {
        logger.error(`Auth middleware error: ${error.message}`);
        next(error);
    }
};

export default authMiddleware;