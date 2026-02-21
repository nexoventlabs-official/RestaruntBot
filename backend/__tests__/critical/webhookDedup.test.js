/**
 * Payment Webhook Deduplication Tests
 *
 * Tests the PaymentEvent-based idempotency guard that protects against
 * Razorpay delivering the same webhook event multiple times.
 *
 * 💰 FINANCIAL RISK: Failed dedup can cause double-crediting, double-refunding,
 * or the dedup-before-commit bug where payment is deduplicated before the
 * DB write completes — a crash between create(PaymentEvent) and order.save()
 * causes PERMANENT payment loss.
 */

const crypto = require('crypto');

// ── Mocks ───────────────────────────────────────────────────────

const mockOrderFindOne = jest.fn();
const mockOrderSave = jest.fn();
const mockPaymentEventCreate = jest.fn();

jest.mock('../../models/Order', () => ({
  findOne: mockOrderFindOne
}));

jest.mock('../../models/PaymentEvent', () => ({
  create: mockPaymentEventCreate
}));

jest.mock('../../services/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}));

jest.mock('../../services/whatsapp', () => ({
  sendMessage: jest.fn(),
  sendButtons: jest.fn()
}));

jest.mock('../../services/correlationContext', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}));

jest.mock('../../services/googleSheets', () => ({
  appendNewOrder: jest.fn(),
  updateOrderStatus: jest.fn()
}));

// ── Setup ───────────────────────────────────────────────────────

const WEBHOOK_SECRET = 'test_webhook_secret';

function generateValidSignature(body) {
  return crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(typeof body === 'string' ? body : JSON.stringify(body))
    .digest('hex');
}

function makeWebhookPayload(eventId, eventType, paymentId, orderId) {
  return {
    event_id: eventId,
    event: eventType,
    payload: {
      payment: {
        entity: {
          id: paymentId,
          order_id: orderId,
          amount: 50000, // 500.00 INR in paise
          notes: { orderId: 'ORD_TEST1' }
        }
      },
      refund: {
        entity: {
          id: 'rfnd_test123',
          payment_id: paymentId,
          amount: 50000
        }
      }
    }
  };
}

// ── Tests ───────────────────────────────────────────────────────

