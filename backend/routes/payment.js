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
const { logRouteError } = require('../services/logger');
const User = require('../models/User');
const pushNotification = require('../services/pushNotification');
const dataEvents = require('../services/eventEmitter');
const { isShuttingDown } = require('../services/shutdownState');
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
    return logRouteError(res, 'Create UPI order error', error);
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
      logger.warn('Could not verify payment amount from Razorpay', { error: rzpErr.message, orderId });
      // Continue but log warning — signature is already verified
    }

    // State machine transition (validates before mutation)
    const txResult = transitionStatus(order, 'confirmed', 'Payment received via UPI');
    if (!txResult.success) {
      logger.warn('verify-upi: Status transition blocked', { orderId, reason: txResult.reason });
      return res.status(409).json({ error: txResult.reason });
    }

    // Atomic payment status update — prevents cross-endpoint race
    const updatedOrder = await Order.findOneAndUpdate(
      { _id: order._id, paymentStatus: { $ne: 'paid' } },
      {
        $set: {
          paymentStatus: 'paid',
          paymentId: razorpay_payment_id,
          razorpayPaymentId: razorpay_payment_id,
          status: order.status,
          statusUpdatedAt: order.statusUpdatedAt,
          trackingUpdates: order.trackingUpdates
        }
      },
      { new: true }
    );

    if (!updatedOrder) {
      logger.info('verify-upi: Payment already processed by another endpoint', { orderId });
      return res.json({ success: true, message: 'Payment already verified' });
    }

    logger.info('Payment status changed', { orderId, from: 'pending', to: 'paid', via: 'verify-upi' });

    // Emit event for real-time updates
    dataEvents.emit('orders');
    dataEvents.emit('dashboard');

    // Update Google Sheets
    googleSheets.updateOrderStatus(updatedOrder.orderId, 'confirmed', 'paid').catch(err =>
      logger.error('Google Sheets sync error', { error: err.message, orderId: updatedOrder.orderId })
    );

    // Build detailed order confirmation message
    let confirmMsg = `✅ *Payment Successful!*\n\n`;
    confirmMsg += `📦 *Order ID:* ${updatedOrder.orderId}\n`;
    confirmMsg += `💳 *Payment:* UPI\n`;
    confirmMsg += `💰 *Amount Paid:* ₹${updatedOrder.totalAmount}\n`;
    confirmMsg += `🍽️ *Service:* ${updatedOrder.serviceType.replace('_', ' ')}\n\n`;
    confirmMsg += `━━━━━━━━━━━━━━━\n`;
    confirmMsg += `📋 *Your Items:*\n`;
    updatedOrder.items.forEach((item, i) => {
      confirmMsg += `${i + 1}. *${item.name}*\n   Qty: ${item.quantity} × ₹${item.price} = ₹${item.price * item.quantity}\n\n`;
    });
    confirmMsg += `━━━━━━━━━━━━━━━\n\n`;
    
    if (updatedOrder.deliveryAddress?.address) {
      confirmMsg += `📍 *Delivery Address:*\n${updatedOrder.deliveryAddress.address}\n\n`;
    }
    
    confirmMsg += `🙏 Thank you for your order!\nWe're preparing it now.`;

    // Send WhatsApp confirmation
    const confirmedImageUrl = await chatbotImagesService.getImageUrl('payment_success');
    
    try {
      if (confirmedImageUrl) {
        await whatsapp.sendImageWithButtons(updatedOrder.customer.phone, confirmedImageUrl, confirmMsg, [
          { id: 'track_order', text: 'Track Order' },
          { id: 'view_menu', text: 'Add More Items' },
          { id: 'help', text: 'Help' }
        ]);
      } else {
        await whatsapp.sendButtons(updatedOrder.customer.phone, confirmMsg, [
          { id: 'track_order', text: 'Track Order' },
          { id: 'view_menu', text: 'Add More Items' },
          { id: 'help', text: 'Help' }
        ]);
      }
      // Mark confirmation sent for reconciliation
      await Order.updateOne({ _id: updatedOrder._id }, { $set: { whatsappConfirmationSent: true } });
    } catch (whatsappErr) {
      logger.error('WhatsApp notification failed', { error: whatsappErr.message, orderId: updatedOrder.orderId });
    }

    // Send email if available
    if (updatedOrder.customer.email) {
      try {
        await brevoMail.sendOrderConfirmation(updatedOrder.customer.email, updatedOrder);
      } catch (emailErr) {
        logger.error('Email error', { error: emailErr.message, orderId: updatedOrder.orderId });
      }
    }

    // Update customer stats atomically
    await Customer.findOneAndUpdate(
      { phone: updatedOrder.customer.phone },
      { $inc: { totalOrders: 1, totalSpent: updatedOrder.totalAmount } }
    );

    // Send push notification to admin for UPI payment confirmed
    try {
      const admins = await User.find({ pushToken: { $ne: null } });
      for (const admin of admins) {
        if (admin.pushToken) {
          await pushNotification.sendNotification(
            admin.pushToken,
            '💳 Payment Confirmed!',
            `Order #${updatedOrder.orderId} - ₹${updatedOrder.totalAmount}\n${updatedOrder.customer.name || 'Customer'} paid via UPI`,
            { type: 'payment_confirmed', orderId: updatedOrder.orderId, screen: 'Orders' },
            'order-updates'
          );
        }
      }
      if (admins.length > 0) logger.info('Admin push sent for UPI payment', { orderId: updatedOrder.orderId, adminCount: admins.length });
    } catch (pushErr) {
      logger.error('Admin push error', { error: pushErr.message, orderId: updatedOrder.orderId });
    }

    logger.info('UPI Payment verified', { orderId: updatedOrder.orderId, amount: updatedOrder.totalAmount });
    res.json({ success: true, message: 'Payment verified successfully' });
  } catch (error) {
    return logRouteError(res, 'Verify UPI payment error', error);
  }
});

