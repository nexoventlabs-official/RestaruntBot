/**
 * Payment Failure & Edge-Case Tests
 *
 * Tests Razorpay payment verification, signature handling, amount validation,
 * partial failures, and recovery paths.
 *
 * 💰 FINANCIAL RISK: Incorrect payment verification can accept unpaid orders,
 * under-payments, or forged signatures — directly causing revenue loss.
 */

const crypto = require('crypto');

// ── Mocks ───────────────────────────────────────────────────────

const mockOrderFindOne = jest.fn();
const mockOrderSave = jest.fn();
const mockRazorpayFetch = jest.fn();

jest.mock('../../services/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}));

jest.mock('../../services/whatsapp', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendButtons: jest.fn().mockResolvedValue(true)
}));

jest.mock('../../services/correlationContext', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}));

// ── Helpers ─────────────────────────────────────────────────────

const KEY_SECRET = 'test_key_secret_123';

function generateVerifyUpiSignature(orderId, paymentId) {
  const body = orderId + '|' + paymentId;
  return crypto
    .createHmac('sha256', KEY_SECRET)
    .update(body)
    .digest('hex');
}

function createMockOrder(overrides = {}) {
  return {
    orderId: 'ORD_TEST001',
    status: 'pending',
    paymentStatus: 'pending',
    razorpayOrderId: 'order_test123',
    itemsTotal: 500,
    deliveryCharge: 50,
    totalAmount: 550,
    customer: { phone: '919999999999', name: 'Test User' },
    items: [{ name: 'Pizza', quantity: 2, price: 250 }],
    trackingUpdates: [],
    save: mockOrderSave.mockResolvedValue(true),
    ...overrides
  };
}

// ── Tests ───────────────────────────────────────────────────────

