/**
 * Production Readiness Fixes - Test Suite
 * 
 * Tests for all 8 production-readiness issues:
 * #1 Redis-backed rate limiters
 * #2 Upload size/type limits
 * #3 SSE authentication
 * #4 Swagger hidden in production
 * #5 Log sensitive data redaction
 * #6 Docker Compose hardening
 * #7 JWT refresh token flow
 * #8 (covered by #1 - login brute-force protection)
 */

const fs = require('fs');
const path = require('path');

// ─── Mocks ─────────────────────────────────────────────────────────
jest.mock('../services/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  child: jest.fn().mockReturnValue({ info: jest.fn(), warn: jest.fn(), error: jest.fn() })
}));

// ─── #1: Redis-backed Rate Limiters ────────────────────────────────
describe('#1 Redis-backed Rate Limiters', () => {
  it('rateLimiter.js should use rate-limiter-flexible (not plain Map)', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'middleware', 'rateLimiter.js'), 'utf8');
    expect(code).toContain('rate-limiter-flexible');
    expect(code).toContain('RateLimiterRedis');
    expect(code).toContain('insuranceLimiter');
    // Should NOT have the old in-memory Map store
    expect(code).not.toContain('const rateLimitStore = new Map()');
  });

  it('should export all required middleware names', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'middleware', 'rateLimiter.js'), 'utf8');
    expect(code).toContain('authRateLimiter');
    expect(code).toContain('adminRateLimiter');
    expect(code).toContain('webhookRateLimiter');
    expect(code).toContain('publicRateLimiter');
    expect(code).toContain('strictRateLimiter');
  });
});

// ─── #2: Upload Size and Type Limits ───────────────────────────────
describe('#2 Upload Size and Type Limits', () => {
  const filesToCheck = [
    { file: 'routes/offers.js', name: 'offers' },
    { file: 'routes/heroSection.js', name: 'heroSection' }
  ];

  for (const { file, name } of filesToCheck) {
    it(`${name} should have fileSize limit on multer`, () => {
      const code = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
      expect(code).toContain('fileSize');
      expect(code).toMatch(/10\s*\*\s*1024\s*\*\s*1024/); // 10MB
    });

    it(`${name} should have fileFilter for images only`, () => {
      const code = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
      expect(code).toContain('fileFilter');
      expect(code).toContain("file.mimetype.startsWith('image/')");
    });
  }
});

// ─── #3: SSE Endpoint Authentication ───────────────────────────────
describe('#3 SSE Endpoint Authentication', () => {
  it('SSE endpoint should require JWT verification', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    // Find the /api/events route
    const sseSection = code.substring(code.indexOf("app.get('/api/events'"));
    expect(sseSection).toContain('verify');
    expect(sseSection).toContain('JWT_SECRET');
    expect(sseSection).toContain('401');
  });
});

// ─── #4: Swagger Hidden in Production ──────────────────────────────
describe('#4 Swagger Hidden in Production', () => {
  it('api-docs.json should NOT be exposed unconditionally', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    // The old code had: app.get('/api-docs.json', ...) outside any env check
    // New code should gate it behind NODE_ENV check
    const jsonEndpointIdx = code.indexOf("'/api-docs.json'");
    expect(jsonEndpointIdx).toBeGreaterThan(-1);
    // Check that there's a production check before it
    const beforeEndpoint = code.substring(Math.max(0, jsonEndpointIdx - 200), jsonEndpointIdx);
    expect(beforeEndpoint).toContain('production');
  });
});

// ─── #5: Log Sensitive Data Redaction ──────────────────────────────
describe('#5 Log Sensitive Data Redaction', () => {
  it('logger.js should define sensitive field list and redaction', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'services', 'logger.js'), 'utf8');
    expect(code).toContain('SENSITIVE_FIELDS');
    expect(code).toContain('redactSensitive');
    expect(code).toContain('REDACTED');
    expect(code).toContain('password');
    expect(code).toContain('secret');
    expect(code).toContain('authorization');
  });

  it('redaction format should be wired into both dev and prod formats', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'services', 'logger.js'), 'utf8');
    // redactFormat() should appear in both format.combine() calls
    const matches = code.match(/redactFormat\(\)/g);
    expect(matches).not.toBeNull();
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });
});

