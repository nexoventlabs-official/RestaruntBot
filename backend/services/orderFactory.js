/**
 * Order Factory — shared order data builder
 *
 * Centralises the Order constructor payload so that processCODOrder,
 * processCheckout, and processPickupCheckout all produce a consistent
 * document shape.  Each caller still handles its own post-save actions.
 *
 * Usage:
 *   const data = orderFactory.buildOrderData({ ... });
 *   const order = new Order(data);
 *   await order.save();
 */
const { v4: uuidv4 } = require('uuid');

/**
 * Build a normalised Order constructor payload.
 *
 * @param {Object} opts
 * @param {string}  opts.orderId           – e.g. 'ORD-xxxx'
 * @param {Object}  opts.customer          – { phone, name, email }
 * @param {Array}   opts.items             – line-item array
 * @param {number}  opts.itemsTotal        – sum of item prices
 * @param {number}  [opts.deliveryCharge=0]
 * @param {number|null} [opts.deliveryDistance=null]
 * @param {number}  opts.totalAmount
 * @param {number}  [opts.discountAmount=0]
 * @param {string[]} [opts.appliedOfferIds=[]]
 * @param {string}  opts.serviceType       – 'delivery' | 'pickup'
 * @param {Object|null} opts.deliveryAddress – { address, latitude?, longitude? }
 * @param {string}  opts.paymentMethod     – 'cod' | 'online' | etc.
 * @param {string}  [opts.paymentStatus]   – 'pending' | 'paid' …
 * @param {string}  [opts.status]          – initial order status
 * @param {Array}   [opts.trackingUpdates] – initial tracking entries
 * @returns {Object} plain object ready for `new Order(data)`
 */
function buildOrderData({
  orderId,
  customer,
  items,
  itemsTotal = 0,
  deliveryCharge = 0,
  deliveryDistance = null,
  totalAmount,
  discountAmount = 0,
  appliedOfferIds = [],
  serviceType = 'delivery',
  deliveryAddress = null,
  paymentMethod,
  paymentStatus,
  status,
  trackingUpdates
}) {
  const data = {
    orderId,
    customer: {
      phone: customer.phone,
      name: customer.name || 'Customer',
      email: customer.email
    },
    items,
    itemsTotal,
    deliveryCharge,
    deliveryDistance,
    totalAmount,
    discountAmount,
    appliedOfferIds: Array.isArray(appliedOfferIds) ? appliedOfferIds : Array.from(appliedOfferIds),
    serviceType,
    deliveryAddress,
    paymentMethod
  };

  if (paymentStatus !== undefined) data.paymentStatus = paymentStatus;
  if (status !== undefined) data.status = status;
  if (trackingUpdates) data.trackingUpdates = trackingUpdates;

  return data;
}

module.exports = { buildOrderData };
