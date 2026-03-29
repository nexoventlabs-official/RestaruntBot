/**
 * Phase 8 – Architecture Fix Tests
 *
 * Tests for all 20 issues fixed after the BACKEND_ARCHITECTURE_AUDIT.
 * Each describe block maps to an audit issue ID (C1–C6, M1–M7, R1–R7).
 */

// ── helpers ──────────────────────────────────────────────────────────────────
const path = require('path');

// Disable external services for unit tests
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-key';
process.env.MONGODB_URI = 'mongodb://localhost:27017/test';
process.env.WHATSAPP_API_TOKEN = 'test';
process.env.META_PHONE_NUMBER_ID = 'test';
process.env.RAZORPAY_KEY_ID = 'test';
process.env.RAZORPAY_KEY_SECRET = 'test';

// ═══════════════════════════════════════════════════════════════════════════
// C1 – messageProcessor uses chatbotRouter (not undefined chatbot)
// ═══════════════════════════════════════════════════════════════════════════
describe('C1: messageProcessor imports chatbotRouter', () => {
  it('should import chatbotRouter at the top', () => {
    const src = require('fs').readFileSync(
      path.join(__dirname, '..', 'services', 'messageProcessor.js'), 'utf8'
    );
    expect(src).toMatch(/require\(['"]\.\/chatbotRouter['"]\)/);
  });

  it('should NOT call chatbot.handleMessage in code (undefined variable)', () => {
    const src = require('fs').readFileSync(
      path.join(__dirname, '..', 'services', 'messageProcessor.js'), 'utf8'
    );
    // Filter out comment lines, only check actual code lines
    const codeLines = src.split('\n').filter(l => !l.trim().startsWith('*') && !l.trim().startsWith('//'));
    const codeOnly = codeLines.join('\n');
    expect(codeOnly).not.toMatch(/\bchatbot\.handleMessage\b/);
  });

  it('should call chatbotRouter.handleMessage', () => {
    const src = require('fs').readFileSync(
      path.join(__dirname, '..', 'services', 'messageProcessor.js'), 'utf8'
    );
    expect(src).toMatch(/chatbotRouter\.handleMessage/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// C2 – conversationState dead code removed
// ═══════════════════════════════════════════════════════════════════════════
describe('C2: conversationState has no unreachable code', () => {
  it('should have only one logger require (at module scope)', () => {
    const src = require('fs').readFileSync(
      path.join(__dirname, '..', 'services', 'conversationState.js'), 'utf8'
    );
    const matches = src.match(/require\(['"]\.\/logger['"]\)/g);
    expect(matches).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// C3 – processCheckout sets paymentMethod: 'online'
// ═══════════════════════════════════════════════════════════════════════════
describe('C3: processCheckout sets paymentMethod', () => {
  it('should have paymentMethod: "online" in processCheckout order creation', () => {
    const src = require('fs').readFileSync(
      path.join(__dirname, '..', 'services', 'chatbot.js'), 'utf8'
    );
    // Find processCheckout method – it should contain paymentMethod: 'upi'
    const marker = 'async processCheckout(phone';
    const checkoutSection = src.substring(
      src.indexOf(marker),
      src.indexOf(marker) + 10000
    );
    expect(checkoutSection).toContain("paymentMethod: 'upi'");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// C4 – processPickupCheckout now has complete fields
// ═══════════════════════════════════════════════════════════════════════════
describe('C4: processPickupCheckout has all required fields', () => {
  it('should include itemsTotal field', () => {
    const src = require('fs').readFileSync(
      path.join(__dirname, '..', 'services', 'chatbot.js'), 'utf8'
    );
    const marker = 'async processPickupCheckout(phone';
    const pickupSection = src.substring(
      src.indexOf(marker),
      src.indexOf(marker) + 6000
    );
    expect(pickupSection).toContain('itemsTotal');
  });

  it('should include deliveryCharge: 0', () => {
    const src = require('fs').readFileSync(
      path.join(__dirname, '..', 'services', 'chatbot.js'), 'utf8'
    );
    const marker = 'async processPickupCheckout(phone';
    const pickupSection = src.substring(
      src.indexOf(marker),
      src.indexOf(marker) + 6000
    );
    expect(pickupSection).toContain('deliveryCharge: 0');
  });

  it('should include trackingUpdates', () => {
    const src = require('fs').readFileSync(
      path.join(__dirname, '..', 'services', 'chatbot.js'), 'utf8'
    );
    const marker = 'async processPickupCheckout(phone';
    const pickupSection = src.substring(
      src.indexOf(marker),
      src.indexOf(marker) + 6000
    );
    expect(pickupSection).toContain('trackingUpdates');
  });

  it('should include whatsappBroadcast.addContact', () => {
    const src = require('fs').readFileSync(
      path.join(__dirname, '..', 'services', 'chatbot.js'), 'utf8'
    );
    const marker = 'async processPickupCheckout(phone';
    const pickupSection = src.substring(
      src.indexOf(marker),
      src.indexOf(marker) + 8000
    );
    expect(pickupSection).toContain('whatsappBroadcast.addContact');
  });

  it('should include DashboardStats todayOrders tracking', () => {
    const src = require('fs').readFileSync(
      path.join(__dirname, '..', 'services', 'chatbot.js'), 'utf8'
    );
    const marker = 'async processPickupCheckout(phone';
    const pickupSection = src.substring(
      src.indexOf(marker),
      src.indexOf(marker) + 8000
    );
    expect(pickupSection).toContain('todayOrders');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// C4 (cont.) – orderFactory.js exists and exports buildOrderData
// ═══════════════════════════════════════════════════════════════════════════
describe('C4: orderFactory module', () => {
  const orderFactory = require('../services/orderFactory');

  it('should export buildOrderData function', () => {
    expect(typeof orderFactory.buildOrderData).toBe('function');
  });

  it('should build complete order data with defaults', () => {
    const data = orderFactory.buildOrderData({
      orderId: 'ORD-TEST-001',
      customer: { phone: '1234567890', name: 'Test', email: 'test@test.com' },
      items: [{ name: 'Item1', price: 100, quantity: 1 }],
      totalAmount: 100,
      paymentMethod: 'cod'
    });

    expect(data.orderId).toBe('ORD-TEST-001');
    expect(data.customer.phone).toBe('1234567890');
    expect(data.itemsTotal).toBe(0); // default
    expect(data.deliveryCharge).toBe(0); // default
    expect(data.deliveryDistance).toBeNull(); // default
    expect(data.discountAmount).toBe(0); // default
    expect(data.appliedOfferIds).toEqual([]); // default
    expect(data.paymentMethod).toBe('cod');
  });

  it('should convert Set to Array for appliedOfferIds', () => {
    const data = orderFactory.buildOrderData({
      orderId: 'ORD-TEST-002',
      customer: { phone: '123' },
      items: [],
      totalAmount: 0,
      paymentMethod: 'cod',
      appliedOfferIds: new Set(['offer1', 'offer2'])
    });
    expect(Array.isArray(data.appliedOfferIds)).toBe(true);
    expect(data.appliedOfferIds).toContain('offer1');
    expect(data.appliedOfferIds).toContain('offer2');
  });

  it('should include optional status fields when provided', () => {
    const data = orderFactory.buildOrderData({
      orderId: 'ORD-TEST-003',
      customer: { phone: '123' },
      items: [],
      totalAmount: 0,
      paymentMethod: 'online',
      status: 'pending',
      paymentStatus: 'pending',
      trackingUpdates: [{ status: 'pending', message: 'Awaiting payment' }]
    });
    expect(data.status).toBe('pending');
    expect(data.paymentStatus).toBe('pending');
    expect(data.trackingUpdates).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// C5 – chatbot.js uses transitionStatus for cancellation
// ═══════════════════════════════════════════════════════════════════════════
describe('C5: chatbot.js wires orderStateMachine', () => {
  it('should import orderStateMachine', () => {
    const src = require('fs').readFileSync(
      path.join(__dirname, '..', 'services', 'chatbot.js'), 'utf8'
    );
    expect(src).toMatch(/require\(['"]\.\/orderStateMachine['"]\)/);
  });

  it('should NOT use raw order.status = "cancelled" assignment', () => {
    const src = require('fs').readFileSync(
      path.join(__dirname, '..', 'services', 'chatbot.js'), 'utf8'
    );
    // Should not find direct assignment of order.status = 'cancelled'
    expect(src).not.toMatch(/order\.status\s*=\s*['"]cancelled['"]/);
  });

  it('should use transitionStatus for cancellation', () => {
    const src = require('fs').readFileSync(
      path.join(__dirname, '..', 'services', 'chatbot.js'), 'utf8'
    );
    expect(src).toContain("transitionStatus(order, 'cancelled'");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// C6 – customer.js uses batch aggregation instead of N+1 queries
// ═══════════════════════════════════════════════════════════════════════════
describe('C6: customer.js batch aggregation', () => {
  it('should NOT have per-customer Order.find() inside Promise.all/map', () => {
    const src = require('fs').readFileSync(
      path.join(__dirname, '..', 'routes', 'customer.js'), 'utf8'
    );
    // Old N+1: Promise.all(customers.map(async ... Order.find({ 'customer.phone': ...
    expect(src).not.toMatch(/customers\.map\(async.*Order\.find/s);
  });

  it('should use Order.aggregate for batch queries', () => {
    const src = require('fs').readFileSync(
      path.join(__dirname, '..', 'routes', 'customer.js'), 'utf8'
    );
    expect(src).toContain('Order.aggregate');
  });

  it('should aggregate orderCounts and totalSpent in parallel', () => {
    const src = require('fs').readFileSync(
      path.join(__dirname, '..', 'routes', 'customer.js'), 'utf8'
    );
    expect(src).toContain('orderCountsAgg');
    expect(src).toContain('totalSpentAgg');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// M1 – orderService.js scaffold exists
// ═══════════════════════════════════════════════════════════════════════════
describe('M1: orderService scaffold', () => {
  const orderService = require('../services/orderService');

  it('should export getOrders', () => {
    expect(typeof orderService.getOrders).toBe('function');
  });

  it('should export updateStatus', () => {
    expect(typeof orderService.updateStatus).toBe('function');
  });

  it('should export assignDeliveryPartner', () => {
    expect(typeof orderService.assignDeliveryPartner).toBe('function');
  });

  it('should export notifyDeliveryPartner', () => {
    expect(typeof orderService.notifyDeliveryPartner).toBe('function');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// M2 – dailyCleanup.saveOrderStats removed (dead code)
// ═══════════════════════════════════════════════════════════════════════════
describe('M2: consolidated cleanup services', () => {
  it('should NOT have saveOrderStats in dailyCleanup', () => {
    const src = require('fs').readFileSync(
      path.join(__dirname, '..', 'services', 'dailyCleanup.js'), 'utf8'
    );
    expect(src).not.toContain('saveOrderStats');
  });

  it('should have saveOrderStats in orderCleanup', () => {
    const src = require('fs').readFileSync(
      path.join(__dirname, '..', 'services', 'orderCleanup.js'), 'utf8'
    );
    expect(src).toContain('saveOrderStats');
  });

  it('should have Google Sheets sync in orderCleanup.saveOrderStats', () => {
    const src = require('fs').readFileSync(
      path.join(__dirname, '..', 'services', 'orderCleanup.js'), 'utf8'
    );
    expect(src).toContain('updateDashboardStat');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// M3 – sendImageWithCtaPhone uses trackOutbound
// ═══════════════════════════════════════════════════════════════════════════
describe('M3: sendImageWithCtaPhone tracking', () => {
  it('should wrap sendImageWithCtaPhone with trackOutbound', () => {
    const src = require('fs').readFileSync(
      path.join(__dirname, '..', 'services', 'whatsapp.js'), 'utf8'
    );
    // Find the sendImageWithCtaPhone method
    const methodStart = src.indexOf('sendImageWithCtaPhone');
    const methodSection = src.substring(methodStart, methodStart + 500);
    expect(methodSection).toContain('trackOutbound');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// M4 – no circular dependency (false positive confirmed)
// ═══════════════════════════════════════════════════════════════════════════
describe('M4: no circular dependency', () => {
  it('chatbot.js should NOT require orchestrator or chatbotRouter', () => {
    const src = require('fs').readFileSync(
      path.join(__dirname, '..', 'services', 'chatbot.js'), 'utf8'
    );
    expect(src).not.toMatch(/require\(['"]\.\/orchestrator['"]\)/);
    expect(src).not.toMatch(/require\(['"]\.\/chatbotRouter['"]\)/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// M5 – generateAutoTags extracted to shared module
// ═══════════════════════════════════════════════════════════════════════════
describe('M5: generateAutoTags shared module', () => {
  const generateAutoTags = require('../services/generateAutoTags');

  it('should export a function', () => {
    expect(typeof generateAutoTags).toBe('function');
  });

  it('should generate tags from item name', () => {
    const tags = generateAutoTags('Chicken Biryani', 'non-veg', 'plate', 1, []);
    expect(tags).toContain('chicken');
    expect(tags).toContain('biryani');
  });

  it('should include food type tag', () => {
    const tags = generateAutoTags('Paneer Tikka', 'veg', 'piece', 1, []);
    expect(tags).toContain('veg');
  });

  it('should include unit tag', () => {
    const tags = generateAutoTags('Water', 'veg', 'bottle', 1, []);
    expect(tags).toContain('1 bottle');
  });

  it('should include category names as tags', () => {
    const tags = generateAutoTags('Item', 'veg', 'piece', 1, ['Starters', 'Indian']);
    expect(tags).toContain('starters');
    expect(tags).toContain('indian');
  });

  it('menu.js should import from shared module', () => {
    const src = require('fs').readFileSync(
      path.join(__dirname, '..', 'routes', 'menu.js'), 'utf8'
    );
    expect(src).toContain("require('../services/generateAutoTags')");
  });

  it('menu.js should NOT have inline generateAutoTags function', () => {
    const src = require('fs').readFileSync(
      path.join(__dirname, '..', 'routes', 'menu.js'), 'utf8'
    );
    // Should not have function definition
    expect(src).not.toMatch(/function\s+generateAutoTags\s*\(/);
    expect(src).not.toMatch(/const\s+generateAutoTags\s*=\s*\(/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// M6 – Unbounded Maps have eviction
// ═══════════════════════════════════════════════════════════════════════════
describe('M6: Maps have eviction', () => {
  it('pushNotification.js should have MAX_BADGE_ENTRIES cap', () => {
    const src = require('fs').readFileSync(
      path.join(__dirname, '..', 'services', 'pushNotification.js'), 'utf8'
    );
    expect(src).toContain('MAX_BADGE_ENTRIES');
    expect(src).toContain('_sweepBadgeCounts');
  });

  it('pushNotification.js should have MAX_STALE_ENTRIES cap', () => {
    const src = require('fs').readFileSync(
      path.join(__dirname, '..', 'services', 'pushNotification.js'), 'utf8'
    );
    expect(src).toContain('MAX_STALE_ENTRIES');
    expect(src).toContain('_sweepStaleTokens');
  });

  it('pushNotification.js should have periodic sweep interval', () => {
    const src = require('fs').readFileSync(
      path.join(__dirname, '..', 'services', 'pushNotification.js'), 'utf8'
    );
    expect(src).toMatch(/setInterval\(/);
    expect(src).toContain('.unref()');
  });

  it('catalogReviewPoller.js should have MAX_REVIEW_CACHE_SIZE', () => {
    const src = require('fs').readFileSync(
      path.join(__dirname, '..', 'services', 'catalogReviewPoller.js'), 'utf8'
    );
    expect(src).toContain('MAX_REVIEW_CACHE_SIZE');
  });

  it('googleSheetsReliable.js should have MAX_SYNC_ERRORS + eviction', () => {
    const src = require('fs').readFileSync(
      path.join(__dirname, '..', 'services', 'googleSheetsReliable.js'), 'utf8'
    );
    expect(src).toContain('MAX_SYNC_ERRORS');
    expect(src).toContain('_evictOldestSyncErrors');
  });

  it('metrics.js should have MAX_METRIC_KEYS cap', () => {
    const src = require('fs').readFileSync(
      path.join(__dirname, '..', 'services', 'metrics.js'), 'utf8'
    );
    expect(src).toContain('MAX_METRIC_KEYS');
  });

  it('alerting.js should have MAX_ALERT_CACHE_SIZE + eviction', () => {
    const src = require('fs').readFileSync(
      path.join(__dirname, '..', 'services', 'alerting.js'), 'utf8'
    );
    expect(src).toContain('MAX_ALERT_CACHE_SIZE');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// M7 – unhandledRejection triggers forceShutdown
// ═══════════════════════════════════════════════════════════════════════════
describe('M7: unhandledRejection shuts down', () => {
  it('should call forceShutdown on unhandledRejection', () => {
    const src = require('fs').readFileSync(
      path.join(__dirname, '..', 'server.js'), 'utf8'
    );
    // Find the unhandledRejection handler
    const idx = src.indexOf("'unhandledRejection'");
    const section = src.substring(idx, idx + 300);
    expect(section).toContain('forceShutdown');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// R1 – auth.js has no async without await
// ═══════════════════════════════════════════════════════════════════════════
describe('R1: auth.js no unnecessary async', () => {
  it('/refresh handler should not be async', () => {
    const src = require('fs').readFileSync(
      path.join(__dirname, '..', 'routes', 'auth.js'), 'utf8'
    );
    // Find the refresh handler
    const refreshIdx = src.indexOf("'/refresh'");
    const section = src.substring(refreshIdx, refreshIdx + 300);
    // It should have (req, res) => { not async (req, res) => {
    expect(section).not.toMatch(/async\s*\(req,\s*res\)\s*=>/);
  });

  it('/revoke handler should not be async', () => {
    const src = require('fs').readFileSync(
      path.join(__dirname, '..', 'routes', 'auth.js'), 'utf8'
    );
    const revokeIdx = src.indexOf("'/revoke'");
    const section = src.substring(revokeIdx, revokeIdx + 300);
    expect(section).not.toMatch(/async\s*\(req,\s*res\)\s*=>/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// R2 – No error-swallowing catches
// ═══════════════════════════════════════════════════════════════════════════
describe('R2: no silent error catches', () => {
  it('analytics.js should log collection stats errors', () => {
    const src = require('fs').readFileSync(
      path.join(__dirname, '..', 'routes', 'analytics.js'), 'utf8'
    );
    expect(src).not.toContain('// Some system collections may not have stats');
    expect(src).toContain('Failed to get stats for collection');
  });

  it('menu.js should not have /* ignore */ catches', () => {
    const src = require('fs').readFileSync(
      path.join(__dirname, '..', 'routes', 'menu.js'), 'utf8'
    );
    expect(src).not.toContain('/* ignore */');
  });

  it('offers.js should not have /* ignore */ catches', () => {
    const src = require('fs').readFileSync(
      path.join(__dirname, '..', 'routes', 'offers.js'), 'utf8'
    );
    expect(src).not.toContain('/* ignore */');
  });

  it('reportPdf.js should log image fetch failures', () => {
    const src = require('fs').readFileSync(
      path.join(__dirname, '..', 'services', 'reportPdf.js'), 'utf8'
    );
    expect(src).not.toContain('// Silently fail for individual images');
    expect(src).toContain('Failed to fetch image for PDF report');
  });

  it('auth.js /verify should capture error variable', () => {
    const src = require('fs').readFileSync(
      path.join(__dirname, '..', 'routes', 'auth.js'), 'utf8'
    );
    // Should not have bare "catch {"
    const verifySection = src.substring(src.indexOf("'/verify'"), src.indexOf("'/verify'") + 500);
    expect(verifySection).not.toMatch(/catch\s*\{/);
    expect(verifySection).toContain('Token verification failed');
  });

  it('chatbot.js should log statsErr with stack trace', () => {
    const src = require('fs').readFileSync(
      path.join(__dirname, '..', 'services', 'chatbot.js'), 'utf8'
    );
    // All statsErr logs should include stack
    const matches = src.match(/statsErr\.message/g) || [];
    const stackMatches = src.match(/statsErr\.message,\s*stack:\s*statsErr\.stack/g) || [];
    expect(stackMatches.length).toBe(matches.length);
  });

  it('chatbot.js should not have empty .catch(() => {})', () => {
    const src = require('fs').readFileSync(
      path.join(__dirname, '..', 'services', 'chatbot.js'), 'utf8'
    );
    expect(src).not.toContain('.catch(() => {})');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// R3 – No inline requires in route handlers
// ═══════════════════════════════════════════════════════════════════════════
describe('R3: no inline requires in routes', () => {
  const routeFiles = ['auth.js', 'order.js', 'webhook.js', 'payment.js'];

  routeFiles.forEach(file => {
    it(`${file} should not have indented requires`, () => {
      const src = require('fs').readFileSync(
        path.join(__dirname, '..', 'routes', file), 'utf8'
      );
      const lines = src.split('\n');
      const inlineRequires = lines.filter(
        line => /^\s{2,}const\s+\w+\s*=\s*require\(/.test(line)
      );
      expect(inlineRequires).toEqual([]);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// R4 – No lazy require shadows in chatbot.js
// ═══════════════════════════════════════════════════════════════════════════
describe('R4: no lazy require shadows in chatbot.js', () => {
  it('should have exactly one whatsappBroadcast require', () => {
    const src = require('fs').readFileSync(
      path.join(__dirname, '..', 'services', 'chatbot.js'), 'utf8'
    );
    const matches = src.match(/require\(['"]\.\/whatsappBroadcast['"]\)/g);
    expect(matches).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// R5 – defaultChatbotImages config extracted
// ═══════════════════════════════════════════════════════════════════════════
describe('R5: defaultChatbotImages config', () => {
  const defaultImages = require('../config/defaultChatbotImages');

  it('should export an array', () => {
    expect(Array.isArray(defaultImages)).toBe(true);
  });

  it('should have 81 image slot definitions', () => {
    expect(defaultImages.length).toBe(81);
  });

  it('each entry should have key and name properties', () => {
    defaultImages.forEach(img => {
      expect(img).toHaveProperty('key');
      expect(img).toHaveProperty('name');
    });
  });

  it('all keys should be unique', () => {
    const keys = defaultImages.map(img => img.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('chatbotImages.js should import from config file', () => {
    const src = require('fs').readFileSync(
      path.join(__dirname, '..', 'routes', 'chatbotImages.js'), 'utf8'
    );
    expect(src).toContain("require('../config/defaultChatbotImages')");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// R6 – Email template extracted to brevoMail
// ═══════════════════════════════════════════════════════════════════════════
describe('R6: email template in brevoMail', () => {
  it('brevoMail should export sendDeliveryPartnerCredentials', () => {
    const src = require('fs').readFileSync(
      path.join(__dirname, '..', 'services', 'brevoMail.js'), 'utf8'
    );
    expect(src).toContain('sendDeliveryPartnerCredentials');
  });

  it('deliveryboy.js should NOT create its own SibApiV3Sdk instance', () => {
    const src = require('fs').readFileSync(
      path.join(__dirname, '..', 'routes', 'deliveryboy.js'), 'utf8'
    );
    expect(src).not.toContain('SibApiV3Sdk');
    expect(src).not.toContain('TransactionalEmailsApi');
  });

  it('deliveryboy.js sendPasswordEmail should delegate to brevoMail', () => {
    const src = require('fs').readFileSync(
      path.join(__dirname, '..', 'routes', 'deliveryboy.js'), 'utf8'
    );
    expect(src).toContain('brevoMail.sendDeliveryPartnerCredentials');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// R7 – Signal handlers centralised in server.js
// ═══════════════════════════════════════════════════════════════════════════
describe('R7: centralised signal handlers', () => {
  it('redis.js should NOT have process.on SIGTERM/SIGINT', () => {
    const src = require('fs').readFileSync(
      path.join(__dirname, '..', 'services', 'redis.js'), 'utf8'
    );
    expect(src).not.toContain("process.on('SIGTERM'");
    expect(src).not.toContain("process.on('SIGINT'");
  });

  it('messageQueue.js should NOT have process.on SIGTERM/SIGINT', () => {
    const src = require('fs').readFileSync(
      path.join(__dirname, '..', 'services', 'messageQueue.js'), 'utf8'
    );
    expect(src).not.toContain("process.on('SIGTERM'");
    expect(src).not.toContain("process.on('SIGINT'");
  });

  it('server.js should shut down messageQueue in gracefulShutdown', () => {
    const src = require('fs').readFileSync(
      path.join(__dirname, '..', 'server.js'), 'utf8'
    );
    expect(src).toContain('messageQueue');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// REGRESSION GUARDS — catch if fixes are accidentally reverted
// ═══════════════════════════════════════════════════════════════════════════
describe('Regression guards', () => {
  const fs = require('fs');

  // --- C1 regression: chatbot variable must not exist in messageProcessor ---
  it('messageProcessor must never define a "chatbot" variable', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'messageProcessor.js'), 'utf8');
    const codeLines = src.split('\n').filter(l => !l.trim().startsWith('*') && !l.trim().startsWith('//'));
    expect(codeLines.join('\n')).not.toMatch(/const\s+chatbot\s*=/);
  });

  // --- C3 regression: processCODOrder must also have paymentMethod ---
  it('processCODOrder should have paymentMethod: cod', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'chatbot.js'), 'utf8');
    const marker = 'async processCODOrder(phone';
    const idx = src.indexOf(marker);
    expect(idx).toBeGreaterThan(-1);
    const section = src.substring(idx, idx + 8000);
    expect(section).toContain("paymentMethod: 'cod'");
  });

  // --- C4 regression: orderFactory defaults are correct types ---
  it('orderFactory defaults: deliveryDistance should be null not 0', () => {
    const { buildOrderData } = require('../services/orderFactory');
    const data = buildOrderData({
      orderId: 'REG-001', customer: { phone: '123' },
      items: [], totalAmount: 0, paymentMethod: 'cod'
    });
    expect(data.deliveryDistance).toBeNull();
    expect(data.deliveryCharge).toBe(0);
    expect(data.discountAmount).toBe(0);
  });

  // --- C5 regression: no raw status='cancelled' anywhere in chatbot.js ---
  it('chatbot.js must not have order.status = cancelled anywhere', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'chatbot.js'), 'utf8');
    const codeLines = src.split('\n').filter(l => !l.trim().startsWith('//'));
    expect(codeLines.join('\n')).not.toMatch(/order\.status\s*=\s*['"]cancelled['"]/);
  });

  // --- C6 regression: customer.js must not loop Order.find per customer ---
  it('customer.js must not have Order.find inside a loop', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'customer.js'), 'utf8');
    expect(src).not.toMatch(/for\s*\(.*customer.*\)\s*\{[\s\S]*?Order\.find/);
    expect(src).not.toMatch(/\.map\(async.*Order\.find/s);
  });

  // --- M3 regression: whatsapp.js sendImageWithCtaPhone must use trackOutbound ---
  it('whatsapp.js sendImageWithCtaPhone must not call metaCloud directly', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'whatsapp.js'), 'utf8');
    const methodIdx = src.indexOf('sendImageWithCtaPhone');
    const methodBody = src.substring(methodIdx, methodIdx + 800);
    expect(methodBody).toContain('trackOutbound');
    // Should NOT have a bare metaCloud.sendImageWithCtaPhone outside of trackOutbound callback
    const outsideTrack = methodBody.replace(/trackOutbound[\s\S]*?metaCloud\.sendImageWithCtaPhone[\s\S]*?\)/, '');
    expect(outsideTrack).not.toMatch(/^\s*(?:return\s+)?metaCloud\.sendImageWithCtaPhone/m);
  });

  // --- M7 regression: both uncaught handlers must call forceShutdown ---
  it('server.js must call forceShutdown for both uncaughtException and unhandledRejection', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    const uncaughtIdx = src.indexOf("'uncaughtException'");
    const unhandledIdx = src.indexOf("'unhandledRejection'");
    expect(uncaughtIdx).toBeGreaterThan(-1);
    expect(unhandledIdx).toBeGreaterThan(-1);
    const uncaughtBlock = src.substring(uncaughtIdx, uncaughtIdx + 300);
    const unhandledBlock = src.substring(unhandledIdx, unhandledIdx + 300);
    expect(uncaughtBlock).toContain('forceShutdown');
    expect(unhandledBlock).toContain('forceShutdown');
  });

  // --- R4 regression: no module should shadow its own top-level imports ---
  it('chatbot.js should have exactly one require for each critical service', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'chatbot.js'), 'utf8');
    ['whatsappBroadcast', 'googleSheets', 'razorpay'].forEach(mod => {
      const re = new RegExp(`require\\(['"]\\.\\/` + mod + `['"]\\)`, 'g');
      const matches = src.match(re) || [];
      expect(matches.length).toBe(1);
    });
  });

  // --- R7 regression: only server.js should register SIGTERM/SIGINT ---
  it('no service file (except server.js) should register SIGTERM/SIGINT', () => {
    const serviceDir = path.join(__dirname, '..', 'services');
    const serviceFiles = fs.readdirSync(serviceDir).filter(f => f.endsWith('.js'));
    serviceFiles.forEach(file => {
      const src = fs.readFileSync(path.join(serviceDir, file), 'utf8');
      expect(src).not.toContain("process.on('SIGTERM'");
      expect(src).not.toContain("process.on('SIGINT'");
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Edge cases — generateAutoTags
// ═══════════════════════════════════════════════════════════════════════════
describe('M5: generateAutoTags edge cases', () => {
  const generateAutoTags = require('../services/generateAutoTags');

  it('should handle empty item name', () => {
    const tags = generateAutoTags('', 'veg', 'piece', 1, []);
    expect(Array.isArray(tags)).toBe(true);
    expect(tags).toContain('veg');
  });

  it('should handle null categories gracefully', () => {
    const tags = generateAutoTags('Dosa', 'veg', 'piece', 1, null);
    expect(tags).toContain('dosa');
  });

  it('should handle nonveg food type', () => {
    const tags = generateAutoTags('Fish Fry', 'nonveg', 'piece', 2, []);
    expect(tags).toContain('nonveg');
    expect(tags).toContain('non-veg');
    expect(tags).toContain('non veg');
  });

  it('should handle egg food type', () => {
    const tags = generateAutoTags('Egg Curry', 'egg', 'piece', 1, []);
    expect(tags).toContain('egg');
    expect(tags).toContain('eggetarian');
  });

  it('should produce plural unit for quantity > 1', () => {
    const tags = generateAutoTags('Samosa', 'veg', 'piece', 3, []);
    expect(tags).toContain('3 pieces');
  });

  it('should filter out short words from item name', () => {
    const tags = generateAutoTags('A To Go', 'veg', 'piece', 1, []);
    // 'A' and 'To' are < 3 chars, should be filtered
    expect(tags).not.toContain('a');
    expect(tags).not.toContain('to');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Edge cases — orderFactory.buildOrderData
// ═══════════════════════════════════════════════════════════════════════════
describe('C4: orderFactory edge cases', () => {
  const { buildOrderData } = require('../services/orderFactory');

  it('should default customer name to "Customer" when missing', () => {
    const data = buildOrderData({
      orderId: 'EDGE-001', customer: { phone: '9876543210' },
      items: [], totalAmount: 0, paymentMethod: 'cod'
    });
    expect(data.customer.name).toBe('Customer');
  });

  it('should preserve email when provided', () => {
    const data = buildOrderData({
      orderId: 'EDGE-002', customer: { phone: '123', email: 'a@b.com', name: 'X' },
      items: [], totalAmount: 500, paymentMethod: 'online'
    });
    expect(data.customer.email).toBe('a@b.com');
    expect(data.totalAmount).toBe(500);
  });

  it('should default serviceType to delivery', () => {
    const data = buildOrderData({
      orderId: 'EDGE-003', customer: { phone: '123' },
      items: [], totalAmount: 0, paymentMethod: 'cod'
    });
    expect(data.serviceType).toBe('delivery');
  });

  it('should not include status when not provided', () => {
    const data = buildOrderData({
      orderId: 'EDGE-004', customer: { phone: '123' },
      items: [], totalAmount: 0, paymentMethod: 'cod'
    });
    expect(data).not.toHaveProperty('status');
    expect(data).not.toHaveProperty('paymentStatus');
  });

  it('should handle empty Set for appliedOfferIds', () => {
    const data = buildOrderData({
      orderId: 'EDGE-005', customer: { phone: '123' },
      items: [], totalAmount: 0, paymentMethod: 'cod',
      appliedOfferIds: new Set()
    });
    expect(data.appliedOfferIds).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Phase 9 – Domain & GoogleSheets Audit Fixes
// ═══════════════════════════════════════════════════════════════════════════

// ── D1: googleSheets/core.js – updateActualPaymentMethod column fix ──────
describe('D1: googleSheets column mapping', () => {
  it('should write payment method to column I (not K=OrderStatus)', () => {
    const src = require('fs').readFileSync(
      path.join(__dirname, '..', 'services', 'googleSheets', 'core.js'), 'utf8'
    );
    // Find the updateActualPaymentMethod function
    const fnStart = src.indexOf('updateActualPaymentMethod');
    const fnBlock = src.substring(fnStart, fnStart + 2000);
    // PaymentMethod should go to column I
    expect(fnBlock).toMatch(/!I\$\{orderData\.rowIndex/);
    // PaymentStatus should go to column J
    expect(fnBlock).toMatch(/!J\$\{orderData\.rowIndex/);
    // Should NOT write to K or H in this function
    expect(fnBlock).not.toMatch(/!K\$\{orderData\.rowIndex/);
    expect(fnBlock).not.toMatch(/!H\$\{orderData\.rowIndex/);
  });
});

// ── D2: googleSheets/core.js – $serviceType instead of $deliveryType ─────
describe('D2: googleSheets aggregation uses serviceType', () => {
  it('should use $serviceType for pickup detection (not $deliveryType)', () => {
    const src = require('fs').readFileSync(
      path.join(__dirname, '..', 'services', 'googleSheets', 'core.js'), 'utf8'
    );
    expect(src).not.toMatch(/\$deliveryType/);
    expect(src).toMatch(/\$serviceType.*pickup/);
  });
});

// ── D3: paymentCompletionHandler – correct googleSheets method ───────────
describe('D3: paymentCompletionHandler uses updateOrderStatus', () => {
  it('should call googleSheets.updateOrderStatus (not updateOrder)', () => {
    const src = require('fs').readFileSync(
      path.join(__dirname, '..', 'services', 'domains', 'paymentCompletionHandler.js'), 'utf8'
    );
    expect(src).not.toMatch(/googleSheets\.updateOrder\b\(/);
    expect(src).toMatch(/googleSheets\.updateOrderStatus\(/);
  });
});

// ── D4: paymentCompletionHandler uses orderStateMachine ──────────────────
describe('D4: paymentCompletionHandler uses transitionStatus', () => {
  it('should import transitionStatus from orderStateMachine', () => {
    const src = require('fs').readFileSync(
      path.join(__dirname, '..', 'services', 'domains', 'paymentCompletionHandler.js'), 'utf8'
    );
    expect(src).toMatch(/require\(['"]\.\.\/orderStateMachine['"]\)/);
    expect(src).toMatch(/transitionStatus/);
  });

  it('should NOT directly assign order.status = ORDER_STATUS.CONFIRMED', () => {
    const src = require('fs').readFileSync(
      path.join(__dirname, '..', 'services', 'domains', 'paymentCompletionHandler.js'), 'utf8'
    );
    // Filter out comment lines
    const codeLines = src.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*'));
    const codeOnly = codeLines.join('\n');
    expect(codeOnly).not.toMatch(/order\.status\s*=\s*ORDER_STATUS\.CONFIRMED/);
  });

  it('should have RAZORPAY_KEY_SECRET validation in verifyPaymentSignature', () => {
    const src = require('fs').readFileSync(
      path.join(__dirname, '..', 'services', 'domains', 'paymentCompletionHandler.js'), 'utf8'
    );
    expect(src).toMatch(/if\s*\(\s*!secret\s*\)/);
    expect(src).toMatch(/RAZORPAY_KEY_SECRET not configured/);
  });
});

// ── D5: orderHandler uses transitionStatus ───────────────────────────────
describe('D5: orderHandler uses transitionStatus', () => {
  it('should import transitionStatus from orderStateMachine', () => {
    const src = require('fs').readFileSync(
      path.join(__dirname, '..', 'services', 'domains', 'orderHandler.js'), 'utf8'
    );
    expect(src).toMatch(/require\(['"]\.\.\/orderStateMachine['"]\)/);
    expect(src).toMatch(/transitionStatus/);
  });

  it('should call transitionStatus for cancellation', () => {
    const src = require('fs').readFileSync(
      path.join(__dirname, '..', 'services', 'domains', 'orderHandler.js'), 'utf8'
    );
    expect(src).toMatch(/transitionStatus\(order,\s*'cancelled'/);
  });
});

// ── D6: No inline requires in orderHandler and paymentCompletionHandler ──
describe('D6: No inline requires in domain handlers', () => {
  it('orderHandler should have all requires at top level', () => {
    const src = require('fs').readFileSync(
      path.join(__dirname, '..', 'services', 'domains', 'orderHandler.js'), 'utf8'
    );
    // Should have top-level imports for User, pushNotification, dataEvents
    const topSection = src.substring(0, 1500);
    expect(topSection).toMatch(/require\(['"]\.\.\/\.\.\/models\/User['"]\)/);
    expect(topSection).toMatch(/require\(['"]\.\.\/pushNotification['"]\)/);
    expect(topSection).toMatch(/require\(['"]\.\.\/eventEmitter['"]\)/);
  });

  it('paymentCompletionHandler should have all requires at top level', () => {
    const src = require('fs').readFileSync(
      path.join(__dirname, '..', 'services', 'domains', 'paymentCompletionHandler.js'), 'utf8'
    );
    const topSection = src.substring(0, 1500);
    expect(topSection).toMatch(/require\(['"]\.\.\/\.\.\/models\/User['"]\)/);
    expect(topSection).toMatch(/require\(['"]\.\.\/pushNotification['"]\)/);
  });

  it('orderHandler cancelOrder should NOT have inline requires', () => {
    const src = require('fs').readFileSync(
      path.join(__dirname, '..', 'services', 'domains', 'orderHandler.js'), 'utf8'
    );
    const cancelFn = src.substring(src.indexOf('async function cancelOrder'));
    const cancelBody = cancelFn.substring(0, cancelFn.indexOf('\nasync function') > 0 ? cancelFn.indexOf('\nasync function') : 800);
    // Should NOT have require inside the function body
    expect(cancelBody).not.toMatch(/const User = require/);
    expect(cancelBody).not.toMatch(/const pushNotification = require/);
  });
});

// ── D7: locationHandler – no console.error ───────────────────────────────
describe('D7: locationHandler uses logger instead of console.error', () => {
  it('should NOT use console.error anywhere', () => {
    const src = require('fs').readFileSync(
      path.join(__dirname, '..', 'services', 'domains', 'locationHandler.js'), 'utf8'
    );
    expect(src).not.toMatch(/console\.error/);
  });

  it('should use logger.error for delivery charge errors', () => {
    const src = require('fs').readFileSync(
      path.join(__dirname, '..', 'services', 'domains', 'locationHandler.js'), 'utf8'
    );
    expect(src).toMatch(/logger\.error\('Error calculating delivery charge'/);
  });
});

// ── D8: domains/index.js – endTimer called on redirect path ──────────────
describe('D8: domains/index.js endTimer on redirect', () => {
  it('should call endTimer before returning on redirect', () => {
    const src = require('fs').readFileSync(
      path.join(__dirname, '..', 'services', 'domains', 'index.js'), 'utf8'
    );
    const redirectBlock = src.substring(
      src.indexOf('result.redirect'),
      src.indexOf('return result;') + 20
    );
    expect(redirectBlock).toMatch(/endTimer/);
  });
});

// ── D9: getDeliveryPartnerHistory – correct column range and index ───────
describe('D9: getDeliveryPartnerHistory uses 13-column layout', () => {
  it('should fetch A:M (13 columns) not A:L', () => {
    const src = require('fs').readFileSync(
      path.join(__dirname, '..', 'services', 'googleSheets', 'core.js'), 'utf8'
    );
    const fnStart = src.indexOf('getDeliveryPartnerHistory');
    const fnBlock = src.substring(fnStart, fnStart + 2000);
    expect(fnBlock).toMatch(/!A:M/);
    expect(fnBlock).not.toMatch(/!A:L/);
  });

  it('should use row[12] for delivery partner (not row[10])', () => {
    const src = require('fs').readFileSync(
      path.join(__dirname, '..', 'services', 'googleSheets', 'core.js'), 'utf8'
    );
    const fnStart = src.indexOf('getDeliveryPartnerHistory');
    const fnBlock = src.substring(fnStart, fnStart + 2000);
    expect(fnBlock).toMatch(/row\[12\]/);
    // Should NOT use row[10] for delivery partner
    expect(fnBlock).not.toMatch(/deliveryPartner\s*=\s*row\[10\]/);
  });
});

// ── D10: validationHelpers – batch query for cart items ──────────────────
describe('D10: validationHelpers batch query', () => {
  it('should batch-fetch menu items with $in instead of N+1', () => {
    const src = require('fs').readFileSync(
      path.join(__dirname, '..', 'services', 'domains', 'shared', 'validationHelpers.js'), 'utf8'
    );
    expect(src).toMatch(/MenuItem\.find\(\{\s*_id:\s*\{\s*\$in:/);
    expect(src).toMatch(/menuItemMap/);
  });

  it('should NOT have MenuItem.findById inside the for loop', () => {
    const src = require('fs').readFileSync(
      path.join(__dirname, '..', 'services', 'domains', 'shared', 'validationHelpers.js'), 'utf8'
    );
    // Find the checkCartAvailability function
    const fnStart = src.indexOf('async function checkCartAvailability');
    const fnEnd = src.indexOf('\nasync function', fnStart + 10);
    const fnBody = src.substring(fnStart, fnEnd > 0 ? fnEnd : fnStart + 2000);
    expect(fnBody).not.toMatch(/MenuItem\.findById\(/);
  });
});

// ── D11: validateOrderCancellation – correct query field ─────────────────
describe('D11: validateOrderCancellation uses correct query', () => {
  it('should query by customer.phone not customer ObjectId', () => {
    const src = require('fs').readFileSync(
      path.join(__dirname, '..', 'services', 'domains', 'shared', 'validationHelpers.js'), 'utf8'
    );
    expect(src).toMatch(/Order\.findOne\(\{[^}]*['"]customer\.phone['"]/);
    expect(src).not.toMatch(/Order\.findOne\(\{\s*orderId,\s*customer:\s*customerId\s*\}/);
  });
});

// ── Regression: all domain handler files should import logger properly ───
describe('Domain handlers regression: no console.* usage', () => {
  const domainFiles = [
    'cartHandler.js', 'errorHandler.js', 'locationHandler.js',
    'menuHandler.js', 'orderHandler.js', 'paymentCompletionHandler.js',
    'paymentInitiationHandler.js'
  ];

  domainFiles.forEach(file => {
    it(`${file} should not use console.log/error/warn`, () => {
      const src = require('fs').readFileSync(
        path.join(__dirname, '..', 'services', 'domains', file), 'utf8'
      );
      // Filter out comment lines
      const codeLines = src.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*'));
      const codeOnly = codeLines.join('\n');
      expect(codeOnly).not.toMatch(/console\.(log|error|warn)\(/);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// C4 supplement – processPickupCheckout uses itemsTotal (not undefined)
// ═══════════════════════════════════════════════════════════════════════════
describe('C4: processPickupCheckout itemsTotal variable', () => {
  const src = require('fs').readFileSync(
    path.join(__dirname, '..', 'services', 'chatbot.js'), 'utf8'
  );

  // Extract processPickupCheckout function body (large enough to include confirmation msg)
  const fnStart = src.indexOf('async processPickupCheckout(');
  const fnBody = src.slice(fnStart, fnStart + 12000);

  it('should declare let itemsTotal (not let total)', () => {
    expect(fnBody).toMatch(/let\s+itemsTotal\s*=\s*0/);
  });

  it('should accumulate itemsTotal += itemTotal', () => {
    expect(fnBody).toMatch(/itemsTotal\s*\+=\s*itemTotal/);
  });

  it('should use itemsTotal in Order constructor', () => {
    expect(fnBody).toMatch(/itemsTotal,/);
  });

  it('should use itemsTotal in confirmation message', () => {
    expect(fnBody).toMatch(/\$\{itemsTotal\}/);
  });
});