// Razorpay Webhook - receives payment events
router.post('/razorpay-webhook', webhookRateLimiter, express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    // Return 503 during shutdown so Razorpay retries on a healthy instance
    if (isShuttingDown) {
      logger.info('Webhook rejected during shutdown — Razorpay will retry');
      return res.status(503).json({ error: 'Server shutting down, please retry' });
    }
    
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

    // Payment event idempotency: two-phase dedup
    // Phase 1: Insert with status='processing' (allows retry if crash before order update)
    // Phase 2: Update to status='completed' after order.save() succeeds
    // Only reject retries where status is 'completed' (fully processed)
    const razorpayEventId = event.event_id || event.id;
    let paymentEvent = null;
    if (razorpayEventId) {
      try {
        paymentEvent = await PaymentEvent.create({ eventId: razorpayEventId, eventType: event.event, status: 'processing' });
      } catch (dedupErr) {
        if (dedupErr.code === 11000) {
          // Check if previous attempt completed successfully
          const existing = await PaymentEvent.findOne({ eventId: razorpayEventId });
          if (existing && existing.status === 'completed') {
            logger.info('Duplicate Razorpay webhook event skipped (completed)', { eventId: razorpayEventId });
            return res.json({ status: 'ok', duplicate: true });
          }
          // Previous attempt was 'processing' or 'failed' — allow retry by removing stale record
          logger.info('Retrying previously incomplete webhook event', { eventId: razorpayEventId, previousStatus: existing?.status });
          await PaymentEvent.deleteOne({ eventId: razorpayEventId });
          paymentEvent = await PaymentEvent.create({ eventId: razorpayEventId, eventType: event.event, status: 'processing' });
        } else {
          logger.warn('PaymentEvent save warning', { error: dedupErr.message });
        }
      }
    }
    
    const payload = event.payload;
    
    // Handle payment captured event (backup for callback)
    if (event.event === 'payment.captured') {
      const payment = payload.payment?.entity;
      const paymentLinkId = payment?.notes?.payment_link_id || payment?.payment_link_id;
      
      if (paymentLinkId) {
        const order = await Order.findOne({ razorpayOrderId: paymentLinkId });
        if (order && order.paymentStatus !== 'paid') {
          // Amount verification: compare Razorpay captured amount with order total
          if (payment.amount) {
            const paidAmountPaise = payment.amount;
            const expectedAmountPaise = Math.round(order.totalAmount * 100);
            if (paidAmountPaise !== expectedAmountPaise) {
              logger.warn('Payment amount mismatch in webhook', {
                orderId: order.orderId,
                paid: paidAmountPaise / 100,
                expected: order.totalAmount
              });
              return res.status(400).json({ status: 'error', message: 'Amount mismatch' });
            }
          }

          // State machine transition
          transitionStatus(order, 'confirmed', 'Payment received via webhook');

          // Atomic payment status update — prevents cross-endpoint race
          const updatedOrder = await Order.findOneAndUpdate(
            { _id: order._id, paymentStatus: { $ne: 'paid' } },
            {
              $set: {
                paymentStatus: 'paid',
                razorpayPaymentId: payment.id,
                status: order.status,
                statusUpdatedAt: order.statusUpdatedAt,
                trackingUpdates: order.trackingUpdates
              }
            },
            { new: true }
          );

          if (updatedOrder) {
            logger.info('Payment status changed', { orderId: updatedOrder.orderId, from: 'pending', to: 'paid', via: 'razorpay-webhook' });
          
            // Phase 2: Mark dedup record as completed (safe for future retries to skip)
            if (paymentEvent) {
              paymentEvent.status = 'completed';
              paymentEvent.completedAt = new Date();
              paymentEvent.orderId = updatedOrder.orderId;
              paymentEvent.paymentId = payment.id;
              await paymentEvent.save();
            }
          
            logger.info('Payment captured via webhook', { orderId: updatedOrder.orderId });
          
            // Emit event for real-time updates
            dataEvents.emit('orders');
            dataEvents.emit('dashboard');
          
            // Update Google Sheets
            googleSheets.updateOrderStatus(updatedOrder.orderId, 'confirmed', 'paid').catch(err =>
              logger.error('Google Sheets sync error', { error: err.message, orderId: updatedOrder.orderId })
            );
          
          // Send push notification to admin for webhook payment
            try {
              const admins = await User.find({ pushToken: { $ne: null } });
              for (const admin of admins) {
                if (admin.pushToken) {
                  await pushNotification.sendNotification(
                    admin.pushToken,
                    '💳 Payment Confirmed!',
                    `Order #${updatedOrder.orderId} - ₹${updatedOrder.totalAmount} paid via UPI`,
                    { type: 'payment_confirmed', orderId: updatedOrder.orderId, screen: 'Orders' },
                    'order-updates'
                  );
                }
              }
            } catch (pushErr) {
              logger.error('Admin push error (webhook)', { error: pushErr.message, orderId: updatedOrder.orderId });
            }
          } else {
            logger.info('webhook: Payment already processed by another endpoint', { orderId: order.orderId });
            // Still mark dedup as completed so retry is skipped
            if (paymentEvent) {
              paymentEvent.status = 'completed';
              paymentEvent.completedAt = new Date();
              paymentEvent.orderId = order.orderId;
              await paymentEvent.save();
            }
          }
        }
      }
      
      return res.json({ status: 'ok' });
    }
    
    res.json({ status: 'ok' });
  } catch (error) {
    return logRouteError(res, 'Razorpay webhook error', error);
  }
});

