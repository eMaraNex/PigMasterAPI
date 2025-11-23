import { ForbiddenError } from './errors.js';
import logger from './logger.js';

const permissionMiddleware = (requiredPermission) => {
    return (req, res, next) => {
        try {
            const userPermissions = req.user?.permissions || [];
            if (!Array.isArray(userPermissions)) {
                throw new ForbiddenError('Invalid permissions format');
            }

            if (!userPermissions.includes(requiredPermission) && !userPermissions.includes('all')) {
                throw new ForbiddenError(`Permission '${requiredPermission}' required`);
            }

            next();
        } catch (error) {
            logger.error(`Permission middleware error: ${error.message}`);
            next(error);
        }
    };
};

export default permissionMiddleware;