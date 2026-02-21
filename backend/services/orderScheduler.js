const Order = require('../models/Order');
const logger = require('./logger');
const whatsapp = require('./whatsapp');
const googleSheets = require('./googleSheets');
const chatbotImagesService = require('./chatbotImages');
const { transitionStatus } = require('./orderStateMachine');
const { initContext, runWithContext } = require('./correlationContext');

const PENDING_TIMEOUT_MINUTES = 15;

const orderScheduler = {
  // Check and cancel pending orders older than 15 minutes
  async cancelExpiredOrders() {
    try {
      const cutoffTime = new Date(Date.now() - PENDING_TIMEOUT_MINUTES * 60 * 1000);
      
      // Find pending orders older than 15 minutes
      // EXCLUDE pickup orders with COD (Pay at Hotel) - they don't need payment confirmation
      const expiredOrders = await Order.find({
        status: 'pending',
        paymentStatus: 'pending',
        createdAt: { $lt: cutoffTime },
        // Exclude pickup orders with COD payment (Pay at Hotel)
        $nor: [
          { serviceType: 'pickup', paymentMethod: 'cod' }
        ]
      });
      
      logger.info('Found expired pending orders', {
        count: expiredOrders.length,
        cutoffTime: cutoffTime.toISOString()
      });
      
      for (const order of expiredOrders) {
        await this.cancelOrder(order);
      }
      
      return expiredOrders.length;
    } catch (error) {
      logger.error('Error checking expired orders', { error: error.message, stack: error.stack });
      return 0;
    }
  },

  // Cancel a single order and notify customer
  async cancelOrder(order) {
    try {
      logger.info('Auto-cancelling expired order', {
        orderId: order.orderId,
        pendingMinutes: PENDING_TIMEOUT_MINUTES,
        triggeredBy: 'scheduler'
      });
      
      // Update order status via state machine
      const result = transitionStatus(order, 'cancelled', 'Order auto-cancelled due to payment timeout', 'scheduler');
      if (!result.success) {
        logger.warn('Failed to transition expired order', { orderId: order.orderId, reason: result.reason });
        return false;
      }
      order.cancellationReason = 'Auto-cancelled: Payment not received within 15 minutes';
      await order.save();
      
      // Update Google Sheets
      googleSheets.updateOrderStatus(order.orderId, 'cancelled', 'pending').catch(err =>
        logger.error('Google Sheets sync error:', err)
      );
      
      // Build order details message
      let itemsList = '';
      if (order.items && order.items.length > 0) {
        itemsList = order.items.map((item, i) => 
          `${i + 1}. *${item.name}*\n   Qty: ${item.quantity} × ₹${item.price} = ₹${item.price * item.quantity}`
        ).join('\n\n');
      }
      
      // Send WhatsApp notification to customer
      const message = `❌ *Order Cancelled*\n\n` +
        `📦 *Order ID:* ${order.orderId}\n` +
        `💰 *Total:* ₹${order.totalAmount}\n` +
        `🍽️ *Service:* ${order.serviceType}\n\n` +
        `━━━━━━━━━━━━━━━\n` +
        `📋 *Items:*\n${itemsList}\n\n` +
        `━━━━━━━━━━━━━━━\n` +
        `⚠️ *Reason:* Payment not received within 15 minutes.\n\n` +
        `If you still want to order, please start a new order by sending "hi".`;
      
      // Use payment_timeout_cancelled image, fallback to order_cancelled
      let cancelledImageUrl = await chatbotImagesService.getImageUrl('payment_timeout_cancelled');
      if (!cancelledImageUrl) {
        cancelledImageUrl = await chatbotImagesService.getImageUrl('order_cancelled');
      }
      
      if (cancelledImageUrl) {
        await whatsapp.sendImageWithButtons(order.customer.phone, cancelledImageUrl, message, [
          { id: 'place_order', text: 'New Order' },
          { id: 'help', text: 'Help' }
        ]);
      } else {
        await whatsapp.sendButtons(order.customer.phone, message, [
          { id: 'place_order', text: 'New Order' },
          { id: 'help', text: 'Help' }
        ]);
      }
      
      // Emit event for real-time updates
      const dataEvents = require('./eventEmitter');
      dataEvents.emit('orders');
      dataEvents.emit('dashboard');

      // Send push notification to admin — auto-cancelled
      try {
        const User = require('../models/User');
        const pushNotification = require('./pushNotification');
        
        const admins = await User.find({ pushToken: { $ne: null } });
        for (const admin of admins) {
          if (admin.pushToken) {
            await pushNotification.sendNotification(
              admin.pushToken,
              '⏰ Order Auto-Cancelled',
              `Order #${order.orderId} - ₹${order.totalAmount}\nPayment not received within 15 min`,
              { type: 'order_cancelled', orderId: order.orderId, screen: 'Orders' },
              'order-updates'
            );
          }
        }
      } catch (pushErr) {
        logger.error('Admin push error (auto-cancel)', { error: pushErr.message, orderId: order.orderId });
      }
      // Notify assigned delivery partner if order was assigned
      if (order.assignedTo) {
        try {
          const DeliveryBoy = require('../models/DeliveryBoy');
          const pushNotification = require('./pushNotification');
          
          const deliveryBoy = await DeliveryBoy.findById(order.assignedTo);
          if (deliveryBoy && deliveryBoy.pushToken) {
            await pushNotification.sendOrderCancelledNotification(deliveryBoy.pushToken, {
              orderId: order.orderId,
              totalAmount: order.totalAmount
            });
        logger.info('Delivery partner notified of auto-cancellation', {
          deliveryPartner: deliveryBoy.name,
          orderId: order.orderId
        });
          }
        } catch (pushErr) {
        logger.error('Delivery push error (auto-cancel)', { error: pushErr.message, orderId: order.orderId });
        }
      }
      logger.info('Order cancelled and customer notified', { orderId: order.orderId });
      return true;
    } catch (error) {
      logger.error('Error cancelling order', { orderId: order.orderId, error: error.message, stack: error.stack });
      return false;
    }
  },

  // Start the scheduler (runs every minute)
  start() {
    logger.info('Order scheduler started', { checkIntervalSec: 60 });
    
    // Run immediately on start
    const ctx = initContext(null, { source: 'scheduler', job: 'orderScheduler' });
    runWithContext(ctx, () => this.cancelExpiredOrders());
    
    // Then run every minute
    setInterval(() => {
      const ctx = initContext(null, { source: 'scheduler', job: 'orderScheduler' });
      runWithContext(ctx, () => this.cancelExpiredOrders());
    }, 60 * 1000); // Every 1 minute
  }
};

module.exports = orderScheduler;
