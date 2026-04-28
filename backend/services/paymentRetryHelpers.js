/**
 * Payment Retry Helpers
 * ----------------------
 * Sends the "Payment Failed — Try Again" message for an order that has just
 * failed online payment (WhatsApp UPI / Razorpay).
 *
 * The message replaces the legacy 3-button reply
 *   [ Retry UPI ] [ Pay COD / Pay at Hotel ] [ Main Menu ]
 * with a single "Try Again" CTA button that opens a dedicated WhatsApp Flow
 * (`JRB Payment Retry v1`). Inside the Flow the user picks one of two
 * visual options (RadioButtonsGroup with images):
 *   - Retry UPI (always present)
 *   - Pay COD       (delivery orders)
 *   - Pay at Hotel  (pickup orders)
 *
 * On submit the Flow ends with an nfm_reply containing
 *   { selected_option, order_id, flow_token }
 * which `routes/webhook.js` then routes to the appropriate handler.
 *
 * If the Flow ID is not configured (env var missing), this helper falls back
 * to the legacy 3-button reply so the user is never stuck.
 *
 * Used by:
 *   - routes/webhook.js (WhatsApp UPI status webhook → failure path)
 *   - services/domains/paymentCompletionHandler.js (Razorpay failure path)
 */

const logger = require('./logger');
const whatsapp = require('./whatsapp');
const metaCloud = require('./metaCloud');
const catalogService = require('./catalogService');
const chatbotImagesService = require('./chatbotImages');

/**
 * Send the "Try Again" Flow CTA (or the legacy fallback) for a failed-payment
 * order.
 *
 * @param {object} order - Hydrated Order document or lean object. Must include:
 *                         orderId, totalAmount, serviceType, customer.phone
 * @param {object} [opts]
 * @param {'failed'|'cancelled'} [opts.reason='failed'] - Used in body copy.
 * @returns {Promise<{ ok: boolean, sentVia?: 'flow'|'buttons', reason?: string }>}
 */
async function sendPaymentRetryMessage(order, opts = {}) {
  if (!order || !order.customer?.phone || !order.orderId) {
    return { ok: false, reason: 'invalid_order' };
  }

  const phone = order.customer.phone;
  const isPickup = order.serviceType === 'pickup';
  const reason = opts.reason === 'cancelled' ? 'Cancelled' : 'Failed';

  const headline = `❌ *Payment ${reason}*`;
  const body =
    `${headline}\n\n` +
    `Order #${order.orderId}\n\n` +
    `Please tap *Try Again* to retry payment or switch to ` +
    `${isPickup ? 'pay-at-hotel' : 'cash on delivery'}.`;

  const payFailImg = await chatbotImagesService.getImageUrl('payment_failed');
  const flowId = catalogService.getPaymentRetryFlowId();

  // Prefer the Flow CTA if configured.
  if (flowId) {
    try {
      const cleanPhone = phone.replace('@c.us', '').replace(/\D/g, '');
      const flowToken = `payment_retry_${cleanPhone}_${order.orderId}`;
      await metaCloud.sendFlowMessage(phone, {
        flowId,
        flowCta: 'Try Again',
        headerImageUrl: payFailImg || undefined,
        headerText: payFailImg ? undefined : 'Payment Failed',
        bodyText: body,
        flowToken,
        flowAction: 'data_exchange'
      });
      logger.info('Payment retry flow sent', {
        orderId: order.orderId,
        serviceType: order.serviceType,
        reason
      });
      return { ok: true, sentVia: 'flow' };
    } catch (flowErr) {
      logger.warn('Payment retry flow send failed, falling back to buttons', {
        orderId: order.orderId,
        error: flowErr.response?.data?.error?.message || flowErr.message
      });
      // Fall through to button fallback.
    }
  }

  // Fallback — legacy 3-button reply (still better than nothing if Flow ID is
  // missing or sendFlowMessage threw). For pickup orders we now show
  // "Pay at Hotel" instead of "Pay COD".
  const buttons = isPickup
    ? [
        { id: 'retry_payment', text: 'Retry UPI' },
        { id: 'pickup_pay_hotel', text: 'Pay at Hotel' },
        { id: 'home', text: 'Main Menu' }
      ]
    : [
        { id: 'retry_payment', text: 'Retry UPI' },
        { id: 'pay_cod', text: 'Pay COD' },
        { id: 'home', text: 'Main Menu' }
      ];

  try {
    if (payFailImg) {
      await whatsapp.sendImageWithButtons(phone, payFailImg, body, buttons);
    } else {
      await whatsapp.sendButtons(phone, body, buttons);
    }
    logger.info('Payment retry buttons sent (fallback)', {
      orderId: order.orderId,
      serviceType: order.serviceType
    });
    return { ok: true, sentVia: 'buttons' };
  } catch (err) {
    logger.error('sendPaymentRetryMessage failed', {
      orderId: order.orderId,
      error: err.message
    });
    return { ok: false, reason: 'send_failed' };
  }
}

