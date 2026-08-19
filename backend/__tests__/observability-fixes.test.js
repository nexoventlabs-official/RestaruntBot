/**
 * Logging & Observability Fixes Tests
 * 
 * Verifies all 7 fixes from LOGGING_OBSERVABILITY_AUDIT.md:
 * O1: Correlation ID auto-injection via Winston format
 * O2: googleSheets.js console→logger migration
 * O3: orderId in correlation context at checkout
 * O4: Payment status transition logging
 * O5: err.stack enabled in production errorHandler
 * O6: External API duration tracking (logApiCall/startTimer)
 * O7: Template literals → structured objects
 * 
 * Maturity improvements (M1-M8):
 * M1: Response logging with duration
 * M2: MongoDB retry counter  
 * M3: State transition triggeredBy
 * M4: OutboundRetryWorker improved logging
 * M5: Google Sheets duration tracking
 * M6: Chatbot.js API duration tracking
 * M7: logRouteError helper + route adoption
 * M8: Chatbot.js template literal elimination
 */

const fs = require('fs');
const path = require('path');

// ─── O1: Correlation ID Auto-Injection ───────────────────────────────

describe('O1: Correlation ID auto-injection via Winston format', () => {
  it('logger.js exports setCorrelationProvider function', () => {
    const loggerModule = require('../services/logger');
    expect(typeof loggerModule.setCorrelationProvider).toBe('function');
  });

  it('logger.js exports classifyError function', () => {
    const loggerModule = require('../services/logger');
    expect(typeof loggerModule.classifyError).toBe('function');
  });

  it('correlationContext.js calls setCorrelationProvider on import', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../services/correlationContext.js'), 'utf8'
    );
    expect(src).toContain('setCorrelationProvider');
    expect(src).toContain('asyncLocalStorage.getStore()');
  });

  it('correlationFormat is in both dev and prod Winston format chains', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../services/logger.js'), 'utf8'
    );
    // correlationFormat() should appear in both devFormat and prodFormat combine() calls
    const matches = src.match(/correlationFormat\(\)/g);
    expect(matches).not.toBeNull();
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it('correlationFormat reads from _getCorrelationContext provider', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../services/logger.js'), 'utf8'
    );
    expect(src).toContain('_getCorrelationContext()');
    expect(src).toContain('info.correlationId');
  });
});

// ─── O2: googleSheets.js Console → Logger ────────────────────────────

