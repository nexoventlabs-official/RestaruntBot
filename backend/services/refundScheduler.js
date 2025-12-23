// Refund Scheduler - Sends refund success message after delay
const Order = require('../models/Order');
const whatsapp = require('./whatsapp');
const googleSheets = require('./googleSheets');

const pendingRefunds = new Map();

const refundScheduler = {
  scheduleRefundCompletion(orderId, delayMs = 5 * 60 * 1000) {
    console.log(`⏰ Scheduling refund completion for ${orderId} in ${delayMs / 1000} seconds`);
    
    const timeoutId = setTimeout(async () => {
      await this.completeRefund(orderId);
      pendingRefunds.delete(orderId);
    }, delayMs);
    
    pendingRefunds.set(orderId, timeoutId);
  },

  async completeRefund(orderId) {
    try {
      const order = await Order.findOne({ orderId });
      
      if (!order) {
        console.log(`❌ Order ${orderId} not found for refund completion`);
        return;
      }
      
      if (order.refundStatus !== 'pending') {
        console.log(`⚠️ Order ${orderId} refund status is ${order.refundStatus}, skipping`);
        return;
      }
      
      // Update refund status to completed and order status to refunded
      order.refundStatus = 'completed';
      order.status = 'refunded';
      order.statusUpdatedAt = new Date(); // For cleanup scheduler
      order.refundedAt = new Date();
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
      
      console.log(`✅ Refund completed for order ${orderId}`);
      
      // Send WhatsApp success message
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
        console.log(`📱 Refund success message sent to ${order.customer.phone}`);
      } catch (whatsappError) {
        console.error('WhatsApp refund notification failed:', whatsappError.message);
      }
      
      // Sync to Google Sheets
      try {
        await googleSheets.updateOrderStatus(order.orderId, 'refunded', 'refunded');
      } catch (err) {
        console.error('Google Sheets sync error:', err.message);
      }
      
    } catch (error) {
      console.error(`❌ Error completing refund for ${orderId}:`, error.message);
    }
  },

  cancelScheduledRefund(orderId) {
    const timeoutId = pendingRefunds.get(orderId);
    if (timeoutId) {
      clearTimeout(timeoutId);
      pendingRefunds.delete(orderId);
      console.log(`🚫 Cancelled scheduled refund for ${orderId}`);
    }
  }
};

module.exports = refundScheduler;
