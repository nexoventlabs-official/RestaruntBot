const express = require('express');
const crypto = require('crypto');
const Order = require('../models/Order');
const Customer = require('../models/Customer');
const PaymentEvent = require('../models/PaymentEvent');
const whatsapp = require('../services/whatsapp');
const brevoMail = require('../services/brevoMail');
const razorpayService = require('../services/razorpay');
const googleSheets = require('../services/googleSheets');
const chatbotImagesService = require('../services/chatbotImages');
const authMiddleware = require('../middleware/auth');
const { publicRateLimiter, webhookRateLimiter } = require('../middleware/rateLimiter');
const { transitionStatus } = require('../services/orderStateMachine');
const logger = require('../services/logger');
const router = express.Router();

// Create Razorpay order for UPI intent payment (no auth required - public endpoint)
router.post('/create-upi-order', publicRateLimiter, async (req, res) => {
  try {
    const { orderId, amount } = req.body;
    
    if (!orderId || !amount) {
      return res.status(400).json({ error: 'Order ID and amount are required' });
    }

    // Verify order exists and is pending payment
    const order = await Order.findOne({ orderId });
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    
    if (order.paymentStatus === 'paid') {
      return res.status(400).json({ error: 'Order already paid' });
    }

    // Validate amount matches order total (prevent underpayment attack)
    const expectedAmountPaise = Math.round(order.totalAmount * 100);
    const requestedAmountPaise = Math.round(amount * 100);
    if (requestedAmountPaise !== expectedAmountPaise) {
      logger.warn('Payment amount mismatch', { orderId, requested: amount, expected: order.totalAmount });
      return res.status(400).json({ error: `Amount mismatch. Expected ₹${order.totalAmount}` });
    }

    // Create Razorpay order
    const razorpayOrder = await razorpayService.createOrder(order.totalAmount, orderId);
    
    // Update order with Razorpay order ID
    order.razorpayOrderId = razorpayOrder.id;
    await order.save();

    res.json({
      razorpayOrderId: razorpayOrder.id,
      amount: razorpayOrder.amount,
      currency: razorpayOrder.currency,
      keyId: process.env.RAZORPAY_KEY_ID,
      merchantName: process.env.MERCHANT_NAME || 'Restaurant'
    });
  } catch (error) {
    logger.error('Create UPI order error', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// Verify UPI payment (no auth required - public endpoint)
router.post('/verify-upi', publicRateLimiter, async (req, res) => {
  try {
    const { orderId, razorpay_payment_id, razorpay_order_id, razorpay_signature } = req.body;

    // Verify signature
    const body = razorpay_order_id + '|' + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest('hex');

    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({ error: 'Invalid payment signature' });
    }

    // Find and update order
    const order = await Order.findOne({ orderId });
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Idempotency guard: skip if already paid
    if (order.paymentStatus === 'paid') {
      logger.info('verify-upi: Order already paid, skipping', { orderId });
      return res.json({ success: true, message: 'Payment already verified' });
    }

    // Amount verification: fetch payment from Razorpay and compare
    try {
      const rzpPayment = await razorpayService.getPaymentDetails(razorpay_payment_id);
      const paidAmountPaise = rzpPayment.amount;
      const expectedAmountPaise = Math.round(order.totalAmount * 100);
      if (paidAmountPaise !== expectedAmountPaise) {
        logger.warn('Payment amount mismatch in verify-upi', { orderId, paid: paidAmountPaise / 100, expected: order.totalAmount });
        return res.status(400).json({ error: `Payment amount mismatch. Paid ₹${paidAmountPaise / 100}, expected ₹${order.totalAmount}` });
      }
    } catch (rzpErr) {
      logger.warn('Could not verify payment amount from Razorpay', { error: rzpErr.message });
      // Continue but log warning — signature is already verified
    }

    order.paymentStatus = 'paid';
    order.paymentId = razorpay_payment_id;
    order.razorpayPaymentId = razorpay_payment_id;
    const txResult = transitionStatus(order, 'confirmed', 'Payment received via UPI');
    if (!txResult.success) {
      logger.warn('verify-upi: Status transition blocked', { orderId, reason: txResult.reason });
      return res.status(409).json({ error: txResult.reason });
    }
    await order.save();

    // Emit event for real-time updates
    const dataEvents = require('../services/eventEmitter');
    dataEvents.emit('orders');
    dataEvents.emit('dashboard');

    // Update Google Sheets
    googleSheets.updateOrderStatus(order.orderId, 'confirmed', 'paid').catch(err =>
      logger.error('Google Sheets sync error', { error: err.message })
    );

    // Build detailed order confirmation message
    let itemsList = order.items.map(item => 
      `• ${item.name} x${item.quantity} - ₹${item.price * item.quantity}`
    ).join('\n');

    let confirmMsg = `✅ *Payment Successful!*\n\n`;
    confirmMsg += `📦 *Order ID:* ${order.orderId}\n`;
    confirmMsg += `💳 *Payment:* UPI\n`;
    confirmMsg += `💰 *Amount Paid:* ₹${order.totalAmount}\n`;
    confirmMsg += `🍽️ *Service:* ${order.serviceType.replace('_', ' ')}\n\n`;
    confirmMsg += `━━━━━━━━━━━━━━━\n`;
    confirmMsg += `*Your Items:*\n${itemsList}\n`;
    confirmMsg += `━━━━━━━━━━━━━━━\n\n`;
    
    if (order.deliveryAddress?.address) {
      confirmMsg += `📍 *Delivery Address:*\n${order.deliveryAddress.address}\n\n`;
    }
    
    confirmMsg += `🙏 Thank you for your order!\nWe're preparing it now.`;

    // Send WhatsApp confirmation
    const confirmedImageUrl = await chatbotImagesService.getImageUrl('payment_success');
    
    try {
      if (confirmedImageUrl) {
        await whatsapp.sendImageWithButtons(order.customer.phone, confirmedImageUrl, confirmMsg, [
          { id: 'track_order', text: 'Track Order' },
          { id: 'view_menu', text: 'Add More Items' },
          { id: 'help', text: 'Help' }
        ]);
      } else {
        await whatsapp.sendButtons(order.customer.phone, confirmMsg, [
          { id: 'track_order', text: 'Track Order' },
          { id: 'view_menu', text: 'Add More Items' },
          { id: 'help', text: 'Help' }
        ]);
      }
    } catch (whatsappErr) {
      logger.error('WhatsApp notification failed', { error: whatsappErr.message });
    }

    // Send email if available
    if (order.customer.email) {
      try {
        await brevoMail.sendOrderConfirmation(order.customer.email, order);
      } catch (emailErr) {
        logger.error('Email error', { error: emailErr.message });
      }
    }

    // Update customer stats
    const customer = await Customer.findOne({ phone: order.customer.phone });
    if (customer) {
      customer.totalOrders = (customer.totalOrders || 0) + 1;
      customer.totalSpent = (customer.totalSpent || 0) + order.totalAmount;
      await customer.save();
    }

    // Send push notification to admin for UPI payment confirmed
    try {
      const User = require('../models/User');
      const pushNotification = require('../services/pushNotification');
      
      const admins = await User.find({ pushToken: { $ne: null } });
      for (const admin of admins) {
        if (admin.pushToken) {
          await pushNotification.sendNotification(
            admin.pushToken,
            '💳 Payment Confirmed!',
            `Order #${order.orderId} - ₹${order.totalAmount}\n${order.customer.name || 'Customer'} paid via UPI`,
            { type: 'payment_confirmed', orderId: order.orderId, screen: 'Orders' },
            'order-updates'
          );
        }
      }
      if (admins.length > 0) logger.info(`Admin push sent for UPI payment ${order.orderId}`);
    } catch (pushErr) {
      logger.error('Admin push error', { error: pushErr.message });
    }

    logger.info(`UPI Payment verified for order ${order.orderId}`);
    res.json({ success: true, message: 'Payment verified successfully' });
  } catch (error) {
    logger.error('Verify UPI payment error', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// Razorpay Webhook - receives payment and refund events
router.post('/razorpay-webhook', webhookRateLimiter, express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    
    // Signature verification is MANDATORY
    if (!webhookSecret) {
      logger.error('RAZORPAY_WEBHOOK_SECRET not configured — rejecting webhook');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    const signature = req.headers['x-razorpay-signature'];
    if (!signature) {
      return res.status(401).json({ error: 'Missing signature header' });
    }

    const body = req.body.toString();
    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(body)
      .digest('hex');

    // Use timing-safe comparison to prevent timing attacks
    const sigBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expectedSignature);
    if (sigBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
      logger.warn('Razorpay webhook signature mismatch');
      return res.status(401).json({ error: 'Invalid signature' });
    }
    
    const event = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    logger.info('Razorpay webhook event', { event: event.event });

    // Payment event idempotency: reject duplicate event IDs
    const razorpayEventId = event.event_id || event.id;
    if (razorpayEventId) {
      try {
        await PaymentEvent.create({ eventId: razorpayEventId, eventType: event.event });
      } catch (dedupErr) {
        if (dedupErr.code === 11000) {
          logger.info('Duplicate Razorpay webhook event skipped', { eventId: razorpayEventId });
          return res.json({ status: 'ok', duplicate: true });
        }
        logger.warn('PaymentEvent save warning', { error: dedupErr.message });
      }
    }
    
    const payload = event.payload;
    
    // Handle refund events
    if (event.event === 'refund.processed' || event.event === 'refund.created') {
      const refund = payload.refund?.entity;
      const paymentId = refund?.payment_id;
      
      if (!paymentId) {
        logger.warn('No payment ID in refund webhook');
        return res.json({ status: 'ok' });
      }
      
      logger.info('Refund webhook received', { refundId: refund.id, paymentId, amount: refund.amount / 100, status: refund.status });
      
      // Find order by payment ID
      const order = await Order.findOne({ 
        $or: [
          { razorpayPaymentId: paymentId },
          { paymentId: paymentId }
        ]
      });
      
      if (!order) {
        logger.warn('Order not found for payment', { paymentId });
        return res.json({ status: 'ok' });
      }
      
      // Update order with refund details
      if (refund.status === 'processed') {
        order.refundStatus = 'completed';
        order.refundId = refund.id;
        order.refundProcessedAt = new Date();
        order.paymentStatus = 'refunded';
        transitionStatus(order, 'refunded', `Refund of ₹${refund.amount / 100} processed. Refund ID: ${refund.id}`);
        await order.save();
        
        logger.info('Order updated with refund', { orderId: order.orderId });
        
        // Emit event for real-time updates
        const dataEvents = require('../services/eventEmitter');
        dataEvents.emit('orders');
        dataEvents.emit('dashboard');
        
        // Update Google Sheets - move to refunded sheet
        googleSheets.updateOrderStatus(order.orderId, 'refunded', 'refunded').catch(err =>
          logger.error('Google Sheets sync error', { error: err.message })
        );
        
        // Notify customer
        try {
          await whatsapp.sendButtons(order.customer.phone,
            `✅ *Refund Successful!*\n\nOrder: ${order.orderId}\nAmount: ₹${refund.amount / 100}\nRefund ID: ${refund.id}\n\n💳 The amount will be credited to your account within 5-7 business days.`,
            [
              { id: 'place_order', text: 'New Order' },
              { id: 'home', text: 'Main Menu' }
            ]
          );
        } catch (whatsappErr) {
          logger.error('WhatsApp notification failed', { error: whatsappErr.message });
        }
      }
      
      return res.json({ status: 'ok' });
    }
    
    // Handle refund failed event
    if (event.event === 'refund.failed') {
      const refund = payload.refund?.entity;
      const paymentId = refund?.payment_id;
      
      if (!paymentId) {
        return res.json({ status: 'ok' });
      }
      
      logger.info('Refund failed webhook', { refundId: refund.id, paymentId, reason: refund.failure_reason });
      
      const order = await Order.findOne({ 
        $or: [
          { razorpayPaymentId: paymentId },
          { paymentId: paymentId }
        ]
      });
      
      if (!order) {
        return res.json({ status: 'ok' });
      }
      
      order.refundStatus = 'failed';
      order.refundError = refund.failure_reason || 'Refund failed';
      order.paymentStatus = 'refund_failed';
      transitionStatus(order, 'cancelled', `Refund failed: ${refund.failure_reason || 'Unknown error'}`);
      await order.save();
      
      // Emit event for real-time updates
      const dataEvents = require('../services/eventEmitter');
      dataEvents.emit('orders');
      dataEvents.emit('dashboard');
      
      // Update Google Sheets - move to refundfailed sheet
      googleSheets.updateOrderStatus(order.orderId, 'refund_failed', 'refund_failed').catch(err =>
        logger.error('Google Sheets sync error', { error: err.message })
      );
      
      // Notify customer
      try {
        await whatsapp.sendButtons(order.customer.phone,
          `⚠️ *Refund Issue*\n\nOrder: ${order.orderId}\nAmount: ₹${order.totalAmount}\n\nWe couldn't process your refund automatically.\nOur team will contact you within 24 hours to resolve this.`,
          [
            { id: 'place_order', text: 'New Order' },
            { id: 'home', text: 'Main Menu' }
          ]
        );
      } catch (whatsappErr) {
        logger.error('WhatsApp notification failed', { error: whatsappErr.message });
      }
      
      return res.json({ status: 'ok' });
    }
    
    // Handle payment captured event (backup for callback)
    if (event.event === 'payment.captured') {
      const payment = payload.payment?.entity;
      const paymentLinkId = payment?.notes?.payment_link_id || payment?.payment_link_id;
      
      if (paymentLinkId) {
        const order = await Order.findOne({ razorpayOrderId: paymentLinkId });
        if (order && order.paymentStatus !== 'paid') {
          order.paymentStatus = 'paid';
          order.razorpayPaymentId = payment.id;
          transitionStatus(order, 'confirmed', 'Payment received via webhook');
          await order.save();
          
          logger.info('Payment captured via webhook', { orderId: order.orderId });
          
          // Emit event for real-time updates
          const dataEvents = require('../services/eventEmitter');
          dataEvents.emit('orders');
          dataEvents.emit('dashboard');
          
          // Update Google Sheets
          googleSheets.updateOrderStatus(order.orderId, 'confirmed', 'paid').catch(err =>
            logger.error('Google Sheets sync error', { error: err.message })
          );
          
          // Send push notification to admin for webhook payment
          try {
            const User = require('../models/User');
            const pushNotification = require('../services/pushNotification');
            
            const admins = await User.find({ pushToken: { $ne: null } });
            for (const admin of admins) {
              if (admin.pushToken) {
                await pushNotification.sendNotification(
                  admin.pushToken,
                  '💳 Payment Confirmed!',
                  `Order #${order.orderId} - ₹${order.totalAmount} paid via UPI`,
                  { type: 'payment_confirmed', orderId: order.orderId, screen: 'Orders' },
                  'order-updates'
                );
              }
            }
          } catch (pushErr) {
            logger.error('Admin push error (webhook)', { error: pushErr.message });
          }
        }
      }
      
      return res.json({ status: 'ok' });
    }
    
    res.json({ status: 'ok' });
  } catch (error) {
    logger.error('Razorpay webhook error', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

router.get('/callback', publicRateLimiter, async (req, res) => {
  try {
    const { razorpay_payment_id, razorpay_payment_link_id, razorpay_payment_link_status, razorpay_signature } = req.query;

    // Signature verification for payment link callbacks
    if (razorpay_payment_link_id && razorpay_payment_id) {
      const secret = process.env.RAZORPAY_KEY_SECRET;
      if (secret) {
        const body = razorpay_payment_link_id + '|' + razorpay_payment_link_id + '|' + razorpay_payment_id + '|' + razorpay_payment_link_status;
        const expectedSig = crypto.createHmac('sha256', secret).update(body).digest('hex');
        if (razorpay_signature) {
          const sigBuf = Buffer.from(razorpay_signature);
          const expBuf = Buffer.from(expectedSig);
          if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
            logger.warn('Payment callback signature mismatch');
            return res.status(400).send('<html><body><h1>Invalid Signature</h1></body></html>');
          }
        } else {
          logger.warn('Payment callback missing signature — proceeding with caution');
        }
      }
    }
    
    if (razorpay_payment_link_status === 'paid') {
      const order = await Order.findOne({ razorpayOrderId: razorpay_payment_link_id });
      if (order && order.paymentStatus !== 'paid') {
        order.paymentId = razorpay_payment_id;
        order.razorpayPaymentId = razorpay_payment_id; // Store for refunds
        transitionStatus(order, 'confirmed', 'Payment received, order confirmed');
        order.paymentStatus = 'paid';
        await order.save();

        // Emit event for real-time updates
        const dataEvents = require('../services/eventEmitter');
        dataEvents.emit('orders');
        dataEvents.emit('dashboard');

        // Update Google Sheets
        googleSheets.updateOrderStatus(order.orderId, 'confirmed', 'paid').catch(err =>
          logger.error('Google Sheets sync error', { error: err.message })
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

        // Send WhatsApp confirmation with image and buttons
        const confirmedImageUrl = await chatbotImagesService.getImageUrl('payment_success');
        
        if (confirmedImageUrl) {
          await whatsapp.sendImageWithButtons(order.customer.phone, confirmedImageUrl, confirmMsg, [
            { id: 'track_order', text: 'Track Order' },
            { id: 'view_menu', text: 'Add More Items' },
            { id: 'help', text: 'Help' }
          ]);
        } else {
          await whatsapp.sendButtons(order.customer.phone, confirmMsg, [
            { id: 'track_order', text: 'Track Order' },
            { id: 'view_menu', text: 'Add More Items' },
            { id: 'help', text: 'Help' }
          ]);
        }

        // Send email if available
        if (order.customer.email) {
          try {
            await brevoMail.sendOrderConfirmation(order.customer.email, order);
          } catch (emailErr) {
            logger.error('Email error', { error: emailErr.message });
          }
        }

        // Update customer stats
        const customer = await Customer.findOne({ phone: order.customer.phone });
        if (customer) {
          customer.totalOrders = (customer.totalOrders || 0) + 1;
          customer.totalSpent = (customer.totalSpent || 0) + order.totalAmount;
          await customer.save();
        }
        
        // Send push notification to admin for callback payment
        try {
          const User = require('../models/User');
          const pushNotification = require('../services/pushNotification');
          
          const admins = await User.find({ pushToken: { $ne: null } });
          for (const admin of admins) {
            if (admin.pushToken) {
              await pushNotification.sendNotification(
                admin.pushToken,
                '💳 Payment Confirmed!',
                `Order #${order.orderId} - ₹${order.totalAmount} paid via UPI`,
                { type: 'payment_confirmed', orderId: order.orderId, screen: 'Orders' },
                'order-updates'
              );
            }
          }
        } catch (pushErr) {
          logger.error('Admin push error (callback)', { error: pushErr.message });
        }

        logger.info(`Payment confirmed for order ${order.orderId}`);
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
    logger.error('Payment callback error', { error: error.message });
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
      
      order.refundStatus = 'completed';
      order.refundId = refund.id;
      order.refundAmount = order.totalAmount;
      order.refundRequestedAt = new Date();
      order.refundProcessedAt = new Date();
      order.paymentStatus = 'refunded';
      transitionStatus(order, 'refunded', `Refund of ₹${order.totalAmount} processed. Refund ID: ${refund.id}`);
      await order.save();

      // Emit event for real-time updates
      const dataEvents = require('../services/eventEmitter');
      dataEvents.emit('orders');
      dataEvents.emit('dashboard');

      // Update Google Sheets - move to refunded sheet
      googleSheets.updateOrderStatus(order.orderId, 'refunded', 'refunded').catch(err =>
        logger.error('Google Sheets sync error', { error: err.message })
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
      logger.error('Refund failed', { error: refundError.message });
      
      order.refundStatus = 'failed';
      order.refundAmount = order.totalAmount;
      order.refundRequestedAt = new Date();
      order.refundError = refundError.message;
      order.paymentStatus = 'refund_failed';
      transitionStatus(order, 'cancelled', `Refund failed: ${refundError.message}`);
      await order.save();

      // Emit event for real-time updates
      const dataEvents = require('../services/eventEmitter');
      dataEvents.emit('orders');
      dataEvents.emit('dashboard');

      // Update Google Sheets - move to refundfailed sheet
      googleSheets.updateOrderStatus(order.orderId, 'refund_failed', 'refund_failed').catch(err =>
        logger.error('Google Sheets sync error', { error: err.message })
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
      
      order.refundStatus = 'completed';
      order.refundId = refund.id;
      order.refundAmount = order.totalAmount;
      order.refundProcessedAt = new Date();
      order.paymentStatus = 'refunded';
      transitionStatus(order, 'refunded', `Refund of ₹${order.totalAmount} processed. Refund ID: ${refund.id}`);
      await order.save();

      // Emit event for real-time updates
      const dataEvents = require('../services/eventEmitter');
      dataEvents.emit('orders');
      dataEvents.emit('dashboard');

      // Update Google Sheets - move to refunded sheet
      googleSheets.updateOrderStatus(order.orderId, 'refunded', 'refunded').catch(err =>
        logger.error('Google Sheets sync error', { error: err.message })
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
      logger.error('Refund processing failed', { error: refundError.message });
      
      order.refundStatus = 'failed';
      order.refundError = refundError.message;
      order.paymentStatus = 'refund_failed';
      transitionStatus(order, 'cancelled', `Refund failed: ${refundError.message}`);
      await order.save();

      // Emit event for real-time updates
      const dataEvents = require('../services/eventEmitter');
      dataEvents.emit('orders');
      dataEvents.emit('dashboard');

      // Update Google Sheets - move to refundfailed sheet
      googleSheets.updateOrderStatus(order.orderId, 'refund_failed', 'refund_failed').catch(err =>
        logger.error('Google Sheets sync error', { error: err.message })
      );

      res.status(500).json({ success: false, error: refundError.message });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
