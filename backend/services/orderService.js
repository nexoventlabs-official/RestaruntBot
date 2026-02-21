/**
 * Order Service Layer
 *
 * Extracted from routes/order.js to separate business logic from HTTP handling.
 * Provides CRUD and status management for orders.
 *
 * This is a scaffold — routes/order.js still contains inline logic.
 * Migrate route handlers to call these service methods incrementally.
 */
const Order = require('../models/Order');
const Customer = require('../models/Customer');
const Settings = require('../models/Settings');
const DeliveryBoy = require('../models/DeliveryBoy');
const DashboardStats = require('../models/DashboardStats');
const User = require('../models/User');
const { transitionStatus, validateTransition } = require('./orderStateMachine');
const whatsapp = require('./whatsapp');
const googleSheets = require('./googleSheets');
const pushNotification = require('./pushNotification');
const brevoMail = require('./brevoMail');
const dataEvents = require('./eventEmitter');
const logger = require('./logger');

const orderService = {
  /**
   * Get paginated orders with optional filters
   */
  async getOrders({ page = 1, limit = 50, status, search } = {}) {
    const query = { isHidden: { $ne: true } };
    if (status) query.status = status;
    if (search) {
      query.$or = [
        { orderId: { $regex: search, $options: 'i' } },
        { 'customer.name': { $regex: search, $options: 'i' } },
        { 'customer.phone': { $regex: search, $options: 'i' } }
      ];
    }

    const [orders, total] = await Promise.all([
      Order.find(query).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
      Order.countDocuments(query)
    ]);

    return { orders, total, pages: Math.ceil(total / limit) };
  },

  /**
   * Update order status with state machine validation
   */
  async updateStatus(orderId, newStatus, { trackingMessage } = {}) {
    const order = await Order.findById(orderId);
    if (!order) throw new Error('Order not found');

    const result = transitionStatus(order, newStatus, trackingMessage);
    if (!result.success) {
      const err = new Error(result.reason || 'Invalid status transition');
      err.statusCode = 400;
      throw err;
    }

    await order.save();
    dataEvents.emit('orders');
    dataEvents.emit('dashboard');

    return order;
  },

  /**
   * Assign delivery partner to an order
   */
  async assignDeliveryPartner(orderId, deliveryBoyId) {
    const [order, deliveryBoy] = await Promise.all([
      Order.findById(orderId),
      DeliveryBoy.findById(deliveryBoyId)
    ]);

    if (!order) throw new Error('Order not found');
    if (!deliveryBoy) throw new Error('Delivery partner not found');
    if (!deliveryBoy.isActive) {
      const err = new Error('Delivery partner is not active');
      err.statusCode = 400;
      throw err;
    }

    order.assignedTo = deliveryBoy._id;
    order.deliveryPartnerName = deliveryBoy.name;
    order.assignedAt = new Date();
    order.trackingUpdates.push({
      status: order.status,
      message: `Assigned to delivery partner: ${deliveryBoy.name}`
    });

    await order.save();
    dataEvents.emit('orders');

    return { order, deliveryBoy };
  },

  /**
   * Send assignment notifications (push + email) to delivery partner
   */
  async notifyDeliveryPartner(order, deliveryBoy) {
    const orderDetails = {
      orderId: order.orderId,
      customerName: order.customer?.name || 'Customer',
      customerPhone: order.customer?.phone || '',
      totalAmount: order.totalAmount,
      paymentMethod: order.paymentMethod,
      deliveryAddress: order.deliveryAddress?.address || order.customer?.address || 'N/A',
      items: order.items || []
    };

    if (deliveryBoy.pushToken) {
      try {
        await pushNotification.sendNewOrderNotification(deliveryBoy.pushToken, orderDetails);
        logger.info('Push notification sent to', { name : deliveryBoy.name });
      } catch (err) {
        logger.error('Push notification error', { error: err.message });
      }
    }

    if (deliveryBoy.email) {
      try {
        await brevoMail.sendDeliveryPartnerNotification(deliveryBoy.email, deliveryBoy.name, orderDetails);
        logger.info('Email notification sent to', { email : deliveryBoy.email });
      } catch (err) {
        logger.error('Email notification error', { error: err.message });
      }
    }
  }
};

module.exports = orderService;