// ─── #6: Docker Compose Hardening ──────────────────────────────────
describe('#6 Docker Compose Hardening', () => {
  let dockerCode;
  beforeAll(() => {
    dockerCode = fs.readFileSync(path.join(__dirname, '..', '..', 'docker-compose.yml'), 'utf8');
  });

  it('Redis should require a password', () => {
    expect(dockerCode).toContain('--requirepass');
  });

  it('MongoDB port should be bound to localhost', () => {
    expect(dockerCode).toContain('127.0.0.1:27017');
  });

  it('Redis port should be bound to localhost', () => {
    expect(dockerCode).toContain('127.0.0.1:6379');
  });
});

// ─── #7: JWT Refresh Token Flow ────────────────────────────────────
describe('#7 JWT Refresh Token Flow', () => {
  it('auth.js should import jwtRefresh service', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'routes', 'auth.js'), 'utf8');
    expect(code).toContain("require('../services/jwtRefresh')");
    expect(code).toContain('generateTokenPair');
  });

  it('login should return refreshToken alongside token', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'routes', 'auth.js'), 'utf8');
    expect(code).toContain('refreshToken');
    expect(code).toContain('expiresIn');
  });

  it('should have /refresh endpoint', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'routes', 'auth.js'), 'utf8');
    expect(code).toMatch(/router\.post\(['"]\/refresh['"]/);
    expect(code).toContain('rotateRefreshToken');
  });

  it('should have /revoke endpoint for logout', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'routes', 'auth.js'), 'utf8');
    expect(code).toMatch(/router\.post\(['"]\/revoke['"]/);
    expect(code).toContain('revokeRefreshToken');
  });

  it('access token should include id field for compatibility', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'services', 'jwtRefresh.js'), 'utf8');
    expect(code).toContain('id: userId');
  });

  describe('jwtRefresh service logic', () => {
    let jwtRefresh;
    const originalEnv = process.env.JWT_SECRET;

    beforeAll(() => {
      process.env.JWT_SECRET = 'test-jwt-secret-key-minimum-32-characters-long-for-testing';
      jest.resetModules();
      jwtRefresh = require('../services/jwtRefresh');
    });

    afterAll(() => {
      process.env.JWT_SECRET = originalEnv;
    });

    it('generateTokenPair should return accessToken and refreshToken', () => {
      const tokens = jwtRefresh.generateTokenPair('user123', 'admin');
      expect(tokens.accessToken).toBeDefined();
      expect(tokens.refreshToken).toBeDefined();
      expect(tokens.accessTokenExpiresIn).toBe('15m');
      expect(tokens.refreshTokenExpiresIn).toBe('7d');
    });

    it('rotateRefreshToken should return new token pair and invalidate old', () => {
      const tokens = jwtRefresh.generateTokenPair('user456', 'admin');
      const newTokens = jwtRefresh.rotateRefreshToken(tokens.refreshToken);
      expect(newTokens.accessToken).toBeDefined();
      expect(newTokens.refreshToken).not.toBe(tokens.refreshToken);
    });

    it('reusing an old refresh token should throw (replay detection)', () => {
      const tokens = jwtRefresh.generateTokenPair('user789', 'admin');
      // First rotation succeeds
      jwtRefresh.rotateRefreshToken(tokens.refreshToken);
      // Second rotation should fail (token already used)
      expect(() => jwtRefresh.rotateRefreshToken(tokens.refreshToken)).toThrow();
    });

    it('revokeRefreshToken should invalidate the token', () => {
      const tokens = jwtRefresh.generateTokenPair('userABC', 'admin');
      const result = jwtRefresh.revokeRefreshToken(tokens.refreshToken);
      expect(result).toBe(true);
      expect(() => jwtRefresh.rotateRefreshToken(tokens.refreshToken)).toThrow();
    });
  });
});

// ─── #8: Login Brute Force (covered by #1) ─────────────────────────
describe('#8 Login Brute Force Protection (via Redis rate limiter)', () => {
  it('auth.js login route should use strictRateLimiter', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'routes', 'auth.js'), 'utf8');
    const loginSection = code.substring(code.indexOf("router.post('/login'"), code.indexOf("router.get('/verify'"));
    expect(loginSection).toContain('strictRateLimiter');
  });

  it('strictRateLimiter should use Redis-backed store', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'middleware', 'rateLimiter.js'), 'utf8');
    expect(code).toContain("keyPrefix: 'rl:strict'");
    expect(code).toContain('blockDuration: 30 * 60');
  });
});
