import { RateLimitError } from './errors.js';
import logger from './logger.js';

const rateLimitMiddleware = (limit, windowMs) => {
    const requests = new Map();

    return (req, res, next) => {
        try {
            const ip = req.ip;
            const now = Date.now();

            if (!requests.has(ip)) {
                requests.set(ip, { count: 1, startTime: now });
            } else {
                const data = requests.get(ip);
                if (now - data.startTime > windowMs) {
                    // Reset window
                    requests.set(ip, { count: 1, startTime: now });
                } else {
                    data.count += 1;
                    if (data.count > limit) {
                        throw new RateLimitError('Too many requests, please try again later');
                    }
                }
            }

            // Clean up old entries
            for (const [key, value] of requests) {
                if (now - value.startTime > windowMs) {
                    requests.delete(key);
                }
            }

            next();
        } catch (error) {
            logger.error(`Rate limit middleware error: ${error.message}`);
            next(error);
        }
    };
};

export default rateLimitMiddleware;