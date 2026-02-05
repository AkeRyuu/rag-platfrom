/**
 * Structured Logger - Winston-based logging with request context
 */

import winston from 'winston';
import config from '../config';

// Custom format for console output
const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  winston.format.colorize(),
  winston.format.printf((info) => {
    const { timestamp, level, message, ...meta } = info;
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    return `[${timestamp}] [${level}] ${message}${metaStr}`;
  })
);

// JSON format for file/production
const jsonFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// Create logger instance
const winstonLogger = winston.createLogger({
  level: config.LOG_LEVEL,
  defaultMeta: { service: 'rag-api' },
  transports: [
    // Console transport
    new winston.transports.Console({
      format: consoleFormat,
    }),
  ],
});

// Add file transports in production
if (process.env.NODE_ENV === 'production') {
  winstonLogger.add(
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
      format: jsonFormat,
    })
  );
  winstonLogger.add(
    new winston.transports.File({
      filename: 'logs/combined.log',
      format: jsonFormat,
    })
  );
}

/**
 * Logger wrapper with consistent API
 */
class Logger {
  error(message: string, meta?: Record<string, unknown>) {
    winstonLogger.error(message, meta);
  }

  warn(message: string, meta?: Record<string, unknown>) {
    winstonLogger.warn(message, meta);
  }

  info(message: string, meta?: Record<string, unknown>) {
    winstonLogger.info(message, meta);
  }

  debug(message: string, meta?: Record<string, unknown>) {
    winstonLogger.debug(message, meta);
  }

  /**
   * Create a child logger with additional context
   */
  child(meta: Record<string, unknown>): Logger {
    const childWinston = winstonLogger.child(meta);
    const childLogger = new Logger();
    // Override methods to use child logger
    childLogger.error = (msg, m) => childWinston.error(msg, m);
    childLogger.warn = (msg, m) => childWinston.warn(msg, m);
    childLogger.info = (msg, m) => childWinston.info(msg, m);
    childLogger.debug = (msg, m) => childWinston.debug(msg, m);
    return childLogger;
  }
}

export const logger = new Logger();
export default logger;

/**
 * Create a request-scoped logger
 */
export function createRequestLogger(requestId: string, projectName?: string): Logger {
  return logger.child({
    requestId,
    projectName: projectName || 'unknown',
  });
}