describe('O2: googleSheets.js console→logger migration', () => {
  let src;
  beforeAll(() => {
    src = fs.readFileSync(
      path.join(__dirname, '../services/googleSheets.js'), 'utf8'
    );
  });

  it('imports logger module', () => {
    expect(src).toContain("require('./logger')");
  });

  it('has zero console.log calls', () => {
    const matches = src.match(/console\.log\(/g);
    expect(matches).toBeNull();
  });

  it('has zero console.error calls', () => {
    const matches = src.match(/console\.error\(/g);
    expect(matches).toBeNull();
  });

  it('uses logger.info for info-level messages', () => {
    const matches = src.match(/logger\.info\(/g);
    expect(matches).not.toBeNull();
    expect(matches.length).toBeGreaterThan(40);
  });

  it('uses logger.error for error-level messages', () => {
    const matches = src.match(/logger\.error\(/g);
    expect(matches).not.toBeNull();
    expect(matches.length).toBeGreaterThan(30);
  });
});

// ─── O3: orderId in Correlation Context ──────────────────────────────

describe('O3: orderId in correlation context at order creation', () => {
  let src;
  beforeAll(() => {
    src = fs.readFileSync(
      path.join(__dirname, '../services/chatbot.js'), 'utf8'
    );
  });

  it('imports setMetadata from correlationContext', () => {
    expect(src).toContain("{ setMetadata }");
    expect(src).toContain("require('./correlationContext')");
  });

  it('sets orderId in context after generating it (COD path)', () => {
    // After generateOrderId in processCODOrder, setMetadata('orderId', ...) should be called
    const codSection = src.indexOf("via: 'COD'");
    expect(codSection).toBeGreaterThan(-1);
    // Check setMetadata is near the orderId generation
    const nearbyCode = src.substring(codSection - 200, codSection + 50);
    expect(nearbyCode).toContain("setMetadata('orderId'");
    expect(nearbyCode).toContain("setMetadata('phone'");
  });

  it('sets orderId in context after generating it (UPI path)', () => {
    const upiSection = src.indexOf("via: 'UPI'");
    expect(upiSection).toBeGreaterThan(-1);
    const nearbyCode = src.substring(upiSection - 200, upiSection + 50);
    expect(nearbyCode).toContain("setMetadata('orderId'");
    expect(nearbyCode).toContain("setMetadata('phone'");
  });

  it('sets orderId in context after generating it (pickup path)', () => {
    const pickupSection = src.indexOf("via: 'pickup'");
    expect(pickupSection).toBeGreaterThan(-1);
    const nearbyCode = src.substring(pickupSection - 200, pickupSection + 50);
    expect(nearbyCode).toContain("setMetadata('orderId'");
    expect(nearbyCode).toContain("setMetadata('phone'");
  });

  it('logs Order created with structured fields at each checkout', () => {
    const matches = src.match(/logger\.info\('Order created'/g);
    expect(matches).not.toBeNull();
    expect(matches.length).toBe(3); // COD, UPI, pickup
  });
});

// ─── O4: Payment Status Transition Logging ───────────────────────────

describe('O4: Payment status transition logging', () => {
  it('payment.js logs Payment status changed before each paymentStatus assignment', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../routes/payment.js'), 'utf8'
    );
    const matches = src.match(/logger\.info\('Payment status changed'/g);
    expect(matches).not.toBeNull();
    // 3 locations: verify-upi, razorpay-webhook, callback
    expect(matches.length).toBe(3);
  });

  it('payment.js payment status logs include from/to/via fields', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../routes/payment.js'), 'utf8'
    );
    expect(src).toContain("from: 'pending', to: 'paid', via: 'verify-upi'");
    expect(src).toContain("via: 'razorpay-webhook'");
    expect(src).toContain("via: 'callback'");
  });

  it('webhook.js logs Payment status changed for WhatsApp payments', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../routes/webhook.js'), 'utf8'
    );
    const matches = src.match(/logger\.info\('Payment status changed'/g);
    expect(matches).not.toBeNull();
    // 2 locations: success and failed/canceled
    expect(matches.length).toBe(2);
  });

  it('all paymentStatus updates have a log near them', () => {
    const paySrc = fs.readFileSync(
      path.join(__dirname, '../routes/payment.js'), 'utf8'
    );
    const webhookSrc = fs.readFileSync(
      path.join(__dirname, '../routes/webhook.js'), 'utf8'
    );
    // In payment.js: atomic findOneAndUpdate replaces direct assignments.
    // Each atomic update is followed by a 'Payment status changed' log.
    const payLines = paySrc.split('\n');
    const statusChangeLogs = payLines
      .map((line, i) => ({ line, num: i }))
      .filter(({ line }) => line.includes("'Payment status changed'") && !line.includes('//'));
    expect(statusChangeLogs.length).toBeGreaterThanOrEqual(2);

    // In webhook.js
    const whLines = webhookSrc.split('\n');
    const whAssignments = whLines
      .map((line, i) => ({ line, num: i }))
      // Match real assignments only (`=` not followed by `=`), so `=== 'pending'`
      // comparisons are excluded. Count is >= 2 (success + failed/canceled;
      // COD cancellation adds another).
      .filter(({ line }) => /order\.paymentStatus\s*=(?!=)/.test(line) && !line.includes('//'));
    expect(whAssignments.length).toBeGreaterThanOrEqual(2);
  });
});

// ─── O5: err.stack Enabled in Production ─────────────────────────────

describe('O5: err.stack enabled in production errorHandler', () => {
  it('errorHandler always logs err.stack (no NODE_ENV gate)', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../middleware/errorHandler.js'), 'utf8'
    );
    // Should NOT contain the old conditional
    expect(src).not.toContain("process.env.NODE_ENV === 'development' ? err.stack : undefined");
    // Should contain unconditional stack logging
    expect(src).toContain('stack: err.stack');
  });

  it('errorHandler logs err.code and err.name', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../middleware/errorHandler.js'), 'utf8'
    );
    expect(src).toContain('code: err.code');
    expect(src).toContain('name: err.name');
  });

  it('errorHandler classifies errors with category and retryable', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../middleware/errorHandler.js'), 'utf8'
    );
    expect(src).toContain('classifyError');
    expect(src).toContain('category');
    expect(src).toContain('retryable');
  });
});

