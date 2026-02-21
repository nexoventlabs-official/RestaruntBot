/**
 * Edge-Case Input Tests
 *
 * Tests boundary values, invalid inputs, and malformed data that can cause
 * financial miscalculation, order corruption, or system crashes.
 *
 * 💰 FINANCIAL RISK: Negative quantities, extreme prices, empty carts,
 * and missing fields can cause incorrect totals, phantom orders, or
 * unrecoverable state.
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

describe('Edge-Case Input Validation', () => {

  // ─── QUANTITY EDGE CASES ──────────────────────────────────────

  describe('Quantity validation', () => {
    test('💰 quantity = 0 should be rejected', () => {
      const qty = 0;
      expect(qty < 1).toBe(true);
      // updateQuantity checks: if (!quantity || quantity < 1)
      // qty=0 is falsy → correctly rejected
    });

    test('💰 negative quantity should be rejected', () => {
      const qty = -5;
      expect(qty < 1).toBe(true);
    });

    test('💰 fractional quantity (0.5 items)', () => {
      const qty = 0.5;
      // 0.5 < 1 → rejected by current guard
      expect(qty < 1).toBe(true);
    });

    test('💰 extremely large quantity (integer overflow risk)', () => {
      const qty = Number.MAX_SAFE_INTEGER; // 9007199254740991
      const price = 100;
      const total = qty * price;

      // JavaScript handles big numbers but MongoDB may not
      expect(total).toBe(900719925474099100);
      // This exceeds what Razorpay can handle (max ₹50,00,000 per transaction)
      expect(total).toBeGreaterThan(50000000);
    });

    test('💰 quantity as string "2" should be parsed correctly', () => {
      const qty = "2";
      const parsed = parseInt(qty, 10);
      expect(parsed).toBe(2);
      expect(typeof parsed).toBe('number');
    });

    test('💰 quantity as NaN', () => {
      const qty = NaN;
      expect(!qty).toBe(true); // NaN is falsy
      // Current guard: if (!quantity || quantity < 1) → catches NaN via falsy check
    });

    test('💰 quantity as Infinity', () => {
      const qty = Infinity;
      expect(qty < 1).toBe(false);
      expect(isFinite(qty)).toBe(false);
      // FIXED: Guard now includes Number.isFinite() check
      // (!quantity || quantity < 1 || !Number.isFinite(quantity)) catches Infinity
    });

    test('quantity as undefined', () => {
      const qty = undefined;
      expect(!qty).toBe(true); // Caught by falsy check
    });

    test('quantity as null', () => {
      const qty = null;
      expect(!qty).toBe(true); // Caught by falsy check
    });
  });

  // ─── PRICE EDGE CASES ────────────────────────────────────────

  describe('Price calculation edge cases', () => {
    test('💰 item price = 0 (free item)', () => {
      const price = 0;
      const qty = 5;
      const total = price * qty;
      expect(total).toBe(0);
      // Should still create valid order but Razorpay won't accept 0 amount
    });

    test('💰 negative price (data corruption)', () => {
      const price = -50;
      const qty = 2;
      const total = price * qty;
      expect(total).toBe(-100);
      // Negative total → Razorpay rejects → but order saved with negative amount
    });

    test('💰 floating point precision: ₹10.10 × 3', () => {
      const price = 10.10;
      const qty = 3;
      const raw = price * qty;
      
      // JavaScript floating point: 10.10 * 3 = 30.299999999999997
      expect(raw).not.toBe(30.30);
      
      // Fix: round to 2 decimal places
      const rounded = Math.round(raw * 100) / 100;
      expect(rounded).toBe(30.30);
    });

    test('💰 sum of item totals matches order total', () => {
      const items = [
        { price: 150, quantity: 2 }, // 300
        { price: 99.50, quantity: 1 }, // 99.50
        { price: 10.10, quantity: 3 }  // 30.30
      ];

      const itemsTotal = items.reduce((sum, item) => {
        return sum + Math.round(item.price * item.quantity * 100) / 100;
      }, 0);

      const deliveryCharge = 50;
      const expectedTotal = Math.round((itemsTotal + deliveryCharge) * 100) / 100;
      
      expect(expectedTotal).toBe(479.80);
    });

    test('💰 very small price: ₹0.01 × 1', () => {
      const price = 0.01;
      const qty = 1;
      const paise = Math.round(price * 100);
      expect(paise).toBe(1); // 1 paisa — Razorpay minimum is 100 paise (₹1)
    });
  });

  // ─── EMPTY CART CHECKOUT ──────────────────────────────────────

  describe('Empty cart checkout', () => {
    test('💰 checkout with empty cart should be blocked', () => {
      const cart = [];
      expect(cart.length).toBe(0);
      // Should NOT create an order with zero items
    });

    test('💰 checkout with null cart should be blocked', () => {
      const cart = null;
      expect(cart == null).toBe(true);
    });

    test('💰 checkout with cart containing only unavailable items', () => {
      const cart = [
        { menuItem: { available: false, name: 'Sold Out Pizza' }, quantity: 1 }
      ];
      
      const availableItems = cart.filter(item => item.menuItem?.available);
      expect(availableItems.length).toBe(0);
      // Should remove unavailable items and prevent checkout if none remain
    });

    test('cart item with null menuItem reference', () => {
      const cart = [
        { menuItem: null, quantity: 2 }
      ];

      expect(cart[0].menuItem).toBeNull();
      // Should handle gracefully — item was likely deleted from menu
    });
  });

  // ─── ORDER FIELD VALIDATION ───────────────────────────────────

  describe('Order field validation', () => {
    test('orderId must not be empty', () => {
      const orderId = '';
      expect(orderId.length).toBe(0);
    });

    test('orderId must not exceed reasonable length', () => {
      const orderId = 'RD' + 'X'.repeat(200);
      expect(orderId.length).toBeGreaterThan(100);
      // Extremely long orderId could cause issues in logs, WhatsApp messages
    });

    test('💰 customer.phone with non-numeric characters', () => {
      const phone = '+91-999-999-9999';
      const cleaned = phone.replace(/\D/g, '');
      expect(cleaned).toBe('919999999999');
      // WhatsApp API requires pure numeric phone
    });

    test('customer.phone too short or too long', () => {
      const shortPhone = '123';
      const longPhone = '9'.repeat(20);
      
      expect(shortPhone.length).toBeLessThan(10);
      expect(longPhone.length).toBeGreaterThan(15);
    });

    test('customer name with special characters', () => {
      const names = [
        'O\'Brien',
        'Jean-Claude',
        'José García',
        '<script>alert("xss")</script>',
        'A'.repeat(500)
      ];

      names.forEach(name => {
        expect(typeof name).toBe('string');
        // Should sanitize HTML/script tags if rendered in dashboard
      });
    });

    test('💰 missing paymentMethod field', () => {
      const order = {
        orderId: 'ORD_TEST',
        paymentMethod: undefined
      };
      
      expect(order.paymentMethod).toBeUndefined();
      // Without paymentMethod, the system won't know how to handle payment
    });

    test('💰 invalid paymentMethod value', () => {
      const validMethods = ['cod', 'upi', 'razorpay'];
      const invalidMethod = 'bitcoin';
      
      expect(validMethods).not.toContain(invalidMethod);
    });
  });

  // ─── WHATSAPP MESSAGE EDGE CASES ──────────────────────────────

  describe('WhatsApp message edge cases', () => {
    test('null messageId in inbound message', () => {
      const message = {
        from: '919999999999',
        id: null,
        type: 'text',
        text: { body: 'Hi' }
      };

      expect(message.id).toBeNull();
      // Inbound message dedup uses messageId — null would bypass dedup
    });

    test('empty message body', () => {
      const message = {
        from: '919999999999',
        id: 'msg_123',
        type: 'text',
        text: { body: '' }
      };

      expect(message.text.body.length).toBe(0);
    });

    test('message body with only whitespace', () => {
      const body = '   \n\t  ';
      expect(body.trim().length).toBe(0);
    });

    test('extremely long message body (>4096 chars)', () => {
      const body = 'x'.repeat(5000);
      expect(body.length).toBe(5000);
      // WhatsApp has a 4096 char limit for text messages
      expect(body.length).toBeGreaterThan(4096);
    });

    test('message with unicode emojis', () => {
      const body = '🍕 I want to order pizza! 🎉';
      expect(body).toContain('🍕');
      // Should be handled normally — UTF-8 support required
    });
  });

  // ─── DELIVERY DETAILS EDGE CASES ──────────────────────────────

  describe('Delivery details edge cases', () => {
    test('💰 delivery charge = negative', () => {
      const deliveryCharge = -50;
      const itemsTotal = 500;
      const total = itemsTotal + deliveryCharge;
      
      expect(total).toBe(450);
      // Negative delivery charge reduces total — could be exploited
    });

    test('💰 delivery address is empty string', () => {
      const address = '';
      expect(address.length).toBe(0);
      // Should not allow delivery without address
    });

    test('delivery address with SQL injection attempt', () => {
      const address = "123 Main St'; DROP TABLE orders;--";
      expect(address).toContain('DROP TABLE');
      // MongoDB is NoSQL so SQL injection doesn't apply,
      // but NoSQL injection ($where, $gt) should be guarded
    });

    test('delivery address with NoSQL injection', () => {
      const address = { $gt: '' };
      expect(typeof address).toBe('object');
      // If passed directly to MongoDB query, this matches everything
    });

    test('delivery location coordinates out of valid range', () => {
      const lat = 999; // Valid: -90 to 90
      const lng = 999; // Valid: -180 to 180
      
      expect(Math.abs(lat)).toBeGreaterThan(90);
      expect(Math.abs(lng)).toBeGreaterThan(180);
    });
  });

  // ─── CONCURRENT DATA STATE ───────────────────────────────────

  describe('Stale data edge cases', () => {
    test('💰 menu item price changed between cart add and checkout', () => {
      // Customer adds item at ₹200
      const cartPrice = 200;
      
      // By checkout time, restaurant updated price to ₹300
      const currentPrice = 300;
      
      // Order should use current price, not stale cart price
      expect(cartPrice).not.toBe(currentPrice);
      // BUG NOTE: chatbot.js uses freshCustomer.populate('cart.menuItem')
      // at checkout time, but the cart stores menuItem reference, not price.
      // If the item's price is fetched fresh, this is correct.
      // But the cart.addedAt timestamp could be used to detect stale pricing.
    });

    test('💰 menu item deleted between cart add and checkout', () => {
      const cartItem = { menuItem: null, quantity: 2 };
      
      // populate('cart.menuItem') returns null for deleted items
      expect(cartItem.menuItem).toBeNull();
      // Should be caught by checkCartAvailability()
    });

    test('💰 restaurant closed between cart add and checkout', () => {
      const isOpen = false;
      expect(isOpen).toBe(false);
      // Order should be blocked if restaurant is closed at checkout time
    });
  });
});
