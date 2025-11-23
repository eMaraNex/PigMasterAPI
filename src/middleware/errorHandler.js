import logger from './logger.js';

export const errorHandler = (err, req, res, next) => {
    logger.error(err.message, { stack: err.stack, path: req.originalUrl, method: req.method });

    const statusCode = err.statusCode || 500;
    const message = err.isOperational ? err.message : 'Internal Server Error';

    res.status(statusCode).json({
        success: false,
        message,
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
    });
};