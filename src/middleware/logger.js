import pino from 'pino';
// import { createWriteStream } from 'fs';
// import { dirname } from 'path';
// import { fileURLToPath } from 'url';
// import { mkdirSync } from 'fs';

// const __filename = fileURLToPath(import.meta.url);
// const __dirname = dirname(__filename);

// // Ensure logs directory exists
// const logsDir = process.env.LOG_DIR || 'logs';
// try {
//     mkdirSync(logsDir, { recursive: true });
// } catch (error) {
//     // Directory already exists or cannot be created
// }

// Create logger configuration
const loggerConfig = {
    level: process.env.LOG_LEVEL || 'info',
    formatters: {
        level: (label) => ({ level: label }),
        bindings: (bindings) => ({
            pid: bindings.pid,
            hostname: bindings.hostname,
            name: bindings.name,
        }),
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
        paths: ['password', 'token', 'authorization', 'cookie'],
        censor: '[REDACTED]',
    },
};

// Development logger with pretty printing
if (process.env.NODE_ENV === 'development') {
    loggerConfig.transport = {
        target: 'pino-pretty',
        options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
            singleLine: false,
        },
    };
}

// Production logger with console output (no file writing for Vercel)
if (process.env.NODE_ENV === 'production') {
    // Vercel captures console output, so we log to stdout
    // No transport needed; pino logs to console by default
    loggerConfig.base = {
        name: 'pig-farm-backend',
    };
    //     const logFile = process.env.LOG_FILE || `${logsDir}/app.log`;
    // loggerConfig.transport = {
    //     targets: [
    //         {
    //             target: 'pino/file',
    //             options: { destination: logFile },
    //             level: 'info',
    //         },
    //         {
    //             target: 'pino/file',
    //             options: { destination: `${logsDir}/error.log` },
    //             level: 'error',
    //         },
    //     ],
    // };
}

const logger = pino(loggerConfig);

// Custom logging methods
class Logger {
    constructor(pinoLogger) {
        this.logger = pinoLogger;
    }

    info(message, meta = {}) {
        this.logger.info(meta, message);
    }

    error(message, error = null, meta = {}) {
        const errorMeta = error ? {
            error: {
                message: error.message,
                stack: error.stack,
                name: error.name,
            },
            ...meta,
        } : meta;

        this.logger.error(errorMeta, message);
    }

    warn(message, meta = {}) {
        this.logger.warn(meta, message);
    }

    debug(message, meta = {}) {
        this.logger.debug(meta, message);
    }

    trace(message, meta = {}) {
        this.logger.trace(meta, message);
    }

    fatal(message, error = null, meta = {}) {
        const errorMeta = error ? {
            error: {
                message: error.message,
                stack: error.stack,
                name: error.name,
            },
            ...meta,
        } : meta;

        this.logger.fatal(errorMeta, message);
    }

    // HTTP request logging
    logRequest(req, res, responseTime) {
        const logData = {
            method: req.method,
            url: req.url,
            statusCode: res.statusCode,
            responseTime: `${responseTime}ms`,
            userAgent: req.get('User-Agent'),
            ip: req.ip || req.connection.remoteAddress,
            userId: req.user?.id,
        };

        if (res.statusCode >= 400) {
            this.error('HTTP Request Error', null, logData);
        } else {
            this.info('HTTP Request', logData);
        }
    }

    // Database operation logging
    logDatabaseOperation(operation, table, duration, error = null) {
        const logData = {
            operation,
            table,
            duration: `${duration}ms`,
        };

        if (error) {
            this.error('Database Operation Failed', error, logData);
        } else {
            this.debug('Database Operation', logData);
        }
    }

    // Authentication logging
    logAuth(action, userId, success, ip, userAgent, error = null) {
        const logData = {
            action,
            userId,
            success,
            ip,
            userAgent,
        };

        if (error) {
            this.error('Authentication Error', error, logData);
        } else if (success) {
            this.info('Authentication Success', logData);
        } else {
            this.warn('Authentication Failed', logData);
        }
    }

    // Business logic logging
    logBusinessEvent(event, data = {}) {
        this.info(`Business Event: ${event}`, data);
    }

    // Performance logging
    logPerformance(operation, duration, metadata = {}) {
        const logData = {
            operation,
            duration: `${duration}ms`,
            ...metadata,
        };

        if (duration > 1000) {
            this.warn('Slow Operation Detected', logData);
        } else {
            this.debug('Performance Log', logData);
        }
    }
}

export default new Logger(logger);