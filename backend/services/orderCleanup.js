const Order = require('../models/Order');
const Customer = require('../models/Customer');
const DashboardStats = require('../models/DashboardStats');
const dataEvents = require('./eventEmitter');

const CLEANUP_DELAY_HOURS = 1; // Remove delivered/cancelled orders after 1 hour

const orderCleanup = {
  // Get or create dashboard stats document
  async getStats() {
    let stats = await DashboardStats.findOne();
    if (!stats) {
      stats = new DashboardStats();
      await stats.save();
    }
    return stats;
  },

  // Get today's date string
  getTodayString() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
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
      
      console.log(`📊 Cleanup stats saved: ${orders.length} orders, ₹${revenue} revenue`);
      return stats;
    } catch (error) {
      console.error('❌ Error saving cleanup stats:', error.message);
    }
  },

  // Delete customer if they have no other orders
  async deleteCustomerIfNoOrders(phone) {
    try {
      // Check if customer has any remaining orders
      const remainingOrders = await Order.countDocuments({ 'customer.phone': phone });
      
      if (remainingOrders === 0) {
        const result = await Customer.deleteOne({ phone });
        if (result.deletedCount > 0) {
          console.log(`👤 Deleted customer: ${phone} (no remaining orders)`);
          
          // Update customer stats
          const stats = await this.getStats();
          stats.totalCustomers += 1;
          await stats.save();
          
          return true;
        }
      }
      return false;
    } catch (error) {
      console.error(`❌ Error deleting customer ${phone}:`, error.message);
      return false;
    }
  },

  // Remove delivered and cancelled orders older than 1 hour from status update
  async cleanupCompletedOrders() {
    try {
      const cutoffTime = new Date(Date.now() - CLEANUP_DELAY_HOURS * 60 * 60 * 1000);
      
      // Find delivered/cancelled orders where statusUpdatedAt is older than 1 hour
      const ordersToRemove = await Order.find({
        status: { $in: ['delivered', 'cancelled'] },
        statusUpdatedAt: { $lt: cutoffTime, $exists: true }
      });
      
      if (ordersToRemove.length === 0) {
        return 0;
      }
      
      console.log(`🧹 Found ${ordersToRemove.length} completed orders to remove (status updated >1 hour ago)`);
      
      // Save cumulative stats before deleting (for total revenue/orders tracking)
      await this.saveOrderStats(ordersToRemove);
      
      // Collect unique customer phones before deleting orders
      const customerPhones = [...new Set(ordersToRemove.map(o => o.customer?.phone).filter(Boolean))];
      
      // Delete the orders
      const orderIds = ordersToRemove.map(o => o._id);
      const result = await Order.deleteMany({ _id: { $in: orderIds } });
      
      console.log(`✅ Removed ${result.deletedCount} delivered/cancelled orders`);
      
      // Delete customers who have no remaining orders
      let customersDeleted = 0;
      for (const phone of customerPhones) {
        const deleted = await this.deleteCustomerIfNoOrders(phone);
        if (deleted) customersDeleted++;
      }
      
      if (customersDeleted > 0) {
        console.log(`👥 Removed ${customersDeleted} customers with no remaining orders`);
        dataEvents.emit('customers');
      }
      
      // Emit event to update frontend
      dataEvents.emit('orders');
      dataEvents.emit('dashboard');
      
      return result.deletedCount;
    } catch (error) {
      console.error('❌ Error cleaning up completed orders:', error.message);
      return 0;
    }
  },

  // Start the scheduler (runs every 5 minutes)
  start() {
    console.log(`🧹 Order cleanup scheduler started - removes delivered/cancelled orders after ${CLEANUP_DELAY_HOURS} hour(s)`);
    
    // Run immediately on start
    this.cleanupCompletedOrders();
    
    // Then run every 5 minutes
    setInterval(() => {
      this.cleanupCompletedOrders();
    }, 5 * 60 * 1000); // Every 5 minutes
  }
};

module.exports = orderCleanup;