/**
 * Re-send the WhatsApp Native Payment "Review and Pay" message for an
 * existing failed-payment order. Triggered when the user picks "Retry UPI"
 * inside the Payment Retry Flow.
 *
 * Mirrors the native-payment block in `chatbot.processCheckout`, but builds
 * the items array from `order.items` instead of the cart (which has been
 * cleared at this point).
 *
 * @param {object} order - Order document or lean object with items + totals
 * @returns {Promise<{ ok: boolean, reason?: string }>}
 */
async function resendNativePayment(order) {
  if (!order || !order.customer?.phone || !order.orderId) {
    return { ok: false, reason: 'invalid_order' };
  }

  const phone = order.customer.phone;
  const paymentConfig = process.env.WHATSAPP_PAYMENT_CONFIG || process.env.RAZORPAY_CONFIG_ID;
  if (!catalogService.isEnabled() || !paymentConfig) {
    logger.warn('Payment retry — native payment unavailable', {
      orderId: order.orderId,
      catalogEnabled: catalogService.isEnabled(),
      hasPaymentConfig: !!paymentConfig
    });
    return { ok: false, reason: 'native_payment_unavailable' };
  }

  try {
    // Build retailer_id for each order item. For variant items the catalog
    // product id has the form `${baseId}_v${variantIndex}`. The Order schema
    // does not persist quantityIndex, so quantity-tier retailers can't be
    // reconstructed here — fall back to the variant-level id which still
    // resolves to a valid catalog product.
    const baseIds = [...new Set(order.items.map(i => i.menuItem?.toString()).filter(Boolean))];
    const retailerMappings = await catalogService.getRetailerIds(baseIds);
    const retailerMap = new Map(retailerMappings.map(m => [m.menuItemId, m.retailerId]));

    if (retailerMappings.length !== baseIds.length) {
      logger.warn('Payment retry — not all items have catalog mappings', {
        orderId: order.orderId,
        mapped: retailerMappings.length,
        total: baseIds.length
      });
      return { ok: false, reason: 'catalog_mapping_incomplete' };
    }

    const orderItems = order.items.map(item => {
      const baseId = item.menuItem?.toString();
      let retailerId;
      if (item.variantIndex != null) {
        retailerId = `${baseId}_v${item.variantIndex}`;
      } else {
        retailerId = retailerMap.get(baseId) || baseId;
      }
      return {
        retailerId,
        name: item.name,
        imageUrl: item.image || null,
        priceAmount: item.originalPrice || item.price,
        saleAmount: item.originalPrice && item.price !== item.originalPrice ? item.price : undefined,
        quantity: item.quantity
      };
    });

    const orderDetailsImg = await chatbotImagesService.getImageUrl('order_details');
    await whatsapp.sendOrderDetails(phone, order.orderId, orderItems, order.totalAmount, {
      tax: 0,
      shipping: order.deliveryCharge || 0,
      discount: order.totalDiscount || 0,
      headerImageUrl: orderDetailsImg || null
    });

    logger.info('Payment retry — native payment re-sent', {
      orderId: order.orderId,
      total: order.totalAmount
    });
    return { ok: true };
  } catch (err) {
    logger.error('Payment retry — resendNativePayment failed', {
      orderId: order.orderId,
      error: err.response?.data || err.message
    });
    return { ok: false, reason: 'send_failed' };
  }
}

