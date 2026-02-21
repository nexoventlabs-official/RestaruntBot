/**
 * Order Reconciliation Scheduler
 * 
 * Purpose: Catch orders that were confirmed/paid but never got WhatsApp confirmation
 * due to crashes, network failures, or process restarts.
 * 
 * Runs every 5 minutes:
 * 1. Finds orders with paymentStatus='paid' AND whatsappConfirmationSent=false
 *    that are older than 2 minutes (gives normal flow time to complete)
 * 2. Re-sends WhatsApp confirmation to the customer
 * 3. Updates customer stats if they were missed
 * 
 * Also catches COD orders (status='confirmed') that were never notified.
 */

const cron = require('node-cron');
const Order = require('../models/Order');
const Customer = require('../models/Customer');
const whatsapp = require('./whatsapp');
const chatbotImagesService = require('./chatbotImages');
const logger = require('./logger');
const { initContext, runWithContext } = require('./correlationContext');

let schedulerTask = null;

/**
 * Find and reconcile unnotified orders
 */
async function reconcileOrders() {
  try {
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    // Find confirmed/paid orders where WhatsApp confirmation was never sent
    // Only look at orders between 2 min and 1 hour old (avoid spamming old orders)
    const unnotifiedOrders = await Order.find({
      whatsappConfirmationSent: { $ne: true },
      createdAt: { $lt: twoMinutesAgo, $gt: oneHourAgo },
      status: { $in: ['confirmed', 'preparing', 'ready', 'out_for_delivery', 'delivered'] },
      $or: [
        { paymentStatus: 'paid' },
        { paymentMethod: 'cod', status: 'confirmed' }
      ]
    }).limit(20);

    if (unnotifiedOrders.length === 0) return { reconciled: 0 };

    logger.info('[Reconciliation] Found unnotified orders', { length : unnotifiedOrders.length });

    let reconciled = 0;
    for (const order of unnotifiedOrders) {
      try {
        // Build confirmation message
        let msg = '✅ *Order Confirmed!*\n\n';
        msg += `📦 *Order ID:* ${order.orderId}\n`;
        msg += `💰 *Total:* ₹${order.totalAmount}\n`;
        msg += `🍽️ *Service:* ${order.serviceType}\n`;
        msg += `💳 *Payment:* ${order.paymentMethod === 'cod' ? 'Cash on Delivery' : 'Paid'}\n\n`;
        msg += `🙏 Your order is being prepared!\n`;
        msg += `_(This is a delayed confirmation — apologies for the wait!)_`;

        const imageUrl = await chatbotImagesService.getImageUrl('order_confirmed');

        try {
          if (imageUrl) {
            await whatsapp.sendImageWithButtons(order.customer.phone, imageUrl, msg, [
              { id: 'track_order', text: 'Track Order' },
              { id: 'help', text: 'Help' }
            ]);
          } else {
            await whatsapp.sendButtons(order.customer.phone, msg, [
              { id: 'track_order', text: 'Track Order' },
              { id: 'help', text: 'Help' }
            ]);
          }
        } catch (whatsappErr) {
          logger.error('[Reconciliation] WhatsApp re-send failed', {
            orderId: order.orderId,
            error: whatsappErr.message
          });
          continue; // Skip this order, will retry next cycle
        }

        // Mark as notified
        order.whatsappConfirmationSent = true;
        await order.save();

        // Ensure customer stats are correct
        const customer = await Customer.findOne({ phone: order.customer.phone });
        if (customer && order.paymentStatus === 'paid') {
          // Check if this order is already counted by looking at orderHistory
          const alreadyCounted = customer.orderHistory?.some(
            id => id.toString() === order._id.toString()
          );
          if (!alreadyCounted) {
            customer.totalOrders = (customer.totalOrders || 0) + 1;
            customer.totalSpent = (customer.totalSpent || 0) + order.totalAmount;
            customer.orderHistory = customer.orderHistory || [];
            customer.orderHistory.push(order._id);
            await customer.save();
            logger.info('[Reconciliation] Customer stats updated', {
              orderId: order.orderId,
              phone: order.customer.phone
            });
          }
        }

        reconciled++;
        logger.info('[Reconciliation] Order re-notified successfully', { orderId : order.orderId });
      } catch (orderErr) {
        logger.error('[Reconciliation] Error processing order', {
          orderId: order.orderId,
          error: orderErr.message,
          stack: orderErr.stack
        });
      }
    }

    return { reconciled, total: unnotifiedOrders.length };
  } catch (error) {
    logger.error('[Reconciliation] Fatal error', { error: error.message, stack: error.stack });
    return { reconciled: 0, error: error.message };
  }
}

/**
 * Start the reconciliation scheduler
 */
function start() {
  if (schedulerTask) {
    logger.info('[Reconciliation] Already running');
    return;
  }

  // Run every 5 minutes
  schedulerTask = cron.schedule('*/5 * * * *', async () => {
    const ctx = initContext(null, { source: 'scheduler', job: 'orderReconciliation' });
    await runWithContext(ctx, async () => {
      const result = await reconcileOrders();
      if (result.reconciled > 0) {
        logger.info('[Reconciliation] Completed', { reconciled: result.reconciled, total: result.total });
      }
    });
  });

  logger.info('[Reconciliation] Started — running every 5 minutes');
}

/**
 * Stop the reconciliation scheduler
 */
function stop() {
  if (schedulerTask) {
    schedulerTask.stop();
    schedulerTask = null;
    logger.info('[Reconciliation] Stopped');
  }
}

module.exports = {
  start,
  stop,
  reconcileOrders // Exported for testing
};