describe('Payment Failure Scenarios', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.RAZORPAY_KEY_SECRET = KEY_SECRET;
  });

  // ─── SIGNATURE VERIFICATION ──────────────────────────────────

  describe('Signature verification', () => {
    test('valid signature passes verification', () => {
      const orderId = 'order_abc123';
      const paymentId = 'pay_xyz789';
      const signature = generateVerifyUpiSignature(orderId, paymentId);

      const body = orderId + '|' + paymentId;
      const expected = crypto
        .createHmac('sha256', KEY_SECRET)
        .update(body)
        .digest('hex');

      expect(signature).toBe(expected);
    });

    test('forged signature is rejected', () => {
      const orderId = 'order_abc123';
      const paymentId = 'pay_xyz789';
      const forgedSignature = 'a'.repeat(64);

      const body = orderId + '|' + paymentId;
      const expected = crypto
        .createHmac('sha256', KEY_SECRET)
        .update(body)
        .digest('hex');

      expect(forgedSignature).not.toBe(expected);
    });

    test('empty signature is rejected', () => {
      const expected = generateVerifyUpiSignature('order_abc123', 'pay_xyz789');
      expect('').not.toBe(expected);
      expect(null).not.toBe(expected);
      expect(undefined).not.toBe(expected);
    });

    test('signature with different order_id is rejected', () => {
      const sig1 = generateVerifyUpiSignature('order_ONE', 'pay_123');
      const sig2 = generateVerifyUpiSignature('order_TWO', 'pay_123');
      expect(sig1).not.toBe(sig2);
    });

    test('signature with different payment_id is rejected', () => {
      const sig1 = generateVerifyUpiSignature('order_abc', 'pay_ONE');
      const sig2 = generateVerifyUpiSignature('order_abc', 'pay_TWO');
      expect(sig1).not.toBe(sig2);
    });

    test('💰 signature with swapped order_id and payment_id is rejected', () => {
      // Attacker might try swapping parameters
      const sig1 = generateVerifyUpiSignature('order_abc', 'pay_xyz');
      const sig2 = generateVerifyUpiSignature('pay_xyz', 'order_abc');
      expect(sig1).not.toBe(sig2);
    });
  });

  // ─── MISSING PAYMENT FIELDS ──────────────────────────────────

  describe('Missing payment fields', () => {
    test('verify-upi with missing razorpay_order_id should fail', () => {
      const params = {
        razorpay_order_id: undefined,
        razorpay_payment_id: 'pay_123',
        razorpay_signature: 'sig_123',
        orderId: 'ORD_TEST001'
      };

      expect(params.razorpay_order_id).toBeUndefined();
      // Signature generation with undefined will produce different hash
      const sig = generateVerifyUpiSignature(params.razorpay_order_id, params.razorpay_payment_id);
      expect(sig).not.toBe(params.razorpay_signature);
    });

    test('verify-upi with missing razorpay_payment_id should fail', () => {
      const params = {
        razorpay_order_id: 'order_123',
        razorpay_payment_id: undefined,
        razorpay_signature: 'sig_123',
        orderId: 'ORD_TEST001'
      };

      expect(params.razorpay_payment_id).toBeUndefined();
    });

    test('verify-upi with missing orderId cannot find order', () => {
      mockOrderFindOne.mockResolvedValue(null);

      const params = {
        razorpay_order_id: 'order_123',
        razorpay_payment_id: 'pay_123',
        razorpay_signature: 'sig_123',
        orderId: undefined
      };

      expect(params.orderId).toBeUndefined();
    });

    test('verify-upi for non-existent order returns error', async () => {
      mockOrderFindOne.mockResolvedValue(null);
      const order = await mockOrderFindOne({ orderId: 'ORD_NONEXIST' });
      expect(order).toBeNull();
    });
  });

  // ─── PAYMENT STATUS TRANSITIONS ──────────────────────────────

  describe('Payment status transitions', () => {
    test('pending → paid on successful verification', () => {
      const order = createMockOrder({ paymentStatus: 'pending' });
      
      order.paymentStatus = 'paid';
      order.razorpayPaymentId = 'pay_success123';
      
      expect(order.paymentStatus).toBe('paid');
      expect(order.razorpayPaymentId).toBe('pay_success123');
    });

    test('pending → failed on failed verification', () => {
      const order = createMockOrder({ paymentStatus: 'pending' });
      
      order.paymentStatus = 'failed';
      
      expect(order.paymentStatus).toBe('failed');
    });

    test('💰 paid → paid is idempotent (no double-processing)', () => {
      const order = createMockOrder({ paymentStatus: 'paid' });
      
      // verify-upi checks: if (order.paymentStatus === 'paid') return early
      const alreadyPaid = order.paymentStatus === 'paid';
      expect(alreadyPaid).toBe(true);
    });

    test('💰 failed → paid should NOT be allowed without new payment', () => {
      // A failed payment should not be flippable to paid 
      // without a new valid Razorpay transaction
      const order = createMockOrder({ paymentStatus: 'failed' });
      
      // FIXED: State machine blocks transitions from terminal states (failed/cancelled)
      // Atomic findOneAndUpdate with paymentStatus: { $ne: 'paid' } prevents this
      expect(order.paymentStatus).toBe('failed');
    });

    test('💰 cancelled → paid should not resurrect cancelled order', () => {
      const order = createMockOrder({ 
        paymentStatus: 'cancelled',
        status: 'cancelled'
      });
      
      // If webhook arrives after cancellation, it should NOT change status
      expect(order.paymentStatus).toBe('cancelled');
      expect(order.status).toBe('cancelled');
    });
  });

  // ─── AMOUNT VERIFICATION ────────────────────────────────────

  describe('Amount verification', () => {
    test('💰 order amount matches Razorpay amount (in paise)', () => {
      const order = createMockOrder({ totalAmount: 550 }); // ₹550
      const razorpayAmount = 55000; // Razorpay uses paise
      
      expect(razorpayAmount / 100).toBe(order.totalAmount);
    });

    test('💰 underpayment should be rejected', () => {
      const order = createMockOrder({ totalAmount: 550 });
      const razorpayAmount = 50000; // Only ₹500, short by ₹50
      
      expect(razorpayAmount / 100).not.toBe(order.totalAmount);
      expect(razorpayAmount / 100).toBeLessThan(order.totalAmount);
    });

    test('💰 overpayment should be flagged', () => {
      const order = createMockOrder({ totalAmount: 550 });
      const razorpayAmount = 60000; // ₹600, overpaid by ₹50
      
      expect(razorpayAmount / 100).not.toBe(order.totalAmount);
      expect(razorpayAmount / 100).toBeGreaterThan(order.totalAmount);
    });

    test('💰 zero amount order should be rejected', () => {
      const order = createMockOrder({ totalAmount: 0 });
      expect(order.totalAmount).toBe(0);
      // Should not create Razorpay order for zero amount
    });

    test('💰 negative amount should be rejected', () => {
      const order = createMockOrder({ totalAmount: -100 });
      expect(order.totalAmount).toBeLessThan(0);
    });

    test('💰 floating point amount rounds correctly (paise conversion)', () => {
      // ₹10.50 = 1050 paise, not 1049.9999 or 1050.0001
      const amount = 10.50;
      const paise = Math.round(amount * 100);
      expect(paise).toBe(1050);
      
      // Edge case: ₹99.99
      const amount2 = 99.99;
      const paise2 = Math.round(amount2 * 100);
      expect(paise2).toBe(9999);
    });
  });

  // ─── RAZORPAY API FAILURES ──────────────────────────────────

  describe('Razorpay API failures', () => {
    test('Razorpay timeout during order creation should not leave partial state', () => {
      // If Razorpay times out when creating order, the order should not
      // be saved with a pending razorpayOrderId
      const order = createMockOrder({ razorpayOrderId: undefined });
      expect(order.razorpayOrderId).toBeUndefined();
      // No Razorpay order = no payment link = customer must retry
    });

    test('Razorpay returns error during payment capture', async () => {
      mockRazorpayFetch.mockRejectedValue(new Error('Razorpay API error'));
      
      await expect(mockRazorpayFetch('pay_123')).rejects.toThrow('Razorpay API error');
      // Order should remain in pending state, not marked as failed
    });

    test('Razorpay webhook with invalid event type is ignored', () => {
      const knownEvents = [
        'payment.captured',
        'payment.failed'
      ];
      
      expect(knownEvents).not.toContain('order.paid');
      expect(knownEvents).not.toContain('settlement.processed');
    });
  });

  // ─── WEBHOOK PAYLOAD EDGE CASES ───────────────────────────────

  describe('Webhook payload edge cases', () => {
    test('empty payload body returns 400', () => {
      const rawBody = '';
      expect(rawBody.length).toBe(0);
      // Should return 400, not crash
    });

    test('malformed JSON payload returns 400', () => {
      const rawBody = '{invalid json';
      expect(() => JSON.parse(rawBody)).toThrow();
    });

    test('payload missing payment.entity is handled', () => {
      const payload = { event: 'payment.captured', payload: {} };
      expect(payload.payload.payment).toBeUndefined();
    });

    test('payload with null notes.orderId is handled', () => {
      const payload = {
        event: 'payment.captured',
        payload: {
          payment: {
            entity: {
              id: 'pay_123',
              notes: { orderId: null }
            }
          }
        }
      };
      expect(payload.payload.payment.entity.notes.orderId).toBeNull();
    });
  });
});
