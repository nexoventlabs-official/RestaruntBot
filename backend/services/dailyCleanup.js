const Order = require('../models/Order');
const Customer = require('../models/Customer');
const DashboardStats = require('../models/DashboardStats');

const RETENTION_DAYS = 10; // Keep data for 10 days

const dailyCleanup = {
  // Check if it's 11:59 PM
  isCleanupTime() {
    const now = new Date();
    const hours = now.getHours();
    const minutes = now.getMinutes();
    
    return hours === 23 && minutes === 59;
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

  // Save stats before deleting orders
  async saveOrderStats(orders) {
    try {
      const stats = await this.getStats();
      
      const paidOrders = orders.filter(o => o.paymentStatus === 'paid');
      const revenue = paidOrders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);
      
      // Add to cumulative totals
      stats.totalOrders += orders.length;
      stats.totalRevenue += revenue;
      stats.lastUpdated = new Date();
      
      await stats.save();
      
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
      
      console.log(`📊 Saved stats: ${count} customers`);
      return stats;
    } catch (error) {
      console.error('❌ Error saving customer stats:', error.message);
    }
  },

  // Clean up orders older than 10 days
  async cleanupOldOrders() {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - RETENTION_DAYS);
      cutoffDate.setHours(23, 59, 59, 999);
      
      // Find orders to delete
      const ordersToDelete = await Order.find({
        createdAt: { $lt: cutoffDate }
      });
      
      if (ordersToDelete.length === 0) {
        console.log('📦 No orders older than 10 days to clean up');
        return 0;
      }
      
      // Save stats before deleting
      await this.saveOrderStats(ordersToDelete);
      
      // Delete old orders
      const result = await Order.deleteMany({
        createdAt: { $lt: cutoffDate }
      });
      
      console.log(`🗑️ Deleted ${result.deletedCount} orders older than ${RETENTION_DAYS} days`);
      return result.deletedCount;
    } catch (error) {
      console.error('❌ Error cleaning up orders:', error.message);
      return 0;
    }
  },

  // Clean up customers who haven't ordered in 10 days
  async cleanupInactiveCustomers() {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - RETENTION_DAYS);
      
      // Find customers whose last interaction was more than 10 days ago
      // and who don't have any recent orders
      const inactiveCustomers = await Customer.find({
        $or: [
          { 'conversationState.lastInteraction': { $lt: cutoffDate } },
          { 'conversationState.lastInteraction': { $exists: false } }
        ]
      });
      
      let deletedCount = 0;
      
      for (const customer of inactiveCustomers) {
        // Check if customer has any orders in the last 10 days
        const recentOrders = await Order.countDocuments({
          'customer.phone': customer.phone,
          createdAt: { $gte: cutoffDate }
        });
        
        if (recentOrders === 0) {
          // No recent orders, safe to delete
          await Customer.deleteOne({ _id: customer._id });
          deletedCount++;
        }
      }
      
      if (deletedCount > 0) {
        // Save customer count to stats
        await this.saveCustomerStats(deletedCount);
        console.log(`🗑️ Deleted ${deletedCount} inactive customers (no orders in ${RETENTION_DAYS} days)`);
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
    console.log(`📅 Removing data older than ${RETENTION_DAYS} days`);
    
    const ordersDeleted = await this.cleanupOldOrders();
    const customersDeleted = await this.cleanupInactiveCustomers();
    
    console.log('✅ Daily cleanup completed!');
    console.log(`   Orders removed: ${ordersDeleted}`);
    console.log(`   Customers removed: ${customersDeleted}`);
    
    return { ordersDeleted, customersDeleted };
  },

  // Manual cleanup trigger (for testing)
  async manualCleanup() {
    return await this.runCleanup();
  },

  // Start the scheduler (runs every day at 11:59 PM)
  start() {
    console.log(`📅 Daily cleanup scheduler started - runs every day at 11:59 PM`);
    console.log(`   Data retention: ${RETENTION_DAYS} days`);
    
    // Check every minute if it's time to run cleanup
    setInterval(async () => {
      if (this.isCleanupTime()) {
        console.log('⏰ 11:59 PM - Running daily cleanup...');
        try {
          await this.runCleanup();
        } catch (error) {
          console.error('Daily cleanup failed:', error);
        }
      }
    }, 60 * 1000); // Check every minute
  }
};

module.exports = dailyCleanup;
