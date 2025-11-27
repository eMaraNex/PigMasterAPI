import { ForbiddenError, UnauthorizedError } from './errors.js';

const formatDate = (date) => {
    if (!date) return 'your trial period';
    try {
        return new Date(date).toLocaleDateString();
    } catch {
        return 'your trial period';
    }
};

export const requireActiveSubscription = (options = {}) => {
    const {
        allowRoles = ['admin', 'superadmin'],
        allowDuringTrial = true,
        customMessage,
    } = options;

    return (req, res, next) => {
        if (!req.user) {
            return next(new UnauthorizedError('Authentication required'));
        }

        const roleName = req.user.role_name;
        if (roleName && allowRoles.includes(roleName)) {
            return next();
        }

        const accessControl = req.accessControl || {};
        const hasSubscription = Boolean(accessControl.hasActiveSubscription);
        const trialActive = allowDuringTrial && Boolean(accessControl.isTrialActive);

        if (hasSubscription || trialActive) {
            return next();
        }

        const message =
            customMessage ||
            `Your trial expired on ${formatDate(
                accessControl.trialEndsAt
            )}. Please upgrade your plan to continue using this feature.`;

        return next(new ForbiddenError(message));
    };
};

export default requireActiveSubscription;