router.get('/callback', publicRateLimiter, async (req, res) => {
  try {
    // Return 503 during shutdown so payment can be retried/reconciled
    if (isShuttingDown) {
      logger.info('Callback rejected during shutdown');
      return res.status(503).send('<html><body><h1>Server is restarting</h1><p>Please wait a moment and try again.</p></body></html>');
    }
    
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
        // Amount verification: fetch payment from Razorpay and compare
        if (razorpay_payment_id) {
          try {
            const rzpPayment = await razorpayService.getPaymentDetails(razorpay_payment_id);
            const paidAmountPaise = rzpPayment.amount;
            const expectedAmountPaise = Math.round(order.totalAmount * 100);
            if (paidAmountPaise !== expectedAmountPaise) {
              logger.warn('Payment amount mismatch in callback', {
                orderId: order.orderId,
                paid: paidAmountPaise / 100,
                expected: order.totalAmount
              });
              return res.status(400).send('<html><body><h1>Amount Mismatch</h1></body></html>');
            }
          } catch (rzpErr) {
            logger.warn('Could not verify payment amount from Razorpay in callback', { error: rzpErr.message, orderId: order.orderId });
            // Continue — signature is already verified
          }
        }

        // State machine transition (validates before mutation)
        transitionStatus(order, 'confirmed', 'Payment received, order confirmed');

        // Atomic payment status update — prevents cross-endpoint race
        const updatedOrder = await Order.findOneAndUpdate(
          { _id: order._id, paymentStatus: { $ne: 'paid' } },
          {
            $set: {
              paymentStatus: 'paid',
              paymentId: razorpay_payment_id,
              razorpayPaymentId: razorpay_payment_id,
              status: order.status,
              statusUpdatedAt: order.statusUpdatedAt,
              trackingUpdates: order.trackingUpdates
            }
          },
          { new: true }
        );

        if (updatedOrder) {
          const previousPaymentStatus = 'pending';
          logger.info('Payment status changed', { orderId: updatedOrder.orderId, from: previousPaymentStatus, to: 'paid', via: 'callback' });

          // Emit event for real-time updates
          dataEvents.emit('orders');
          dataEvents.emit('dashboard');

          // Update Google Sheets
          googleSheets.updateOrderStatus(updatedOrder.orderId, 'confirmed', 'paid').catch(err =>
            logger.error('Google Sheets sync error', { error: err.message, orderId: updatedOrder.orderId })
          );

          // Build detailed order confirmation message
          let confirmMsg = `✅ *Payment Successful!*\n\n`;
          confirmMsg += `📦 *Order ID:* ${updatedOrder.orderId}\n`;
          confirmMsg += `💳 *Payment:* UPI/Online\n`;
          confirmMsg += `💰 *Amount Paid:* ₹${updatedOrder.totalAmount}\n`;
          confirmMsg += `🍽️ *Service:* ${updatedOrder.serviceType.replace('_', ' ')}\n\n`;
          confirmMsg += `━━━━━━━━━━━━━━━\n`;
          confirmMsg += `📋 *Your Items:*\n`;
          updatedOrder.items.forEach((item, i) => {
            confirmMsg += `${i + 1}. *${item.name}*\n   Qty: ${item.quantity} × ₹${item.price} = ₹${item.price * item.quantity}\n\n`;
          });
          confirmMsg += `━━━━━━━━━━━━━━━\n\n`;
          
          if (updatedOrder.deliveryAddress?.address) {
            confirmMsg += `📍 *Delivery Address:*\n${updatedOrder.deliveryAddress.address}\n\n`;
          }
          
          confirmMsg += `🙏 Thank you for your order!\nWe're preparing it now.`;

          // Send WhatsApp confirmation with image and buttons
          const confirmedImageUrl = await chatbotImagesService.getImageUrl('payment_success');
          
          try {
            if (confirmedImageUrl) {
              await whatsapp.sendImageWithButtons(updatedOrder.customer.phone, confirmedImageUrl, confirmMsg, [
                { id: 'track_order', text: 'Track Order' },
                { id: 'view_menu', text: 'Add More Items' },
                { id: 'help', text: 'Help' }
              ]);
            } else {
              await whatsapp.sendButtons(updatedOrder.customer.phone, confirmMsg, [
                { id: 'track_order', text: 'Track Order' },
                { id: 'view_menu', text: 'Add More Items' },
                { id: 'help', text: 'Help' }
              ]);
            }
            // Mark confirmation sent for reconciliation
            await Order.updateOne({ _id: updatedOrder._id }, { $set: { whatsappConfirmationSent: true } });
          } catch (whatsappErr) {
            logger.error('WhatsApp notification failed (callback)', { error: whatsappErr.message, orderId: updatedOrder.orderId });
          }

          // Send email if available
          if (updatedOrder.customer.email) {
            try {
              await brevoMail.sendOrderConfirmation(updatedOrder.customer.email, updatedOrder);
            } catch (emailErr) {
              logger.error('Email error', { error: emailErr.message, orderId: updatedOrder.orderId });
            }
          }

          // Update customer stats atomically
          await Customer.findOneAndUpdate(
            { phone: updatedOrder.customer.phone },
            { $inc: { totalOrders: 1, totalSpent: updatedOrder.totalAmount } }
          );
          
          // Send push notification to admin for callback payment
          try {
            const admins = await User.find({ pushToken: { $ne: null } });
            for (const admin of admins) {
              if (admin.pushToken) {
                await pushNotification.sendNotification(
                  admin.pushToken,
                  '💳 Payment Confirmed!',
                  `Order #${updatedOrder.orderId} - ₹${updatedOrder.totalAmount} paid via UPI`,
                  { type: 'payment_confirmed', orderId: updatedOrder.orderId, screen: 'Orders' },
                  'order-updates'
                );
              }
            }
          } catch (pushErr) {
            logger.error('Admin push error (callback)', { error: pushErr.message, orderId: updatedOrder.orderId });
          }

          logger.info('Payment confirmed', { orderId: updatedOrder.orderId, amount: updatedOrder.totalAmount, via: 'callback' });
        } else {
          logger.info('callback: Payment already processed by another endpoint', { orderId: order.orderId });
        }
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

module.exports = router;
