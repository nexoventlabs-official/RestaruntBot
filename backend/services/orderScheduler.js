const Order = require('../models/Order');
const whatsapp = require('./whatsapp');
const googleSheets = require('./googleSheets');

const PENDING_TIMEOUT_MINUTES = 15;

const orderScheduler = {
  // Check and cancel pending orders older than 15 minutes
  async cancelExpiredOrders() {
    try {
      const cutoffTime = new Date(Date.now() - PENDING_TIMEOUT_MINUTES * 60 * 1000);
      
      // Find pending orders older than 15 minutes
      const expiredOrders = await Order.find({
        status: 'pending',
        paymentStatus: 'pending',
        createdAt: { $lt: cutoffTime }
      });
      
      console.log(`🔍 Found ${expiredOrders.length} expired pending orders`);
      
      for (const order of expiredOrders) {
        await this.cancelOrder(order);
      }
      
      return expiredOrders.length;
    } catch (error) {
      console.error('❌ Error checking expired orders:', error.message);
      return 0;
    }
  },

  // Cancel a single order and notify customer
  async cancelOrder(order) {
    try {
      console.log(`⏰ Auto-cancelling order ${order.orderId} (pending for >15 mins)`);
      
      // Update order status
      order.status = 'cancelled';
      order.cancellationReason = 'Auto-cancelled: Payment not received within 15 minutes';
      order.trackingUpdates.push({
        status: 'cancelled',
        message: 'Order auto-cancelled due to payment timeout',
        timestamp: new Date()
      });
      await order.save();
      
      // Update Google Sheets
      googleSheets.updateOrderStatus(order.orderId, 'cancelled', 'pending').catch(err =>
        console.error('Google Sheets sync error:', err)
      );
      
      // Build order details message
      let itemsList = '';
      if (order.items && order.items.length > 0) {
        itemsList = order.items.map(item => 
          `• ${item.name} x${item.quantity} - ₹${item.price * item.quantity}`
        ).join('\n');
      }
      
      // Send WhatsApp notification to customer
      const message = `❌ *Order Cancelled*\n\n` +
        `📦 *Order ID:* ${order.orderId}\n` +
        `💰 *Total:* ₹${order.totalAmount}\n` +
        `🍽️ *Service:* ${order.serviceType}\n\n` +
        `*Items:*\n${itemsList}\n\n` +
        `━━━━━━━━━━━━━━━\n` +
        `⚠️ *Reason:* Payment not received within 15 minutes.\n\n` +
        `If you still want to order, please start a new order by sending "hi".`;
      
      await whatsapp.sendButtons(order.customer.phone, message, [
        { id: 'place_order', text: '🛒 New Order' },
        { id: 'help', text: '❓ Help' }
      ]);
      
      console.log(`✅ Order ${order.orderId} cancelled and customer notified`);
      return true;
    } catch (error) {
      console.error(`❌ Error cancelling order ${order.orderId}:`, error.message);
      return false;
    }
  },

  // Start the scheduler (runs every minute)
  start() {
    console.log('⏰ Order scheduler started - checking for expired orders every minute');
    
    // Run immediately on start
    this.cancelExpiredOrders();
    
    // Then run every minute
    setInterval(() => {
      this.cancelExpiredOrders();
    }, 60 * 1000); // Every 1 minute
  }
};

module.exports = orderScheduler;
