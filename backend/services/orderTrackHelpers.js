/**
 * Order Track Helpers
 * --------------------
 * Sends a status-aware "Order Update" WhatsApp message for an order, with the
 * appropriate banner image and a CTA URL button:
 *   - delivery orders → "Track Your Order 📍" → frontend /track/<orderId>
 *   - pickup   orders → "📍 Navigate to Hotel" → Google Maps URL (from Settings)
 *
 * Used by:
 *   - The Welcome Flow's "Track Order" screen webhook handler (routes/webhook.js)
 *   - Anywhere else we want to deliver the same status-aware tracking card
 */

const logger = require('./logger');
const whatsapp = require('./whatsapp');
const chatbotImagesService = require('./chatbotImages');
const Settings = require('../models/Settings');

/* ─── Status → user-friendly text/emoji ─── */
const DELIVERY_STATUS_TEXT = {
  pending: '⏳ Your order is pending confirmation.',
  confirmed: '✅ Your order has been confirmed!',
  preparing: '👨‍🍳 Your order is being prepared!',
  ready: '📦 Your order is ready!',
  out_for_delivery: '🛵 Your order is on the way!'
};

const PICKUP_STATUS_TEXT = {
  pending: '⏳ Your pickup order is pending confirmation.',
  confirmed: '✅ Your pickup order has been confirmed!',
  preparing: '👨‍🍳 Your pickup order is being prepared!',
  ready: '📦 Your order is ready for pickup!\n\n🏪 Please come to the restaurant to collect it.'
};

/* ─── Status → which banner image to show ─── */
const DELIVERY_STATUS_IMAGE_KEY = {
  pending: 'preparing',
  confirmed: 'preparing',
  preparing: 'preparing',
  ready: 'ready',
  out_for_delivery: 'out_for_delivery'
};

const PICKUP_STATUS_IMAGE_KEY = {
  pending: 'pickup_confirmed',
  confirmed: 'pickup_confirmed',
  preparing: 'preparing',
  ready: 'pickup_ready'
};

/**
 * Resolve the configured Google Maps navigation URL for self-pickup orders.
 * Falls back to null if the restaurant location is not configured.
 */
async function getGoogleMapsNavigationUrl() {
  try {
    const restaurantLocation = await Settings.getValue('restaurantLocation');
    if (restaurantLocation?.latitude && restaurantLocation?.longitude) {
      return `https://www.google.com/maps/dir/?api=1&destination=${restaurantLocation.latitude},${restaurantLocation.longitude}&travelmode=driving`;
    }
  } catch (err) {
    logger.warn('getGoogleMapsNavigationUrl failed', { error: err.message });
  }
  return null;
}

/**
 * Send the "Order Update" message for a given order.
 *
 * Mirrors the look from `routes/order.js` admin status-update flow so the user
 * sees a consistent card whether the update was triggered by an admin or by the
 * customer tapping "Track Order" in the Welcome Flow.
 *
 * @param {object} order - Hydrated Order document or lean object. Must include:
 *                         orderId, status, serviceType, customer.phone
 * @returns {Promise<{ ok: true, status: string }|{ ok: false, reason: string }>}
 */
async function sendOrderTrackMessage(order) {
  if (!order || !order.customer?.phone) {
    return { ok: false, reason: 'invalid_order' };
  }

  const isPickup = order.serviceType === 'pickup';
  const phone = order.customer.phone;

  // Body text — bold "Order Update" header + order id + status line
  const statusLine = isPickup
    ? PICKUP_STATUS_TEXT[order.status] || `Status: ${order.status}`
    : DELIVERY_STATUS_TEXT[order.status] || `Status: ${order.status}`;

  const message = `*Order Update*\n\nOrder: ${order.orderId}\n${statusLine}`;

  // Banner image (admin-uploaded chatbot image)
  const imageKey = isPickup
    ? PICKUP_STATUS_IMAGE_KEY[order.status]
    : DELIVERY_STATUS_IMAGE_KEY[order.status];
  const imageUrl = imageKey ? await chatbotImagesService.getImageUrl(imageKey) : null;

  // CTA button — different for delivery vs pickup
  let buttonText;
  let url;
  let footer;

  if (isPickup) {
    const mapsUrl = await getGoogleMapsNavigationUrl();
    if (!mapsUrl) {
      // No restaurant location configured — fall back to plain message + image (no CTA)
      try {
        if (imageUrl) {
          await whatsapp.sendImageWithCtaUrl(
            phone,
            imageUrl,
            message + '\n\n_Restaurant location not configured. Please contact support for directions._',
            'Get Directions',
            'https://maps.google.com/',
            'Self-pickup order'
          );
        } else {
          await whatsapp.sendMessage(phone, message);
        }
      } catch (err) {
        logger.error('sendOrderTrackMessage pickup-no-maps fallback failed', {
          orderId: order.orderId, error: err.message
        });
        return { ok: false, reason: 'send_failed' };
      }
      return { ok: true, status: order.status };
    }
    buttonText = '📍 Navigate to Hotel';
    url = mapsUrl;
    footer = 'Get directions to pick up your order';
  } else {
    const frontendUrl = process.env.FRONTEND_URL || 'https://restarunt-bot.vercel.app';
    buttonText = 'Track Your Order 📍';
    url = `${frontendUrl}/track/${order.orderId}`;
    footer = 'Tap to track your order';
  }

  try {
    if (imageUrl) {
      await whatsapp.sendImageWithCtaUrl(phone, imageUrl, message, buttonText, url, footer);
    } else {
      await whatsapp.sendCtaUrl(phone, message, buttonText, url, footer);
    }
    logger.info('Order track message sent', {
      orderId: order.orderId,
      status: order.status,
      serviceType: order.serviceType
    });
    return { ok: true, status: order.status };
  } catch (err) {
    logger.error('sendOrderTrackMessage failed', {
      orderId: order.orderId,
      status: order.status,
      error: err.message
    });
    return { ok: false, reason: 'send_failed' };
  }
}

module.exports = {
  sendOrderTrackMessage,
  getGoogleMapsNavigationUrl,
  DELIVERY_STATUS_TEXT,
  PICKUP_STATUS_TEXT
};
