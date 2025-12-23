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
    
    // Schedule refund to process after 5 minutes
    order.status = 'cancelled';
    order.refundStatus = 'scheduled';
    order.refundAmount = order.totalAmount;
    order.refundScheduledAt = new Date();
    order.statusUpdatedAt = new Date();
    order.trackingUpdates.push({ status: 'refund_scheduled', message: 'Refund scheduled by admin', timestamp: new Date() });
    await order.save();

    // Schedule refund to process after 5 minutes
    const refundScheduler = require('../services/refundScheduler');
    refundScheduler.scheduleRefund(order.orderId, 5 * 60 * 1000); // 5 minutes

    // Emit event for real-time updates
    const dataEvents = require('../services/eventEmitter');
    dataEvents.emit('orders');
    dataEvents.emit('dashboard');

    // Update Google Sheets
    googleSheets.updateOrderStatus(order.orderId, 'cancelled', order.paymentStatus).catch(err =>
      console.error('Google Sheets sync error:', err)
    );

    await whatsapp.sendButtons(order.customer.phone,
      `💰 *Refund Scheduled*\n\nOrder: ${order.orderId}\nAmount: ₹${order.totalAmount}\n\n⏱️ Your refund will be processed in 5 minutes.\nYou'll receive a confirmation once complete.`,
      [
        { id: 'place_order', text: 'New Order' },
        { id: 'help', text: 'Help' }
      ]
    );

    res.json({ success: true, message: 'Refund scheduled', orderId: order.orderId });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
