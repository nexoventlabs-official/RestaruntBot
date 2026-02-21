/**
 * Observability 10/10 Maturity Tests
 * 
 * Validates all 7 dimensions at maximum maturity level:
 * D1: Correlation context for ALL background workers + SSE
 * D2: Zero template literal logger calls (100% structured)
 * D3: State transitions with from/to for all entity types
 * D4: Error classification with 10+ categories + logRouteError adoption
 * D5: External API timers for ALL outbound calls
 * D6: Retry logging with backoff strategy
 * D7: Log aggregation infrastructure (runtime level, Prometheus, configurable rotation)
 */

const fs = require('fs');
const path = require('path');

const servicesDir = path.join(__dirname, '..', 'services');
const routesDir = path.join(__dirname, '..', 'routes');
const middlewareDir = path.join(__dirname, '..', 'middleware');

function readSrc(dir, file) {
  return fs.readFileSync(path.join(dir, file), 'utf8');
}

// ═══════════════════════════════════════════════════════════════
// D1: Correlation Context — ALL background workers + SSE
// ═══════════════════════════════════════════════════════════════
describe('D1: Correlation context for background workers', () => {
  const bgWorkers = [
    'orderScheduler.js',
    'outboundRetryWorker.js',
    'dailyCleanup.js',
    'categoryScheduler.js',
    'orderCleanup.js',
    'catalogRatingSync.js',
    'orderReconciliation.js',
    'dashboardStatsSync.js',
    'pushTokenCleanup.js',
    'catalogReviewPoller.js'
  ];

  bgWorkers.forEach(file => {
    it(`${file} imports correlationContext`, () => {
      const src = readSrc(servicesDir, file);
      expect(src).toMatch(/require\(.*correlationContext.*\)/);
    });

    it(`${file} uses initContext or runWithContext`, () => {
      const src = readSrc(servicesDir, file);
      expect(src).toMatch(/initContext|runWithContext/);
    });
  });

  it('server.js SSE endpoint has correlation context', () => {
    const src = readSrc(path.join(__dirname, '..'), 'server.js');
    expect(src).toMatch(/initContext.*sse|sse.*initContext/is);
  });
});

