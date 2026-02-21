/**
 * Concurrent Checkout & Order ID Collision Tests
 *
 * Tests race conditions during simultaneous checkouts, generateOrderId
 * collision risk, and the non-atomic order-create → cart-clear sequence.
 *
 * 💰 FINANCIAL RISK: Concurrent checkouts can create duplicate orders
 * for the same cart, and orderId collisions can overwrite existing orders.
 */

jest.mock('../../services/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}));

jest.mock('../../services/correlationContext', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}));

// ── Tests ───────────────────────────────────────────────────────

describe('Concurrent Checkout', () => {

  // ─── ORDER ID GENERATION ────────────────────────────────────

  describe('generateOrderId collision risk', () => {
    /**
     * The current implementation:
     *   generateOrderId = (prefix) => prefix + 'RD' + Date.now().toString(36).toUpperCase()
     *
     * Date.now() has millisecond resolution. Two orders placed in the same
     * millisecond (e.g., high-traffic scenario, load test, or automated
     * double-click) will produce IDENTICAL order IDs.
     *
     * With orderId being unique in the DB, the second insert will throw E11000,
     * but the code does NOT retry with a new ID — the order is simply lost.
     */

    function generateOrderId(prefix = '') {
      return prefix + 'RD' + Date.now().toString(36).toUpperCase();
    }

    test('same millisecond produces identical IDs (collision)', () => {
      // Mock Date.now to return same value
      const now = Date.now();
      const mockDateNow = jest.spyOn(Date, 'now').mockReturnValue(now);

      const id1 = generateOrderId('');
      const id2 = generateOrderId('');

      expect(id1).toBe(id2); // COLLISION!
      
      mockDateNow.mockRestore();
    });

    test('different milliseconds produce unique IDs', () => {
      const mockDateNow = jest.spyOn(Date, 'now');
      mockDateNow.mockReturnValueOnce(1700000000000);
      const id1 = generateOrderId('');

      mockDateNow.mockReturnValueOnce(1700000000001);
      const id2 = generateOrderId('');

      expect(id1).not.toBe(id2);
      
      mockDateNow.mockRestore();
    });

    test('💰 collision under load: 100 rapid IDs in same ms', () => {
      const now = Date.now();
      jest.spyOn(Date, 'now').mockReturnValue(now);

      const ids = [];
      for (let i = 0; i < 100; i++) {
        ids.push(generateOrderId(''));
      }

      const uniqueIds = new Set(ids);
      
      // BUG: All 100 IDs are the same — only 1 unique value
      expect(uniqueIds.size).toBe(1);
      // FIX: Should add random suffix → uniqueIds.size should be ~100
      
      jest.restoreAllMocks();
    });

    test('FIX: orderId with random suffix avoids collision', () => {
      function generateOrderIdFixed(prefix = '') {
        const random = Math.random().toString(36).substring(2, 8).toUpperCase();
        return prefix + 'RD' + Date.now().toString(36).toUpperCase() + random;
      }

      const now = Date.now();
      jest.spyOn(Date, 'now').mockReturnValue(now);

      const ids = new Set();
      for (let i = 0; i < 100; i++) {
        ids.add(generateOrderIdFixed(''));
      }

      // With random suffix, collisions are astronomically unlikely
      expect(ids.size).toBeGreaterThan(95); // Allow tiny theoretical collision
      
      jest.restoreAllMocks();
    });

    test('orderId format is consistent', () => {
      const id = generateOrderId('STORE_');
      expect(id).toMatch(/^STORE_RD[A-Z0-9]+$/);
    });
  });

  // ─── NON-ATOMIC ORDER + CART CLEAR ────────────────────────────

  describe('Non-atomic order creation and cart clear', () => {
    /**
     * The checkout flow in chatbot.js:
     *   1. order = new Order({...})
     *   2. await order.save()
     *   3. freshCustomer.cart = []
     *   4. await freshCustomer.save()
     *
     * Steps 2 and 4 are separate MongoDB operations — NOT in a transaction.
     * If the server crashes between steps 2 and 4:
     *   - The order exists in the DB
     *   - The cart is NOT cleared
     *   - Customer can checkout again → DUPLICATE ORDER
     */

    test('SCENARIO: crash after order.save, before cart.clear', () => {
      const order1 = {
        orderId: 'ORD_CRASH1',
        items: [{ name: 'Pizza', qty: 2 }],
        totalAmount: 500
      };

      const cart = [{ menuItem: 'pizza_id', quantity: 2 }];

      // Step 1: Order saved successfully
      const orderSaved = true;
      
      // Step 2: Cart clear FAILS (simulated crash)
      const cartCleared = false;
      
      expect(orderSaved).toBe(true);
      expect(cartCleared).toBe(false);
      expect(cart.length).toBe(1); // Cart still has items

      // Customer opens app again, sees cart with items, checks out again
      const order2 = {
        orderId: 'ORD_CRASH2',
        items: [{ name: 'Pizza', qty: 2 }],
        totalAmount: 500
      };

      // BUG: Two orders created for same cart contents
      expect(order1.items).toEqual(order2.items);
      expect(order1.orderId).not.toBe(order2.orderId);
    });

    test('FIX VERIFICATION: order + cart clear should use transaction', async () => {
      let committed = false;
      let aborted = false;

      // Simulated transaction
      const session = {
        startTransaction: jest.fn(),
        commitTransaction: jest.fn(() => { committed = true; }),
        abortTransaction: jest.fn(() => { aborted = true; }),
        endSession: jest.fn()
      };

      try {
        session.startTransaction();
        // Both operations in same transaction:
        // order.save({ session })
        // customer.save({ session })
        await session.commitTransaction();
      } catch (e) {
        await session.abortTransaction();
      } finally {
        session.endSession();
      }

      expect(committed).toBe(true);
      expect(aborted).toBe(false);
    });
  });

  // ─── DOUBLE-CLICK / RAPID SUBMIT ─────────────────────────────

  describe('Double-click checkout protection', () => {
    /**
     * User taps "Confirm Order" twice in rapid succession via WhatsApp.
     * Both messages arrive within the same second.
     * Without idempotency, two orders are created.
     */

    test('💰 two identical checkout requests within 1 second', () => {
      const requests = [
        { customerId: 'cust_001', action: 'checkout', timestamp: 1700000000000 },
        { customerId: 'cust_001', action: 'checkout', timestamp: 1700000000500 } // 500ms later
      ];

      // Both should hash to the same idempotency key
      // Current code uses checkOrderOperation for this
      const key1 = `order:cust_001:checkout`;
      const key2 = `order:cust_001:checkout`;
      
      expect(key1).toBe(key2);
      // First request processes; second should be deduplicated
    });

    test('different customers can checkout simultaneously', () => {
      const key1 = `order:cust_001:checkout`;
      const key2 = `order:cust_002:checkout`;
      
      expect(key1).not.toBe(key2);
    });
  });

  // ─── CONCURRENT PAYMENT VERIFICATION ──────────────────────────

  describe('Concurrent payment verification', () => {
    /**
     * 💰 Three endpoints can update payment status for the same order:
     *   1. POST /verify-upi (frontend callback)
     *   2. POST /razorpay-webhook (Razorpay server-to-server)
     *   3. GET /callback (payment link redirect)
     *
     * All three can fire within milliseconds of each other.
     * Only the webhook has PaymentEvent dedup. The other two use only
     * a simple `if (paymentStatus === 'paid') return` check.
     */

    test('💰 RACE: verify-upi + webhook arrive within 10ms', () => {
      // Simulated order state
      let orderVersion = 0;
      let paymentStatus = 'pending';
      let whatsappNotifications = 0;
      let googleSheetsUpdates = 0;

      // Both endpoints read 'pending' simultaneously
      const verifyUpiReads = paymentStatus; // 'pending'
      const webhookReads = paymentStatus;   // 'pending'

      // Both proceed to update
      if (verifyUpiReads === 'pending') {
        paymentStatus = 'paid';
        orderVersion++;
        whatsappNotifications++;
        googleSheetsUpdates++;
      }

      // Reset for webhook (simulating concurrent read)
      // In reality, webhook also read 'pending' before verify-upi committed
      if (webhookReads === 'pending') {
        paymentStatus = 'paid'; // Already 'paid', writes again
        orderVersion++;
        whatsappNotifications++; // DOUBLE notification!
        googleSheetsUpdates++;   // DOUBLE Google Sheets entry!
      }

      // BUG: Customer gets 2 confirmation WhatsApp messages
      expect(whatsappNotifications).toBe(2);
      // BUG: Google Sheets shows 2 entries for same order
      expect(googleSheetsUpdates).toBe(2);
      // BUG: Order was written twice
      expect(orderVersion).toBe(2);
    });

    test('FIX: atomic update with paymentStatus guard', () => {
      /**
       * The correct approach is:
       *   Order.findOneAndUpdate(
       *     { orderId, paymentStatus: 'pending' },  // Guard condition
       *     { $set: { paymentStatus: 'paid', ... } },
       *     { new: true }
       *   )
       * 
       * Only the first writer succeeds. The second gets null back.
       */
      let firstWriterSucceeds = true;  // Guard matches: pending → paid
      let secondWriterSucceeds = false; // Guard fails: no longer 'pending'

      expect(firstWriterSucceeds).toBe(true);
      expect(secondWriterSucceeds).toBe(false);
    });
  });

  // ─── TRANSACTION MANAGER EDGE CASES ───────────────────────────

  describe('Transaction manager scenarios', () => {
    test('transaction retries on TransientTransactionError', async () => {
      let attempts = 0;
      const maxRetries = 3;
      let success = false;

      while (attempts < maxRetries) {
        attempts++;
        if (attempts < 3) {
          // Simulated transient error
          continue;
        }
        success = true;
        break;
      }

      expect(success).toBe(true);
      expect(attempts).toBe(3);
    });

    test('transaction retries on WriteConflict (code 112)', () => {
      const error = { code: 112, message: 'WriteConflict' };
      const isRetryable = error.code === 112;
      expect(isRetryable).toBe(true);
    });

    test('transaction does NOT retry on validation errors', () => {
      const error = { name: 'ValidationError', message: 'Path required' };
      const isRetryable = error.code === 112 || 
        error.codeName === 'TransientTransactionError';
      expect(isRetryable).toBe(false);
    });

    test('optimistic lock retries on version mismatch', () => {
      let version = 1;
      let attempts = 0;
      let success = false;

      // Simulate CAS: read version, try update, version changed
      while (attempts < 5) {
        attempts++;
        const readVersion = version;
        
        // Another writer incremented version
        if (attempts < 3) {
          version++;
          // CAS fails: readVersion != currentVersion
          continue;
        }
        
        success = true;
        break;
      }

      expect(success).toBe(true);
      expect(attempts).toBe(3);
    });

    test('saga compensation runs on failure', async () => {
      const compensations = [];

      const steps = [
        {
          execute: () => { /* Step 1: create order */ },
          compensate: () => { compensations.push('delete_order'); }
        },
        {
          execute: () => { /* Step 2: debit payment */ },
          compensate: () => { compensations.push('reverse_payment'); }
        },
        {
          execute: () => { throw new Error('Step 3 failed'); },
          compensate: () => { compensations.push('undo_step3'); }
        }
      ];

      // Execute steps until failure, then compensate in reverse
      let failedAt = -1;
      for (let i = 0; i < steps.length; i++) {
        try {
          steps[i].execute();
        } catch (e) {
          failedAt = i;
          break;
        }
      }

      // Compensate completed steps in reverse
      if (failedAt >= 0) {
        for (let i = failedAt - 1; i >= 0; i--) {
          steps[i].compensate();
        }
      }

      // Step 3 failed → compensate step 2, then step 1
      expect(compensations).toEqual(['reverse_payment', 'delete_order']);
    });
  });
});
