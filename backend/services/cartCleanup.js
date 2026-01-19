const Customer = require('../models/Customer');
const cron = require('node-cron');

// Function to clean up expired cart items (older than 30 minutes)
const cleanupExpiredCartItems = async () => {
  try {
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
    
    // Find all customers with cart items
    const customers = await Customer.find({ 'cart.0': { $exists: true } });
    
    let totalItemsRemoved = 0;
    let customersAffected = 0;
    
    for (const customer of customers) {
      const originalCartLength = customer.cart.length;
      
      // Filter out items older than 30 minutes
      customer.cart = customer.cart.filter(item => {
        // If addedAt doesn't exist (old data), keep the item for now
        if (!item.addedAt) return true;
        
        // Remove if older than 30 minutes
        return item.addedAt > thirtyMinutesAgo;
      });
      
      // Save if cart changed
      if (customer.cart.length !== originalCartLength) {
        await customer.save();
        totalItemsRemoved += (originalCartLength - customer.cart.length);
        customersAffected++;
      }
    }
    
    if (totalItemsRemoved > 0) {
      console.log(`[Cart Cleanup] Removed ${totalItemsRemoved} expired items from ${customersAffected} customer carts`);
    }
  } catch (error) {
    console.error('[Cart Cleanup] Error cleaning up expired cart items:', error);
  }
};

// Schedule cleanup to run every 5 minutes
const startCartCleanupScheduler = () => {
  // Run every 5 minutes
  cron.schedule('*/5 * * * *', async () => {
    await cleanupExpiredCartItems();
  });
  
  console.log('[Cart Cleanup] Scheduler started - running every 5 minutes');
};

module.exports = {
  cleanupExpiredCartItems,
  startCartCleanupScheduler
};
