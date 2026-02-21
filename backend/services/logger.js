/**
 * Structured Logger Service
 * Phase 4.1: Observability - Structured Logging
 * Phase 6.5: Enhanced with daily rotation and production logging
 * 
 * Purpose: Centralized logging with structured output, log levels, and context
 * Features:
 * - Environment-aware log levels (dev vs production)
 * - Structured JSON logging for production
 * - Human-readable console for development
 * - Request correlation IDs
 * - Performance timing
 * - Error tracking with stack traces
 * - Daily log rotation (Phase 6.5)
 * - Separate error logs (Phase 6.5)
 */

const winston = require('winston');
const path = require('path');
require('winston-daily-rotate-file'); // Phase 6.5: Daily rotation

// Determine environment
const isDevelopment = process.env.NODE_ENV !== 'production';
const logLevel = process.env.LOG_LEVEL || (isDevelopment ? 'debug' : 'info');

// Correlation context provider — set by correlationContext.js to avoid circular dependency
let _getCorrelationContext = () => null;
function setCorrelationProvider(provider) {
  _getCorrelationContext = provider;
}

// Sensitive field names to redact from log metadata
const SENSITIVE_FIELDS = new Set([
  'password', 'secret', 'token', 'authorization', 'apikey', 'api_key',
  'access_token', 'refresh_token', 'credit_card', 'card_number', 'cvv',
  'ssn', 'private_key', 'webhook_secret', 'otp', 'pin',
  'razorpay_key_secret', 'meta_app_secret', 'jwt_secret',
  'pushtoken', 'push_token'
]);

/**
 * Recursively redact sensitive fields from an object
 */
function redactSensitive(obj, depth = 0) {
  if (depth > 5 || obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') return obj;
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(item => redactSensitive(item, depth + 1));

  const redacted = {};
  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase().replace(/[-_]/g, '_');
    if (SENSITIVE_FIELDS.has(lowerKey)) {
      redacted[key] = typeof value === 'string' && value.length > 0
        ? value.substring(0, 4) + '***REDACTED***'
        : '***REDACTED***';
    } else if (typeof value === 'object' && value !== null) {
      redacted[key] = redactSensitive(value, depth + 1);
    } else {
      redacted[key] = value;
    }
  }
  return redacted;
}

// Winston format that redacts sensitive metadata
const redactFormat = winston.format((info) => {
  // Redact any metadata beyond standard fields
  const { level, message, timestamp, ...meta } = info;
  const cleanMeta = redactSensitive(meta);
  return { level, message, timestamp, ...cleanMeta };
});

// Auto-inject correlation context into every log entry
const correlationFormat = winston.format((info) => {
  const ctx = _getCorrelationContext();
  if (ctx) {
    info.correlationId = ctx.correlationId || undefined;
    if (ctx.startTime) {
      info.requestDuration = Date.now() - ctx.startTime;
    }
    if (ctx.metadata) {
      // Propagate structured context fields (orderId, phone, etc.)
      for (const [key, value] of Object.entries(ctx.metadata)) {
        if (value !== undefined && value !== null && !(key in info) && key !== 'createdAt') {
          info[key] = value;
        }
      }
    }
  }
  return info;
});

// Custom format for development (human-readable with redaction)
const devFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'HH: ss' }),
  correlationFormat(),
  redactFormat(),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let metaStr = '';
    if (Object.keys(meta).length > 0) {
      metaStr = '\n' + JSON.stringify(meta, null, 2);
    }
    return `${timestamp} ${level}: ${message}${metaStr}`;
  })
);

// Custom format for production (JSON with redaction)
const prodFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  correlationFormat(),
  redactFormat(),
  winston.format.json()
);

// Create logger instance
const logger = winston.createLogger({
  level: logLevel,
  format: isDevelopment ? devFormat : prodFormat,
  defaultMeta: { 
    service: 'restaurant-whatsapp-bot',
    environment: process.env.NODE_ENV || 'development',
    version: '6.5'
  },
  transports: [
    // Console output
    new winston.transports.Console({
      stderrLevels: ['error']
    })
  ]
});