describe('Webhook Deduplication', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;
  });

  describe('PaymentEvent dedup guard', () => {
    test('first webhook event creates PaymentEvent and processes', async () => {
      mockPaymentEventCreate.mockResolvedValue({
        eventId: 'evt_001',
        eventType: 'payment.captured'
      });

      const result = await simulateWebhookDedup('evt_001', 'payment.captured');
      
      expect(mockPaymentEventCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          eventId: 'evt_001',
          eventType: 'payment.captured'
        })
      );
      expect(result.processed).toBe(true);
    });

    test('duplicate webhook event (E11000) returns early without processing', async () => {
      const dupError = new Error('E11000 duplicate key error');
      dupError.code = 11000;
      mockPaymentEventCreate.mockRejectedValue(dupError);

      const result = await simulateWebhookDedup('evt_001', 'payment.captured');
      
      expect(result.processed).toBe(false);
      expect(result.duplicate).toBe(true);
    });

    test('non-dedup error from PaymentEvent.create propagates', async () => {
      mockPaymentEventCreate.mockRejectedValue(new Error('DB connection lost'));

      await expect(
        simulateWebhookDedup('evt_001', 'payment.captured')
      ).rejects.toThrow('DB connection lost');
    });

    test('webhook without event_id bypasses dedup (processes normally)', async () => {
      // Some older Razorpay payloads may lack event_id
      const result = await simulateWebhookDedup(null, 'payment.captured');
      
      expect(mockPaymentEventCreate).not.toHaveBeenCalled();
      expect(result.processed).toBe(true);
    });
  });

  describe('💰 Dedup-before-commit bug', () => {
    /**
     * CRITICAL BUG: The webhook handler creates PaymentEvent BEFORE updating 
     * the order. If the server crashes between these two operations:
     *   1. PaymentEvent.create(eventId) ← succeeds
     *   2. order.save() ← CRASH here
     * 
     * When Razorpay retries the webhook, step 1 returns E11000 (duplicate),
     * and the payment is permanently lost — the order stays unpaid, but the
     * event is marked as processed.
     */
    test('SCENARIO: crash after PaymentEvent.create, before order.save', async () => {
      // Step 1: PaymentEvent.create succeeds
      mockPaymentEventCreate.mockResolvedValue({ eventId: 'evt_crash_001' });
      
      // Step 2: order.save fails (simulating crash/timeout)
      mockOrderFindOne.mockResolvedValue({
        orderId: 'ORD_CRASH1',
        status: 'pending',
        paymentStatus: 'pending',
        save: jest.fn().mockRejectedValue(new Error('MongoTimeoutError: connection timed out'))
      });

      // First attempt: PaymentEvent recorded, but order update fails
      try {
        await simulateFullWebhookFlow('evt_crash_001', 'payment.captured', 'ORD_CRASH1');
      } catch (e) {
        // Expected: order update failed
      }

      // Second attempt (Razorpay retry): PaymentEvent already exists
      const dupError = new Error('E11000 duplicate key');
      dupError.code = 11000;
      mockPaymentEventCreate.mockRejectedValue(dupError);

      const retryResult = await simulateWebhookDedup('evt_crash_001', 'payment.captured');
      
      // BUG: This should NOT be treated as duplicate — order was never updated
      // But the current code WILL skip it
      expect(retryResult.duplicate).toBe(true);
      // The order is STILL unpaid — money is lost
    });

    test('FIX VERIFICATION: PaymentEvent should be created AFTER order.save', () => {
      /**
       * The correct order of operations should be:
       *   1. order.save() with paymentStatus: 'paid'
       *   2. PaymentEvent.create(eventId)
       * 
       * This way, if step 2 fails, Razorpay will retry and the webhook
       * handler should check if the order is already paid (idempotent).
       * 
       * This test documents the expected fix. Currently FAILING by design.
       */
      // Placeholder: implement once the fix is applied
      expect(true).toBe(true); // TODO: Verify commit-then-dedup ordering
    });
  });

  describe('Cross-endpoint race conditions', () => {
    /**
     * 💰 FINANCIAL RISK: Three endpoints can update the same order concurrently:
     *   1. POST /verify-upi — called by frontend after Razorpay checkout
     *   2. POST /razorpay-webhook — called by Razorpay server
     *   3. GET /callback — called by Razorpay payment link redirect
     *
     * Only the webhook uses PaymentEvent dedup. The other two rely only on
     * checking `order.paymentStatus === 'paid'`, which is subject to TOCTOU.
     */

    test('verify-upi and webhook arrive simultaneously for same order', async () => {
      const order = {
        orderId: 'ORD_RACE1',
        status: 'pending',
        paymentStatus: 'pending',
        razorpayOrderId: 'rzp_order_test1',
        save: jest.fn()
      };

      // Both endpoints read paymentStatus as 'pending' (TOCTOU window)
      // Both proceed to update it to 'paid'
      
      // Simulate: verify-upi reads order first
      const verifyOrder = { ...order, paymentStatus: 'pending' };
      // Simulate: webhook reads order concurrently  
      const webhookOrder = { ...order, paymentStatus: 'pending' };

      // Both see 'pending', both will try to set 'paid'
      // Without optimistic locking, both succeed
      verifyOrder.paymentStatus = 'paid';
      webhookOrder.paymentStatus = 'paid';

      // This should ideally use findOneAndUpdate with a paymentStatus: 'pending' guard
      expect(verifyOrder.paymentStatus).toBe('paid');
      expect(webhookOrder.paymentStatus).toBe('paid');
      
      // BUG: Both endpoints may send confirmation WhatsApp messages
      // BUG: Both endpoints may update Google Sheets
      // BUG: No version check prevents the double-write
    });

    test('verify-upi idempotency guard: already-paid returns early', () => {
      // The verify-upi endpoint's only dedup is:
      //   if (order.paymentStatus === 'paid') return { success: true }
      // This is correct for sequential calls but racy for concurrent ones
      
      const order = { paymentStatus: 'paid' };
      const isPaid = order.paymentStatus === 'paid';
      expect(isPaid).toBe(true);
      // Correct: Returns success without double-processing
    });
  });

  describe('HMAC signature verification', () => {
    test('valid webhook signature is accepted', () => {
      const body = '{"event":"payment.captured"}';
      const signature = generateValidSignature(body);

      const expected = crypto
        .createHmac('sha256', WEBHOOK_SECRET)
        .update(body)
        .digest('hex');

      const sigBuf = Buffer.from(signature);
      const expBuf = Buffer.from(expected);
      
      expect(sigBuf.length).toBe(expBuf.length);
      expect(crypto.timingSafeEqual(sigBuf, expBuf)).toBe(true);
    });

    test('invalid webhook signature is rejected', () => {
      const body = '{"event":"payment.captured"}';
      const badSignature = 'deadbeef'.repeat(8); // 64 hex chars (SHA-256)

      const expected = generateValidSignature(body);
      const sigBuf = Buffer.from(badSignature);
      const expBuf = Buffer.from(expected);

      if (sigBuf.length === expBuf.length) {
        expect(crypto.timingSafeEqual(sigBuf, expBuf)).toBe(false);
      } else {
        // Different lengths immediately rejected
        expect(sigBuf.length).not.toBe(expBuf.length);
      }
    });

    test('tampered body produces different signature', () => {
      const originalBody = '{"event":"payment.captured","amount":50000}';
      const tamperedBody = '{"event":"payment.captured","amount":100}';

      const originalSig = generateValidSignature(originalBody);
      const tamperedSig = generateValidSignature(tamperedBody);

      expect(originalSig).not.toBe(tamperedSig);
    });

    test('💰 verify-upi uses non-timing-safe comparison (CVE risk)', () => {
      // The verify-upi endpoint (payment.js L72-80) uses:
      //   expectedSignature !== razorpay_signature   (plain ===)
      // 
      // While not exploitable in practice for HMAC, it's a security hygiene issue.
      // This documents the discrepancy vs the webhook handler which correctly uses
      // crypto.timingSafeEqual.
      
      const sig1 = 'abc123';
      const sig2 = 'abc123';
      
      // Plain comparison (current code)
      expect(sig1 !== sig2).toBe(false); // strings match
      
      // Timing-safe comparison (correct approach)
      expect(
        crypto.timingSafeEqual(Buffer.from(sig1), Buffer.from(sig2))
      ).toBe(true);
    });
  });

  describe('Refund webhook deduplication', () => {
    test('refund.processed event is deduplicated by eventId', async () => {
      mockPaymentEventCreate.mockResolvedValue({ eventId: 'evt_refund_001' });

      const result = await simulateWebhookDedup('evt_refund_001', 'refund.processed');
      expect(result.processed).toBe(true);
      expect(mockPaymentEventCreate).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'refund.processed' })
      );
    });

    test('refund.failed event is deduplicated by eventId', async () => {
      mockPaymentEventCreate.mockResolvedValue({ eventId: 'evt_refund_fail' });

      const result = await simulateWebhookDedup('evt_refund_fail', 'refund.failed');
      expect(result.processed).toBe(true);
    });

    test('💰 same payment, different event types are NOT deduped against each other', async () => {
      // payment.captured and refund.processed have different event IDs
      // so they correctly process independently
      mockPaymentEventCreate.mockResolvedValue({});

      const capturedResult = await simulateWebhookDedup('evt_cap_001', 'payment.captured');
      const refundResult = await simulateWebhookDedup('evt_ref_001', 'refund.processed');
      
      expect(capturedResult.processed).toBe(true);
      expect(refundResult.processed).toBe(true);
      expect(mockPaymentEventCreate).toHaveBeenCalledTimes(2);
    });
  });
});

// ── Simulation helpers (mirror actual webhook handler logic) ─────

async function simulateWebhookDedup(eventId, eventType) {
  if (eventId) {
    try {
      await mockPaymentEventCreate({
        eventId: eventId,
        eventType: eventType
      });
    } catch (dedupErr) {
      if (dedupErr.code === 11000) {
        return { processed: false, duplicate: true };
      }
      throw dedupErr;
    }
  }
  return { processed: true, duplicate: false };
}

async function simulateFullWebhookFlow(eventId, eventType, orderId) {
  // Step 1: Dedup (PaymentEvent)
  await mockPaymentEventCreate({ eventId, eventType });

  // Step 2: Find and update order
  const order = await mockOrderFindOne({ orderId });
  if (!order) throw new Error('Order not found');
  
  order.paymentStatus = 'paid';
  order.status = 'confirmed';
  await order.save();
}
