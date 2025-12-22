const express = require('express');
const Order = require('../models/Order');
const Customer = require('../models/Customer');
const whatsapp = require('../services/whatsapp');
const brevoMail = require('../services/brevoMail');
const googleSheets = require('../services/googleSheets');
const razorpayService = require('../services/razorpay');
const authMiddleware = require('../middleware/auth');
const router = express.Router();

// Lightweight endpoint to check for updates (returns hash only)
router.get('/check-updates', authMiddleware, async (req, res) => {
  try {
    const { status, lastHash } = req.query;
    const query = status ? { status } : {};
    
    // Get count and latest update timestamp - very lightweight query
    const [count, latestOrder] = await Promise.all([
      Order.countDocuments(query),
      Order.findOne(query).sort({ updatedAt: -1 }).select('updatedAt').lean()
    ]);
    
    // Create a simple hash from count + latest update time
    const latestTime = latestOrder?.updatedAt?.getTime() || 0;
    const currentHash = `${count}-${latestTime}`;
    
    // If hash matches, no changes
    if (lastHash === currentHash) {
      return res.json({ hasChanges: false, hash: currentHash });
    }
    
    res.json({ hasChanges: true, hash: currentHash });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/', authMiddleware, async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const query = status ? { status } : {};
    const orders = await Order.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));
    const total = await Order.countDocuments(query);
    
    // Include hash for client-side change detection
    const latestOrder = orders[0];
    const hash = `${total}-${latestOrder?.updatedAt?.getTime() || 0}`;
    
    res.json({ orders, total, pages: Math.ceil(total / limit), hash });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    res.json(order);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/:id/status', authMiddleware, async (req, res) => {
  console.log('🔄 PUT /orders/:id/status called with id:', req.params.id, 'body:', req.body);
  try {
    const { status, message } = req.body;
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    console.log('📋 Found order:', order.orderId, 'current status:', order.status, 'new status:', status);

    const statusLabels = {
      pending: 'Pending', confirmed: 'Confirmed', preparing: 'Preparing', ready: 'Ready',
      out_for_delivery: 'On the Way', delivered: 'Delivered', cancelled: 'Cancelled', refunded: 'Refunded'
    };

    order.status = status;
    order.trackingUpdates.push({ status, message: message || `Status updated to ${statusLabels[status] || status}` });
    
    // Track when status changed to delivered/cancelled for auto-cleanup
    if (status === 'delivered' || status === 'cancelled') {
      order.statusUpdatedAt = new Date();
    }
    
    if (status === 'delivered') {
      order.deliveredAt = new Date();
      // Auto-mark COD orders as paid when delivered
      if (order.paymentMethod === 'cod') {
        order.paymentStatus = 'paid';
        order.trackingUpdates.push({ status: 'paid', message: 'COD payment collected on delivery' });
      }
      
      // Track today's revenue for delivered + paid orders
      if (order.paymentStatus === 'paid') {
        try {
          const DashboardStats = require('../models/DashboardStats');
          const getTodayString = () => {
            const now = new Date();
            return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
          };
          
          let stats = await DashboardStats.findOne();
          if (!stats) {
            stats = new DashboardStats({ todayDate: getTodayString() });
          }
          
          const today = getTodayString();
          if (stats.todayDate !== today) {
            stats.todayRevenue = 0;
            stats.todayOrders = 0;
            stats.todayDate = today;
          }
          
          stats.todayRevenue += order.totalAmount || 0;
          stats.todayOrders += 1;
          stats.lastUpdated = new Date();
          await stats.save();
          
          console.log(`📊 Today's revenue updated: +₹${order.totalAmount} (Total: ₹${stats.todayRevenue})`);
        } catch (statsErr) {
          console.error('Error updating today revenue:', statsErr.message);
        }
      }
    }
    
    // Mark COD orders as cancelled payment status when order is cancelled
    if (status === 'cancelled' && order.paymentMethod === 'cod' && order.paymentStatus === 'pending') {
      order.paymentStatus = 'cancelled';
    }
    
    // Start refund process for paid UPI orders when cancelled (don't complete immediately)
    if (status === 'cancelled' && order.paymentStatus === 'paid' && order.razorpayPaymentId) {
      try {
        console.log('💰 Initiating refund for order:', order.orderId);
        const refund = await razorpayService.refund(order.razorpayPaymentId, order.totalAmount);
        order.refundStatus = 'pending'; // Set to pending first, will be completed after delay
        order.refundAmount = order.totalAmount;
        order.refundId = refund.id;
        order.refundInitiatedAt = new Date();
        order.trackingUpdates.push({ 
          status: 'refund_initiated', 
          message: `Refund of ₹${order.totalAmount} initiated`, 
          timestamp: new Date() 
        });
        console.log('✅ Refund initiated:', refund.id);
        
        // Schedule refund completion message after 5 minutes
        const refundScheduler = require('../services/refundScheduler');
        refundScheduler.scheduleRefundCompletion(order.orderId, 5 * 60 * 1000); // 5 minutes
      } catch (refundError) {
        console.error('❌ Refund initiation failed:', refundError.message);
        order.refundStatus = 'failed';
        order.refundAmount = order.totalAmount;
      }
    }
    
    try {
      await order.save();
      console.log('✅ Order saved to DB:', order.orderId, 'status:', status, 'paymentStatus:', order.paymentStatus);
    } catch (saveErr) {
      console.error('❌ Order save error:', saveErr.message);
      return res.status(500).json({ error: 'Failed to save order: ' + saveErr.message });
    }

    // Sync status update to Google Sheets
    try {
      console.log('📊 Syncing to Google Sheets:', order.orderId, status, order.paymentStatus);
      const sheetUpdated = await googleSheets.updateOrderStatus(order.orderId, status, order.paymentStatus);
      if (sheetUpdated) {
        console.log('✅ Google Sheets synced successfully');
      } else {
        console.log('⚠️ Google Sheets update returned false - order may not exist in sheet');
      }
    } catch (err) {
      console.error('❌ Google Sheets sync error:', err.message);
    }

    // Notify customer via WhatsApp (don't fail if notification fails)
    const statusMessages = {
      confirmed: '✅ Your order has been confirmed!',
      preparing: '👨‍🍳 Your order is being prepared!',
      ready: '📦 Your order is ready!',
      out_for_delivery: '🛵 Your order is on the way!',
      delivered: '✅ Your order has been delivered! Enjoy!',
      cancelled: '❌ Your order has been cancelled.'
    };
    
    if (statusMessages[status]) {
      try {
        let msg = `*Order Update*\n\nOrder: ${order.orderId}\n${statusMessages[status]}`;
        
        // Add order details and bill for delivered orders
        if (status === 'delivered') {
          msg += `\n\n━━━━━━━━━━━━━━━\n📋 *Order Details*\n━━━━━━━━━━━━━━━\n`;
          
          // Add each item
          order.items.forEach((item, index) => {
            const itemTotal = item.price * item.quantity;
            msg += `${index + 1}. ${item.name}\n`;
            msg += `   ${item.quantity} × ₹${item.price} = ₹${itemTotal}\n`;
          });
          
          msg += `\n━━━━━━━━━━━━━━━\n`;
          msg += `💰 *Total Bill: ₹${order.totalAmount}*\n`;
          msg += `💳 Payment: ${order.paymentMethod === 'cod' ? 'Cash on Delivery' : 'UPI'} (${order.paymentStatus === 'paid' ? '✅ Paid' : '⏳ Pending'})\n`;
          msg += `━━━━━━━━━━━━━━━\n`;
          msg += `\n🙏 Thank you for ordering!\nWe hope you enjoy your meal! 🍽️`;
          
          // Send combined message with review CTA button if Google Review URL is configured
          const googleReviewUrl = process.env.GOOGLE_REVIEW_URL;
          if (googleReviewUrl && googleReviewUrl !== 'https://g.page/r/YOUR_GOOGLE_REVIEW_LINK') {
            await whatsapp.sendCtaUrl(
              order.customer.phone,
              msg,
              'Leave a Review ⭐',
              googleReviewUrl,
              'Your feedback helps us improve!'
            );
          } else {
            await whatsapp.sendMessage(order.customer.phone, msg);
          }
        } else {
          // Add refund info if order was cancelled with pending refund
          if (status === 'cancelled' && order.refundStatus === 'pending' && order.refundId) {
            msg += `\n\n💰 *Refund Processing*\nYour refund of ₹${order.totalAmount} is being processed.\n\n⏱️ Your money will be refunded in 5-10 minutes.`;
          } else if (status === 'cancelled' && order.refundStatus === 'failed') {
            msg += `\n\n⚠️ *Refund Issue*\nWe couldn't process your refund automatically.\nAmount: ₹${order.totalAmount}\n\nOur team will contact you within 24 hours to resolve this.`;
          }
          
          await whatsapp.sendMessage(order.customer.phone, msg);
        }
      } catch (whatsappError) {
        console.error('WhatsApp notification failed:', whatsappError.message);
      }
    }

    // Send email if available (don't fail if email fails)
    if (order.customer.email) {
      try {
        await brevoMail.sendStatusUpdate(order.customer.email, order.orderId, status, statusMessages[status] || '');
      } catch (emailError) {
        console.error('Email notification failed:', emailError.message);
      }
    }

    // Emit event for real-time updates
    const dataEvents = require('../services/eventEmitter');
    dataEvents.emit('orders');
    dataEvents.emit('dashboard');

    res.json(order);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/:id/delivery-time', authMiddleware, async (req, res) => {
  try {
    const { estimatedDeliveryTime } = req.body;
    const order = await Order.findByIdAndUpdate(
      req.params.id,
      { estimatedDeliveryTime: new Date(estimatedDeliveryTime) },
      { new: true }
    );
    
    try {
      await whatsapp.sendMessage(order.customer.phone,
        `⏰ *Delivery Update*\n\nOrder: ${order.orderId}\nEstimated delivery: ${new Date(estimatedDeliveryTime).toLocaleString()}`);
    } catch (whatsappError) {
      console.error('WhatsApp notification failed:', whatsappError.message);
    }
    
    res.json(order);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get pending refund requests
router.get('/refunds/pending', authMiddleware, async (req, res) => {
  try {
    const orders = await Order.find({ refundStatus: 'pending' }).sort({ createdAt: -1 });
    res.json(orders);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Approve refund
router.put('/:id/refund/approve', authMiddleware, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    
    if (order.refundStatus !== 'pending') {
      return res.status(400).json({ error: 'No pending refund request for this order' });
    }

    const razorpayService = require('../services/razorpay');
    
    // Process refund via Razorpay if UPI payment
    if (order.paymentMethod === 'upi' && order.paymentId) {
      try {
        const refund = await razorpayService.refund(order.paymentId, order.refundAmount || order.totalAmount);
        order.refundId = refund.id;
        order.refundStatus = 'completed';
        order.paymentStatus = 'refunded';
        order.status = 'refunded';
        order.refundProcessedAt = new Date();
        order.trackingUpdates.push({ status: 'refunded', message: `Refund of ₹${order.refundAmount || order.totalAmount} processed. Refund ID: ${refund.id}` });
        
        // Notify customer
        try {
          await whatsapp.sendMessage(order.customer.phone,
            `✅ *Refund Processed!*\n\nOrder: ${order.orderId}\nAmount: ₹${order.refundAmount || order.totalAmount}\nRefund ID: ${refund.id}\n\n💳 Amount will be credited to your account in 10-20 minutes.`
          );
        } catch (e) {
          console.error('WhatsApp notification failed:', e.message);
        }
      } catch (refundError) {
        console.error('Razorpay refund error:', refundError);
        return res.status(500).json({ error: 'Refund processing failed: ' + refundError.message });
      }
    } else {
      // COD refund - manual process
      order.refundStatus = 'completed';
      order.paymentStatus = 'refunded';
      order.status = 'refunded';
      order.refundProcessedAt = new Date();
      order.trackingUpdates.push({ status: 'refunded', message: `COD refund of ₹${order.refundAmount || order.totalAmount} approved` });
      
      // Notify customer
      try {
        await whatsapp.sendMessage(order.customer.phone,
          `✅ *Refund Approved!*\n\nOrder: ${order.orderId}\nAmount: ₹${order.refundAmount || order.totalAmount}\n\n💵 Your COD refund has been approved. Our team will contact you for the refund process.`
        );
      } catch (e) {
        console.error('WhatsApp notification failed:', e.message);
      }
    }
    
    await order.save();
    
    // Emit event for real-time updates
    const dataEvents = require('../services/eventEmitter');
    dataEvents.emit('orders');
    dataEvents.emit('dashboard');
    
    // Sync to Google Sheets
    googleSheets.updateOrderStatus(order.orderId, order.status, order.paymentStatus).catch(err => 
      console.error('Google Sheets sync error:', err)
    );
    
    res.json({ success: true, order });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Reject refund
router.put('/:id/refund/reject', authMiddleware, async (req, res) => {
  try {
    const { reason } = req.body;
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    
    if (order.refundStatus !== 'pending') {
      return res.status(400).json({ error: 'No pending refund request for this order' });
    }

    order.refundStatus = 'rejected';
    order.trackingUpdates.push({ status: 'refund_rejected', message: reason || 'Refund request rejected by admin' });
    await order.save();
    
    // Emit event for real-time updates
    const dataEvents = require('../services/eventEmitter');
    dataEvents.emit('orders');
    dataEvents.emit('dashboard');
    
    // Notify customer
    try {
      await whatsapp.sendMessage(order.customer.phone,
        `❌ *Refund Request Rejected*\n\nOrder: ${order.orderId}\n\nReason: ${reason || 'Your refund request has been reviewed and rejected.'}\n\nPlease contact support for more information.`
      );
    } catch (e) {
      console.error('WhatsApp notification failed:', e.message);
    }
    
    res.json({ success: true, order });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
