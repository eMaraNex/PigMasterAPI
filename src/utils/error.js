export class AppError extends Error {
    constructor(message, statusCode) {
        super(message);
        this.statusCode = statusCode;
        this.isOperational = true;
        Error.captureStackTrace(this, this.constructor);
    }
}

export class NotFoundError extends AppError {
    constructor(message) {
        super(message, 404);
    }
}

export class BadRequestError extends AppError {
    constructor(message) {
        super(message, 400);
    }
}

export class ConflictError extends AppError {
    constructor(message) {
        super(message, 409);
    }
}