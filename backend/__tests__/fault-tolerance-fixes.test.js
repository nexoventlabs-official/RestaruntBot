/**
 * Fault-Tolerance Fix Tests
 *
 * Verifies all 5 fixes from FAULT_TOLERANCE_AUDIT.md:
 * FT1 — Two-phase webhook dedup (dedup-after-commit)
 * FT2 — Order reconciliation cron
 * FT3 — Atomic order+cart clear (findOneAndUpdate immediately after order.save)
 * FT4 — Outbound message retry worker
 * FT5 — isShuttingDown guard in payment routes
 * FT6 — Callback WhatsApp try/catch fix
 *
 * A+ fixes:
 * FT7 — Session-based checkout transactions (transactionManager.execute)
 * FT8 — Startup reconciliation on boot
 * FT9 — Dashboard stats daily sync cron
 * FT10 — Push token DB cleanup cron
 */

const path = require('path');
const fs = require('fs');

// Disable external services
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-key';
process.env.MONGODB_URI = 'mongodb://localhost:27017/test';
process.env.WHATSAPP_API_TOKEN = 'test';
process.env.META_PHONE_NUMBER_ID = 'test';
process.env.RAZORPAY_KEY_ID = 'test';
process.env.RAZORPAY_KEY_SECRET = 'test';
process.env.RAZORPAY_WEBHOOK_SECRET = 'test-webhook-secret';

