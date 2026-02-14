/**
 * Rate Limiter Middleware Tests
 *
 * The rate limiter now uses rate-limiter-flexible (Redis-backed with
 * in-memory fallback). createRateLimiter returns a RateLimiter *instance*,
 * while the pre-configured exports (authRateLimiter, etc.) are async
 * Express middleware functions wrapping those instances.
 */
const { createRateLimiter, adminRateLimiter, publicRateLimiter, authRateLimiter, strictRateLimiter, webhookRateLimiter } = require('../../middleware/rateLimiter');

describe('Rate Limiter Middleware', () => {
  let req, res, next;

  beforeEach(() => {
    req = {
      ip: '127.0.0.1',
      connection: { remoteAddress: '127.0.0.1' }
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      setHeader: jest.fn()
    };
    next = jest.fn();
  });

  describe('createRateLimiter', () => {
    it('should return a rate-limiter-flexible instance with consume method', () => {
      const limiter = createRateLimiter({ points: 10, duration: 60, keyPrefix: 'test-obj' });
      expect(limiter).toBeDefined();
      expect(typeof limiter.consume).toBe('function');
    });

    it('should allow consumption within limit', async () => {
      const limiter = createRateLimiter({
        points: 5,
        duration: 60,
        keyPrefix: 'test-consume-ok'
      });

      const result = await limiter.consume('test-ip');
      expect(result.remainingPoints).toBe(4);
    });

    it('should reject consumption exceeding limit', async () => {
      const limiter = createRateLimiter({
        points: 2,
        duration: 60,
        keyPrefix: 'test-consume-exceed'
      });

      await limiter.consume('exceed-ip');
      await limiter.consume('exceed-ip');

      // 3rd consume should throw (rate limited)
      await expect(limiter.consume('exceed-ip')).rejects.toBeDefined();
    });

    it('should separate limits by keyPrefix', async () => {
      const limiter1 = createRateLimiter({ points: 1, duration: 60, keyPrefix: 'prefix-a' });
      const limiter2 = createRateLimiter({ points: 1, duration: 60, keyPrefix: 'prefix-b' });

      await limiter1.consume('same-ip');
      // Different prefix — should still be allowed
      const result = await limiter2.consume('same-ip');
      expect(result.remainingPoints).toBe(0);
    });
  });

  describe('Pre-configured limiters', () => {
    it('should export adminRateLimiter as a function', () => {
      expect(typeof adminRateLimiter).toBe('function');
    });

    it('should export publicRateLimiter as a function', () => {
      expect(typeof publicRateLimiter).toBe('function');
    });

    it('should export authRateLimiter as a function', () => {
      expect(typeof authRateLimiter).toBe('function');
    });

    it('should export strictRateLimiter as a function', () => {
      expect(typeof strictRateLimiter).toBe('function');
    });

    it('should export webhookRateLimiter as a function', () => {
      expect(typeof webhookRateLimiter).toBe('function');
    });

    it('adminRateLimiter should call next for a valid request', async () => {
      req.ip = '10.0.0.200';
      await adminRateLimiter(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('publicRateLimiter should call next for a valid request', async () => {
      req.ip = '10.0.0.201';
      await publicRateLimiter(req, res, next);
      expect(next).toHaveBeenCalled();
    });
  });
});
