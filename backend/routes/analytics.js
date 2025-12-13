const express = require('express');
const Order = require('../models/Order');
const Customer = require('../models/Customer');
const MenuItem = require('../models/MenuItem');
const DashboardStats = require('../models/DashboardStats');
const authMiddleware = require('../middleware/auth');
const router = express.Router();

router.get('/dashboard', authMiddleware, async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Get cumulative stats (persisted across weekly cleanups)
    let cumulativeStats = await DashboardStats.findOne();
    if (!cumulativeStats) {
      cumulativeStats = { totalOrders: 0, totalRevenue: 0, totalCustomers: 0 };
    }
    
    // Get current week's data (exclude cancelled/refunded orders from revenue)
    const [currentOrders, todayOrders, currentRevenue, todayRevenue, currentCustomers, menuItems] = await Promise.all([
      Order.countDocuments({ status: { $in: ['confirmed', 'preparing', 'ready', 'out_for_delivery', 'delivered'] } }),
      Order.countDocuments({ createdAt: { $gte: today } }),
      Order.aggregate([{ $match: { paymentStatus: 'paid', status: { $nin: ['cancelled', 'refunded'] }, refundStatus: { $nin: ['completed', 'pending'] } } }, { $group: { _id: null, total: { $sum: '$totalAmount' } } }]),
      Order.aggregate([{ $match: { paymentStatus: 'paid', status: { $nin: ['cancelled', 'refunded'] }, refundStatus: { $nin: ['completed', 'pending'] }, createdAt: { $gte: today } } }, { $group: { _id: null, total: { $sum: '$totalAmount' } } }]),
      Customer.countDocuments(),
      MenuItem.countDocuments()
    ]);

    // Combine cumulative + current week stats
    const totalOrders = cumulativeStats.totalOrders + currentOrders;
    const totalRevenue = cumulativeStats.totalRevenue + (currentRevenue[0]?.total || 0);
    const totalCustomers = cumulativeStats.totalCustomers + currentCustomers;

    const pendingOrders = await Order.countDocuments({ status: 'pending' });
    const preparingOrders = await Order.countDocuments({ status: 'preparing' });

    const recentOrders = await Order.find().sort({ createdAt: -1 }).limit(5);

    const ordersByStatus = await Order.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);

    res.json({
      totalOrders,
      todayOrders,
      totalRevenue,
      todayRevenue: todayRevenue[0]?.total || 0,
      totalCustomers,
      menuItems,
      pendingOrders,
      preparingOrders,
      recentOrders,
      ordersByStatus,
      // Include weekly history for charts
      weeklyHistory: cumulativeStats.weeklyHistory || []
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/sales', authMiddleware, async (req, res) => {
  try {
    const { days = 7 } = req.query;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days));

    const sales = await Order.aggregate([
      { $match: { paymentStatus: 'paid', status: { $nin: ['cancelled', 'refunded'] }, refundStatus: { $nin: ['completed', 'pending'] }, createdAt: { $gte: startDate } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, total: { $sum: '$totalAmount' }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } }
    ]);

    res.json(sales);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/top-items', authMiddleware, async (req, res) => {
  try {
    const topItems = await Order.aggregate([
      { $unwind: '$items' },
      { $group: { _id: '$items.name', totalQuantity: { $sum: '$items.quantity' }, totalRevenue: { $sum: { $multiply: ['$items.price', '$items.quantity'] } } } },
      { $sort: { totalQuantity: -1 } },
      { $limit: 10 }
    ]);
    res.json(topItems);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;


// Manual cleanup endpoint (admin only)
router.post('/cleanup', authMiddleware, async (req, res) => {
  try {
    const dailyCleanup = require('../services/dailyCleanup');
    const result = await dailyCleanup.manualCleanup();
    res.json({ 
      success: true, 
      message: 'Daily cleanup completed - removed data older than 10 days',
      ...result 
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
