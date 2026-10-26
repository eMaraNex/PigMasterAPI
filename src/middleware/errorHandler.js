import logger from './logger.js';

const PARSER_ERRORS = {
    'entity.parse.failed': [400, 'Malformed JSON body'],
    'entity.too.large': [413, 'Request body is too large'],
};

export const errorHandler = (err, req, res, _next) => {
    const parserError = PARSER_ERRORS[err.type];
    const statusCode = parserError?.[0] ?? err.statusCode ?? err.status ?? 500;
    // Messages of unexpected errors can contain SQL or internals, so they never reach the client.
    const message = parserError?.[1] ?? (err.isOperational ? err.message : 'Internal Server Error');

    if (statusCode >= 500) {
        logger.error(`${req.method} ${req.originalUrl} failed: ${err.message}`, { stack: err.stack });
    } else {
        logger.warn(`${req.method} ${req.originalUrl} -> ${statusCode}: ${message}`);
    }

    res.status(statusCode).json({
        success: false,
        message,
        ...(err.isOperational && err.errors?.length > 0 && { errors: err.errors }),
    });
};