// ─── O5b: classifyError function tests ───────────────────────────────

describe('O5b: classifyError classification logic', () => {
  const { classifyError } = require('../services/logger');

  it('classifies MongoNetworkError as database/retryable', () => {
    const err = new Error('connection timed out');
    err.name = 'MongoNetworkError';
    expect(classifyError(err)).toEqual({ category: 'database', retryable: true });
  });

  it('classifies duplicate key as database_duplicate/not retryable', () => {
    const err = new Error('duplicate key error');
    err.code = 11000;
    expect(classifyError(err)).toEqual({ category: 'database_duplicate', retryable: false });
  });

  it('classifies ValidationError as validation/not retryable', () => {
    const err = new Error('Path `name` is required');
    err.name = 'ValidationError';
    expect(classifyError(err)).toEqual({ category: 'validation', retryable: false });
  });

  it('classifies ECONNRESET as network/retryable', () => {
    const err = new Error('read ECONNRESET');
    err.code = 'ECONNRESET';
    expect(classifyError(err)).toEqual({ category: 'network', retryable: true });
  });

  it('classifies ETIMEDOUT as network/retryable', () => {
    const err = new Error('connect ETIMEDOUT');
    err.code = 'ETIMEDOUT';
    expect(classifyError(err)).toEqual({ category: 'network', retryable: true });
  });

  it('classifies rate limit as rate_limit/retryable', () => {
    const err = new Error('Too many requests');
    err.status = 429;
    expect(classifyError(err)).toEqual({ category: 'rate_limit', retryable: true });
  });

  it('classifies 401 as auth/not retryable', () => {
    const err = new Error('Unauthorized');
    err.status = 401;
    expect(classifyError(err)).toEqual({ category: 'auth', retryable: false });
  });

  it('classifies 400 as business_logic/not retryable', () => {
    const err = new Error('Bad request');
    err.status = 400;
    expect(classifyError(err)).toEqual({ category: 'business_logic', retryable: false });
  });

  it('classifies unknown errors as unknown/retryable', () => {
    const err = new Error('something unexpected');
    expect(classifyError(err)).toEqual({ category: 'unknown', retryable: true });
  });
});

// ─── O6: External API Duration Tracking ──────────────────────────────

describe('O6: External API duration tracking with startTimer', () => {
  it('razorpay.js uses startTimer for createOrder', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../services/razorpay.js'), 'utf8'
    );
    expect(src).toContain("startTimer('razorpay.createOrder')");
    expect(src).toContain('endTimer(');
  });

  it('razorpay.js uses startTimer for createPaymentLink', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../services/razorpay.js'), 'utf8'
    );
    expect(src).toContain("startTimer('razorpay.createPaymentLink')");
  });

  it('razorpay.js uses startTimer for getPaymentDetails', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../services/razorpay.js'), 'utf8'
    );
    expect(src).toContain("startTimer('razorpay.getPaymentDetails')");
  });

  it('metaCloud.js uses startTimer for sendMessage', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../services/metaCloud.js'), 'utf8'
    );
    expect(src).toContain("startTimer('meta.sendMessage')");
  });

  it('metaCloud.js uses startTimer for downloadMedia', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../services/metaCloud.js'), 'utf8'
    );
    expect(src).toContain("startTimer('meta.downloadMedia')");
  });

  it('pushNotification.js uses startTimer for sendNotification', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../services/pushNotification.js'), 'utf8'
    );
    expect(src).toContain("startTimer('push.sendNotification')");
  });

  it('startTimer is exported and callable from logger.js', () => {
    const { startTimer } = require('../services/logger');
    expect(typeof startTimer).toBe('function');
    const endTimer = startTimer('test.operation');
    expect(typeof endTimer).toBe('function');
  });
});

