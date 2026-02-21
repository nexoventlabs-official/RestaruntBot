const express = require('express');
const Customer = require('../models/Customer');
const Order = require('../models/Order');
const authMiddleware = require('../middleware/auth');
const { adminRateLimiter } = require('../middleware/rateLimiter');
const router = express.Router();

// Apply admin rate limiting
router.use(adminRateLimiter);

router.get('/', authMiddleware, async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    
    // Get phone numbers of customers who have actual orders (processing or confirmed status)
    const ordersWithCustomers = await Order.aggregate([
      {
        $match: {
          status: { $in: ['processing', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'delivered'] }
        }
      },
      {
        $group: {
          _id: '$customer.phone'
        }
      }
    ]);
    
    const phonesWithOrders = ordersWithCustomers.map(o => o._id).filter(Boolean);
    
    // Only fetch customers who have placed orders
    const total = await Customer.countDocuments({ phone: { $in: phonesWithOrders } });
    const customers = await Customer.find({ phone: { $in: phonesWithOrders } })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));
    
    // Batch-aggregate order stats for all customers on this page (avoids N+1 queries)
    const phoneList = customers.map(c => c.phone);

    const [orderCountsAgg, totalSpentAgg] = await Promise.all([
      // Count confirmed/delivered orders per phone
      Order.aggregate([
        { $match: { 'customer.phone': { $in: phoneList }, status: { $in: ['confirmed', 'preparing', 'ready', 'out_for_delivery', 'delivered'] } } },
        { $group: { _id: '$customer.phone', totalOrders: { $sum: 1 } } }
      ]),
      // Sum totalAmount of paid, non-cancelled orders per phone
      Order.aggregate([
        { $match: { 'customer.phone': { $in: phoneList }, paymentStatus: 'paid', status: { $ne: 'cancelled' } } },
        { $group: { _id: '$customer.phone', totalSpent: { $sum: { $ifNull: ['$totalAmount', 0] } } } }
      ])
    ]);

    const orderCountMap = Object.fromEntries(orderCountsAgg.map(r => [r._id, r.totalOrders]));
    const totalSpentMap = Object.fromEntries(totalSpentAgg.map(r => [r._id, r.totalSpent]));

    const customersWithStats = customers.map(customer => {
      const customerObj = customer.toObject();
      customerObj.totalOrders = orderCountMap[customer.phone] || 0;
      customerObj.totalSpent = totalSpentMap[customer.phone] || 0;
      return customerObj;
    });
    
    res.json({ customers: customersWithStats, total, pages: Math.ceil(total / limit) });
  } catch (error) {

    return logRouteError(res, 'Internal server error', error);
  }
});

router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id);
    if (!customer) return res.status(404).json({ error: 'Customer not found' });
    
    const customerObj = customer.toObject();
    
    // Get all orders for this customer
    const orders = await Order.find({ 'customer.phone': customer.phone })
      .sort({ createdAt: -1 });
    
    // Get confirmed orders count
    const confirmedOrders = orders.filter(o => 
      ['confirmed', 'preparing', 'ready', 'out_for_delivery', 'delivered'].includes(o.status)
    );
    
    // Get paid orders for total spent (exclude cancelled)
    const paidOrders = orders.filter(o => 
      o.paymentStatus === 'paid' && 
      o.status !== 'cancelled'
    );
    
    customerObj.totalOrders = confirmedOrders.length;
    customerObj.totalSpent = paidOrders.reduce((sum, order) => sum + (order.totalAmount || 0), 0);
    customerObj.orderHistory = orders;
    
    res.json(customerObj);
  } catch (error) {

    return logRouteError(res, 'Internal server error', error);
  }
});

router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const { name, email } = req.body;
    const customer = await Customer.findByIdAndUpdate(req.params.id, { name, email }, { new: true });
    res.json(customer);
  } catch (error) {

    return logRouteError(res, 'Internal server error', error);
  }
});

module.exports = router;
