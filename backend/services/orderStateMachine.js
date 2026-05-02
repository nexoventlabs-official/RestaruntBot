/**
 * Order State Machine
 * 
 * Centralizes all order status transitions with validation.
 * Every status change MUST go through this module.
 * 
 * Prevents invalid transitions (e.g., delivered → pending).
 */

const logger = require('./logger');

// Canonical order statuses
const ORDER_STATUS = {
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  PREPARING: 'preparing',
  READY: 'ready',
  OUT_FOR_DELIVERY: 'out_for_delivery',
  DELIVERED: 'delivered',
  CANCELLED: 'cancelled'
};

// Allowed transitions: { fromStatus: [allowedNextStatuses] }
const ALLOWED_TRANSITIONS = {
  [ORDER_STATUS.PENDING]:          [ORDER_STATUS.CONFIRMED, ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.CONFIRMED]:        [ORDER_STATUS.PREPARING, ORDER_STATUS.READY, ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.PREPARING]:        [ORDER_STATUS.READY, ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.READY]:            [ORDER_STATUS.OUT_FOR_DELIVERY, ORDER_STATUS.DELIVERED, ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.OUT_FOR_DELIVERY]: [ORDER_STATUS.DELIVERED, ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.DELIVERED]:        [],  // Terminal state
  [ORDER_STATUS.CANCELLED]:        []   // Terminal state
};

/**
 * Validate whether a status transition is allowed.
 * @param {string} currentStatus
 * @param {string} newStatus
 * @returns {{ valid: boolean, reason?: string }}
 */
function validateTransition(currentStatus, newStatus) {
  if (!Object.values(ORDER_STATUS).includes(newStatus)) {
    return { valid: false, reason: `Invalid target status: ${newStatus}` };
  }

  if (currentStatus === newStatus) {
    return { valid: true };  // No-op, allow same-status for idempotency
  }

  const allowed = ALLOWED_TRANSITIONS[currentStatus];
  if (!allowed) {
    return { valid: false, reason: `Unknown current status: ${currentStatus}` };
  }

  if (!allowed.includes(newStatus)) {
    return { valid: false, reason: `Transition from '${currentStatus}' to '${newStatus}' is not allowed. Allowed: [${allowed.join(', ')}]` };
  }

  return { valid: true };
}

/**
 * Transition an order's status with validation.
 * Mutates the order object (caller must save).
 * 
 * @param {Object} order - Mongoose order document
 * @param {string} newStatus - Target status
 * @param {string} [trackingMessage] - Optional tracking update message
 * @param {string} [triggeredBy='system'] - Who triggered the transition (admin, customer, scheduler, webhook)
 * @returns {{ success: boolean, reason?: string }}
 */
function transitionStatus(order, newStatus, trackingMessage, triggeredBy = 'system') {
  const result = validateTransition(order.status, newStatus);

  if (!result.valid) {
    logger.warn('Invalid order status transition', {
      orderId: order.orderId,
      from: order.status,
      to: newStatus,
      reason: result.reason,
      triggeredBy
    });
    return { success: false, reason: result.reason };
  }

  const previousStatus = order.status;
  order.status = newStatus;
  order.statusUpdatedAt = new Date();

  if (trackingMessage) {
    order.trackingUpdates.push({
      status: newStatus,
      message: trackingMessage,
      timestamp: new Date()
    });
  }

  logger.info('Order status transitioned', {
    orderId: order.orderId,
    from: previousStatus,
    to: newStatus,
    triggeredBy
  });

  return { success: true };
}

/**
 * Decide whether the customer can still cancel an order from WhatsApp.
 *
 * Rules (per product):
 *   • Self-pickup (any payment): cancel allowed up to & including
 *     `confirmed`. Once the kitchen starts preparing it, cancel is hidden.
 *   • Delivery + COD / Pay-at-Hotel: cancel allowed up to but NOT including
 *     `ready`. Once the order is ready/out_for_delivery the customer must
 *     contact us to cancel (food has already been packed for the rider).
 *   • Delivery + paid online (UPI / WhatsApp Pay): only `pending` — once
 *     the kitchen accepts (confirmed) we keep the customer on the
 *     contact-us path because a refund needs to be initiated manually.
 *   • Terminal states (`delivered`, `cancelled`) and `out_for_delivery`
 *     are never cancellable from the flow.
 *
 * Centralised here so the WhatsApp flow endpoint, the webhook My-Orders
 * handler, and any other call site stay in sync.
 *
 * @param {Object} order  Order document or lean object
 * @returns {boolean}
 */
function canCancelOrder(order) {
  if (!order) return false;
  const status = order.status;
  if (['delivered', 'cancelled', 'out_for_delivery'].includes(status)) return false;

  const isPickup = order.serviceType === 'pickup';
  const isCOD = order.paymentMethod === 'cod';

  if (isPickup) {
    // Pickup: pending or confirmed only.
    return status === ORDER_STATUS.PENDING || status === ORDER_STATUS.CONFIRMED;
  }
  // Delivery
  if (isCOD) {
    // Delivery + COD: pending, confirmed or preparing. Hidden once ready.
    return [ORDER_STATUS.PENDING, ORDER_STATUS.CONFIRMED, ORDER_STATUS.PREPARING].includes(status);
  }
  // Delivery + paid online: pending only (refund involved past that).
  return status === ORDER_STATUS.PENDING;
}

module.exports = {
  ORDER_STATUS,
  ALLOWED_TRANSITIONS,
  validateTransition,
  transitionStatus,
  canCancelOrder
};
