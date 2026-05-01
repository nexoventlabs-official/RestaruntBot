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
const metaCloud = require('./metaCloud');
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
        // Build confirmation message — mirrors the real-time WhatsApp Pay
        // confirmation in routes/webhook.js and the COD/Pay-at-Hotel
        // confirmations in services/chatbot.js so the customer sees a
        // consistent rich card with one "Order Details" CTA, regardless
        // of payment method or whether the message is real-time or a
        // delayed reconciliation re-send.
        const isPickup = order.serviceType === 'pickup';
        const serviceLabel = isPickup ? 'Self-Pickup' : 'Home Delivery';
        const paymentLabel = order.paymentMethod === 'cod'
          ? (isPickup ? 'Pay at Hotel' : 'Cash on Delivery')
          : 'Paid';
        let msg = '✅ *Order Confirmed!*\n\n';
        msg += `📦 *Order ID:* ${order.orderId}\n`;
        msg += `💰 *Total:* ₹${order.totalAmount}\n`;
        msg += `🍽️ *Service:* ${serviceLabel}\n`;
        msg += `💳 *Payment:* ${paymentLabel}\n\n`;
        msg += `🙏 Your order is being prepared!\n`;
        msg += `_(This is a delayed confirmation — apologies for the wait!)_\n\n`;
        msg += `Tap *Order Details* below to view items,\ntrack your order or contact us.`;

        const imageUrl = await chatbotImagesService.getImageUrl('order_confirmed');
        const orderActionsFlowId = process.env.WHATSAPP_ORDER_ACTIONS_FLOW_ID;
        const cleanPhone = String(order.customer.phone || '').replace(/\D/g, '');
        let sent = false;

        // Preferred path: rich card with single "Order Details" CTA that
        // opens the Order Actions flow (same as the real-time confirms).
        // The Track Order / Help quick-reply buttons that used to live
        // here were removed per product request — both actions are
        // available inside the flow.
        if (orderActionsFlowId) {
          try {
            await metaCloud.sendFlowMessage(order.customer.phone, {
              flowId: orderActionsFlowId,
              flowCta: 'Order Details',
              headerImageUrl: imageUrl || undefined,
              headerText: imageUrl ? undefined : 'Order Confirmed',
              bodyText: msg,
              flowToken: `order_actions_${cleanPhone}_${order.orderId}`,
              flowAction: 'data_exchange'
            });
            sent = true;
          } catch (flowErr) {
            logger.warn('[Reconciliation] Order actions flow failed, falling back', {
              orderId: order.orderId,
              error: flowErr.message
            });
          }
        }

        // Fallback (no flow configured, or flow send failed): plain
        // image+text message — still no Track Order / Help buttons.
        if (!sent) {
          try {
            if (imageUrl) {
              await whatsapp.sendImage(order.customer.phone, imageUrl, msg);
            } else {
              await whatsapp.sendMessage(order.customer.phone, msg);
            }
          } catch (whatsappErr) {
            logger.error('[Reconciliation] WhatsApp re-send failed', {
              orderId: order.orderId,
              error: whatsappErr.message
            });
            continue; // Skip this order, will retry next cycle
          }
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
