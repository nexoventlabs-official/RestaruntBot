const express = require('express');
const crypto = require('crypto');
const Order = require('../models/Order');
const Customer = require('../models/Customer');
const whatsapp = require('../services/whatsapp');
const brevoMail = require('../services/brevoMail');
const razorpayService = require('../services/razorpay');
const googleSheets = require('../services/googleSheets');
const authMiddleware = require('../middleware/auth');
const router = express.Router();

router.get('/callback', async (req, res) => {
  try {
    const { razorpay_payment_id, razorpay_payment_link_id, razorpay_payment_link_status } = req.query;
    
    if (razorpay_payment_link_status === 'paid') {
      const order = await Order.findOne({ razorpayOrderId: razorpay_payment_link_id });
      if (order) {
        order.paymentStatus = 'paid';
        order.paymentId = razorpay_payment_id;
        order.razorpayPaymentId = razorpay_payment_id; // Store for refunds
        order.status = 'confirmed';
        order.trackingUpdates.push({ status: 'confirmed', message: 'Payment received, order confirmed' });
        await order.save();

        // Emit event for real-time updates
        const dataEvents = require('../services/eventEmitter');
        dataEvents.emit('orders');
        dataEvents.emit('dashboard');

        // Update Google Sheets
        googleSheets.updateOrderStatus(order.orderId, 'confirmed', 'paid').catch(err =>
          console.error('Google Sheets sync error:', err)
        );

        // Build detailed order confirmation message
        let itemsList = order.items.map(item => 
          `• ${item.name} x${item.quantity} - ₹${item.price * item.quantity}`
        ).join('\n');

        let confirmMsg = `✅ *Payment Successful!*\n\n`;
        confirmMsg += `📦 *Order ID:* ${order.orderId}\n`;
        confirmMsg += `💳 *Payment:* UPI/Online\n`;
        confirmMsg += `💰 *Amount Paid:* ₹${order.totalAmount}\n`;
        confirmMsg += `🍽️ *Service:* ${order.serviceType.replace('_', ' ')}\n\n`;
        confirmMsg += `━━━━━━━━━━━━━━━\n`;
        confirmMsg += `*Your Items:*\n${itemsList}\n`;
        confirmMsg += `━━━━━━━━━━━━━━━\n\n`;
        
        if (order.deliveryAddress?.address) {
          confirmMsg += `📍 *Delivery Address:*\n${order.deliveryAddress.address}\n\n`;
        }
        
        confirmMsg += `🙏 Thank you for your order!\nWe're preparing it now.`;

        // Send WhatsApp confirmation with buttons
        await whatsapp.sendButtons(order.customer.phone, confirmMsg, [
          { id: 'track_order', text: 'Track Order' },
          { id: `cancel_${order.orderId}`, text: 'Cancel Order' },
          { id: 'help', text: 'Help' }
        ]);

        // Send email if available
        if (order.customer.email) {
          try {
            await brevoMail.sendOrderConfirmation(order.customer.email, order);
          } catch (emailErr) {
            console.error('Email error:', emailErr.message);
          }
        }

        // Update customer stats
        const customer = await Customer.findOne({ phone: order.customer.phone });
        if (customer) {
          customer.totalOrders = (customer.totalOrders || 0) + 1;
          customer.totalSpent = (customer.totalSpent || 0) + order.totalAmount;
          await customer.save();
        }
        
        console.log(`✅ Payment confirmed for order ${order.orderId}`);
      }
    }
    
    res.send(`
      <html>
        <head>
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>
            body { font-family: Arial, sans-serif; text-align: center; padding: 50px; background: #f0f9f0; }
            .success { color: #22c55e; font-size: 48px; }
            h1 { color: #166534; }
            p { color: #666; }
          </style>
        </head>
        <body>
          <div class="success">✅</div>
          <h1>Payment Successful!</h1>
          <p>Your order has been confirmed.</p>
          <p>Check WhatsApp for order details.</p>
          <p style="margin-top: 30px; color: #999;">You can close this window.</p>
        </body>
      </html>
    `);
  } catch (error) {
    console.error('Payment callback error:', error);
    res.send('<html><body><h1>Payment Error</h1><p>Please contact support.</p></body></html>');
  }
});

