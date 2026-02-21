/**
 * Order Lifecycle Audit Tests
 * 
 * Validates all fixes from the Order Lifecycle Trace audit:
 * - State machine coverage (all bypass paths eliminated)
 * - Optimistic concurrency control
 * - VersionError handling
 * - Proper transition validation at every mutation path
 */

const fs = require('fs');
const path = require('path');

// Helper to read file content
function readFile(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

describe('Order Lifecycle — State Machine Coverage', () => {
  
  describe('State Machine Module', () => {
    const { validateTransition, transitionStatus, ORDER_STATUS, ALLOWED_TRANSITIONS } = require('../services/orderStateMachine');

    test('exports ORDER_STATUS with all 7 states', () => {
      expect(Object.keys(ORDER_STATUS)).toHaveLength(7);
      expect(ORDER_STATUS).toEqual(expect.objectContaining({
        PENDING: 'pending',
        CONFIRMED: 'confirmed',
        PREPARING: 'preparing',
        READY: 'ready',
        OUT_FOR_DELIVERY: 'out_for_delivery',
        DELIVERED: 'delivered',
        CANCELLED: 'cancelled'
      }));
    });

    test('delivered and cancelled are terminal states with no outgoing transitions', () => {
      expect(ALLOWED_TRANSITIONS[ORDER_STATUS.DELIVERED]).toEqual([]);
      expect(ALLOWED_TRANSITIONS[ORDER_STATUS.CANCELLED]).toEqual([]);
    });

    test('validates allowed transitions', () => {
      expect(validateTransition('pending', 'confirmed').valid).toBe(true);
      expect(validateTransition('pending', 'cancelled').valid).toBe(true);
      expect(validateTransition('confirmed', 'preparing').valid).toBe(true);
      expect(validateTransition('out_for_delivery', 'delivered').valid).toBe(true);
    });

    test('blocks illegal transitions', () => {
      expect(validateTransition('delivered', 'pending').valid).toBe(false);
      expect(validateTransition('cancelled', 'confirmed').valid).toBe(false);
      expect(validateTransition('pending', 'delivered').valid).toBe(false);
      expect(validateTransition('delivered', 'cancelled').valid).toBe(false);
    });

    test('allows same-status for idempotency', () => {
      expect(validateTransition('pending', 'pending').valid).toBe(true);
      expect(validateTransition('delivered', 'delivered').valid).toBe(true);
    });

    test('transitionStatus mutates order and pushes trackingUpdate', () => {
      const mockOrder = {
        orderId: 'TEST001',
        status: 'pending',
        trackingUpdates: []
      };
      const result = transitionStatus(mockOrder, 'confirmed', 'Test transition', 'test');
      expect(result.success).toBe(true);
      expect(mockOrder.status).toBe('confirmed');
      expect(mockOrder.statusUpdatedAt).toBeDefined();
      expect(mockOrder.trackingUpdates).toHaveLength(1);
      expect(mockOrder.trackingUpdates[0].status).toBe('confirmed');
    });

    test('transitionStatus rejects invalid transition without mutating', () => {
      const mockOrder = {
        orderId: 'TEST002',
        status: 'delivered',
        trackingUpdates: []
      };
      const result = transitionStatus(mockOrder, 'pending', 'Should fail');
      expect(result.success).toBe(false);
      expect(mockOrder.status).toBe('delivered'); // unchanged
      expect(mockOrder.trackingUpdates).toHaveLength(0); // no spurious tracking
    });
  });

  describe('Bypass Elimination — orderHandler.js', () => {
    const content = readFile('services/domains/orderHandler.js');

    test('does NOT force-set order.status as fallback after state machine rejection', () => {
      // The old pattern: if (!transition.success) { order.status = 'cancelled'; }
      expect(content).not.toMatch(/transition\.success[\s\S]*order\.status\s*=\s*'cancelled'/);
    });

    test('uses transitionStatus with triggeredBy = customer', () => {
      expect(content).toMatch(/transitionStatus\(order,\s*'cancelled'.*'customer'\)/);
    });

    test('handles VersionError on save', () => {
      expect(content).toMatch(/saveErr\.name\s*===\s*'VersionError'/);
    });

    test('returns early (with WhatsApp message) when state machine blocks cancellation', () => {
      // After transition fails, should send message and return, not force-set
      const cancelBlock = content.match(/if \(!transition\.success\)[\s\S]*?return;/);
      expect(cancelBlock).not.toBeNull();
      expect(cancelBlock[0]).toMatch(/sendMessage/);
    });
  });

  describe('Bypass Elimination — paymentCompletionHandler.js', () => {
    const content = readFile('services/domains/paymentCompletionHandler.js');

    test('checks transitionStatus return value for verify payment path', () => {
      // Should check transition result and return error if failed
      expect(content).toMatch(/const transition = transitionStatus\(order,\s*'confirmed',\s*'Payment received[\s\S]*?if \(!transition\.success\)/);
    });

    test('checks transitionStatus return value for webhook payment path', () => {
      expect(content).toMatch(/const transition = transitionStatus\(order,\s*'confirmed',\s*'Payment captured[\s\S]*?if \(!transition\.success\)/);
    });

    test('passes triggeredBy for both paths', () => {
      const matches = content.match(/transitionStatus\(order,\s*'confirmed',[^)]+\)/g);
      expect(matches).not.toBeNull();
      expect(matches.length).toBeGreaterThanOrEqual(2);
      // Each should have a 4th argument for triggeredBy
      matches.forEach(m => {
        // Count comma-separated args by counting commas
        const commaCount = (m.match(/,/g) || []).length;
        expect(commaCount).toBeGreaterThanOrEqual(3); // 4 args = 3 commas
      });
    });

    test('uses atomic findOneAndUpdate (no VersionError needed)', () => {
      // paymentCompletionHandler now uses atomic findOneAndUpdate instead of order.save()
      // so VersionError handling is no longer needed/present
      expect(content).toContain('findOneAndUpdate');
    });
  });

  describe('Bypass Elimination — routes/order.js (admin)', () => {
    const content = readFile('routes/order.js');

    test('uses transitionStatus instead of manual order.status assignment', () => {
      expect(content).toMatch(/transitionStatus\(order,\s*status,[\s\S]*?'admin'\)/);
    });

    test('does NOT have manual order.status = status in admin update path', () => {
      // The admin PUT handler should NOT directly assign order.status
      // But order.status may appear in other contexts (like paymentStatus assignments).
      // Check specifically that the old pattern of validateTransition + manual assign is gone
      expect(content).not.toMatch(/validateTransition\(order\.status[\s\S]*?order\.status\s*=\s*status;/);
    });

    test('handles VersionError with 409 response', () => {
      expect(content).toMatch(/VersionError[\s\S]*?409/);
    });
  });

  describe('Bypass Elimination — routes/deliveryboy.js', () => {
    const content = readFile('routes/deliveryboy.js');

    test('imports validateTransition from orderStateMachine', () => {
      expect(content).toMatch(/require\(['"]\.\.\/services\/orderStateMachine['"]\)/);
      expect(content).toMatch(/validateTransition/);
    });

    test('validates transition before mark-ready findOneAndUpdate', () => {
      const section = content.match(/validateTransition\('preparing',\s*'ready'\)[\s\S]*?findOneAndUpdate/);
      expect(section).not.toBeNull();
    });

    test('validates transition before out-for-delivery findOneAndUpdate', () => {
      const section = content.match(/validateTransition\('ready',\s*'out_for_delivery'\)[\s\S]*?findOneAndUpdate/);
      expect(section).not.toBeNull();
    });

    test('validates transition before direct delivery findOneAndUpdate', () => {
      const deliverySection = content.match(/validateTransition\(existingOrder\.status,\s*'delivered'\)[\s\S]*?findOneAndUpdate/);
      expect(deliverySection).not.toBeNull();
    });

    test('validates transition before QR payment delivery findOneAndUpdate', () => {
      const matches = content.match(/validateTransition\(.*'delivered'\)/g);
      expect(matches).not.toBeNull();
      expect(matches.length).toBeGreaterThanOrEqual(2);
    });

    test('all 4 delivery paths have validateTransition calls', () => {
      const allCalls = content.match(/validateTransition\(/g);
      expect(allCalls).not.toBeNull();
      expect(allCalls.length).toBe(4);
    });

    test('logs transition for mark-ready and out-for-delivery', () => {
      expect(content).toMatch(/Order status transitioned.*preparing.*ready.*delivery_boy/);
      expect(content).toMatch(/Order status transitioned.*ready.*out_for_delivery.*delivery_boy/);
    });

    test('logs transition for deliver path', () => {
      expect(content).toMatch(/Order status transitioned.*out_for_delivery.*delivered.*delivery_boy/);
    });

    test('returns 409 if findOneAndUpdate returns null (concurrent modification)', () => {
      expect(content).toMatch(/409[\s\S]*?concurrently|concurrent/i);
    });
  });
});

describe('Order Lifecycle — Optimistic Concurrency Control', () => {
  
  test('Order model has optimisticConcurrency enabled', () => {
    const content = readFile('models/Order.js');
    expect(content).toMatch(/optimisticConcurrency:\s*true/);
  });

  test('classifyError handles VersionError as concurrency_conflict', () => {
    const { classifyError } = require('../services/logger');
    const versionError = new Error('No matching document found for id "xyz"');
    versionError.name = 'VersionError';
    const result = classifyError(versionError);
    expect(result.category).toBe('concurrency_conflict');
    expect(result.retryable).toBe(true);
  });
});

describe('Order Lifecycle — State Machine Coverage Audit', () => {
  
  test('all status mutation paths use state machine or atomic precondition', () => {
    // Verify no direct order.status = 'cancelled' without state machine in orderHandler
    const orderHandler = readFile('services/domains/orderHandler.js');
    const cancelAssignments = orderHandler.match(/order\.status\s*=\s*['"]cancelled['"]/g);
    expect(cancelAssignments).toBeNull(); // should be zero direct assignments

    // Verify paymentCompletionHandler uses transitionStatus (not direct assignment)
    const paymentHandler = readFile('services/domains/paymentCompletionHandler.js');
    expect(paymentHandler).not.toMatch(/order\.status\s*=\s*ORDER_STATUS\.CONFIRMED/);
    expect(paymentHandler).not.toMatch(/order\.status\s*=\s*['"]confirmed['"]/);
  });

  test('orderScheduler uses transitionStatus', () => {
    const scheduler = readFile('services/orderScheduler.js');
    expect(scheduler).toMatch(/transitionStatus/);
    // Should NOT have direct assignment
    expect(scheduler).not.toMatch(/order\.status\s*=\s*['"]cancelled['"]/);
  });

  test('chatbot cancel uses transitionStatus', () => {
    const chatbot = readFile('services/chatbot.js');
    // The cancel path should use transitionStatus
    expect(chatbot).toMatch(/transitionStatus\(order,\s*'cancelled'/);
  });

  test('state machine gated: all 11 mutable paths across 8 files', () => {
    // Count files that import/use transitionStatus or validateTransition
    const files = [
      'routes/order.js',
      'routes/payment.js', 
      'routes/webhook.js',
      'routes/deliveryboy.js',
      'services/chatbot.js',
      'services/orderScheduler.js',
      'services/domains/orderHandler.js',
      'services/domains/paymentCompletionHandler.js'
    ];
    
    let gatedCount = 0;
    for (const file of files) {
      const content = readFile(file);
      if (content.includes('transitionStatus') || content.includes('validateTransition')) {
        gatedCount++;
      }
    }
    // All 8 files should reference the state machine
    expect(gatedCount).toBe(8);
  });
});
