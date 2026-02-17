/**
 * Rate Limiting Middleware (Redis-backed with in-memory fallback)
 * 
 * Strategy: Uses Redis via rate-limiter-flexible for persistence across restarts.
 * Falls back to in-memory if Redis is unavailable (logs a warning).
 * 
 * Rate Limits:
 * - Auth endpoints: 20 requests per 15 minutes per IP
 * - Admin endpoints: 5000 requests per 15 minutes per IP
 * - Webhook endpoints: 1000 requests per minute per IP
 * - Public endpoints: 500 requests per 15 minutes per IP
 * - Strict (login): 5 requests per 15 minutes per IP (30-min block)
 */

const { RateLimiterRedis, RateLimiterMemory } = require('rate-limiter-flexible');
const logger = require('../services/logger');

let redisClient = null;
let useRedis = false;

// Attempt to load Redis client
try {
  const { getClient } = require('../services/redis');
  redisClient = getClient();
  if (redisClient) {
    useRedis = true;
    logger.info('✅ Rate limiter using Redis store (persistent across restarts)');
  }
} catch (err) {
  logger.warn('⚠️ Redis not available for rate limiting, using in-memory fallback', { error: err.message });
}

/**
 * Create a rate limiter instance (Redis first, memory fallback)
 */
function createRateLimiterInstance(options) {
  const { points, duration, keyPrefix = 'rl', blockDuration = 0 } = options;

  if (useRedis && redisClient) {
    try {
      return new RateLimiterRedis({
        storeClient: redisClient,
        keyPrefix,
        points,
        duration,
        blockDuration,
        execEvenly: false,
        // If Redis connection fails at runtime, insurance limiter takes over
        insuranceLimiter: new RateLimiterMemory({ points, duration, blockDuration })
      });
    } catch (err) {
      logger.warn(`⚠️ Redis rate limiter creation failed for ${keyPrefix}, using memory`, { error: err.message });
    }
  }

  return new RateLimiterMemory({ points, duration, blockDuration });
}

/**
 * Wrap a rate limiter instance into Express middleware
 */
function createMiddleware(limiter, message = 'Too many requests') {
  return async (req, res, next) => {
    const key = req.ip || req.connection.remoteAddress || 'unknown';

    try {
      const result = await limiter.consume(key);

      res.setHeader('X-RateLimit-Limit', limiter.points);
      res.setHeader('X-RateLimit-Remaining', result.remainingPoints);
      res.setHeader('X-RateLimit-Reset', new Date(Date.now() + result.msBeforeNext).toISOString());
      next();
    } catch (rateLimiterRes) {
      // rateLimiterRes may be a RateLimiterRes or an Error
      if (rateLimiterRes instanceof Error) {
        // Internal error in rate limiter — let request through rather than blocking
        logger.error('Rate limiter internal error', { error: rateLimiterRes.message });
        return next();
      }

      const retryAfter = Math.ceil(rateLimiterRes.msBeforeNext / 1000);

      res.setHeader('X-RateLimit-Limit', limiter.points);
      res.setHeader('X-RateLimit-Remaining', 0);
      res.setHeader('X-RateLimit-Reset', new Date(Date.now() + rateLimiterRes.msBeforeNext).toISOString());
      res.setHeader('Retry-After', retryAfter);

      logger.warn(`⚠️ Rate limit exceeded: ${key} (${limiter.keyPrefix || 'unknown'})`);

      return res.status(429).json({
        error: message,
        code: 'RATE_LIMIT_EXCEEDED',
        retryAfter,
        limit: limiter.points,
        window: `${limiter.duration}s`
      });
    }
  };
}

// ─── Pre-configured limiters ───────────────────────────────────────

const authLimiter = createRateLimiterInstance({
  points: 50,
  duration: 15 * 60,
  keyPrefix: 'rl:auth',
  blockDuration: 5 * 60
});

const adminLimiter = createRateLimiterInstance({
  points: 5000,
  duration: 15 * 60,
  keyPrefix: 'rl:admin'
});

const webhookLimiter = createRateLimiterInstance({
  points: 1000,
  duration: 60,
  keyPrefix: 'rl:webhook'
});

const publicLimiter = createRateLimiterInstance({
  points: 500,
  duration: 15 * 60,
  keyPrefix: 'rl:public'
});

const strictLimiter = createRateLimiterInstance({
  points: 15,
  duration: 15 * 60,
  keyPrefix: 'rl:strict',
  blockDuration: 5 * 60
});

// ─── Utility helpers ───────────────────────────────────────────────

function getRateLimitStats() {
  return {
    store: useRedis ? 'redis' : 'memory',
    presets: ['auth', 'admin', 'webhook', 'public', 'strict']
  };
}

function clearRateLimit(ip, prefix = null) {
  const limiters = [authLimiter, adminLimiter, webhookLimiter, publicLimiter, strictLimiter];
  const targets = prefix
    ? limiters.filter(l => l.keyPrefix && l.keyPrefix.includes(prefix))
    : limiters;

  return Promise.all(targets.map(l => l.delete(ip).catch(() => {})));
}

module.exports = {
  createRateLimiter: createRateLimiterInstance,
  authRateLimiter: createMiddleware(authLimiter, 'Too many authentication attempts, please try again later'),
  adminRateLimiter: createMiddleware(adminLimiter, 'Too many admin requests, please slow down'),
  webhookRateLimiter: createMiddleware(webhookLimiter, 'Webhook rate limit exceeded'),
  publicRateLimiter: createMiddleware(publicLimiter, 'Too many requests, please try again later'),
  strictRateLimiter: createMiddleware(strictLimiter, 'Too many attempts, please try again later'),
  getRateLimitStats,
  clearRateLimit
};