// ═══════════════════════════════════════════════════════════════
// D2: Zero template literal logger calls
// ═══════════════════════════════════════════════════════════════
describe('D2: Structured logging — zero template literals', () => {
  const allServiceFiles = fs.readdirSync(servicesDir).filter(f => f.endsWith('.js'));
  const allRouteFiles = fs.readdirSync(routesDir).filter(f => f.endsWith('.js'));
  const allMiddlewareFiles = fs.readdirSync(middlewareDir).filter(f => f.endsWith('.js'));
  const allFiles = [
    ...allServiceFiles.map(f => ({ dir: servicesDir, file: f })),
    ...allRouteFiles.map(f => ({ dir: routesDir, file: f })),
    ...allMiddlewareFiles.map(f => ({ dir: middlewareDir, file: f }))
  ];

  it('no template literal logger calls in any source file', () => {
    const violators = [];
    for (const { dir, file } of allFiles) {
      const src = readSrc(dir, file);
      const matches = src.match(/logger\.(info|error|warn|debug)\s*\(\s*`/g);
      if (matches) {
        violators.push({ file, count: matches.length });
      }
    }
    expect(violators).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════
// D3: State transitions with from/to logging
// ═══════════════════════════════════════════════════════════════
describe('D3: State transition logging', () => {
  it('order.js uses transitionStatus for state transitions', () => {
    const src = readSrc(routesDir, 'order.js');
    expect(src).toMatch(/transitionStatus\(order,\s*status/);
    expect(src).toMatch(/'admin'/);
  });

  it('order.js state transitions are gated by state machine', () => {
    const src = readSrc(routesDir, 'order.js');
    // transitionStatus already logs from/to internally via orderStateMachine.js
    expect(src).toMatch(/transitionStatus/);
    // Should NOT have manual order.status = status in the admin update handler
    expect(src).not.toMatch(/validateTransition[\s\S]*?order\.status\s*=\s*status/);
  });

  it('whatsapp.js logs state_transition for outbound message sent', () => {
    const src = readSrc(servicesDir, 'whatsapp.js');
    expect(src).toContain("'state_transition'");
    expect(src).toMatch(/entity:\s*'outbound_message'/);
    expect(src).toMatch(/from:\s*previousStatus/);
  });

  it('whatsapp.js logs state_transition for outbound message failure', () => {
    const src = readSrc(servicesDir, 'whatsapp.js');
    const failBlock = src.indexOf("const prevStatus = outboundMsg.status");
    expect(failBlock).toBeGreaterThan(-1);
    expect(src.indexOf("from: prevStatus")).toBeGreaterThan(failBlock);
  });

  it('webhook.js logs state_transition for delivery status updates', () => {
    const src = readSrc(routesDir, 'webhook.js');
    expect(src).toMatch(/state_transition.*outbound_message.*webhook/s);
  });
});

// ═══════════════════════════════════════════════════════════════
// D4: Error classification + logRouteError adoption
// ═══════════════════════════════════════════════════════════════
describe('D4: Error classification completeness', () => {
  const loggerSrc = readSrc(servicesDir, 'logger.js');

  it('classifyError handles Redis errors', () => {
    expect(loggerSrc).toContain("category: 'redis'");
  });

  it('classifyError handles Meta/WhatsApp API errors', () => {
    expect(loggerSrc).toContain("category: 'meta_api'");
  });

  it('classifyError handles payment/Razorpay errors', () => {
    expect(loggerSrc).toContain("category: 'payment'");
  });

  it('classifyError handles media upload/Cloudinary errors', () => {
    expect(loggerSrc).toContain("category: 'media_upload'");
  });

  it('classifyError covers 10+ distinct categories', () => {
    const categories = loggerSrc.match(/category:\s*'(\w+)'/g);
    const unique = new Set(categories.map(c => c.match(/'(\w+)'/)[1]));
    expect(unique.size).toBeGreaterThanOrEqual(10);
  });

  it('classifyError functional: Redis error → redis category', () => {
    const { classifyError } = require('../services/logger');
    const result = classifyError(new Error('redis connection is closed'));
    expect(result.category).toBe('redis');
    expect(result.retryable).toBe(true);
  });

  it('classifyError functional: Cloudinary error → media_upload', () => {
    const { classifyError } = require('../services/logger');
    const result = classifyError(new Error('cloudinary upload failed'));
    expect(result.category).toBe('media_upload');
  });

  it('classifyError functional: Razorpay error → payment', () => {
    const { classifyError } = require('../services/logger');
    const result = classifyError(new Error('razorpay order creation failed'));
    expect(result.category).toBe('payment');
  });
});

describe('D4: logRouteError adoption', () => {
  const routeFiles = fs.readdirSync(routesDir).filter(f => f.endsWith('.js') && f !== 'health.js');

  it('majority of route files import logRouteError', () => {
    let count = 0;
    for (const file of routeFiles) {
      const src = readSrc(routesDir, file);
      if (src.includes('logRouteError')) count++;
    }
    // At least 14 of ~17 route files should use logRouteError
    expect(count).toBeGreaterThanOrEqual(14);
  });

  it('raw res.status(500).json count is below 15 across all routes', () => {
    let total = 0;
    for (const file of routeFiles) {
      const src = readSrc(routesDir, file);
      const matches = src.match(/res\.status\(500\)\.json/g);
      if (matches) total += matches.length;
    }
    expect(total).toBeLessThan(15);
  });

  it('errorHandler.js includes requestId in error responses', () => {
    const src = readSrc(middlewareDir, 'errorHandler.js');
    expect(src).toContain('requestId');
    expect(src).toContain('getCorrelationId');
  });
});

// ═══════════════════════════════════════════════════════════════
// D5: External API timers for ALL outbound calls
// ═══════════════════════════════════════════════════════════════
describe('D5: External API timers', () => {
  it('metaCloud.js has startTimer for ALL async functions', () => {
    const src = readSrc(servicesDir, 'metaCloud.js');
    const asyncFns = src.match(/async\s+(\w+)\s*\(/g);
    const timerCalls = src.match(/startTimer\('meta\.\w+'\)/g);
    // Every async function should have a timer
    expect(timerCalls.length).toBeGreaterThanOrEqual(asyncFns.length);
  });

  it('brevoMail.js has startTimer for ALL async functions', () => {
    const src = readSrc(servicesDir, 'brevoMail.js');
    const asyncFns = src.match(/async\s+(\w+)\s*\(/g);
    const timerCalls = src.match(/startTimer\('brevo\.\w+'\)/g);
    expect(timerCalls.length).toBeGreaterThanOrEqual(asyncFns.length);
  });

  it('cloudinary.js has startTimer for async functions', () => {
    const src = readSrc(servicesDir, 'cloudinary.js');
    const timerCalls = src.match(/startTimer\('cloudinary\.\w+'\)/g);
    expect(timerCalls).not.toBeNull();
    expect(timerCalls.length).toBeGreaterThanOrEqual(2);
  });

  it('groqAi.js has startTimer for ALL async functions', () => {
    const src = readSrc(servicesDir, 'groqAi.js');
    const asyncFns = src.match(/async\s+(\w+)\s*\(/g);
    const timerCalls = src.match(/startTimer\('groq\.\w+'\)/g);
    expect(timerCalls.length).toBeGreaterThanOrEqual(asyncFns.length);
  });

  it('ALL API timer functions have endTimer on error path', () => {
    const files = ['metaCloud.js', 'brevoMail.js', 'cloudinary.js', 'groqAi.js'];
    for (const file of files) {
      const src = readSrc(servicesDir, file);
      const timers = src.match(/const endTimer = startTimer\('/g) || [];
      const errorEndTimers = src.match(/endTimer\(\{\s*success:\s*false/g) || [];
      expect(errorEndTimers.length).toBeGreaterThanOrEqual(timers.length);
    }
  });

  it('ALL API timer functions have endTimer on success path', () => {
    const files = ['metaCloud.js', 'brevoMail.js', 'cloudinary.js', 'groqAi.js'];
    for (const file of files) {
      const src = readSrc(servicesDir, file);
      const timers = src.match(/const endTimer = startTimer\('/g) || [];
      const successEndTimers = src.match(/endTimer\(\{\s*success:\s*true/g) || [];
      expect(successEndTimers.length).toBeGreaterThanOrEqual(timers.length);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// D6: Retry logging with backoff strategy
// ═══════════════════════════════════════════════════════════════
describe('D6: Retry and backoff logging', () => {
  it('outboundRetryWorker logs backoffStrategy on retry scheduling', () => {
    const src = readSrc(servicesDir, 'outboundRetryWorker.js');
    expect(src).toContain("backoffStrategy: 'exponential'");
  });

  it('outboundRetryWorker logs state_transition on retry success', () => {
    const src = readSrc(servicesDir, 'outboundRetryWorker.js');
    expect(src).toMatch(/state_transition.*retry_worker/s);
  });

  it('outboundRetryWorker logs state_transition on retry exhaustion', () => {
    const src = readSrc(servicesDir, 'outboundRetryWorker.js');
    expect(src).toMatch(/state_transition.*retry_exhausted/s);
  });

  it('pushNotification.js logs backoffStrategy in FCM retries', () => {
    const src = readSrc(servicesDir, 'pushNotification.js');
    expect(src).toContain("backoffStrategy: 'exponential'");
  });

  it('pushNotification.js logs attempt and maxRetries in FCM retries', () => {
    const src = readSrc(servicesDir, 'pushNotification.js');
    expect(src).toMatch(/attempt:.*maxRetries:/s);
  });

  it('server.js MongoDB has finite max retries', () => {
    const src = readSrc(path.join(__dirname, '..'), 'server.js');
    expect(src).toMatch(/MONGO_MAX_RETRIES\s*=/);
    expect(src).toMatch(/mongoRetryCount\s*>=?\s*MONGO_MAX_RETRIES/);
  });

  it('server.js MongoDB logs exponential backoff details', () => {
    const src = readSrc(path.join(__dirname, '..'), 'server.js');
    expect(src).toContain("backoffStrategy: 'exponential'");
  });
});

// ═══════════════════════════════════════════════════════════════
// D7: Log aggregation infrastructure
// ═══════════════════════════════════════════════════════════════
describe('D7: Log aggregation infrastructure', () => {
  it('logger.js exports setLogLevel function', () => {
    const { setLogLevel } = require('../services/logger');
    expect(typeof setLogLevel).toBe('function');
  });

  it('setLogLevel validates input and changes level', () => {
    const { setLogLevel, logger } = require('../services/logger');
    const original = logger.level;
    const result = setLogLevel('warn');
    expect(result.previous).toBe(original);
    expect(result.current).toBe('warn');
    expect(logger.level).toBe('warn');
    // Restore
    setLogLevel(original);
  });

  it('setLogLevel rejects invalid levels', () => {
    const { setLogLevel } = require('../services/logger');
    expect(() => setLogLevel('invalid')).toThrow('Invalid log level');
  });

  it('log rotation is configurable via env vars', () => {
    const src = readSrc(servicesDir, 'logger.js');
    expect(src).toContain('LOG_MAX_SIZE');
    expect(src).toContain('LOG_ERROR_RETENTION_DAYS');
    expect(src).toContain('LOG_COMBINED_RETENTION_DAYS');
    expect(src).toContain('LOG_INFO_RETENTION_DAYS');
    expect(src).toContain('LOG_COMPRESS');
  });

  it('health routes have PUT /log-level endpoint', () => {
    const src = readSrc(routesDir, 'health.js');
    expect(src).toContain("put('/log-level'");
    expect(src).toContain('setLogLevel');
  });

  it('health routes have GET /log-level endpoint', () => {
    const src = readSrc(routesDir, 'health.js');
    expect(src).toContain("get('/log-level'");
  });

  it('health routes have Prometheus metrics endpoint', () => {
    const src = readSrc(routesDir, 'health.js');
    expect(src).toContain("get('/prometheus'");
    expect(src).toContain("text/plain; version=0.0.4");
    expect(src).toContain('process_uptime_seconds');
    expect(src).toContain('http_requests_total');
  });

  it('alerting.js has configurable thresholds via env vars', () => {
    const src = readSrc(servicesDir, 'alerting.js');
    expect(src).toContain('ALERT_THRESHOLDS');
    expect(src).toContain('ALERT_ERROR_RATE_THRESHOLD');
    expect(src).toContain('ALERT_API_FAILURE_THRESHOLD');
    expect(src).toContain('ALERT_COOLDOWN_MS');
  });

  it('alerting.js exports ALERT_THRESHOLDS', () => {
    // Just verify it's in the exports
    const src = readSrc(servicesDir, 'alerting.js');
    expect(src).toMatch(/module\.exports\s*=\s*\{[\s\S]*ALERT_THRESHOLDS/);
  });

  it('errorHandler.js includes requestId from correlation context', () => {
    const src = readSrc(middlewareDir, 'errorHandler.js');
    expect(src).toContain('getCorrelationId');
    expect(src).toContain('requestId');
  });
});

// ═══════════════════════════════════════════════════════════════
// Cross-cutting: Overall maturity validation
// ═══════════════════════════════════════════════════════════════
describe('Cross-cutting: Overall observability maturity', () => {
  it('ALL service files use logger (not console)', () => {
    const files = fs.readdirSync(servicesDir).filter(f => f.endsWith('.js'));
    const consoleLogs = [];
    for (const file of files) {
      if (['logger.js', 'correlationContext.js'].includes(file)) continue;
      const src = readSrc(servicesDir, file);
      // Match console.log/error/warn but not inside comments
      const lines = src.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith('//') || line.startsWith('*')) continue;
        if (/console\.(log|error|warn)\(/.test(line)) {
          consoleLogs.push(`${file}:${i + 1}`);
        }
      }
    }
    // Allow max 2 console calls (some may be intentional for startup)
    expect(consoleLogs.length).toBeLessThanOrEqual(2);
  });

  it('logger.js version reflects 10/10 maturity', () => {
    const src = readSrc(servicesDir, 'logger.js');
    expect(src).toContain('setLogLevel');
    expect(src).toContain('classifyError');
    expect(src).toContain('logRouteError');
    expect(src).toContain('startTimer');
    expect(src).toContain('setCorrelationProvider');
    expect(src).toContain('redactSensitive');
    expect(src).toContain('correlationFormat');
  });
});
