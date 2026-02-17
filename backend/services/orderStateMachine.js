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
  CANCELLED: 'cancelled',
  REFUNDED: 'refunded',
  REFUND_FAILED: 'refund_failed'
};

// Allowed transitions: { fromStatus: [allowedNextStatuses] }
const ALLOWED_TRANSITIONS = {
  [ORDER_STATUS.PENDING]:          [ORDER_STATUS.CONFIRMED, ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.CONFIRMED]:        [ORDER_STATUS.PREPARING, ORDER_STATUS.READY, ORDER_STATUS.CANCELLED, ORDER_STATUS.REFUNDED, ORDER_STATUS.REFUND_FAILED],
  [ORDER_STATUS.PREPARING]:        [ORDER_STATUS.READY, ORDER_STATUS.CANCELLED, ORDER_STATUS.REFUNDED, ORDER_STATUS.REFUND_FAILED],
  [ORDER_STATUS.READY]:            [ORDER_STATUS.OUT_FOR_DELIVERY, ORDER_STATUS.DELIVERED, ORDER_STATUS.CANCELLED, ORDER_STATUS.REFUNDED, ORDER_STATUS.REFUND_FAILED],
  [ORDER_STATUS.OUT_FOR_DELIVERY]: [ORDER_STATUS.DELIVERED, ORDER_STATUS.CANCELLED, ORDER_STATUS.REFUNDED, ORDER_STATUS.REFUND_FAILED],
  [ORDER_STATUS.DELIVERED]:        [ORDER_STATUS.REFUNDED, ORDER_STATUS.REFUND_FAILED],
  [ORDER_STATUS.CANCELLED]:        [ORDER_STATUS.REFUNDED, ORDER_STATUS.REFUND_FAILED],
  [ORDER_STATUS.REFUNDED]:         [],  // Terminal state
  [ORDER_STATUS.REFUND_FAILED]:    [ORDER_STATUS.REFUNDED, ORDER_STATUS.CANCELLED]
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
 * @returns {{ success: boolean, reason?: string }}
 */
function transitionStatus(order, newStatus, trackingMessage) {
  const result = validateTransition(order.status, newStatus);

  if (!result.valid) {
    logger.warn('⚠️ Invalid order status transition', {
      orderId: order.orderId,
      from: order.status,
      to: newStatus,
      reason: result.reason
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
    to: newStatus
  });

  return { success: true };
}

module.exports = {
  ORDER_STATUS,
  ALLOWED_TRANSITIONS,
  validateTransition,
  transitionStatus
};
