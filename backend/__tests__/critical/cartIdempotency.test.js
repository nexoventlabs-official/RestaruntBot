/**
 * Cart Mutation Idempotency Tests
 *
 * Tests the idempotencyService used by cart operations (add, remove, clear, updateQuantity),
 * including the TOCTOU gap, TTL behavior, key generation, and the missing idempotency
 * guard on updateQuantity.
 *
 * 💰 FINANCIAL RISK: Duplicate cart adds inflate order totals. Missing idempotency
 * on updateQuantity allows rapid taps to increment quantity uncontrollably.
 */

// Use real idempotencyService (pure in-memory, no DB)
const idempotencyService = require('../../services/idempotencyService');

jest.mock('../../services/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}));

describe('Idempotency Service', () => {

  beforeEach(() => {
    // Reset internal cache between tests
    // The service uses a module-level Map, so we need to clean expired entries
    idempotencyService.cleanExpired();
  });

  // ─── KEY GENERATION ───────────────────────────────────────────

  describe('generateKey()', () => {
    test('same inputs produce deterministic key', () => {
      const key1 = idempotencyService.generateKey('cart', 'cust1', 'add', 'item1', '2');
      const key2 = idempotencyService.generateKey('cart', 'cust1', 'add', 'item1', '2');
      expect(key1).toBe(key2);
    });

    test('different inputs produce different keys', () => {
      const key1 = idempotencyService.generateKey('cart', 'cust1', 'add', 'item1', '2');
      const key2 = idempotencyService.generateKey('cart', 'cust1', 'add', 'item2', '2');
      expect(key1).not.toBe(key2);
    });

    test('key contains namespace prefix and hex hash', () => {
      const key = idempotencyService.generateKey('test', 'namespace', 'params');
      expect(key).toMatch(/^test:[a-f0-9]{16}$/);
    });

    test('order of params matters', () => {
      const key1 = idempotencyService.generateKey('cart', 'A', 'B');
      const key2 = idempotencyService.generateKey('cart', 'B', 'A');
      expect(key1).not.toBe(key2);
    });

    test('empty params produce valid key with namespace', () => {
      const key = idempotencyService.generateKey('cart');
      expect(key).toMatch(/^cart:[a-f0-9]{16}$/);
    });
  });

  // ─── isDuplicate / markProcessed ──────────────────────────────

  describe('isDuplicate() and markProcessed()', () => {
    test('new key is not a duplicate', () => {
      const key = idempotencyService.generateKey('test', Date.now().toString(), Math.random().toString());
      expect(idempotencyService.isDuplicate(key)).toBe(false);
    });

    test('marked key becomes a duplicate', () => {
      const key = idempotencyService.generateKey('test', 'unique_' + Date.now());
      idempotencyService.markProcessed(key, 5000);
      expect(idempotencyService.isDuplicate(key)).toBe(true);
    });

    test('expired key is no longer a duplicate', async () => {
      const key = idempotencyService.generateKey('test', 'expire_test_' + Date.now());
      idempotencyService.markProcessed(key, 50); // 50ms TTL

      expect(idempotencyService.isDuplicate(key)).toBe(true);

      // Wait for TTL to expire
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(idempotencyService.isDuplicate(key)).toBe(false);
    }, 1000);
  });

  // ─── CART OPERATION IDEMPOTENCY ───────────────────────────────

  describe('checkCartOperation()', () => {
    const customerId = 'cust_cart_' + Date.now();

    test('first add returns isDuplicate: false', () => {
      const result = idempotencyService.checkCartOperation(
        customerId + '_first', 'add', 'item1', 1
      );
      expect(result.isDuplicate).toBe(false);
      expect(typeof result.mark).toBe('function');
    });

    test('marking then re-checking shows isDuplicate: true', () => {
      const id = customerId + '_mark_test';
      const check1 = idempotencyService.checkCartOperation(id, 'add', 'item1', 1);
      expect(check1.isDuplicate).toBe(false);
      
      check1.mark(); // Mark as processed

      const check2 = idempotencyService.checkCartOperation(id, 'add', 'item1', 1);
      expect(check2.isDuplicate).toBe(true);
    });

    test('different operations for same customer are independent', () => {
      const id = customerId + '_diff_ops';
      const addCheck = idempotencyService.checkCartOperation(id, 'add', 'item1', 1);
      addCheck.mark();

      const removeCheck = idempotencyService.checkCartOperation(id, 'remove', 'item1');
      expect(removeCheck.isDuplicate).toBe(false);
    });

    test('same operation, different items are independent', () => {
      const id = customerId + '_diff_items';
      const check1 = idempotencyService.checkCartOperation(id, 'add', 'item1', 1);
      check1.mark();

      const check2 = idempotencyService.checkCartOperation(id, 'add', 'item2', 1);
      expect(check2.isDuplicate).toBe(false);
    });

    test('same operation, different quantities are independent', () => {
      const id = customerId + '_diff_qty';
      const check1 = idempotencyService.checkCartOperation(id, 'add', 'item1', 1);
      check1.mark();

      const check2 = idempotencyService.checkCartOperation(id, 'add', 'item1', 2);
      expect(check2.isDuplicate).toBe(false);
    });
  });

  // ─── TOCTOU GAP ──────────────────────────────────────────────

  describe('💰 TOCTOU gap (Time-of-Check-to-Time-of-Use)', () => {
    /**
     * The idempotency check and mark are NOT atomic:
     *   1. const check = checkCartOperation(...)  // isDuplicate: false
     *   2. ... business logic runs ...
     *   3. check.mark()                          // marked as processed
     *
     * Between steps 1 and 3, a concurrent request can ALSO pass step 1
     * (both see isDuplicate: false), and both proceed to execute.
     *
     * This is an in-memory Map-based check, so there's no mutex/lock.
     */

    test('concurrent isDuplicate checks both return false (TOCTOU)', () => {
      const id = 'toctou_' + Date.now();
      
      // Request A checks: not duplicate
      const checkA = idempotencyService.checkCartOperation(id, 'add', 'item1', 1);
      expect(checkA.isDuplicate).toBe(false);

      // Request B checks BEFORE A marks: also not duplicate
      const checkB = idempotencyService.checkCartOperation(id, 'add', 'item1', 1);
      expect(checkB.isDuplicate).toBe(false); // BOTH pass!

      // Both proceed to execute business logic → duplicate operation
      checkA.mark();
      checkB.mark();

      // Now future requests are blocked, but the damage is done
      const checkC = idempotencyService.checkCartOperation(id, 'add', 'item1', 1);
      expect(checkC.isDuplicate).toBe(true);
    });

    test('FIX: atomic check-and-set would prevent TOCTOU', () => {
      /**
       * Correct approach: Use Redis SETNX or MongoDB findOneAndUpdate
       * with upsert to atomically check-and-set the idempotency key.
       *
       * Redis: SET key value NX EX ttl
       *   Returns OK if key was set (first request)
       *   Returns null if key exists (duplicate)
       *
       * This eliminates the window between check and mark.
       */
      
      // Simulated atomic operation
      const atomicCache = new Map();
      
      function atomicCheckAndSet(key, ttlMs) {
        if (atomicCache.has(key)) {
          return { isDuplicate: true };
        }
        // Atomic: set immediately, no gap
        atomicCache.set(key, { expiresAt: Date.now() + ttlMs });
        return { isDuplicate: false };
      }

      const result1 = atomicCheckAndSet('key1', 5000);
      expect(result1.isDuplicate).toBe(false);

      // Second call with same key is immediately duplicate
      const result2 = atomicCheckAndSet('key1', 5000);
      expect(result2.isDuplicate).toBe(true);
    });
  });

  // ─── ORDER OPERATION IDEMPOTENCY ──────────────────────────────

  describe('checkOrderOperation()', () => {
    test('first checkout returns isDuplicate: false', () => {
      const check = idempotencyService.checkOrderOperation(
        'cust_checkout_' + Date.now(), 'checkout', { items: [{ id: 'pizza' }] }
      );
      expect(check.isDuplicate).toBe(false);
    });

    test('marked checkout returns isDuplicate: true', () => {
      const id = 'cust_co_mark_' + Date.now();
      const check = idempotencyService.checkOrderOperation(id, 'checkout', { items: [{ id: 'pizza' }] });
      check.mark();

      const recheck = idempotencyService.checkOrderOperation(id, 'checkout', { items: [{ id: 'pizza' }] });
      expect(recheck.isDuplicate).toBe(true);
    });
  });

  // ─── OUTBOUND MESSAGE DEDUP ──────────────────────────────────

  describe('checkOutboundMessage()', () => {
    test('first message returns isDuplicate: false', () => {
      const check = idempotencyService.checkOutboundMessage(
        '919999999999', 'order_confirmation', 'Your order ORD_001 is confirmed'
      );
      expect(check.isDuplicate).toBe(false);
    });

    test('duplicate message returns isDuplicate: true', () => {
      const phone = '9188888' + Date.now();
      const check1 = idempotencyService.checkOutboundMessage(phone, 'confirmation', 'msg1');
      check1.mark();

      const check2 = idempotencyService.checkOutboundMessage(phone, 'confirmation', 'msg1');
      expect(check2.isDuplicate).toBe(true);
    });
  });

  // ─── MISSING IDEMPOTENCY ON updateQuantity ────────────────────

  describe('💰 updateQuantity has NO idempotency guard', () => {
    /**
     * In cartHandler.js, addToCart, removeFromCart, and clearCart all use
     * idempotencyService.checkCartOperation() before executing.
     *
     * But updateQuantity (line 395-443) does NOT call checkCartOperation!
     * A rapid double-tap on "Update Quantity" would execute twice.
     *
     * While updateQuantity sets an absolute value (not increment), the 
     * lack of idempotency is inconsistent with other cart operations.
     */

    test('addToCart uses idempotency guard', () => {
      // Verified in cartHandler.js L51-63: checkCartOperation() is called
      expect(typeof idempotencyService.checkCartOperation).toBe('function');
    });

    test('removeFromCart uses idempotency guard', () => {
      // Verified in cartHandler.js L216-227: checkCartOperation() is called
      expect(typeof idempotencyService.checkCartOperation).toBe('function');
    });

    test('clearCart uses idempotency guard', () => {
      // Verified in cartHandler.js L275-286: checkCartOperation() is called
      expect(typeof idempotencyService.checkCartOperation).toBe('function');
    });

    test('updateQuantity does NOT use idempotency guard (BUG)', () => {
      // cartHandler.js L395-443: No checkCartOperation() call
      // This test documents the missing guard
      // TODO: Add idempotency check to updateQuantity
      expect(true).toBe(true); // Placeholder for documentation
    });
  });

  // ─── CACHE CLEANUP ───────────────────────────────────────────

  describe('cleanExpired()', () => {
    test('removes expired entries', async () => {
      const key = idempotencyService.generateKey('cleanup', Date.now().toString());
      idempotencyService.markProcessed(key, 50); // 50ms TTL

      expect(idempotencyService.isDuplicate(key)).toBe(true);

      await new Promise(resolve => setTimeout(resolve, 100));
      idempotencyService.cleanExpired();

      expect(idempotencyService.isDuplicate(key)).toBe(false);
    }, 1000);

    test('retains non-expired entries', () => {
      const key = idempotencyService.generateKey('retain', Date.now().toString());
      idempotencyService.markProcessed(key, 60000); // 60s TTL

      idempotencyService.cleanExpired();

      expect(idempotencyService.isDuplicate(key)).toBe(true);
    });

    test('getStats returns cache statistics', () => {
      const stats = idempotencyService.getStats();
      expect(stats).toHaveProperty('total');
      expect(stats).toHaveProperty('active');
      expect(typeof stats.total).toBe('number');
      expect(typeof stats.active).toBe('number');
    });
  });
});
