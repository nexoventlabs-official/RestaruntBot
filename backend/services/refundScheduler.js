// Refund Scheduler - Processes refund after delay and sends success message
// Uses persistent DB flag + periodic scanner (survives restarts)
const Order = require('../models/Order');
const logger = require('./logger');
const whatsapp = require('./whatsapp');
const googleSheets = require('./googleSheets');
const razorpayService = require('./razorpay');

const pendingRefunds = new Map();
let scanInterval = null;

const refundScheduler = {
  // Schedule refund to be processed after delay (default 5 minutes)
  scheduleRefund(orderId, delayMs = 5 * 60 * 1000) {
    logger.info(`⏰ Scheduling refund for ${orderId} in ${delayMs / 1000} seconds`);
    
    // Cancel any existing scheduled refund for this order
    this.cancelScheduledRefund(orderId);
    
    // Persist the schedule in DB so it survives restarts
    Order.findOneAndUpdate(
      { orderId },
      { refundStatus: 'scheduled', refundScheduledAt: new Date(Date.now() + delayMs) },
      { new: true }
    ).catch(err => logger.error('Failed to persist refund schedule', { orderId, error: err.message }));
    
    const timeoutId = setTimeout(async () => {
      await this.processRefund(orderId);
      pendingRefunds.delete(orderId);
    }, delayMs);
    
    pendingRefunds.set(orderId, timeoutId);
  },

  // Start periodic scanner for recovery after restarts
  start() {
    // Scan every 2 minutes for any scheduled refunds that were lost
    scanInterval = setInterval(() => this.recoverScheduledRefunds(), 2 * 60 * 1000);
    // Also run immediately on startup
    this.recoverScheduledRefunds();
    logger.info('Refund scheduler started with recovery scanner');
  },

  stop() {
    if (scanInterval) {
      clearInterval(scanInterval);
      scanInterval = null;
    }
    // Clear all pending timeouts
    for (const [orderId, timeoutId] of pendingRefunds.entries()) {
      clearTimeout(timeoutId);
    }
    pendingRefunds.clear();
    logger.info('Refund scheduler stopped');
  },

  async recoverScheduledRefunds() {
    try {
      const now = new Date();
      const scheduledOrders = await Order.find({
        refundStatus: 'scheduled',
        status: 'cancelled',
        refundScheduledAt: { $lte: now }
      }).select('orderId');

      for (const order of scheduledOrders) {
        if (!pendingRefunds.has(order.orderId)) {
          logger.info(`Recovering scheduled refund for ${order.orderId}`);
          await this.processRefund(order.orderId);
        }
      }
    } catch (err) {
      logger.error('Refund recovery scan error', { error: err.message });
    }
  },

  async processRefund(orderId) {
    try {
      const order = await Order.findOne({ orderId });
      
      if (!order) {
        logger.info(`❌ Order ${orderId} not found for refund`);
        return;
      }
      
      // Check if refund should be processed
      if (order.refundStatus === 'completed') {
        logger.info(`⚠️ Order ${orderId} already refunded, skipping`);
        return;
      }
      
      if (order.refundStatus !== 'scheduled' && order.refundStatus !== 'pending') {
        logger.info(`⚠️ Order ${orderId} refund status is ${order.refundStatus}, skipping`);
        return;
      }
      
      if (order.status !== 'cancelled') {
        logger.info(`⚠️ Order ${orderId} is not cancelled (status: ${order.status}), skipping refund`);
        return;
      }
      
      if (!order.razorpayPaymentId) {
        logger.info(`⚠️ Order ${orderId} has no payment ID, skipping refund`);
        return;
      }
      
      logger.info(`💰 Processing scheduled refund for order ${orderId}`);
      
      try {
        // Process the actual refund via Razorpay
        const refund = await razorpayService.refund(order.razorpayPaymentId, order.totalAmount);
        
        // Update order with refund details
        order.refundStatus = 'completed';
        order.status = 'refunded';
        order.refundId = refund.id;
        order.refundProcessedAt = new Date();
        order.statusUpdatedAt = new Date();
        order.trackingUpdates.push({
          status: 'refunded',
          message: `Refund of ₹${order.totalAmount} completed successfully`,
          timestamp: new Date()
        });
        await order.save();
        
        // Emit event for real-time updates
        const dataEvents = require('./eventEmitter');
        dataEvents.emit('orders');
        dataEvents.emit('dashboard');
        
        logger.info(`✅ Refund completed for order ${orderId}, Refund ID: ${refund.id}`);
        
        // Send WhatsApp success message
        await this.sendRefundSuccessMessage(order);
        
        // Sync to Google Sheets
        try {
          await googleSheets.updateOrderStatus(order.orderId, 'refunded', 'refunded');
        } catch (err) {
          logger.error('Google Sheets sync error:', err.message);
        }
        
      } catch (refundError) {
        logger.error(`❌ Refund failed for order ${orderId}:`, refundError.message);
        
        // Update order with failure status
        order.refundStatus = 'failed';
        order.status = 'refund_failed';
        order.paymentStatus = 'refund_failed';
        order.refundError = refundError.message;
        order.trackingUpdates.push({
          status: 'refund_failed',
          message: `Refund failed: ${refundError.message}`,
          timestamp: new Date()
        });
        await order.save();
        
        // Emit event for real-time updates
        const dataEvents = require('./eventEmitter');
        dataEvents.emit('orders');
        
        // Sync to Google Sheets - move to refundfailed sheet
        try {
          await googleSheets.updateOrderStatus(order.orderId, 'refund_failed', 'refund_failed');
        } catch (err) {
          logger.error('Google Sheets sync error for failed refund:', err.message);
        }
        
        // Send failure notification
        await this.sendRefundFailureMessage(order);
      }
      
    } catch (error) {
      logger.error(`❌ Error processing refund for ${orderId}:`, error.message);
    }
  },

  async sendRefundSuccessMessage(order) {
    try {
      const msg = `✅ *Refund Successful!*\n\n` +
        `Order: ${order.orderId}\n` +
        `Amount: ₹${order.totalAmount}\n` +
        `Refund ID: ${order.refundId}\n\n` +
        `💰 The amount has been credited to your account.\n\n` +
        `Thank you for your patience! 🙏`;
      
      await whatsapp.sendButtons(order.customer.phone, msg, [
        { id: 'place_order', text: 'New Order' },
        { id: 'home', text: 'Main Menu' }
      ]);
      logger.info(`📱 Refund success message sent to ${order.customer.phone}`);
    } catch (whatsappError) {
      logger.error('WhatsApp refund notification failed:', whatsappError.message);
    }
  },

  async sendRefundFailureMessage(order) {
    try {
      const msg = `⚠️ *Refund Issue*\n\n` +
        `Order: ${order.orderId}\n` +
        `Amount: ₹${order.totalAmount}\n\n` +
        `We couldn't process your refund automatically.\n` +
        `Our team will contact you within 24 hours to resolve this.\n\n` +
        `Sorry for the inconvenience! 🙏`;
      
      await whatsapp.sendButtons(order.customer.phone, msg, [
        { id: 'place_order', text: 'New Order' },
        { id: 'home', text: 'Main Menu' }
      ]);
      logger.info(`📱 Refund failure message sent to ${order.customer.phone}`);
    } catch (whatsappError) {
      logger.error('WhatsApp refund failure notification failed:', whatsappError.message);
    }
  },

  cancelScheduledRefund(orderId) {
    const timeoutId = pendingRefunds.get(orderId);
    if (timeoutId) {
      clearTimeout(timeoutId);
      pendingRefunds.delete(orderId);
      logger.info(`🚫 Cancelled scheduled refund for ${orderId}`);
    }
  }
};

module.exports = refundScheduler;
