const express = require('express');
const Order = require('../models/Order');
const Customer = require('../models/Customer');
const MenuItem = require('../models/MenuItem');
const DashboardStats = require('../models/DashboardStats');
const authMiddleware = require('../middleware/auth');
const router = express.Router();

// Helper to get today's date string
const getTodayString = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

// Helper to get or create stats
const getStats = async () => {
  let stats = await DashboardStats.findOne();
  if (!stats) {
    stats = new DashboardStats({ todayDate: getTodayString() });
    await stats.save();
  }
  return stats;
};

// Track today's revenue (call this when order is paid)
const trackTodayRevenue = async (amount) => {
  try {
    const stats = await getStats();
    const today = getTodayString();
    
    // Reset if new day
    if (stats.todayDate !== today) {
      stats.todayRevenue = 0;
      stats.todayOrders = 0;
      stats.todayDate = today;
    }
    
    stats.todayRevenue += amount;
    stats.todayOrders += 1;
    stats.lastUpdated = new Date();
    await stats.save();
    
    return stats;
  } catch (error) {
    console.error('Error tracking today revenue:', error.message);
  }
};

// Export for use in other routes
router.trackTodayRevenue = trackTodayRevenue;

router.get('/dashboard', authMiddleware, async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = getTodayString();
    
    // Run ALL queries in parallel for better performance
    const [
      cumulativeStats,
      currentOrders,
      todayOrdersFromDb,
      currentRevenue,
      todayDeliveredRevenue,
      currentCustomers,
      menuItemsCount,
      pendingOrders,
      preparingOrders,
      outForDeliveryOrders,
      recentOrders,
      ordersByStatus
    ] = await Promise.all([
      DashboardStats.findOne().lean(),
      Order.countDocuments(), // Count ALL orders in database
      Order.countDocuments({ createdAt: { $gte: today } }),
      Order.aggregate([{ $match: { paymentStatus: 'paid', status: { $nin: ['cancelled', 'refunded'] }, refundStatus: { $nin: ['completed', 'pending'] } } }, { $group: { _id: null, total: { $sum: '$totalAmount' } } }]),
      // Today's delivered + paid orders (still in DB)
      Order.aggregate([{ 
        $match: { 
          status: 'delivered',
          paymentStatus: 'paid', 
          deliveredAt: { $gte: today }
        } 
      }, { 
        $group: { _id: null, total: { $sum: '$totalAmount' } } 
      }]),
      Customer.countDocuments({ hasOrdered: true }), // Only count customers who have placed orders
      MenuItem.countDocuments(),
      Order.countDocuments({ status: 'pending' }),
      Order.countDocuments({ status: 'preparing' }),
      Order.countDocuments({ status: 'out_for_delivery' }),
      Order.find().sort({ createdAt: -1 }).limit(5).lean(),
      Order.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }])
    ]);

    // Use defaults if no cumulative stats
    const stats = cumulativeStats || { totalOrders: 0, totalRevenue: 0, totalCustomers: 0, todayRevenue: 0, todayOrders: 0, todayDate: '', weeklyHistory: [] };

    // Combine cumulative + current stats
    const totalOrders = stats.totalOrders + currentOrders;
    const totalRevenue = stats.totalRevenue + (currentRevenue[0]?.total || 0);
    const totalCustomers = currentCustomers; // Just count customers with hasOrdered: true (they persist)
    
    // Today's revenue calculation:
    // Persisted value (includes revenue from deleted orders)
    let todayRevenue = 0;
    let todayOrders = 0;
    
    // Current delivered orders still in DB
    const currentDeliveredRevenue = todayDeliveredRevenue[0]?.total || 0;
    
    if (stats.todayDate === todayStr) {
      // Same day - use persisted values (includes deleted orders)
      todayRevenue = stats.todayRevenue || 0;
      todayOrders = stats.todayOrders || 0;
    } else {
      // New day or stats not initialized - just use current DB value
      todayRevenue = currentDeliveredRevenue;
      todayOrders = todayOrdersFromDb;
      
      // Initialize today's stats if needed
      if (currentDeliveredRevenue > 0 || todayOrdersFromDb > 0) {
        DashboardStats.findOneAndUpdate(
          {},
          { 
            todayDate: todayStr, 
            todayRevenue: currentDeliveredRevenue,
            todayOrders: todayOrdersFromDb,
            lastUpdated: new Date()
          },
          { upsert: true }
        ).catch(err => console.error('Stats init error:', err));
      }
    }

    res.json({
      totalOrders,
      todayOrders,
      totalRevenue,
      todayRevenue,
      totalCustomers,
      menuItems: menuItemsCount,
      pendingOrders,
      preparingOrders,
      outForDeliveryOrders,
      recentOrders,
      ordersByStatus,
      weeklyHistory: stats.weeklyHistory || []
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

// Comprehensive Report Endpoint
router.get('/report', authMiddleware, async (req, res) => {
  try {
    const { type, startDate, endDate } = req.query;
    
    // Calculate date range based on report type
    let start = new Date();
    let end = new Date();
    
    switch (type) {
      case 'today':
        start.setHours(0, 0, 0, 0);
        end.setHours(23, 59, 59, 999);
        break;
      case 'weekly':
        start.setDate(start.getDate() - start.getDay()); // Start of week (Sunday)
        start.setHours(0, 0, 0, 0);
        end.setHours(23, 59, 59, 999);
        break;
      case 'monthly':
        start.setDate(1); // Start of month
        start.setHours(0, 0, 0, 0);
        end.setHours(23, 59, 59, 999);
        break;
      case 'yearly':
        start.setMonth(0, 1); // Start of year
        start.setHours(0, 0, 0, 0);
        end.setHours(23, 59, 59, 999);
        break;
      case 'custom':
        if (startDate && endDate) {
          start = new Date(startDate);
          start.setHours(0, 0, 0, 0);
          end = new Date(endDate);
          end.setHours(23, 59, 59, 999);
        }
        break;
      default:
        start.setHours(0, 0, 0, 0);
        end.setHours(23, 59, 59, 999);
    }

    const dateFilter = { createdAt: { $gte: start, $lte: end } };

    // Run all queries in parallel
    const [
      orders,
      orderStats,
      itemStats,
      categoryStats,
      paymentStats
    ] = await Promise.all([
      // Get all orders in range
      Order.find(dateFilter).lean(),
      
      // Order statistics
      Order.aggregate([
        { $match: dateFilter },
        {
          $group: {
            _id: null,
            totalOrders: { $sum: 1 },
            totalRevenue: { 
              $sum: { 
                $cond: [
                  { $and: [{ $eq: ['$paymentStatus', 'paid'] }, { $nin: ['$status', ['cancelled', 'refunded']] }] },
                  '$totalAmount',
                  0
                ]
              }
            },
            deliveredOrders: { $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0] } },
            cancelledOrders: { $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] } },
            refundedOrders: { $sum: { $cond: [{ $eq: ['$status', 'refunded'] }, 1, 0] } }
          }
        }
      ]),
      
      // Item statistics
      Order.aggregate([
        { $match: { ...dateFilter, status: { $nin: ['cancelled', 'refunded'] } } },
        { $unwind: '$items' },
        {
          $group: {
            _id: '$items.name',
            name: { $first: '$items.name' },
            category: { $first: { $arrayElemAt: ['$items.category', 0] } },
            quantity: { $sum: '$items.quantity' },
            revenue: { $sum: { $multiply: ['$items.price', '$items.quantity'] } }
          }
        },
        { $sort: { quantity: -1 } }
      ]),
      
      // Category statistics
      Order.aggregate([
        { $match: { ...dateFilter, status: { $nin: ['cancelled', 'refunded'] } } },
        { $unwind: '$items' },
        { $unwind: { path: '$items.category', preserveNullAndEmptyArrays: true } },
        {
          $group: {
            _id: '$items.category',
            category: { $first: '$items.category' },
            quantity: { $sum: '$items.quantity' },
            revenue: { $sum: { $multiply: ['$items.price', '$items.quantity'] } }
          }
        },
        { $sort: { revenue: -1 } }
      ]),
      
      // Payment method statistics
      Order.aggregate([
        { $match: dateFilter },
        {
          $group: {
            _id: '$paymentMethod',
            count: { $sum: 1 }
          }
        }
      ])
    ]);

    // Process results
    const stats = orderStats[0] || { totalOrders: 0, totalRevenue: 0, deliveredOrders: 0, cancelledOrders: 0, refundedOrders: 0 };
    const totalItemsSold = itemStats.reduce((sum, item) => sum + item.quantity, 0);
    const avgOrderValue = stats.totalOrders > 0 ? Math.round(stats.totalRevenue / stats.deliveredOrders) || 0 : 0;
    
    // Payment method counts
    const codOrders = paymentStats.find(p => p._id === 'cod')?.count || 0;
    const upiOrders = paymentStats.find(p => p._id === 'upi')?.count || 0;

    // Top and least selling items
    const topSellingItems = itemStats.slice(0, 10);
    const leastSellingItems = [...itemStats].sort((a, b) => a.quantity - b.quantity).slice(0, 10);

    // Revenue trend (group by date)
    const revenueTrend = [];
    const ordersByDate = {};
    
    orders.forEach(order => {
      if (order.status !== 'cancelled' && order.status !== 'refunded' && order.paymentStatus === 'paid') {
        const dateKey = new Date(order.createdAt).toLocaleDateString('en-IN');
        if (!ordersByDate[dateKey]) {
          ordersByDate[dateKey] = { label: dateKey, revenue: 0, orders: 0 };
        }
        ordersByDate[dateKey].revenue += order.totalAmount || 0;
        ordersByDate[dateKey].orders += 1;
      }
    });
    
    Object.values(ordersByDate).forEach(d => revenueTrend.push(d));
    revenueTrend.sort((a, b) => new Date(a.label.split('/').reverse().join('-')) - new Date(b.label.split('/').reverse().join('-')));

    res.json({
      reportType: type,
      dateRange: { start, end },
      totalRevenue: stats.totalRevenue,
      totalOrders: stats.totalOrders,
      totalItemsSold,
      avgOrderValue,
      deliveredOrders: stats.deliveredOrders,
      cancelledOrders: stats.cancelledOrders,
      refundedOrders: stats.refundedOrders,
      codOrders,
      upiOrders,
      topSellingItems,
      leastSellingItems,
      allItemsSold: itemStats,
      revenueByCategory: categoryStats.map(c => ({ category: c.category || 'Uncategorized', revenue: c.revenue, quantity: c.quantity })),
      revenueTrend
    });
  } catch (error) {
    console.error('Report error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Sync today's revenue from existing delivered orders (admin only)
router.post('/sync-today-revenue', authMiddleware, async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = getTodayString();
    
    // Calculate today's revenue from delivered + paid orders
    const result = await Order.aggregate([
      { 
        $match: { 
          status: 'delivered',
          paymentStatus: 'paid',
          deliveredAt: { $gte: today }
        } 
      },
      { 
        $group: { 
          _id: null, 
          total: { $sum: '$totalAmount' },
          count: { $sum: 1 }
        } 
      }
    ]);
    
    const todayRevenue = result[0]?.total || 0;
    const todayOrders = result[0]?.count || 0;
    
    // Update stats
    await DashboardStats.findOneAndUpdate(
      {},
      { 
        todayDate: todayStr, 
        todayRevenue,
        todayOrders,
        lastUpdated: new Date()
      },
      { upsert: true }
    );
    
    res.json({ 
      success: true, 
      message: `Today's revenue synced: ₹${todayRevenue} from ${todayOrders} orders`,
      todayRevenue,
      todayOrders
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
