import { BadRequestError } from '../utils/error.js';

export const validateRequest = (schema) => {
    return (req, res, next) => {
        const { error, value } = schema.validate(req.body, { abortEarly: false });
        if (error) {
            const errorMessages = error.details.map((err) => err.message).join(', ');
            throw new BadRequestError(`Validation error: ${errorMessages}`);
        }
        req.validatedBody = value;
        next();
    };
};