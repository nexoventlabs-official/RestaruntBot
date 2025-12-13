const mongoose = require('mongoose');

// Store cumulative dashboard stats that persist after weekly cleanup
const dashboardStatsSchema = new mongoose.Schema({
  totalOrders: { type: Number, default: 0 },
  totalRevenue: { type: Number, default: 0 },
  totalCustomers: { type: Number, default: 0 },
  lastUpdated: { type: Date, default: Date.now },
  weeklyHistory: [{
    weekEnding: Date,
    orders: Number,
    revenue: Number,
    customers: Number,
    clearedAt: Date
  }]
});

module.exports = mongoose.model('DashboardStats', dashboardStatsSchema);