router.post('/refund/:orderId', authMiddleware, async (req, res) => {
  try {
    const order = await Order.findOne({ orderId: req.params.orderId });
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (!order.razorpayPaymentId && !order.paymentId) return res.status(400).json({ error: 'No payment found' });

    const paymentId = order.razorpayPaymentId || order.paymentId;
    
    // Process refund immediately via Razorpay
    try {
      const refund = await razorpayService.refund(paymentId, order.totalAmount);
      
      order.status = 'refunded';
      order.refundStatus = 'completed';
      order.refundId = refund.id;
      order.refundAmount = order.totalAmount;
      order.refundRequestedAt = new Date();
      order.refundProcessedAt = new Date();
      order.paymentStatus = 'refunded';
      order.statusUpdatedAt = new Date();
      order.trackingUpdates.push({ status: 'refunded', message: `Refund of ₹${order.totalAmount} processed. Refund ID: ${refund.id}`, timestamp: new Date() });
      await order.save();

      // Emit event for real-time updates
      const dataEvents = require('../services/eventEmitter');
      dataEvents.emit('orders');
      dataEvents.emit('dashboard');

      // Update Google Sheets - move to refunded sheet
      googleSheets.updateOrderStatus(order.orderId, 'refunded', 'refunded').catch(err =>
        console.error('Google Sheets sync error:', err)
      );

      await whatsapp.sendButtons(order.customer.phone,
        `✅ *Refund Successful!*\n\nOrder: ${order.orderId}\nAmount: ₹${order.totalAmount}\nRefund ID: ${refund.id}\n\n💳 The amount will be credited to your account within 5-7 business days.`,
        [
          { id: 'place_order', text: 'New Order' },
          { id: 'home', text: 'Main Menu' }
        ]
      );

      res.json({ success: true, message: 'Refund processed', refundId: refund.id, orderId: order.orderId });
    } catch (refundError) {
      console.error('Refund failed:', refundError.message);
      
      order.status = 'cancelled';
      order.refundStatus = 'failed';
      order.refundAmount = order.totalAmount;
      order.refundRequestedAt = new Date();
      order.refundError = refundError.message;
      order.paymentStatus = 'refund_failed';
      order.statusUpdatedAt = new Date();
      order.trackingUpdates.push({ status: 'refund_failed', message: `Refund failed: ${refundError.message}`, timestamp: new Date() });
      await order.save();

      // Emit event for real-time updates
      const dataEvents = require('../services/eventEmitter');
      dataEvents.emit('orders');
      dataEvents.emit('dashboard');

      // Update Google Sheets - move to refundfailed sheet
      googleSheets.updateOrderStatus(order.orderId, 'refund_failed', 'refund_failed').catch(err =>
        console.error('Google Sheets sync error:', err)
      );

      await whatsapp.sendButtons(order.customer.phone,
        `⚠️ *Refund Issue*\n\nOrder: ${order.orderId}\nAmount: ₹${order.totalAmount}\n\nWe couldn't process your refund automatically.\nOur team will contact you within 24 hours to resolve this.`,
        [
          { id: 'place_order', text: 'New Order' },
          { id: 'home', text: 'Main Menu' }
        ]
      );

      res.status(500).json({ success: false, error: refundError.message, orderId: order.orderId });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Process refund for pending refund orders (admin can trigger this)
router.post('/process-refund/:orderId', authMiddleware, async (req, res) => {
  try {
    const order = await Order.findOne({ orderId: req.params.orderId });
    if (!order) return res.status(404).json({ error: 'Order not found' });
    
    if (order.refundStatus === 'completed') {
      return res.status(400).json({ error: 'Order already refunded' });
    }
    
    const paymentId = order.razorpayPaymentId || order.paymentId;
    if (!paymentId) return res.status(400).json({ error: 'No payment ID found' });

    // Process refund via Razorpay
    try {
      const refund = await razorpayService.refund(paymentId, order.totalAmount);
      
      order.status = 'refunded';
      order.refundStatus = 'completed';
      order.refundId = refund.id;
      order.refundAmount = order.totalAmount;
      order.refundProcessedAt = new Date();
      order.paymentStatus = 'refunded';
      order.statusUpdatedAt = new Date();
      order.trackingUpdates.push({ status: 'refunded', message: `Refund of ₹${order.totalAmount} processed. Refund ID: ${refund.id}`, timestamp: new Date() });
      await order.save();

      // Emit event for real-time updates
      const dataEvents = require('../services/eventEmitter');
      dataEvents.emit('orders');
      dataEvents.emit('dashboard');

      // Update Google Sheets - move to refunded sheet
      googleSheets.updateOrderStatus(order.orderId, 'refunded', 'refunded').catch(err =>
        console.error('Google Sheets sync error:', err)
      );

      await whatsapp.sendButtons(order.customer.phone,
        `✅ *Refund Successful!*\n\nOrder: ${order.orderId}\nAmount: ₹${order.totalAmount}\nRefund ID: ${refund.id}\n\n💳 The amount will be credited to your account within 5-7 business days.`,
        [
          { id: 'place_order', text: 'New Order' },
          { id: 'home', text: 'Main Menu' }
        ]
      );

      res.json({ success: true, message: 'Refund processed', refundId: refund.id });
    } catch (refundError) {
      console.error('Refund processing failed:', refundError.message);
      
      order.refundStatus = 'failed';
      order.refundError = refundError.message;
      order.paymentStatus = 'refund_failed';
      order.status = 'cancelled';
      order.statusUpdatedAt = new Date();
      order.trackingUpdates.push({ status: 'refund_failed', message: `Refund failed: ${refundError.message}`, timestamp: new Date() });
      await order.save();

      // Emit event for real-time updates
      const dataEvents = require('../services/eventEmitter');
      dataEvents.emit('orders');
      dataEvents.emit('dashboard');

      // Update Google Sheets - move to refundfailed sheet
      googleSheets.updateOrderStatus(order.orderId, 'refund_failed', 'refund_failed').catch(err =>
        console.error('Google Sheets sync error:', err)
      );

      res.status(500).json({ success: false, error: refundError.message });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
