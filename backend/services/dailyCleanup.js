const Order = require('../models/Order');
const Customer = require('../models/Customer');
const DashboardStats = require('../models/DashboardStats');
const dataEvents = require('./eventEmitter');
const googleSheets = require('./googleSheets');

const RETENTION_DAYS = 15; // Delete hidden orders after 15 days

const dailyCleanup = {
  // Check if it's midnight (12:00 AM)
  isMidnight() {
    const now = new Date();
    const hours = now.getHours();
    const minutes = now.getMinutes();
    
    return hours === 0 && minutes === 0;
  },

  // Get today's date string
  getTodayString() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  },

  // Get or create dashboard stats document
  async getStats() {
    let stats = await DashboardStats.findOne();
    if (!stats) {
      stats = new DashboardStats();
      await stats.save();
    }
    return stats;
  },

  // Reset today's revenue at midnight
  async resetTodayStats() {
    try {
      const stats = await this.getStats();
      const today = this.getTodayString();
      
      // Only reset if it's a new day
      if (stats.todayDate !== today) {
        console.log(`🌙 Midnight reset - Previous day revenue: ₹${stats.todayRevenue}, orders: ${stats.todayOrders}`);
        
        // Save yesterday's stats to Google Sheets daily_reports before resetting
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayString = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
        
        // Get yesterday's detailed stats from orders before they're cleaned
        const yesterdayStart = new Date(yesterday);
        yesterdayStart.setHours(0, 0, 0, 0);
        const yesterdayEnd = new Date(yesterday);
        yesterdayEnd.setHours(23, 59, 59, 999);
        
        const yesterdayOrders = await Order.find({
          createdAt: { $gte: yesterdayStart, $lte: yesterdayEnd }
        });
        
        const deliveredOrders = yesterdayOrders.filter(o => o.status === 'delivered').length;
        const cancelledOrders = yesterdayOrders.filter(o => o.status === 'cancelled').length;
        const refundedOrders = yesterdayOrders.filter(o => o.status === 'refunded').length;
        const codOrders = yesterdayOrders.filter(o => o.paymentMethod === 'cod').length;
        const upiOrders = yesterdayOrders.filter(o => o.paymentMethod === 'upi').length;
        const itemsSold = yesterdayOrders.reduce((sum, o) => sum + (o.items?.length || 0), 0);
        
        // Calculate top items and categories
        const itemCounts = {};
        const categoryCounts = {};
        yesterdayOrders.forEach(order => {
          order.items?.forEach(item => {
            const itemName = item.name || 'Unknown';
            const category = item.category || 'Other';
            const revenue = (item.price || 0) * (item.quantity || 1);
            
            itemCounts[itemName] = (itemCounts[itemName] || 0) + (item.quantity || 1);
            categoryCounts[category] = (categoryCounts[category] || 0) + revenue;
          });
        });
        
        const topItems = Object.entries(itemCounts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([name, quantity]) => ({ name, quantity }));
          
        const topCategories = Object.entries(categoryCounts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([category, revenue]) => ({ category, revenue }));
        
        // Save to Google Sheets (row-based format - horizontal rows per date)
        await googleSheets.saveDailyReport({
          date: yesterdayString,
          revenue: stats.todayRevenue,
          orders: stats.todayOrders,
          deliveredOrders,
          cancelledOrders,
          refundedOrders,
          codOrders,
          upiOrders,
          itemsSold,
          items: topItems,
          categories: topCategories
        });
        
        // Also update dashboard stats in Google Sheets
        await googleSheets.updateDashboardStat('Total Orders', stats.totalOrders + stats.todayOrders);
        await googleSheets.updateDashboardStat('Total Revenue', stats.totalRevenue + stats.todayRevenue);
        await googleSheets.updateDashboardStat('Today Orders', 0);
        await googleSheets.updateDashboardStat('Today Revenue', 0);
        await googleSheets.updateDashboardStat('Today Date', today);
        
        // Reset today's stats in MongoDB
        stats.todayRevenue = 0;
        stats.todayOrders = 0;
        stats.todayDate = today;
        stats.lastUpdated = new Date();
        
        await stats.save();
        
        console.log(`✅ Today's stats reset for ${today}`);
        console.log(`📊 Yesterday's report saved to Google Sheets`);
        dataEvents.emit('dashboard');
        
        // Clean up empty date headers from Google Sheets
        console.log('📅 Cleaning up empty date headers from Google Sheets...');
        await googleSheets.cleanupEmptyDateHeaders();
      }
    } catch (error) {
      console.error('❌ Error resetting today stats:', error.message);
    }
  },

  // Save stats before deleting orders
  async saveOrderStats(orders) {
    try {
      const stats = await this.getStats();
      
      const paidOrders = orders.filter(o => o.paymentStatus === 'paid' && o.status !== 'cancelled');
      const revenue = paidOrders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);
      
      // Add to cumulative totals
      stats.totalOrders += orders.length;
      stats.totalRevenue += revenue;
      stats.lastUpdated = new Date();
      
      await stats.save();
      
      // Also sync to Google Sheets (cost-saving backup)
      await googleSheets.updateDashboardStat('Total Orders', stats.totalOrders);
      await googleSheets.updateDashboardStat('Total Revenue', stats.totalRevenue);
      
      console.log(`📊 Saved stats: ${orders.length} orders, ₹${revenue} revenue`);
      return stats;
    } catch (error) {
      console.error('❌ Error saving order stats:', error.message);
    }
  },

  // Save customer count before deleting
  async saveCustomerStats(count) {
    try {
      const stats = await this.getStats();
      stats.totalCustomers += count;
      stats.lastUpdated = new Date();
      await stats.save();
      
      // Also sync to Google Sheets
      await googleSheets.updateDashboardStat('Total Customers', stats.totalCustomers);
      
      console.log(`📊 Saved stats: ${count} customers`);
      return stats;
    } catch (error) {
      console.error('❌ Error saving customer stats:', error.message);
    }
  },

  // Clean up hidden orders older than 15 days (stats already saved when hidden)
  async cleanupOldOrders() {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - RETENTION_DAYS);
      
      // Only delete orders that are hidden AND statusUpdatedAt is older than 15 days
      const result = await Order.deleteMany({
        isHidden: true,
        statusUpdatedAt: { $lt: cutoffDate, $exists: true }
      });
      
      if (result.deletedCount > 0) {
        console.log(`🗑️ Permanently deleted ${result.deletedCount} hidden orders older than ${RETENTION_DAYS} days`);
      } else {
        console.log(`📦 No hidden orders older than ${RETENTION_DAYS} days to delete`);
      }
      
      return result.deletedCount;
    } catch (error) {
      console.error('❌ Error cleaning up old orders:', error.message);
      return 0;
    }
  },

  // Clean up customers who haven't ordered in 15 days
  async cleanupInactiveCustomers() {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - RETENTION_DAYS);
      
      // Find customers whose last interaction was more than 15 days ago
      const inactiveCustomers = await Customer.find({
        $or: [
          { 'conversationState.lastInteraction': { $lt: cutoffDate } },
          { 'conversationState.lastInteraction': { $exists: false }, createdAt: { $lt: cutoffDate } }
        ]
      });
      
      let deletedCount = 0;
      
      for (const customer of inactiveCustomers) {
        // Check if customer has any non-hidden orders
        const activeOrders = await Order.countDocuments({
          'customer.phone': customer.phone,
          isHidden: { $ne: true }
        });
        
        if (activeOrders === 0) {
          await Customer.deleteOne({ _id: customer._id });
          deletedCount++;
        }
      }
      
      if (deletedCount > 0) {
        await this.saveCustomerStats(deletedCount);
        console.log(`🗑️ Deleted ${deletedCount} inactive customers`);
      } else {
        console.log('👥 No inactive customers to clean up');
      }
      
      return deletedCount;
    } catch (error) {
      console.error('❌ Error cleaning up customers:', error.message);
      return 0;
    }
  },

  // Run daily cleanup
  async runCleanup() {
    console.log('🧹 Starting daily cleanup...');
    console.log(`📅 Deleting hidden orders older than ${RETENTION_DAYS} days`);
    
    const ordersDeleted = await this.cleanupOldOrders();
    const customersDeleted = await this.cleanupInactiveCustomers();
    
    console.log('✅ Daily cleanup completed!');
    console.log(`   Hidden orders deleted: ${ordersDeleted}`);
    console.log(`   Inactive customers deleted: ${customersDeleted}`);
    
    return { ordersDeleted, customersDeleted };
  },

  // Manual cleanup trigger (for testing)
  async manualCleanup() {
    return await this.runCleanup();
  },

  // Start the scheduler
  start() {
    console.log(`📅 Daily cleanup scheduler started`);
    console.log(`   - Today's revenue resets at 12:00 AM`);
    console.log(`   - Empty date headers cleanup at 12:00 AM`);
    console.log(`   - Hidden orders deleted after ${RETENTION_DAYS} days`);
    
    // Check every minute
    setInterval(async () => {
      // Reset today's stats at midnight
      if (this.isMidnight()) {
        console.log('⏰ 12:00 AM - Resetting today\'s stats...');
        await this.resetTodayStats();
      }
    }, 60 * 1000); // Check every minute
    
    // Run data cleanup once a day at 2 AM
    setInterval(async () => {
      const now = new Date();
      if (now.getHours() === 2 && now.getMinutes() === 0) {
        console.log('⏰ 2:00 AM - Running data cleanup...');
        try {
          await this.runCleanup();
        } catch (error) {
          console.error('Daily cleanup failed:', error);
        }
      }
    }, 60 * 1000);
    
    // Initialize today's date on startup
    this.initTodayStats();
  },

  // Initialize today's stats on server startup
  async initTodayStats() {
    try {
      const stats = await this.getStats();
      const today = this.getTodayString();
      
      if (stats.todayDate !== today) {
        // New day, reset stats
        stats.todayRevenue = 0;
        stats.todayOrders = 0;
        stats.todayDate = today;
        await stats.save();
        console.log(`📊 Initialized today's stats for ${today}`);
      }
    } catch (error) {
      console.error('❌ Error initializing today stats:', error.message);
    }
  }
};

module.exports = dailyCleanup;
