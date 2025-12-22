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
    if (!order.paymentId) return res.status(400).json({ error: 'No payment found' });

    const refund = await razorpayService.refund(order.paymentId, order.totalAmount);
    order.status = 'refunded';
    order.paymentStatus = 'refunded';
    order.refundId = refund.id;
    order.refundAmount = order.totalAmount;
    order.trackingUpdates.push({ status: 'refunded', message: 'Refund processed by admin' });
    await order.save();

    // Emit event for real-time updates
    const dataEvents = require('../services/eventEmitter');
    dataEvents.emit('orders');
    dataEvents.emit('dashboard');

    // Update Google Sheets
    googleSheets.updateOrderStatus(order.orderId, 'refunded', 'refunded').catch(err =>
      console.error('Google Sheets sync error:', err)
    );

    await whatsapp.sendButtons(order.customer.phone,
      `💰 *Refund Processed*\n\nOrder: ${order.orderId}\nAmount: ₹${order.totalAmount}\n\nWill be credited in 10-20 minutes.`,
      [
        { id: 'place_order', text: 'New Order' },
        { id: 'help', text: 'Help' }
      ]
    );

    res.json({ success: true, refund });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