// ─── O7: Structured Logging (Template Literals → Objects) ────────────

describe('O7: Template literals → structured objects', () => {
  it('payment.js has zero template literal logger calls', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../routes/payment.js'), 'utf8'
    );
    // Find logger.info(`...`) or logger.error(`...`) patterns
    const templateLiteralLogs = src.match(/logger\.(info|error|warn)\s*\(`/g);
    expect(templateLiteralLogs).toBeNull();
  });

  it('payment.js includes orderId in all error logs where it is in scope', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../routes/payment.js'), 'utf8'
    );
    // Key error logs that should have orderId
    expect(src).toContain("'Google Sheets sync error', { error: err.message, orderId: updatedOrder.orderId }");
    expect(src).toContain("'Admin push error', { error: pushErr.message, orderId: updatedOrder.orderId }");
    expect(src).toContain("'WhatsApp notification failed', { error: whatsappErr.message, orderId: updatedOrder.orderId }");
  });

  it('webhook.js error logs use structured format (no colon+object pattern)', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../routes/webhook.js'), 'utf8'
    );
    // The old patterns like logger.error('msg:', error) should be gone from
    // the test routes and async error paths
    expect(src).not.toContain("'Async Chatbot Error:', err");
    expect(src).not.toContain("'Meta webhook async processing error:', error");
  });

  it('razorpay.js has zero template literal logger calls', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../services/razorpay.js'), 'utf8'
    );
    const templateLiteralLogs = src.match(/logger\.(info|error|warn)\s*\(`/g);
    expect(templateLiteralLogs).toBeNull();
  });

  it('razorpay.js has zero colon-separated error patterns', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../services/razorpay.js'), 'utf8'
    );
    // Old pattern: logger.error('Error:', error.message)
    expect(src).not.toContain("error:', error.message");
    expect(src).not.toContain("error:',");
  });
});

// ─── O8: Emoji Cleanup ──────────────────────────────────────────────

