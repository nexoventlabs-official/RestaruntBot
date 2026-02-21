/**
 * Global Error Handler Middleware
 * Phase 6.5: Added alerting for critical errors
 * 
 * Provides production-safe error responses without stack trace leakage
 * Sends alerts for critical errors (500s)
 */

const alerting = require('../services/alerting');
const logger = require('../services/logger'); // Phase 6.5
const metricsRedis = require('../services/metricsRedis'); // Phase 6.5
const { getCorrelationId } = require('../services/correlationContext');

const errorHandler = async (err, req, res, next) => {
  // Classify error for alerting and dashboarding
  const { category, retryable } = logger.classifyError(err);

  // Log error details — always include stack, code, and name in production
  logger.error('Error occurred', {
    message: err.message,
    stack: err.stack,
    code: err.code,
    name: err.name,
    category,
    retryable,
    path: req.path,
    method: req.method
  });

  // Determine status code
  const statusCode = err.statusCode || err.status || 500;
  
  // Phase 6.5: Record error in metrics
  try {
    await metricsRedis.recordError(
      err.name || 'Error',
      err.message || 'Unknown error'
    );
  } catch (metricsError) {
    logger.error('Failed to record error metric:', metricsError.message);
  }
  
  // Phase 6.5: Send alert for critical errors (500s)
  if (statusCode === 500 && process.env.NODE_ENV === 'production') {
    try {
      await alerting.alertCriticalError(err, {
        path: req.path,
        method: req.method,
        user: req.user?.id || 'anonymous',
        ip: req.ip
      });
    } catch (alertError) {
      logger.error('Failed to send error alert:', alertError.message);
    }
  }

  // Production vs Development response
  const requestId = typeof getCorrelationId === 'function' ? getCorrelationId() : undefined;

  if (process.env.NODE_ENV === 'production') {
    // Production: Generic error message, no stack traces
    return res.status(statusCode).json({
      success: false,
      error: statusCode === 500 ? 'Internal Server Error' : err.message,
      ...(requestId && { requestId }),
      timestamp: new Date().toISOString()
    });
  }

  // Development: Detailed error information
  return res.status(statusCode).json({
    success: false,
    error: err.message,
    stack: err.stack,
    category,
    retryable,
    ...(requestId && { requestId }),
    details: err.details || undefined,
    timestamp: new Date().toISOString()
  });
};

module.exports = errorHandler;