// ═══════════════════════════════════════════════════════════════════════════
// FT1 — Two-phase webhook dedup (PaymentEvent status field)
// ═══════════════════════════════════════════════════════════════════════════
describe('FT1: Two-phase webhook dedup', () => {
  it('PaymentEvent schema should have status field with processing/completed/failed', () => {
    const PaymentEvent = require('../models/PaymentEvent');
    const statusPath = PaymentEvent.schema.path('status');
    expect(statusPath).toBeDefined();
    expect(statusPath.enumValues).toEqual(expect.arrayContaining(['processing', 'completed', 'failed']));
    expect(statusPath.defaultValue).toBe('processing');
  });

  it('PaymentEvent schema should have completedAt field', () => {
    const PaymentEvent = require('../models/PaymentEvent');
    expect(PaymentEvent.schema.path('completedAt')).toBeDefined();
  });

  it('webhook route should create PaymentEvent with status=processing', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..',  'routes', 'payment.js'), 'utf8'
    );
    // Should create with status: 'processing' instead of no status
    expect(src).toMatch(/PaymentEvent\.create\(\{.*status:\s*'processing'/s);
  });

  it('webhook route should only skip if existing event status is completed', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..',  'routes', 'payment.js'), 'utf8'
    );
    expect(src).toMatch(/existing\.status\s*===\s*'completed'/);
  });

  it('webhook route should allow retry of incomplete events (delete + re-create)', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..',  'routes', 'payment.js'), 'utf8'
    );
    expect(src).toMatch(/PaymentEvent\.deleteOne\(\{.*eventId.*razorpayEventId/s);
  });

  it('webhook route should mark PaymentEvent as completed after order.save()', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..',  'routes', 'payment.js'), 'utf8'
    );
    // After order.save(), paymentEvent.status should be set to 'completed'
    const webhookSection = src.substring(src.indexOf('razorpay-webhook'));
    const orderSaveIdx = webhookSection.indexOf('await order.save()');
    const afterSave = webhookSection.substring(orderSaveIdx);
    expect(afterSave).toMatch(/paymentEvent\.status\s*=\s*'completed'/);
    expect(afterSave).toMatch(/paymentEvent\.completedAt/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// FT2 — Order reconciliation cron
// ═══════════════════════════════════════════════════════════════════════════
describe('FT2: Order reconciliation cron', () => {
  const reconciliation = require('../services/orderReconciliation');

  it('should export start, stop, and reconcileOrders functions', () => {
    expect(typeof reconciliation.start).toBe('function');
    expect(typeof reconciliation.stop).toBe('function');
    expect(typeof reconciliation.reconcileOrders).toBe('function');
  });

  it('should be wired in server.js startup', () => {
    const serverSrc = fs.readFileSync(
      path.join(__dirname, '..',  'server.js'), 'utf8'
    );
    expect(serverSrc).toMatch(/require\('\.\/services\/orderReconciliation'\)/);
    expect(serverSrc).toMatch(/orderReconciliation\.start\(\)/);
  });

  it('should be stopped in server.js graceful shutdown', () => {
    const serverSrc = fs.readFileSync(
      path.join(__dirname, '..',  'server.js'), 'utf8'
    );
    expect(serverSrc).toMatch(/orderReconciliation\.stop/);
  });

  it('Order schema should have whatsappConfirmationSent field', () => {
    const Order = require('../models/Order');
    const field = Order.schema.path('whatsappConfirmationSent');
    expect(field).toBeDefined();
    expect(field.defaultValue).toBe(false);
  });

  it('verify-upi should mark whatsappConfirmationSent=true after send', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..',  'routes', 'payment.js'), 'utf8'
    );
    const verifySection = src.substring(
      src.indexOf('verify-upi'),
      src.indexOf('razorpay-webhook')
    );
    expect(verifySection).toMatch(/whatsappConfirmationSent[:\s]+true/);
  });

  it('callback should mark whatsappConfirmationSent=true after send', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..',  'routes', 'payment.js'), 'utf8'
    );
    const callbackSection = src.substring(src.indexOf("router.get('/callback'"));
    expect(callbackSection).toMatch(/whatsappConfirmationSent[:\s]+true/);
  });

  it('chatbot COD and pickup paths should mark whatsappConfirmationSent=true', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..',  'services', 'chatbot.js'), 'utf8'
    );
    // Should appear at least twice (COD + pickup)
    const matches = src.match(/whatsappConfirmationSent\s*=\s*true/g);
    expect(matches).not.toBeNull();
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// FT3 — Atomic order+cart clear
// ═══════════════════════════════════════════════════════════════════════════
describe('FT3: Atomic order+cart clear', () => {
  it('COD checkout should use Customer.findOneAndUpdate for cart clear', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..',  'services', 'chatbot.js'), 'utf8'
    );
    // Find the COD order section (processCODOrder)
    const codStart = src.indexOf('async processCODOrder(');
    const codEnd = src.indexOf('async processCheckout(');
    const codSection = src.substring(codStart, codEnd);
    
    // Should use findOneAndUpdate with $set: { cart: [] }
    expect(codSection).toMatch(/Customer\.findOneAndUpdate/);
    expect(codSection).toMatch(/\$set:\s*\{[^}]*cart:\s*\[\]/);
  });

  it('UPI checkout should use Customer.findOneAndUpdate for cart clear', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..',  'services', 'chatbot.js'), 'utf8'
    );
    const upiStart = src.indexOf('async processCheckout(');
    const upiEnd = src.indexOf('async processPickupCheckout(');
    const upiSection = src.substring(upiStart, upiEnd);
    
    expect(upiSection).toMatch(/Customer\.findOneAndUpdate/);
    expect(upiSection).toMatch(/\$set:\s*\{[^}]*cart:\s*\[\]/);
  });

  it('Pickup checkout should use Customer.findOneAndUpdate for cart clear', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..',  'services', 'chatbot.js'), 'utf8'
    );
    const pickupStart = src.indexOf('async processPickupCheckout(');
    const pickupSection = src.substring(pickupStart, pickupStart + 10000);
    
    expect(pickupSection).toMatch(/Customer\.findOneAndUpdate/);
    expect(pickupSection).toMatch(/\$set:\s*\{[^}]*cart:\s*\[\]/);
  });

  it('all checkout paths should push orderHistory atomically with cart clear', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..',  'services', 'chatbot.js'), 'utf8'
    );
    // $push: { orderHistory: order._id } should appear in the same findOneAndUpdate
    const matches = src.match(/\$push:\s*\{[^}]*orderHistory:\s*order\._id/g);
    expect(matches).not.toBeNull();
    expect(matches.length).toBeGreaterThanOrEqual(2); // COD and pickup at minimum
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// FT4 — Outbound message retry worker
// ═══════════════════════════════════════════════════════════════════════════
describe('FT4: Outbound message retry worker', () => {
  const retryWorker = require('../services/outboundRetryWorker');

  it('should export start, stop, and processRetries functions', () => {
    expect(typeof retryWorker.start).toBe('function');
    expect(typeof retryWorker.stop).toBe('function');
    expect(typeof retryWorker.processRetries).toBe('function');
  });

  it('should be wired in server.js startup', () => {
    const serverSrc = fs.readFileSync(
      path.join(__dirname, '..',  'server.js'), 'utf8'
    );
    expect(serverSrc).toMatch(/require\('\.\/services\/outboundRetryWorker'\)/);
    expect(serverSrc).toMatch(/outboundRetryWorker\.start\(\)/);
  });

  it('should be stopped in server.js graceful shutdown', () => {
    const serverSrc = fs.readFileSync(
      path.join(__dirname, '..',  'server.js'), 'utf8'
    );
    expect(serverSrc).toMatch(/outboundRetryWorker\.stop/);
  });

  it('should query OutboundMessage with correct retry criteria', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..',  'services', 'outboundRetryWorker.js'), 'utf8'
    );
    expect(src).toMatch(/status:\s*'failed'/);
    expect(src).toMatch(/isRetryable:\s*true/);
    expect(src).toMatch(/nextRetryAt:\s*\{.*\$lte/s);
  });

  it('should handle text, buttons, image, and cta_url message types', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..',  'services', 'outboundRetryWorker.js'), 'utf8'
    );
    expect(src).toMatch(/case\s*'text'/);
    expect(src).toMatch(/case\s*'buttons'/);
    expect(src).toMatch(/case\s*'image'/);
    expect(src).toMatch(/case\s*'cta_url'/);
  });

  it('should mark messages with exhausted retries as non-retryable', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..',  'services', 'outboundRetryWorker.js'), 'utf8'
    );
    expect(src).toMatch(/msg\.isRetryable\s*=\s*false/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// FT5 — isShuttingDown guard
// ═══════════════════════════════════════════════════════════════════════════
describe('FT5: isShuttingDown guard in payment routes', () => {
  it('shutdownState module should export isShuttingDown and setShuttingDown', () => {
    const shutdownState = require('../services/shutdownState');
    expect(shutdownState).toHaveProperty('isShuttingDown');
    expect(typeof shutdownState.setShuttingDown).toBe('function');
    expect(shutdownState.isShuttingDown).toBe(false);
  });

  it('server.js should call shutdownState.setShuttingDown() during shutdown', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..',  'server.js'), 'utf8'
    );
    expect(src).toMatch(/shutdownState\.setShuttingDown\(\)/);
  });

  it('payment.js should import shutdownState', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..',  'routes', 'payment.js'), 'utf8'
    );
    expect(src).toMatch(/require\('\.\.\/services\/shutdownState'\)/);
  });

  it('razorpay-webhook should return 503 when shutting down', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..',  'routes', 'payment.js'), 'utf8'
    );
    const webhookSection = src.substring(
      src.indexOf('razorpay-webhook'),
      src.indexOf("router.get('/callback'")
    );
    expect(webhookSection).toMatch(/isShuttingDown/);
    expect(webhookSection).toMatch(/503/);
  });

  it('callback should return 503 when shutting down', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..',  'routes', 'payment.js'), 'utf8'
    );
    const callbackSection = src.substring(src.indexOf("router.get('/callback'"));
    expect(callbackSection).toMatch(/isShuttingDown/);
    expect(callbackSection).toMatch(/503/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// FT6 — Callback WhatsApp try/catch
// ═══════════════════════════════════════════════════════════════════════════
describe('FT6: Callback WhatsApp wrapped in try/catch', () => {
  it('callback WhatsApp send should be wrapped in try/catch', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..',  'routes', 'payment.js'), 'utf8'
    );
    const callbackSection = src.substring(src.indexOf("router.get('/callback'"));
    
    // Find the WhatsApp send section within callback
    const whatsappIdx = callbackSection.indexOf('sendImageWithButtons');
    const surrounding = callbackSection.substring(
      Math.max(0, whatsappIdx - 200),
      whatsappIdx + 200
    );
    
    // Should be inside a try block
    expect(surrounding).toMatch(/try\s*\{/);
  });

  it('callback should catch WhatsApp errors without crashing', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..',  'routes', 'payment.js'), 'utf8'
    );
    const callbackSection = src.substring(src.indexOf("router.get('/callback'"));
    expect(callbackSection).toMatch(/catch\s*\(whatsappErr\)/);
    expect(callbackSection).toMatch(/WhatsApp notification failed \(callback\)/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Integration: New files exist and are properly structured
// ═══════════════════════════════════════════════════════════════════════════
describe('Fault-tolerance infrastructure files', () => {
  it('orderReconciliation.js should exist', () => {
    expect(fs.existsSync(path.join(__dirname, '..',  'services', 'orderReconciliation.js'))).toBe(true);
  });

  it('outboundRetryWorker.js should exist', () => {
    expect(fs.existsSync(path.join(__dirname, '..',  'services', 'outboundRetryWorker.js'))).toBe(true);
  });

  it('shutdownState.js should exist', () => {
    expect(fs.existsSync(path.join(__dirname, '..',  'services', 'shutdownState.js'))).toBe(true);
  });

  it('orderReconciliation should use node-cron for scheduling', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..',  'services', 'orderReconciliation.js'), 'utf8'
    );
    expect(src).toMatch(/require\('node-cron'\)/);
    expect(src).toMatch(/cron\.schedule/);
  });

  it('outboundRetryWorker should use node-cron for scheduling', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..',  'services', 'outboundRetryWorker.js'), 'utf8'
    );
    expect(src).toMatch(/require\('node-cron'\)/);
    expect(src).toMatch(/cron\.schedule/);
  });

  it('reconciliation should query for unnotified confirmed/paid orders', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..',  'services', 'orderReconciliation.js'), 'utf8'
    );
    expect(src).toMatch(/whatsappConfirmationSent:\s*\{.*\$ne:\s*true/s);
    expect(src).toMatch(/paymentStatus:\s*'paid'/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// FT7 — Session-based checkout transactions
// ═══════════════════════════════════════════════════════════════════════════
describe('FT7: Session-based checkout transactions', () => {
  it('chatbot.js should import transactionManager', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'services', 'chatbot.js'), 'utf8'
    );
    expect(src).toMatch(/require\('\.\/transactionManager'\)/);
  });

  it('COD checkout should use transactionManager.execute with session', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'services', 'chatbot.js'), 'utf8'
    );
    const codStart = src.indexOf('async processCODOrder(');
    const codEnd = src.indexOf('async processCheckout(');
    const codSection = src.substring(codStart, codEnd);
    
    expect(codSection).toMatch(/transactionManager\.execute\(async \(session\)/);
    expect(codSection).toMatch(/order\.save\(\{.*session.*\}\)/s);
    expect(codSection).toMatch(/Customer\.findOneAndUpdate\(.*\{.*session.*\}\)/s);
  });

  it('UPI checkout should use transactionManager.execute with session', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'services', 'chatbot.js'), 'utf8'
    );
    const upiStart = src.indexOf('async processCheckout(');
    const upiEnd = src.indexOf('async processPickupCheckout(');
    const upiSection = src.substring(upiStart, upiEnd);
    
    expect(upiSection).toMatch(/transactionManager\.execute\(async \(session\)/);
    expect(upiSection).toMatch(/order\.save\(\{.*session.*\}\)/s);
    expect(upiSection).toMatch(/Customer\.findOneAndUpdate\(.*\{.*session.*\}\)/s);
  });

  it('Pickup checkout should use transactionManager.execute with session', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'services', 'chatbot.js'), 'utf8'
    );
    const pickupStart = src.indexOf('async processPickupCheckout(');
    const pickupSection = src.substring(pickupStart, pickupStart + 10000);
    
    expect(pickupSection).toMatch(/transactionManager\.execute\(async \(session\)/);
    expect(pickupSection).toMatch(/order\.save\(\{.*session.*\}\)/s);
    expect(pickupSection).toMatch(/Customer\.findOneAndUpdate\(.*\{.*session.*\}\)/s);
  });

  it('all checkout paths should fall back to sequential on non-replica-set', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'services', 'chatbot.js'), 'utf8'
    );
    // Should have fallback catches for transaction not supported
    const fallbacks = src.match(/falling back to sequential/g);
    expect(fallbacks).not.toBeNull();
    expect(fallbacks.length).toBeGreaterThanOrEqual(3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// FT8 — Startup reconciliation on boot
// ═══════════════════════════════════════════════════════════════════════════
describe('FT8: Startup reconciliation on boot', () => {
  it('server.js should call reconcileOrders() after MongoDB connects', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'server.js'), 'utf8'
    );
    expect(src).toMatch(/orderReconciliation\.reconcileOrders\(\)/);
    // Should be in the connectMongoDB function
    const connectSection = src.substring(
      src.indexOf('connectMongoDB'),
      src.indexOf('mongoose.connection.on')
    );
    expect(connectSection).toMatch(/orderReconciliation\.reconcileOrders\(\)/);
  });

  it('startup reconciliation should be fire-and-forget (.then/.catch)', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'server.js'), 'utf8'
    );
    expect(src).toMatch(/reconcileOrders\(\)\.then/);
    expect(src).toMatch(/\.catch\(err/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// FT9 — Dashboard stats daily sync cron
// ═══════════════════════════════════════════════════════════════════════════
describe('FT9: Dashboard stats daily sync cron', () => {
  const dashboardSync = require('../services/dashboardStatsSync');

  it('should export start, stop, and syncStats functions', () => {
    expect(typeof dashboardSync.start).toBe('function');
    expect(typeof dashboardSync.stop).toBe('function');
    expect(typeof dashboardSync.syncStats).toBe('function');
  });

  it('should be wired in server.js startup', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'server.js'), 'utf8'
    );
    expect(src).toMatch(/require\('\.\/services\/dashboardStatsSync'\)/);
    expect(src).toMatch(/dashboardStatsSync\.start\(\)/);
  });

  it('should be stopped in server.js graceful shutdown', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'server.js'), 'utf8'
    );
    expect(src).toMatch(/dashboardStatsSync\.stop/);
  });

  it('should run daily at 3 AM', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'services', 'dashboardStatsSync.js'), 'utf8'
    );
    expect(src).toMatch(/cron\.schedule\('0 3 \* \* \*'/);
  });

  it('should recalculate stats from actual Order/Customer counts', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'services', 'dashboardStatsSync.js'), 'utf8'
    );
    expect(src).toMatch(/Order\.countDocuments/);
    expect(src).toMatch(/Order\.aggregate/);
    expect(src).toMatch(/Customer\.countDocuments/);
    expect(src).toMatch(/DashboardStats\.findOneAndUpdate/);
  });

  it('should also sync to Google Sheets', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'services', 'dashboardStatsSync.js'), 'utf8'
    );
    expect(src).toMatch(/googleSheets\.updateDashboardStat/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// FT10 — Push token DB cleanup cron
// ═══════════════════════════════════════════════════════════════════════════
describe('FT10: Push token DB cleanup cron', () => {
  const pushTokenCleanup = require('../services/pushTokenCleanup');

  it('should export start, stop, cleanStaleTokens, and isValidTokenFormat', () => {
    expect(typeof pushTokenCleanup.start).toBe('function');
    expect(typeof pushTokenCleanup.stop).toBe('function');
    expect(typeof pushTokenCleanup.cleanStaleTokens).toBe('function');
    expect(typeof pushTokenCleanup.isValidTokenFormat).toBe('function');
  });

  it('isValidTokenFormat should reject invalid tokens', () => {
    expect(pushTokenCleanup.isValidTokenFormat(null)).toBe(false);
    expect(pushTokenCleanup.isValidTokenFormat('')).toBe(false);
    expect(pushTokenCleanup.isValidTokenFormat('short')).toBe(false);
    expect(pushTokenCleanup.isValidTokenFormat(123)).toBe(false);
  });

  it('isValidTokenFormat should accept valid FCM-length tokens', () => {
    const fakeFcm = 'a'.repeat(152); // FCM tokens are 100+ chars
    expect(pushTokenCleanup.isValidTokenFormat(fakeFcm)).toBe(true);
  });

  it('should be wired in server.js startup', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'server.js'), 'utf8'
    );
    expect(src).toMatch(/require\('\.\/services\/pushTokenCleanup'\)/);
    expect(src).toMatch(/pushTokenCleanup\.start\(\)/);
  });

  it('should be stopped in server.js graceful shutdown', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'server.js'), 'utf8'
    );
    expect(src).toMatch(/pushTokenCleanup\.stop/);
  });

  it('should run every 6 hours', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'services', 'pushTokenCleanup.js'), 'utf8'
    );
    expect(src).toMatch(/cron\.schedule\('0 \*\/6 \* \* \*'/);
  });

  it('should clean tokens from both User and DeliveryBoy models', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'services', 'pushTokenCleanup.js'), 'utf8'
    );
    expect(src).toMatch(/User\.find\(/);
    expect(src).toMatch(/DeliveryBoy\.find\(/);
    expect(src).toMatch(/User\.updateOne\(.*pushToken:\s*null/s);
    expect(src).toMatch(/DeliveryBoy\.updateOne\(.*pushToken:\s*null/s);
  });

  it('should validate Expo tokens via SDK', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'services', 'pushTokenCleanup.js'), 'utf8'
    );
    expect(src).toMatch(/Expo\.isExpoPushToken/);
    expect(src).toMatch(/DeviceNotRegistered/);
  });

  it('dashboardStatsSync.js should exist', () => {
    expect(fs.existsSync(path.join(__dirname, '..', 'services', 'dashboardStatsSync.js'))).toBe(true);
  });

  it('pushTokenCleanup.js should exist', () => {
    expect(fs.existsSync(path.join(__dirname, '..', 'services', 'pushTokenCleanup.js'))).toBe(true);
  });
});