/**
 * Switch a failed-payment order from online (UPI) to cash payment.
 *
 * - Sets `paymentMethod = 'cod'`
 * - Resets `paymentStatus = 'pending'`
 * - Pushes a tracking update
 * - Sends a confirmation card (delivery → "Cash on Delivery";
 *   pickup → "Pay at Hotel") with an Order Details Flow CTA so the customer
 *   can immediately track or get help.
 *
 * @param {object} order - Hydrated Order document (NOT lean — must support .save())
 * @returns {Promise<{ ok: boolean, reason?: string }>}
 */
async function convertToCashPayment(order) {
  if (!order || !order.customer?.phone || !order.orderId) {
    return { ok: false, reason: 'invalid_order' };
  }

  const phone = order.customer.phone;
  const isPickup = order.serviceType === 'pickup';

  try {
    order.paymentMethod = 'cod';
    order.paymentStatus = 'pending';
    order.trackingUpdates = order.trackingUpdates || [];
    order.trackingUpdates.push({
      status: 'payment_method_changed',
      message: isPickup
        ? 'Switched to pay-at-hotel after failed online payment'
        : 'Switched to Cash on Delivery after failed online payment',
      timestamp: new Date()
    });
    await order.save();

    // Notify dashboards (admin) and Google Sheets that the payment method
    // changed — fire-and-forget.
    try {
      const dataEvents = require('./eventEmitter');
      dataEvents.emit('orders');
      dataEvents.emit('dashboard');
    } catch (_) { /* non-fatal */ }
    try {
      const googleSheets = require('./googleSheets');
      googleSheets.addOrder(order).catch(() => {});
    } catch (_) { /* non-fatal */ }

    // Build the confirmation message
    const heading = isPickup
      ? '🏪 *Pay at Hotel — Confirmed*'
      : '💵 *Cash on Delivery — Confirmed*';
    const tail = isPickup
      ? `Please pay ₹${order.totalAmount} when you collect your order from the restaurant.`
      : `Please pay ₹${order.totalAmount} in cash to our delivery partner when your order arrives.`;

    const body =
      `${heading}\n\n` +
      `Order #${order.orderId}\n` +
      `Total: ₹${order.totalAmount}\n\n` +
      `${tail}`;

    // Try the Order Actions Flow CTA so the customer gets the same
    // "Order Details / Help" experience as a fresh COD order.
    const orderActionsFlowId = process.env.WHATSAPP_ORDER_ACTIONS_FLOW_ID;
    const confirmedImg = await chatbotImagesService.getImageUrl(
      isPickup ? 'pickup_order_requested' : 'order_confirmed'
    );

    if (orderActionsFlowId) {
      try {
        const cleanPhone = phone.replace('@c.us', '').replace(/\D/g, '');
        await metaCloud.sendFlowMessage(phone, {
          flowId: orderActionsFlowId,
          flowCta: 'Order Details',
          headerImageUrl: confirmedImg || undefined,
          headerText: confirmedImg ? undefined : 'Order Confirmed',
          bodyText: body,
          flowToken: `order_actions_${cleanPhone}_${order.orderId}`,
          flowAction: 'data_exchange'
        });
        logger.info('Payment retry — cash confirmation flow sent', {
          orderId: order.orderId,
          serviceType: order.serviceType
        });
        return { ok: true };
      } catch (flowErr) {
        logger.warn('Payment retry — cash confirmation flow failed, falling back', {
          orderId: order.orderId,
          error: flowErr.response?.data?.error?.message || flowErr.message
        });
      }
    }

    // Fallback — image + buttons
    const buttons = [
      { id: 'track_order', text: 'Track Order' },
      { id: 'home', text: 'Main Menu' }
    ];
    if (confirmedImg) {
      await whatsapp.sendImageWithButtons(phone, confirmedImg, body, buttons);
    } else {
      await whatsapp.sendButtons(phone, body, buttons);
    }
    logger.info('Payment retry — cash confirmation buttons sent (fallback)', {
      orderId: order.orderId, serviceType: order.serviceType
    });
    return { ok: true };
  } catch (err) {
    logger.error('Payment retry — convertToCashPayment failed', {
      orderId: order?.orderId,
      error: err.message
    });
    return { ok: false, reason: 'convert_failed' };
  }
}

module.exports = {
  sendPaymentRetryMessage,
  resendNativePayment,
  convertToCashPayment
};