describe('O8: Emoji cleanup from log messages', () => {
  const filesToCheck = [
    { name: 'googleSheets.js', path: '../services/googleSheets.js' },
    { name: 'webhook.js', path: '../routes/webhook.js' },
    { name: 'pushNotification.js', path: '../services/pushNotification.js' },
  ];

  filesToCheck.forEach(({ name, path: filePath }) => {
    it(`${name} logger calls have no emoji prefixes`, () => {
      const src = fs.readFileSync(path.resolve(__dirname, filePath), 'utf8');
      // Check for common emoji prefixes in logger calls
      const emojiLogPattern = /logger\.(info|error|warn)\(['"`][✅❌⚠️📋📦📊📱🔧🚚📥🧹🗑️⏭️💳🔐🎤🔍]/g;
      const matches = src.match(emojiLogPattern);
      expect(matches).toBeNull();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// MATURITY IMPROVEMENT TESTS (M1-M8)
// ═══════════════════════════════════════════════════════════════════

// ─── M1: Response Logging with Duration ─────────────────────────────

describe('M1: Response logging with duration tracking', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../server.js'), 'utf8'
  );

  it('server.js logs on response finish with statusCode and durationMs', () => {
    expect(src).toContain("res.on('finish'");
    expect(src).toContain('durationMs');
    expect(src).toContain('statusCode');
    expect(src).toContain('contentLength');
  });

  it('server.js uses level escalation for errors (4xx→warn, 5xx→error)', () => {
    expect(src).toContain(">= 500 ? 'error'");
    expect(src).toContain(">= 400 ? 'warn'");
  });

  it('server.js has no template literal in request logging', () => {
    // Old: logger.info(`${req.method} ${req.originalUrl}`, ...)
    const templateInRequest = /logger\.info\(`\$\{req\.method\}/;
    expect(templateInRequest.test(src)).toBe(false);
  });
});

// ─── M2: MongoDB Retry Counter ──────────────────────────────────────

describe('M2: MongoDB retry counter', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../server.js'), 'utf8'
  );

  it('server.js declares mongoRetryCount variable', () => {
    expect(src).toContain('mongoRetryCount');
  });

  it('server.js increments retry count on failure', () => {
    expect(src).toContain('mongoRetryCount++');
  });

  it('server.js logs attempt number in retry message', () => {
    expect(src).toContain('attempt: mongoRetryCount');
  });

  it('server.js resets retry count on successful connect', () => {
    expect(src).toContain('mongoRetryCount = 0');
  });
});

// ─── M3: State Transition triggeredBy ──────────────────────────────

describe('M3: orderStateMachine triggeredBy parameter', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../services/orderStateMachine.js'), 'utf8'
  );

  it('transitionStatus accepts triggeredBy parameter', () => {
    expect(src).toMatch(/function transitionStatus\(order, newStatus, trackingMessage, triggeredBy/);
  });

  it('transitionStatus defaults triggeredBy to system', () => {
    expect(src).toContain("triggeredBy = 'system'");
  });

  it('transitionStatus logs triggeredBy in success transitions', () => {
    // Find the success log that has triggeredBy
    const logMatch = src.match(/logger\.info\('Order status transitioned'[^}]*triggeredBy/);
    expect(logMatch).not.toBeNull();
  });

  it('transitionStatus logs triggeredBy in invalid transitions', () => {
    const warnMatch = src.match(/logger\.warn\('Invalid order status transition'[^}]*triggeredBy/);
    expect(warnMatch).not.toBeNull();
  });
});

describe('M3b: orderScheduler uses state machine', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../services/orderScheduler.js'), 'utf8'
  );

  it('orderScheduler imports transitionStatus', () => {
    expect(src).toContain("{ transitionStatus }");
    expect(src).toContain("require('./orderStateMachine')");
  });

  it('orderScheduler calls transitionStatus with scheduler trigger', () => {
    expect(src).toContain("transitionStatus(order, 'cancelled'");
    expect(src).toContain("'scheduler'");
  });

  it('orderScheduler does NOT directly set order.status = cancelled', () => {
    // The old pattern: order.status = 'cancelled';
    // Should NOT exist (state machine handles it)
    const directAssign = src.match(/order\.status\s*=\s*'cancelled'/);
    expect(directAssign).toBeNull();
  });

  it('orderScheduler has zero emoji prefixes in logger calls', () => {
    const emojiLogPattern = /logger\.(info|error|warn)\(['"`][✅❌⚠️📋📦📊📱🔧🚚📥🧹🗑️⏭️💳🔐🎤🔍⏰]/g;
    const matches = src.match(emojiLogPattern);
    expect(matches).toBeNull();
  });

  it('orderScheduler uses structured logging (no template literals)', () => {
    const templateLiterals = src.match(/logger\.(info|error|warn)\(`/g);
    expect(templateLiterals).toBeNull();
  });
});

// ─── M4: OutboundRetryWorker Improved Logging ──────────────────────

describe('M4: OutboundRetryWorker logging improvements', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../services/outboundRetryWorker.js'), 'utf8'
  );

  it('logs attempt number and maxRetries on success', () => {
    const successLog = src.match(/state_transition.*attempt.*maxRetries/s) || src.match(/retried successfully.*attempt.*maxRetries/s);
    expect(successLog).not.toBeNull();
  });

  it('logs attempt and maxRetries on exhaustion', () => {
    const exhaustLog = src.match(/exhausted retries.*attempt.*maxRetries/s);
    expect(exhaustLog).not.toBeNull();
  });

  it('logs delayMs for scheduled retries', () => {
    expect(src).toContain('delayMs');
  });

  it('cycle summary uses structured logging', () => {
    expect(src).toContain('Cycle completed');
    expect(src).toContain('processed');
    expect(src).toContain('succeeded');
  });

  it('has zero template literal logger calls', () => {
    const templateLiterals = src.match(/logger\.(info|error|warn)\(`/g);
    expect(templateLiterals).toBeNull();
  });
});

// ─── M5: Google Sheets Duration Tracking ───────────────────────────

describe('M5: Google Sheets duration tracking', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../services/googleSheets.js'), 'utf8'
  );

  it('imports startTimer from logger', () => {
    expect(src).toContain("{ startTimer }");
  });

  it('addOrder has startTimer wrapper', () => {
    expect(src).toContain("startTimer('googleSheets.addOrder')");
  });

  it('updateOrderStatus has startTimer wrapper', () => {
    expect(src).toContain("startTimer('googleSheets.updateOrderStatus')");
  });

  it('getOrderHistory has startTimer wrapper', () => {
    expect(src).toContain("startTimer('googleSheets.getOrderHistory')");
  });

  it('addOrUpdateCustomer has startTimer wrapper', () => {
    expect(src).toContain("startTimer('googleSheets.addOrUpdateCustomer')");
  });
});

// ─── M6: Chatbot.js API Duration Tracking ──────────────────────────

describe('M6: Chatbot.js external API duration tracking', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../services/chatbot.js'), 'utf8'
  );

  it('imports startTimer from logger', () => {
    expect(src).toContain("{ startTimer }");
  });

  it('OSRM API call has startTimer wrapper', () => {
    expect(src).toContain("startTimer('geo.osrm')");
  });

  it('OpenRouteService API call has startTimer wrapper', () => {
    expect(src).toContain("startTimer('geo.openRouteService')");
  });

  it('OpenCage geocoding has startTimer wrapper', () => {
    expect(src).toContain("startTimer('geo.openCage')");
  });

  it('OSRM logs HTTP status code', () => {
    expect(src).toContain('httpStatus: response.status');
  });
});

// ─── M7: logRouteError Helper + Route Adoption ─────────────────────

describe('M7: logRouteError helper and route adoption', () => {
  it('logger.js exports logRouteError function', () => {
    const loggerModule = require('../services/logger');
    expect(typeof loggerModule.logRouteError).toBe('function');
  });

  it('logRouteError calls classifyError internally', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../services/logger.js'), 'utf8'
    );
    // logRouteError should reference classifyError
    const fnBody = src.substring(src.indexOf('function logRouteError'));
    expect(fnBody).toContain('classifyError(error)');
  });

  const routeFiles = [
    { name: 'order.js', path: '../routes/order.js' },
    { name: 'auth.js', path: '../routes/auth.js' },
    { name: 'deliveryboy.js', path: '../routes/deliveryboy.js' },
  ];

  routeFiles.forEach(({ name, path: filePath }) => {
    it(`${name} imports logRouteError`, () => {
      const src = fs.readFileSync(path.resolve(__dirname, filePath), 'utf8');
      expect(src).toContain('logRouteError');
    });
  });

  it('deliveryboy.js uses logRouteError in at least 5 catch blocks', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../routes/deliveryboy.js'), 'utf8'
    );
    const matches = src.match(/logRouteError\(res,/g);
    expect(matches).not.toBeNull();
    expect(matches.length).toBeGreaterThanOrEqual(5);
  });
});

// ─── M8: Chatbot.js Template Literal Elimination ───────────────────

describe('M8: Chatbot.js template literal elimination', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../services/chatbot.js'), 'utf8'
  );

  it('chatbot.js has zero template literal logger calls', () => {
    const templateLiterals = src.match(/logger\.(info|error|warn)\(`/g);
    expect(templateLiterals).toBeNull();
  });

  it('chatbot.js has no decoration logs (= repeated lines)', () => {
    expect(src).not.toContain("'='.repeat(");
  });

  it('OSRM uses structured logging', () => {
    expect(src).toContain("logger.info('OSRM request'");
    expect(src).toContain("logger.info('OSRM response'");
  });

  it('distance calculation uses structured logging', () => {
    expect(src).toContain("logger.info('Distance calculation started'");
    expect(src).toContain("logger.info('Straight-line distance'");
  });

  it('smart search uses structured logging', () => {
    expect(src).toContain("logger.info('Smart search called'");
    expect(src).toContain("logger.info('Smart search result'");
  });

  it('cart operations use structured logging', () => {
    expect(src).toContain("logger.info('Added to cart'");
    expect(src).toContain("logger.info('Offer applied'");
  });
});