// Add file transports for production with daily rotation
// Configurable via environment variables
if (!isDevelopment) {
  const LOG_MAX_SIZE = process.env.LOG_MAX_SIZE || '20m';
  const LOG_ERROR_RETENTION_DAYS = process.env.LOG_ERROR_RETENTION_DAYS || '14d';
  const LOG_COMBINED_RETENTION_DAYS = process.env.LOG_COMBINED_RETENTION_DAYS || '7d';
  const LOG_INFO_RETENTION_DAYS = process.env.LOG_INFO_RETENTION_DAYS || '3d';
  const LOG_COMPRESS = process.env.LOG_COMPRESS !== 'false'; // default: true

  // Error logs - daily rotation
  logger.add(new winston.transports.DailyRotateFile({
    filename: path.join(__dirname, '../logs/error-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    level: 'error',
    maxSize: LOG_MAX_SIZE,
    maxFiles: LOG_ERROR_RETENTION_DAYS,
    zippedArchive: LOG_COMPRESS,
    format: prodFormat
  }));
  
  // Combined logs - daily rotation
  logger.add(new winston.transports.DailyRotateFile({
    filename: path.join(__dirname, '../logs/combined-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    maxSize: LOG_MAX_SIZE,
    maxFiles: LOG_COMBINED_RETENTION_DAYS,
    zippedArchive: LOG_COMPRESS,
    format: prodFormat
  }));
  
  // Info logs - daily rotation
  logger.add(new winston.transports.DailyRotateFile({
    filename: path.join(__dirname, '../logs/info-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    level: 'info',
    maxSize: LOG_MAX_SIZE,
    maxFiles: LOG_INFO_RETENTION_DAYS,
    zippedArchive: LOG_COMPRESS,
    format: prodFormat
  }));
}

/**
 * Create child logger with additional context
 * @param {Object} context - Additional context to include in all logs
 * @returns {Object} Child logger instance
 */
function createChildLogger(context) {
  return logger.child(context);
}

/**
 * Log with correlation ID for request tracking
 * @param {string} correlationId - Request correlation ID
 * @returns {Object} Logger with correlation context
 */
function withCorrelation(correlationId) {
  return logger.child({ correlationId });
}

/**
 * Log domain action execution
 * @param {string} domain - Domain name
 * @param {string} action - Action name
 * @param {Object} meta - Additional metadata
 */
function logDomainAction(domain, action, meta = {}) {
  logger.info('Domain action: .', {
    domain,
    action,
    ...meta
  });
}

/**
 * Log external API call
 * @param {string} service - Service name (razorpay, whatsapp, sheets)
 * @param {string} operation - Operation name
 * @param {Object} meta - Additional metadata
 */
function logApiCall(service, operation, meta = {}) {
  logger.info('API call: .', {
    service,
    operation,
    type: 'external_api',
    ...meta
  });
}

/**
 * Log performance timing
 * @param {string} operation - Operation name
 * @param {number} durationMs - Duration in milliseconds
 * @param {Object} meta - Additional metadata
 */
function logPerformance(operation, durationMs, meta = {}) {
  const level = durationMs > 1000 ? 'warn' : 'info';
  logger[level](`Performance: ${operation}`, {
    operation,
    durationMs,
    type: 'performance',
    ...meta
  });
}

/**
 * Log business event
 * @param {string} event - Event name
 * @param {Object} data - Event data
 */
function logEvent(event, data = {}) {
  logger.info('Event', {
    event,
    type: 'business_event',
    ...data
  });
}

/**
 * Log error with context
 * @param {string} message - Error message
 * @param {Error} error - Error object
 * @param {Object} context - Additional context
 */
function logError(message, error, context = {}) {
  logger.error(message, {
    error: {
      message: error.message,
      stack: error.stack,
      code: error.code,
      name: error.name
    },
    ...context
  });
}

/**
 * Create performance timer
 * @param {string} operation - Operation name
 * @returns {Function} End function to call when operation completes
 */
function startTimer(operation) {
  const start = Date.now();
  return (meta = {}) => {
    const duration = Date.now() - start;
    logPerformance(operation, duration, meta);
    return duration;
  };
}

/**
 * Classify an error for alerting and dashboarding
 * @param {Error} err - The error to classify
 * @returns {{ category: string, retryable: boolean }}
 */
function classifyError(err) {
  const msg = (err.message || '').toLowerCase();
  const code = err.code;
  const name = err.name || '';

  // Database errors
  if (name === 'MongoNetworkError' || name === 'MongoServerSelectionError' ||
      code === 'ECONNREFUSED' || msg.includes('topology was destroyed') ||
      msg.includes('connection') && msg.includes('mongo')) {
    return { category: 'database', retryable: true };
  }
  if (code === 11000 || name === 'MongoServerError' && msg.includes('duplicate')) {
    return { category: 'database_duplicate', retryable: false };
  }
  if (name === 'ValidationError' || name === 'CastError') {
    return { category: 'validation', retryable: false };
  }
  // Optimistic concurrency conflict
  if (name === 'VersionError' || msg.includes('no matching document found for id')) {
    return { category: 'concurrency_conflict', retryable: true };
  }

  // Redis errors
  if (msg.includes('redis') || name === 'ReplyError' || name === 'AbortError' ||
      code === 'NR_CLOSED' || code === 'UNCERTAIN_STATE' ||
      msg.includes('maxretriesperrequest') || msg.includes('connection is closed')) {
    return { category: 'redis', retryable: true };
  }

  // Meta/WhatsApp API errors
  if (msg.includes('whatsapp') || msg.includes('meta api') || msg.includes('graph.facebook') ||
      msg.includes('messaging_limit') || msg.includes('template') && msg.includes('rejected') ||
      msg.includes('recipient') && msg.includes('not valid')) {
    return { category: 'meta_api', retryable: false };
  }

  // Payment/Razorpay errors
  if (msg.includes('razorpay') || msg.includes('payment') && msg.includes('failed') ||
      msg.includes('order_creation') || msg.includes('signature') && msg.includes('verification')) {
    return { category: 'payment', retryable: false };
  }

  // Cloudinary / media upload errors
  if (msg.includes('cloudinary') || msg.includes('upload') && msg.includes('image') ||
      msg.includes('resource_type') || msg.includes('transformation')) {
    return { category: 'media_upload', retryable: true };
  }

  // Network / external API errors
  if (code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'ENOTFOUND' ||
      code === 'EAI_AGAIN' || msg.includes('socket hang up') || msg.includes('timeout')) {
    return { category: 'network', retryable: true };
  }

  // Rate limiting
  if (err.status === 429 || msg.includes('rate limit') || msg.includes('too many requests')) {
    return { category: 'rate_limit', retryable: true };
  }

  // Auth / permission
  if (err.status === 401 || err.status === 403 || msg.includes('unauthorized') || msg.includes('forbidden')) {
    return { category: 'auth', retryable: false };
  }

  // Business logic
  if (err.status >= 400 && err.status < 500) {
    return { category: 'business_logic', retryable: false };
  }

  return { category: 'unknown', retryable: true };
}

/**
 * Log a route-level error with classification and respond with 500.
 * Replaces the repetitive: logger.error(msg, {error}); res.status(500).json({error})
 * @param {Object} res - Express response object
 * @param {string} message - Log message
 * @param {Error} error - The caught error
 * @param {number} [statusCode=500] - HTTP status code
 */
function logRouteError(res, message, error, statusCode = 500) {
  const { category, retryable } = classifyError(error);
  logger.error(message, {
    error: error.message,
    stack: error.stack,
    code: error.code,
    category,
    retryable
  });
  if (!res.headersSent) {
    res.status(statusCode).json({ error: error.message });
  }
}

/**
 * Runtime log level change
 * @param {string} newLevel - New log level (error, warn, info, http, verbose, debug, silly)
 * @returns {{ previous: string, current: string }}
 */
function setLogLevel(newLevel) {
  const validLevels = ['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly'];
  if (!validLevels.includes(newLevel)) {
    throw new Error(`Invalid log level: ${newLevel}. Must be one of: ${validLevels.join(', ')}`);
  }
  const previous = logger.level;
  logger.level = newLevel;
  logger.transports.forEach(t => { t.level = t.level === previous ? newLevel : t.level; });
  logger.info('Log level changed at runtime', { from: previous, to: newLevel });
  return { previous, current: newLevel };
}

// Export logger and utility functions
module.exports = {
  // Winston logger instance
  logger,
  
  // Utility functions
  createChildLogger,
  withCorrelation,
  logDomainAction,
  logApiCall,
  logPerformance,
  logEvent,
  logError,
  logRouteError,
  startTimer,
  classifyError,
  setCorrelationProvider,
  setLogLevel,
  
  // Direct access to log levels
  debug: logger.debug.bind(logger),
  info: logger.info.bind(logger),
  warn: logger.warn.bind(logger),
  error: logger.error.bind(logger),
  
  // Metadata
  getMetadata: () => ({
    version: '6.5',
    phase: 'Phase 6.5: Enhanced Logging',
    features: [
      'Environment-aware log levels',
      'Structured JSON for production',
      'Human-readable for development',
      'Correlation ID support',
      'Performance timing',
      'Error tracking',
      'Daily log rotation',
      'Compressed archives',
      'Separate error logs'
    ]
  })
};
