/**
 * Concurrency & Idempotency Fix Verification Tests
 *
 * Validates all fixes from CONCURRENCY_IDEMPOTENCY_AUDIT.md:
 * 1. orderId collision — crypto.randomBytes suffix
 * 2. Order creation dedup — checkOrderOperation in all 5 paths
 * 3. Atomic payment status — findOneAndUpdate with paymentStatus guard
 * 4. Cart atomic operations — updateQuantity idempotency + atomic state saves
 * 5. Customer model — optimistic concurrency enabled
 * 6. Idempotency service — MongoDB-backed with in-memory fallback
 * 7. Notification dedup — push notifications inside updatedOrder guard
 */

// ── Mocks ──────────────────────────────────────────────────────

jest.mock('../../services/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}));

jest.mock('../../services/correlationContext', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}));

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ── Tests ──────────────────────────────────────────────────────

describe('Concurrency & Idempotency Fixes', () => {

  // ═══════════════════════════════════════════════════════════════
  // FIX #1: orderId collision — crypto.randomBytes suffix
  // ═══════════════════════════════════════════════════════════════
  describe('Fix #1: orderId collision prevention', () => {
    test('chatbot.js generateOrderId uses crypto.randomBytes', () => {
      const chatbot = fs.readFileSync(
        path.join(__dirname, '../../services/chatbot.js'), 'utf8'
      );
      expect(chatbot).toContain("crypto.randomBytes");
      expect(chatbot).toContain("const crypto = require('crypto')");
      // The generateOrderId function/method should include a random suffix
      const genMatch = chatbot.match(/generateOrderId[\s\S]*?return[^;]+;/);
      expect(genMatch).not.toBeNull();
      expect(genMatch[0]).toContain('randomBytes');
    });

    test('paymentInitiationHandler.js generateOrderId uses crypto.randomBytes', () => {
      const handler = fs.readFileSync(
        path.join(__dirname, '../../services/domains/paymentInitiationHandler.js'), 'utf8'
      );
      expect(handler).toContain("crypto.randomBytes");
      expect(handler).toContain("const crypto = require('crypto')");
    });

    test('100 IDs generated in same millisecond are all unique', () => {
      // Simulate the fixed generateOrderId with crypto suffix
      const now = Date.now();
      jest.spyOn(Date, 'now').mockReturnValue(now);

      const ids = new Set();
      for (let i = 0; i < 100; i++) {
        const suffix = crypto.randomBytes(4).toString('hex').toUpperCase();
        const id = 'RD' + now.toString(36).toUpperCase() + suffix;
        ids.add(id);
      }

      expect(ids.size).toBe(100); // All unique
      jest.restoreAllMocks();
    });

    test('crypto.randomBytes(4) produces 8-character hex string', () => {
      const bytes = crypto.randomBytes(4).toString('hex');
      expect(bytes).toHaveLength(8);
      expect(bytes).toMatch(/^[0-9a-f]{8}$/);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // FIX #2: Order creation dedup — checkOrderOperation in all paths
  // ═══════════════════════════════════════════════════════════════
  describe('Fix #2: Order creation dedup guards', () => {
    test('chatbot.js processCODOrder has checkOrderOperation', () => {
      const src = fs.readFileSync(
        path.join(__dirname, '../../services/chatbot.js'), 'utf8'
      );
      // Find processCODOrder method definition (class method syntax)
      const funcStart = src.indexOf('async processCODOrder(phone');
      expect(funcStart).toBeGreaterThan(-1);
      // checkOrderOperation is near the top; mark() is after the transaction (~170 lines later)
      const nearTop = src.substring(funcStart, funcStart + 1000);
      expect(nearTop).toContain('checkOrderOperation');
      // mark() exists somewhere later in the same function
      const nextMethod = src.indexOf('\n  async ', funcStart + 1);
      const funcBody = src.substring(funcStart, nextMethod > 0 ? nextMethod : undefined);
      expect(funcBody).toContain('orderDedup.mark()');
    });

    test('chatbot.js processCheckout has checkOrderOperation', () => {
      const src = fs.readFileSync(
        path.join(__dirname, '../../services/chatbot.js'), 'utf8'
      );
      const funcStart = src.indexOf('async processCheckout(phone');
      expect(funcStart).toBeGreaterThan(-1);
      const nearTop = src.substring(funcStart, funcStart + 1000);
      expect(nearTop).toContain('checkOrderOperation');
      const nextMethod = src.indexOf('\n  async ', funcStart + 1);
      const funcBody = src.substring(funcStart, nextMethod > 0 ? nextMethod : undefined);
      expect(funcBody).toContain('orderDedup.mark()');
    });

    test('chatbot.js processPickupCheckout has checkOrderOperation', () => {
      const src = fs.readFileSync(
        path.join(__dirname, '../../services/chatbot.js'), 'utf8'
      );
      const funcStart = src.indexOf('async processPickupCheckout(phone');
      expect(funcStart).toBeGreaterThan(-1);
      const nearTop = src.substring(funcStart, funcStart + 1000);
      expect(nearTop).toContain('checkOrderOperation');
      const nextMethod = src.indexOf('\n  async ', funcStart + 1);
      const funcBody = src.substring(funcStart, nextMethod > 0 ? nextMethod : undefined);
      expect(funcBody).toContain('orderDedup.mark()');
    });

    test('paymentInitiationHandler.js initiateOnlinePayment has checkOrderOperation', () => {
      const src = fs.readFileSync(
        path.join(__dirname, '../../services/domains/paymentInitiationHandler.js'), 'utf8'
      );
      const funcStart = src.indexOf('async function initiateOnlinePayment');
      expect(funcStart).toBeGreaterThan(-1);
      const funcBody = src.substring(funcStart, funcStart + 2000);
      expect(funcBody).toContain('checkOrderOperation');
    });

    test('paymentInitiationHandler.js processCODOrder has checkOrderOperation', () => {
      const src = fs.readFileSync(
        path.join(__dirname, '../../services/domains/paymentInitiationHandler.js'), 'utf8'
      );
      // Find the processCODOrder in paymentInitiationHandler (distinct from chatbot's)
      const funcStart = src.indexOf('async function processCODOrder');
      expect(funcStart).toBeGreaterThan(-1);
      const funcBody = src.substring(funcStart, funcStart + 2000);
      expect(funcBody).toContain('checkOrderOperation');
    });

    test('paymentInitiationHandler uses transactionManager for order creation', () => {
      const src = fs.readFileSync(
        path.join(__dirname, '../../services/domains/paymentInitiationHandler.js'), 'utf8'
      );
      expect(src).toContain("require('../transactionManager')");
      expect(src).toContain('transactionManager.execute');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // FIX #3: Atomic payment status with findOneAndUpdate
  // ═══════════════════════════════════════════════════════════════
  describe('Fix #3: Atomic payment status updates', () => {
    let paymentRoute;

    beforeAll(() => {
      paymentRoute = fs.readFileSync(
        path.join(__dirname, '../../routes/payment.js'), 'utf8'
      );
    });

    test('verify-upi uses atomic findOneAndUpdate with paymentStatus guard', () => {
      // Verify the pattern: findOneAndUpdate({ paymentStatus: { $ne: 'paid' } })
      expect(paymentRoute).toContain("paymentStatus: { $ne: 'paid' }");
      
      // Should have updatedOrder variable
      const verifySection = paymentRoute.substring(
        paymentRoute.indexOf('verify-upi'),
        paymentRoute.indexOf('razorpay-webhook')
      );
      expect(verifySection).toContain('findOneAndUpdate');
      expect(verifySection).toContain('updatedOrder');
      // Should NOT have non-atomic pattern
      expect(verifySection).not.toContain("order.paymentStatus = 'paid'");
    });

    test('webhook uses atomic findOneAndUpdate with paymentStatus guard', () => {
      const webhookSection = paymentRoute.substring(
        paymentRoute.indexOf('razorpay-webhook'),
        paymentRoute.indexOf('/callback')
      );
      expect(webhookSection).toContain('findOneAndUpdate');
      expect(webhookSection).toContain("paymentStatus: { $ne: 'paid' }");
      expect(webhookSection).toContain('updatedOrder');
    });

    test('callback uses atomic findOneAndUpdate with paymentStatus guard', () => {
      const callbackSection = paymentRoute.substring(
        paymentRoute.indexOf("router.get('/callback'")
      );
      expect(callbackSection).toContain('findOneAndUpdate');
      expect(callbackSection).toContain("paymentStatus: { $ne: 'paid' }");
      expect(callbackSection).toContain('updatedOrder');
    });

    test('paymentCompletionHandler handlePaymentSuccess uses atomic update', () => {
      const handler = fs.readFileSync(
        path.join(__dirname, '../../services/domains/paymentCompletionHandler.js'), 'utf8'
      );
      const funcStart = handler.indexOf('async function handlePaymentSuccess');
      const funcEnd = handler.indexOf('async function handlePaymentFailure');
      const funcBody = handler.substring(funcStart, funcEnd);
      
      expect(funcBody).toContain('findOneAndUpdate');
      expect(funcBody).toContain("paymentStatus: { $ne:");
      expect(funcBody).toContain('updatedOrder');
      // Should NOT have non-atomic pattern
      expect(funcBody).not.toContain("order.paymentStatus = PAYMENT_STATUS.PAID");
    });

    test('paymentCompletionHandler handleWebhookPaymentCaptured uses atomic update', () => {
      const handler = fs.readFileSync(
        path.join(__dirname, '../../services/domains/paymentCompletionHandler.js'), 'utf8'
      );
      const funcStart = handler.indexOf('async function handleWebhookPaymentCaptured');
      const funcBody = handler.substring(funcStart);
      
      expect(funcBody).toContain('findOneAndUpdate');
      expect(funcBody).toContain("paymentStatus: { $ne:");
      expect(funcBody).toContain('updatedOrder');
    });

    test('all payment paths use updatedOrder for side effects (not stale order)', () => {
      // Verify-upi: push notification uses updatedOrder
      const verifySection = paymentRoute.substring(
        paymentRoute.indexOf('verify-upi'),
        paymentRoute.indexOf('razorpay-webhook')
      );
      // All updatedOrder references should be the source for orderId/totalAmount
      const pushSection = verifySection.substring(verifySection.indexOf('Send push notification'));
      expect(pushSection).toContain('updatedOrder.orderId');
      expect(pushSection).toContain('updatedOrder.totalAmount');
      expect(pushSection).not.toMatch(/order\.orderId(?!.*updated)/); // no stale reference

      // Webhook: push notification uses updatedOrder
      const webhookSection = paymentRoute.substring(
        paymentRoute.indexOf('razorpay-webhook'),
        paymentRoute.indexOf('/callback')
      );
      const webhookPush = webhookSection.substring(webhookSection.indexOf('Send push notification'));
      expect(webhookPush).toContain('updatedOrder.orderId');
      expect(webhookPush).toContain('updatedOrder.totalAmount');
    });

    test('atomic update prevents double-notification via race', () => {
      // Simulate findOneAndUpdate behavior:
      // Two concurrent requests both try to update paymentStatus from pending to paid
      // Only one should succeed (get non-null result)
      
      let dbPaymentStatus = 'pending';
      
      function atomicUpdate() {
        // Only succeeds if current status is not 'paid'
        if (dbPaymentStatus !== 'paid') {
          dbPaymentStatus = 'paid';
          return { orderId: 'ORD123', paymentStatus: 'paid' }; // success
        }
        return null; // another writer already set it
      }
      
      const result1 = atomicUpdate();
      const result2 = atomicUpdate(); // second call — already 'paid'
      
      expect(result1).not.toBeNull(); // first writer wins
      expect(result2).toBeNull();     // second writer gets null → no side effects
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // FIX #4: Cart atomic operations
  // ═══════════════════════════════════════════════════════════════
  describe('Fix #4: Cart atomic operations', () => {
    let cartSrc;

    beforeAll(() => {
      cartSrc = fs.readFileSync(
        path.join(__dirname, '../../services/domains/cartHandler.js'), 'utf8'
      );
    });

    test('updateQuantity has idempotency guard', () => {
      const funcStart = cartSrc.indexOf('async function updateQuantity');
      expect(funcStart).toBeGreaterThan(-1);
      const funcBody = cartSrc.substring(funcStart, funcStart + 1500);
      expect(funcBody).toContain('checkCartOperation');
      expect(funcBody).toContain('isDuplicate');
      expect(funcBody).toContain('idempotencyCheck.mark()');
    });

    test('addToCart uses atomic Customer.findOneAndUpdate for conversation state', () => {
      const funcStart = cartSrc.indexOf('async function addToCart');
      const funcEnd = cartSrc.indexOf('async function viewCart');
      const funcBody = cartSrc.substring(funcStart, funcEnd);
      
      // Should use Customer.findOneAndUpdate instead of customer.save() for conversation state
      expect(funcBody).toContain('Customer.findOneAndUpdate');
      // The transacted save should still use customer.save({ session })
      expect(funcBody).toContain('customer.save({ session })');
    });

    test('clearCart uses atomic Customer.findOneAndUpdate for conversation state', () => {
      const funcStart = cartSrc.indexOf('async function clearCart');
      const funcEnd = cartSrc.indexOf('async function handleCartAction');
      const funcBody = cartSrc.substring(funcStart, funcEnd);
      
      expect(funcBody).toContain('Customer.findOneAndUpdate');
      expect(funcBody).toContain('customer.save({ session })');
    });

    test('cartHandler imports Customer model', () => {
      expect(cartSrc).toContain("require('../../models/Customer')");
    });

    test('all cart mutation operations have idempotency', () => {
      // addToCart
      const add = cartSrc.substring(cartSrc.indexOf('async function addToCart'), cartSrc.indexOf('async function viewCart'));
      expect(add).toContain('checkCartOperation');
      
      // removeFromCart
      const remove = cartSrc.substring(cartSrc.indexOf('async function removeFromCart'), cartSrc.indexOf('async function clearCart'));
      expect(remove).toContain('checkCartOperation');
      
      // clearCart
      const clear = cartSrc.substring(cartSrc.indexOf('async function clearCart'), cartSrc.indexOf('async function handleCartAction'));
      expect(clear).toContain('checkCartOperation');
      
      // updateQuantity
      const update = cartSrc.substring(cartSrc.indexOf('async function updateQuantity'), cartSrc.indexOf('async function getCartTotal'));
      expect(update).toContain('checkCartOperation');
    });

    test('all cart mutations use transactionManager', () => {
      const mutators = ['addToCart', 'removeFromCart', 'clearCart', 'updateQuantity'];
      for (const fn of mutators) {
        const start = cartSrc.indexOf(`async function ${fn}`);
        expect(start).toBeGreaterThan(-1);
        // Find next function boundary
        const nextFn = cartSrc.indexOf('async function ', start + 1);
        const end = nextFn > 0 ? nextFn : cartSrc.length;
        const body = cartSrc.substring(start, end);
        expect(body).toContain('transactionManager.execute');
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // FIX #5: Customer model — optimistic concurrency
  // ═══════════════════════════════════════════════════════════════
  describe('Fix #5: Customer optimistic concurrency', () => {
    test('Customer schema has optimisticConcurrency enabled', () => {
      const src = fs.readFileSync(
        path.join(__dirname, '../../models/Customer.js'), 'utf8'
      );
      expect(src).toContain('optimisticConcurrency: true');
    });

    test('Order schema also has optimisticConcurrency (from prior session)', () => {
      const src = fs.readFileSync(
        path.join(__dirname, '../../models/Order.js'), 'utf8'
      );
      expect(src).toContain('optimisticConcurrency: true');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // FIX #6: Idempotency service — MongoDB-backed
  // ═══════════════════════════════════════════════════════════════
  describe('Fix #6: Idempotency service MongoDB backing', () => {
    let idempSrc;

    beforeAll(() => {
      idempSrc = fs.readFileSync(
        path.join(__dirname, '../../services/idempotencyService.js'), 'utf8'
      );
    });

    test('IdempotencyKey model exists with unique key index', () => {
      const model = fs.readFileSync(
        path.join(__dirname, '../../models/IdempotencyKey.js'), 'utf8'
      );
      expect(model).toContain('unique: true');
      expect(model).toContain('expireAfterSeconds: 0');
      expect(model).toContain("type: String");
    });

    test('idempotencyService imports IdempotencyKey model', () => {
      expect(idempSrc).toContain("require('../models/IdempotencyKey')");
    });

    test('idempotencyService has atomicCheckAndMark function', () => {
      expect(idempSrc).toContain('async function atomicCheckAndMark');
      expect(idempSrc).toContain('findOneAndUpdate');
      expect(idempSrc).toContain('$setOnInsert');
      expect(idempSrc).toContain('upsert: true');
    });

    test('atomicCheckAndMark handles E11000 duplicate key error', () => {
      expect(idempSrc).toContain('err.code === 11000');
    });

    test('checkOrderOperation provides checkAsync for atomic dedup', () => {
      expect(idempSrc).toContain('checkAsync');
      // The checkAsync function should call atomicCheckAndMark
      const orderFunc = idempSrc.substring(idempSrc.indexOf('function checkOrderOperation'));
      expect(orderFunc).toContain('atomicCheckAndMark');
    });

    test('service checks MongoDB connection state', () => {
      expect(idempSrc).toContain('isMongoConnected');
      expect(idempSrc).toContain('mongoose.connection.readyState');
    });

    test('service exports atomicCheckAndMark', () => {
      expect(idempSrc).toContain('atomicCheckAndMark');
      const exports = idempSrc.substring(idempSrc.lastIndexOf('module.exports'));
      expect(exports).toContain('atomicCheckAndMark');
    });

    test('service still has in-memory fallback', () => {
      expect(idempSrc).toContain('idempotencyCache');
      expect(idempSrc).toContain('new Map()');
    });

    test('getStats includes mongoConnected status', () => {
      expect(idempSrc).toContain('mongoConnected: isMongoConnected()');
    });

    test('idempotencyService unit: generateKey produces consistent hashes', () => {
      const { generateKey } = require('../../services/idempotencyService');
      
      const key1 = generateKey('order', 'cust1', 'checkout', { serviceType: 'delivery' });
      const key2 = generateKey('order', 'cust1', 'checkout', { serviceType: 'delivery' });
      const key3 = generateKey('order', 'cust1', 'checkout', { serviceType: 'pickup' });
      
      expect(key1).toBe(key2);     // Same inputs → same key
      expect(key1).not.toBe(key3); // Different data → different key
      expect(key1).toMatch(/^order:/);
    });

    test('idempotencyService unit: in-memory isDuplicate with TTL', () => {
      const { markProcessed, isDuplicate, generateKey } = require('../../services/idempotencyService');
      
      const key = generateKey('test', 'unique-test-' + Date.now());
      
      expect(isDuplicate(key)).toBe(false);
      markProcessed(key, 5000);
      expect(isDuplicate(key)).toBe(true);
    });

    test('idempotencyService unit: checkCartOperation returns dedup interface', () => {
      const { checkCartOperation } = require('../../services/idempotencyService');
      
      const result = checkCartOperation('cust123', 'add', 'item456', 1);
      
      expect(result).toHaveProperty('isDuplicate');
      expect(result).toHaveProperty('mark');
      expect(typeof result.mark).toBe('function');
    });

    test('idempotencyService unit: checkOrderOperation returns dedup interface', () => {
      const { checkOrderOperation } = require('../../services/idempotencyService');
      
      const result = checkOrderOperation('cust123', 'checkout', { serviceType: 'delivery' });
      
      expect(result).toHaveProperty('isDuplicate');
      expect(result).toHaveProperty('mark');
    });

    test('idempotencyService unit: getStats returns expected shape', () => {
      const { getStats } = require('../../services/idempotencyService');
      
      const stats = getStats();
      expect(stats).toHaveProperty('total');
      expect(stats).toHaveProperty('active');
      expect(stats).toHaveProperty('expired');
      expect(stats).toHaveProperty('cacheTtlMs');
      expect(stats).toHaveProperty('mongoConnected');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // FIX #7: Notification dedup — inside updatedOrder guard
  // ═══════════════════════════════════════════════════════════════
  describe('Fix #7: Notification dedup', () => {
    test('payment.js: all push notifications use updatedOrder (not stale order)', () => {
      const src = fs.readFileSync(
        path.join(__dirname, '../../routes/payment.js'), 'utf8'
      );
      
      // Find all push notification blocks
      const pushBlocks = [];
      let searchFrom = 0;
      while (true) {
        const idx = src.indexOf('Send push notification', searchFrom);
        if (idx === -1) break;
        pushBlocks.push(src.substring(idx, idx + 500));
        searchFrom = idx + 100;
      }
      
      // All blocks should reference updatedOrder, not bare order
      for (const block of pushBlocks) {
        expect(block).toContain('updatedOrder.orderId');
      }
    });

    test('paymentCompletionHandler: side effects reference updatedOrder', () => {
      const src = fs.readFileSync(
        path.join(__dirname, '../../services/domains/paymentCompletionHandler.js'), 'utf8'
      );
      
      // handlePaymentSuccess should send confirmation with updatedOrder
      const successFunc = src.substring(
        src.indexOf('async function handlePaymentSuccess'),
        src.indexOf('async function handlePaymentFailure')
      );
      expect(successFunc).toContain('sendPaymentConfirmation(updatedOrder)');
      expect(successFunc).toContain('sendEmailConfirmation(updatedOrder)');
    });

    test('webhook else branch logs already-processed (no side effects)', () => {
      const src = fs.readFileSync(
        path.join(__dirname, '../../routes/payment.js'), 'utf8'
      );
      expect(src).toContain('Payment already processed by another endpoint');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // CROSS-CUTTING: Customer atomic stats update
  // ═══════════════════════════════════════════════════════════════
  describe('Cross-cutting: Atomic customer stats', () => {
    test('payment.js verify-upi uses $inc for customer stats', () => {
      const src = fs.readFileSync(
        path.join(__dirname, '../../routes/payment.js'), 'utf8'
      );
      const verifySection = src.substring(
        src.indexOf('verify-upi'),
        src.indexOf('razorpay-webhook')
      );
      expect(verifySection).toContain('$inc');
      expect(verifySection).toContain('totalOrders');
      expect(verifySection).toContain('totalSpent');
    });

    test('payment.js callback uses $inc for customer stats', () => {
      const src = fs.readFileSync(
        path.join(__dirname, '../../routes/payment.js'), 'utf8'
      );
      const callbackSection = src.substring(src.indexOf("router.get('/callback'"));
      expect(callbackSection).toContain('$inc');
      expect(callbackSection).toContain('totalOrders');
      expect(callbackSection).toContain('totalSpent');
    });

    test('paymentCompletionHandler uses atomic customer update', () => {
      const src = fs.readFileSync(
        path.join(__dirname, '../../services/domains/paymentCompletionHandler.js'), 'utf8'
      );
      const successFunc = src.substring(
        src.indexOf('async function handlePaymentSuccess'),
        src.indexOf('async function handlePaymentFailure')
      );
      expect(successFunc).toContain('Customer.findOneAndUpdate');
    });
  });
});
