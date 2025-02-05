const winston = require('winston');
const path = require('path');
const fs = require('fs');

// Create logs directory if it doesn't exist
const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir);
}

// Define log formats
const logFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json()
);

// Console format (cleaner, less verbose)
const consoleFormat = winston.format.combine(
    winston.format.colorize(),
    winston.format.timestamp({ format: 'HH:mm:ss' }),
    winston.format.printf(
        ({ level, message, timestamp }) => `${timestamp} ${level}: ${message}`
    )
);

// Create the logger
const logger = winston.createLogger({
    level: 'info',
    format: logFormat,
    transports: [
        // Write all logs to separate files
        new winston.transports.File({
            filename: path.join(logsDir, 'error.log'),
            level: 'error',
            maxsize: 5242880, // 5MB
            maxFiles: 5,
        }),
        new winston.transports.File({
            filename: path.join(logsDir, 'bot.log'),
            maxsize: 5242880, // 5MB
            maxFiles: 5,
        }),
        // Console transport with cleaner format
        new winston.transports.Console({
            format: consoleFormat,
            level: 'info'
        })
    ],
    // Handle exceptions and rejections
    exceptionHandlers: [
        new winston.transports.File({
            filename: path.join(logsDir, 'exceptions.log'),
            maxsize: 5242880, // 5MB
            maxFiles: 5,
        })
    ],
    rejectionHandlers: [
        new winston.transports.File({
            filename: path.join(logsDir, 'rejections.log'),
            maxsize: 5242880, // 5MB
            maxFiles: 5,
        })
    ]
});

// Create separate logger for debug messages
const debugLogger = winston.createLogger({
    level: 'debug',
    format: logFormat,
    transports: [
        new winston.transports.File({
            filename: path.join(logsDir, 'debug.log'),
            maxsize: 5242880, // 5MB
            maxFiles: 5,
        })
    ]
});

module.exports = {
    // Main logging functions
    info: (message) => logger.info(message),
    error: (message, error) => {
        if (error?.stack) {
            logger.error(`${message}: ${error.stack}`);
        } else {
            logger.error(`${message}: ${error || ''}`);
        }
    },
    warn: (message) => logger.warn(message),
    debug: (message) => debugLogger.debug(message),

    // Special logging functions for specific features
    bot: (message) => logger.info(`[Bot] ${message}`),
    thread: (message) => logger.info(`[Thread] ${message}`),
    api: (message) => logger.info(`[API] ${message}`),
    whatsapp: (message) => logger.info(`[WhatsApp] ${message}`),

    // System events
    system: (message) => logger.info(`[System] ${message}`),
    startup: (message) => logger.info(`[Startup] ${message}`),
    shutdown: (message) => logger.info(`[Shutdown] ${message}`),
}; 