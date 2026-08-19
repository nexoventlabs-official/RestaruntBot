// services/ownerNotify.js
// SYNHA — Loop 3: Owner notification on order completion.
//
// Sends a WhatsApp message to config.ownerPhone the moment an order is
// completed (COD confirmed / pickup placed / online payment received).
//
// Guarantees:
//   - Non-blocking: never throws. A notification failure must NOT block
//     order completion (the caller does not await a rejection).
//   - Idempotent: de-duplicates by orderId within the process lifetime so
//     that hooking several completion paths never double-notifies an owner.
//   - Config-driven: message body comes from config.ownerNotifyTemplate.
//   - No new dependencies: reuses the existing metaCloud text sender.

const metaCloud = require('./metaCloud');
const logger = require('./logger');

const DEFAULT_TEMPLATE =
  '🔔 New Order — {reference}\n\n' +
  'Customer: {customerName} ({customerPhone})\n' +
  'Items: {items}\n' +
  'Total: ₹{total}\n' +
  'Type: {type}\n' +
  'Time: {time}';

// Process-lifetime dedupe of owner notifications, keyed by orderId.
const _notified = new Set();
const _clear = setInterval(() => _notified.clear(), 60 * 60 * 1000);
if (typeof _clear.unref === 'function') _clear.unref();

function _serviceLabel(serviceType) {
  if (serviceType === 'pickup') return 'Self-Pickup';
  if (serviceType === 'delivery') return 'Home Delivery';
  if (serviceType === 'dine_in') return 'Dine-In';
  return serviceType || '';
}

function _itemsSummary(items) {
  if (!Array.isArray(items) || items.length === 0) return '—';
  return items
    .map((it) => {
      const label = it.variantLabel ? `${it.name} (${it.variantLabel})` : it.name;
      return `${label} x${it.quantity}`;
    })
    .join(', ');
}

/**
 * Build the owner message from the order document and config template.
 * @param {Object} order  - Mongoose Order document (or plain object)
 * @param {Object} config - restaurant.config
 * @returns {string}
 */
function buildOwnerMessage(order, config) {
  const template = (config && config.ownerNotifyTemplate) || DEFAULT_TEMPLATE;
  return template
    .replace(/{customerName}/g, order.customer?.name || 'Customer')
    .replace(/{customerPhone}/g, order.customer?.phone || '')
    .replace(/{items}/g, _itemsSummary(order.items))
    .replace(/{total}/g, order.totalAmount != null ? String(order.totalAmount) : '')
    .replace(/{type}/g, _serviceLabel(order.serviceType))
    .replace(/{reference}/g, order.orderId || '')
    .replace(/{time}/g, new Date().toLocaleString('en-IN'));
}

/**
 * Notify the business owner on WhatsApp. Fire-and-forget: callers should NOT
 * await this in a way that lets a rejection bubble up (it never rejects).
 * @param {Object} order  - Mongoose Order document (or plain object)
 * @param {Object} config - restaurant.config
 */
async function notifyOwner(order, config) {
  try {
    if (!order) return;
    const ownerPhone = config && config.ownerPhone;
    if (!ownerPhone) {
      logger.info('Owner notification skipped — ownerPhone not configured', { orderId: order.orderId });
      return;
    }
    const ref = order.orderId;
    if (ref) {
      if (_notified.has(ref)) return; // already notified this order
      _notified.add(ref);
    }
    const message = buildOwnerMessage(order, config);
    await metaCloud.sendMessage(ownerPhone, message);
    logger.info('Owner notification sent', { orderId: ref, ownerPhone });
  } catch (err) {
    // Never throw — order completion must never be blocked by this.
    logger.error('Owner notification failed', { error: err.message, orderId: order && order.orderId });
  }
}

module.exports = { notifyOwner, buildOwnerMessage };
