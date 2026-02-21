/**
 * Order State Machine Tests
 * 
 * Tests ALL valid/invalid state transitions, idempotent same-status transitions,
 * terminal states, and tracking update behavior.
 * 
 * FINANCIAL RISK: Invalid transitions can move paid orders to cancelled 
 * without triggering refunds, or move cancelled orders to delivered.
 */

const { ORDER_STATUS, ALLOWED_TRANSITIONS, validateTransition, transitionStatus } = require('../../services/orderStateMachine');

// Mock logger (raw Winston in original)
jest.mock('../../services/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}));

const logger = require('../../services/logger');

describe('Order State Machine', () => {
  let mockOrder;

  beforeEach(() => {
    mockOrder = {
      orderId: 'ORD_TEST123',
      status: 'pending',
      trackingUpdates: [],
      statusUpdatedAt: null
    };
    jest.clearAllMocks();
  });

  // ─── VALID TRANSITIONS ───────────────────────────────────────

  describe('Valid transitions', () => {
    const validPaths = [
      ['pending', 'confirmed'],
      ['pending', 'cancelled'],
      ['confirmed', 'preparing'],
      ['confirmed', 'ready'],
      ['confirmed', 'cancelled'],
      ['confirmed', 'refunded'],
      ['confirmed', 'refund_failed'],
      ['preparing', 'ready'],
      ['preparing', 'cancelled'],
      ['preparing', 'refunded'],
      ['preparing', 'refund_failed'],
      ['ready', 'out_for_delivery'],
      ['ready', 'delivered'],
      ['ready', 'cancelled'],
      ['ready', 'refunded'],
      ['ready', 'refund_failed'],
      ['out_for_delivery', 'delivered'],
      ['out_for_delivery', 'cancelled'],
      ['out_for_delivery', 'refunded'],
      ['out_for_delivery', 'refund_failed'],
      ['delivered', 'refunded'],
      ['delivered', 'refund_failed'],
      ['cancelled', 'refunded'],
      ['cancelled', 'refund_failed'],
      ['refund_failed', 'refunded'],
      ['refund_failed', 'cancelled'],
    ];

    test.each(validPaths)(
      '%s → %s should be valid',
      (from, to) => {
        const result = validateTransition(from, to);
        expect(result.valid).toBe(true);
        expect(result.reason).toBeUndefined();
      }
    );
  });

  // ─── INVALID TRANSITIONS ─────────────────────────────────────

  describe('Invalid transitions', () => {
    const invalidPaths = [
      ['pending', 'preparing', 'Must go through confirmed first'],
      ['pending', 'ready', 'Must go through confirmed→preparing'],
      ['pending', 'delivered', 'Cannot deliver unpaid order'],
      ['pending', 'out_for_delivery', 'Not confirmed yet'],
      ['confirmed', 'pending', 'Cannot revert to pending'],
      ['confirmed', 'out_for_delivery', 'Must go through preparing→ready'],
      ['confirmed', 'delivered', 'Must go through preparing→ready→delivery'],
      ['preparing', 'pending', 'Cannot revert to pending'],
      ['preparing', 'confirmed', 'Cannot revert to confirmed'],
      ['preparing', 'out_for_delivery', 'Must go through ready'],
      ['ready', 'pending', 'Cannot revert'],
      ['ready', 'confirmed', 'Cannot revert'],
      ['ready', 'preparing', 'Cannot revert'],
      ['out_for_delivery', 'pending', 'Cannot revert'],
      ['out_for_delivery', 'confirmed', 'Cannot revert'],
      ['out_for_delivery', 'preparing', 'Cannot revert'],
      ['out_for_delivery', 'ready', 'Cannot revert'],
      ['delivered', 'pending', 'Cannot revert delivered'],
      ['delivered', 'confirmed', 'Cannot revert delivered'],
      ['delivered', 'cancelled', 'Cannot cancel after delivery'],
      ['refunded', 'pending', 'Terminal state'],
      ['refunded', 'confirmed', 'Terminal state'],
      ['refunded', 'cancelled', 'Terminal state'],
      ['refunded', 'delivered', 'Terminal state'],
    ];

    test.each(invalidPaths)(
      '%s → %s should be invalid (%s)',
      (from, to) => {
        const result = validateTransition(from, to);
        expect(result.valid).toBe(false);
        expect(result.reason).toBeDefined();
      }
    );
  });

  // ─── TERMINAL STATES ─────────────────────────────────────────

  describe('Terminal states', () => {
    test('refunded has no outbound transitions', () => {
      expect(ALLOWED_TRANSITIONS[ORDER_STATUS.REFUNDED]).toEqual([]);
    });

    test('refunded → any status should be invalid', () => {
      const allStatuses = Object.values(ORDER_STATUS).filter(s => s !== 'refunded');
      allStatuses.forEach(status => {
        const result = validateTransition('refunded', status);
        expect(result.valid).toBe(false);
      });
    });
  });

  // ─── IDEMPOTENT SAME-STATUS ───────────────────────────────────

  describe('Same-status transition (idempotency)', () => {
    test.each(Object.values(ORDER_STATUS))(
      '%s → %s should be valid (no-op)',
      (status) => {
        const result = validateTransition(status, status);
        expect(result.valid).toBe(true);
      }
    );
  });

  // ─── transitionStatus() BEHAVIOR ──────────────────────────────

  describe('transitionStatus()', () => {
    test('valid transition mutates order status', () => {
      mockOrder.status = 'pending';
      const result = transitionStatus(mockOrder, 'confirmed', 'Order confirmed by restaurant');
      
      expect(result.success).toBe(true);
      expect(mockOrder.status).toBe('confirmed');
      expect(mockOrder.statusUpdatedAt).toBeInstanceOf(Date);
    });

    test('valid transition adds tracking update when message provided', () => {
      mockOrder.status = 'confirmed';
      transitionStatus(mockOrder, 'preparing', 'Chef started preparing');
      
      expect(mockOrder.trackingUpdates).toHaveLength(1);
      expect(mockOrder.trackingUpdates[0]).toMatchObject({
        status: 'preparing',
        message: 'Chef started preparing'
      });
      expect(mockOrder.trackingUpdates[0].timestamp).toBeInstanceOf(Date);
    });

    test('valid transition without message does not add tracking update', () => {
      mockOrder.status = 'pending';
      transitionStatus(mockOrder, 'confirmed');
      
      expect(mockOrder.trackingUpdates).toHaveLength(0);
    });

    test('invalid transition does NOT mutate order', () => {
      mockOrder.status = 'delivered';
      const result = transitionStatus(mockOrder, 'pending');
      
      expect(result.success).toBe(false);
      expect(mockOrder.status).toBe('delivered'); // Unchanged
    });

    test('invalid transition logs warning with orderId and reason', () => {
      mockOrder.status = 'delivered';
      transitionStatus(mockOrder, 'pending');
      
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Invalid'),
        expect.objectContaining({
          orderId: 'ORD_TEST123',
          from: 'delivered',
          to: 'pending'
        })
      );
    });

    test('valid transition logs info with from/to', () => {
      mockOrder.status = 'pending';
      transitionStatus(mockOrder, 'confirmed');
      
      expect(logger.info).toHaveBeenCalledWith(
        'Order status transitioned',
        expect.objectContaining({
          orderId: 'ORD_TEST123',
          from: 'pending',
          to: 'confirmed'
        })
      );
    });

    test('invalid target status is rejected', () => {
      const result = validateTransition('pending', 'nonexistent_status');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Invalid target status');
    });

    test('unknown current status is rejected', () => {
      const result = validateTransition('bogus_status', 'confirmed');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Unknown current status');
    });
  });

  // ─── FULL ORDER LIFECYCLE PATHS ───────────────────────────────

  describe('Full lifecycle paths', () => {
    test('happy path: delivery order', () => {
      const steps = ['pending', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'delivered'];
      for (let i = 0; i < steps.length - 1; i++) {
        mockOrder.status = steps[i];
        const result = transitionStatus(mockOrder, steps[i + 1]);
        expect(result.success).toBe(true);
      }
      expect(mockOrder.status).toBe('delivered');
    });

    test('happy path: pickup order (skips out_for_delivery)', () => {
      const steps = ['pending', 'confirmed', 'preparing', 'ready', 'delivered'];
      for (let i = 0; i < steps.length - 1; i++) {
        mockOrder.status = steps[i];
        const result = transitionStatus(mockOrder, steps[i + 1]);
        expect(result.success).toBe(true);
      }
      expect(mockOrder.status).toBe('delivered');
    });

    test('cancellation path: cancel mid-preparation', () => {
      const steps = ['pending', 'confirmed', 'preparing'];
      for (let i = 0; i < steps.length - 1; i++) {
        mockOrder.status = steps[i];
        transitionStatus(mockOrder, steps[i + 1]);
      }
      const result = transitionStatus(mockOrder, 'cancelled');
      expect(result.success).toBe(true);
      expect(mockOrder.status).toBe('cancelled');
    });

    test('refund path: delivered → refunded', () => {
      mockOrder.status = 'delivered';
      const result = transitionStatus(mockOrder, 'refunded');
      expect(result.success).toBe(true);
    });

    test('refund failure path: delivered → refund_failed → refunded', () => {
      mockOrder.status = 'delivered';
      let result = transitionStatus(mockOrder, 'refund_failed');
      expect(result.success).toBe(true);

      result = transitionStatus(mockOrder, 'refunded');
      expect(result.success).toBe(true);
    });

    test('COD order: confirmed immediately (no pending→confirmed for COD)', () => {
      // COD orders are created with status: 'confirmed' directly
      // But if created as pending first, transition should still work
      mockOrder.status = 'pending';
      const result = transitionStatus(mockOrder, 'confirmed');
      expect(result.success).toBe(true);
    });
  });

  // ─── FINANCIAL RISK: DANGEROUS TRANSITIONS ────────────────────

  describe('Financial risk transitions', () => {
    test('RISK: delivered → cancelled is blocked (would lose paid revenue)', () => {
      mockOrder.status = 'delivered';
      const result = transitionStatus(mockOrder, 'cancelled');
      expect(result.success).toBe(false);
    });

    test('RISK: refunded → delivered is blocked (would double-count)', () => {
      mockOrder.status = 'refunded';
      const result = transitionStatus(mockOrder, 'delivered');
      expect(result.success).toBe(false);
    });

    test('RISK: cancelled → confirmed is blocked (zombie order)', () => {
      mockOrder.status = 'cancelled';
      const result = transitionStatus(mockOrder, 'confirmed');
      expect(result.success).toBe(false);
    });

    test('RISK: cancelled → delivered is blocked (fulfilling cancelled order)', () => {
      mockOrder.status = 'cancelled';
      const result = transitionStatus(mockOrder, 'delivered');
      expect(result.success).toBe(false);
    });
  });
});
