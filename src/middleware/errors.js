/**
 * Base class for custom errors
 */
class CustomError extends Error {
    constructor(message, statusCode, errors = []) {
        super(message);
        this.name = this.constructor.name;
        this.statusCode = statusCode;
        this.isOperational = true; // Indicates a trusted, operational error
        this.errors = errors; // Optional array for detailed validation errors
        Error.captureStackTrace(this, this.constructor);
    }
}

/**
 * Error class for validation failures
 */
class ValidationError extends CustomError {
    constructor(message, errors = []) {
        super(message, 400, errors);
    }
}

/**
 * Error class for resources not found
 */
class NotFoundError extends CustomError {
    constructor(message, errors = []) {
        super(message, 404, errors);
    }
}

/**
 * Error class for unauthorized access
 */
class UnauthorizedError extends CustomError {
    constructor(message, errors = []) {
        super(message, 401, errors);
    }
}

/**
 * Error class for forbidden access
 */
class ForbiddenError extends CustomError {
    constructor(message, errors = []) {
        super(message, 403, errors);
    }
}

/**
 * Error class for rate limit exceeded
 */
class RateLimitError extends CustomError {
    constructor(message, errors = []) {
        super(message, 429, errors);
    }
}

/**
 * Error handler middleware
 */
const errorHandler = (error, req, res, next) => {
    const statusCode = error.statusCode || 500;
    const response = {
        success: false,
        message: error.message || 'Internal server error',
        ...(error.errors.length > 0 && { errors: error.errors })
    };
    res.status(statusCode).json(response);
};

export { CustomError, ValidationError, NotFoundError, UnauthorizedError, ForbiddenError, RateLimitError, errorHandler };