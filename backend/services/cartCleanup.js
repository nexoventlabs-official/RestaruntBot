const Customer = require('../models/Customer');
const MenuItem = require('../models/MenuItem');
const cron = require('node-cron');
const whatsapp = require('./whatsapp');
const chatbotImagesService = require('./chatbotImages');

// Track which customers have been warned (to avoid duplicate warnings)
const warnedCustomers = new Set();

// Function to send warning message 10 minutes before clearing
const sendExpiryWarnings = async () => {
  try {
    const twentyMinutesAgo = new Date(Date.now() - 20 * 60 * 1000);
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
    
    // Find customers with cart items that will expire in the next 10 minutes
    const customers = await Customer.find({ 'cart.0': { $exists: true } }).populate('cart.menuItem');
    
    for (const customer of customers) {
      if (!customer.phone) continue;
      
      // Find items that will expire soon (added 20-30 minutes ago)
      const expiringItems = customer.cart.filter(item => {
        if (!item.addedAt) return false;
        return item.addedAt <= twentyMinutesAgo && item.addedAt > thirtyMinutesAgo;
      });
      
      if (expiringItems.length > 0) {
        // Create a unique key for this customer and these items
        const warningKey = `${customer.phone}_${expiringItems.map(i => i.menuItem?._id).join('_')}`;
        
        // Skip if already warned about these items
        if (warnedCustomers.has(warningKey)) continue;
        
        // Build warning message
        let message = '⚠️ *Cart Expiry Warning*\n\n';
        message += 'The following items will be removed from your cart in *10 minutes*:\n\n';
        
        expiringItems.forEach((item, index) => {
          const menuItem = item.menuItem;
          if (menuItem) {
            message += `${index + 1}. ${menuItem.name} x${item.quantity} - ₹${(menuItem.price * item.quantity).toFixed(2)}\n`;
          }
        });
        
        message += '\n💡 *Tip:* Add more quantity or proceed to checkout to keep these items!';
        
        // Send warning message with action buttons and image
        try {
          const cartExpiryImageUrl = await chatbotImagesService.getImageUrl('cart_expiry_warning');
          
          const buttons = [
            { id: 'review_pay', text: 'Review & Pay' },
            { id: 'view_cart', text: 'View Cart' },
            { id: 'clear_cart', text: 'Clear Cart' }
          ];
          
          if (cartExpiryImageUrl) {
            await whatsapp.sendImageWithButtons(customer.phone, cartExpiryImageUrl, message, buttons);
          } else {
            await whatsapp.sendButtons(customer.phone, message, buttons);
          }
          
          warnedCustomers.add(warningKey);
          console.log(`[Cart Warning] Sent expiry warning to ${customer.phone} for ${expiringItems.length} items`);
        } catch (error) {
          console.error(`[Cart Warning] Failed to send warning to ${customer.phone}:`, error.message);
        }
      }
    }
  } catch (error) {
    console.error('[Cart Warning] Error sending expiry warnings:', error);
  }
};

// Function to clean up expired cart items (older than 30 minutes)
const cleanupExpiredCartItems = async () => {
  try {
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
    
    // Find all customers with cart items
    const customers = await Customer.find({ 'cart.0': { $exists: true } }).populate('cart.menuItem');
    
    let totalItemsRemoved = 0;
    let customersAffected = 0;
    
    for (const customer of customers) {
      const originalCartLength = customer.cart.length;
      
      // Identify items to be removed
      const itemsToRemove = customer.cart.filter(item => {
        if (!item.addedAt) return false;
        return item.addedAt <= thirtyMinutesAgo;
      });
      
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
        
        // Send notification about removed items
        if (customer.phone && itemsToRemove.length > 0) {
          let message = '🗑️ *Cart Items Removed*\n\n';
          message += 'The following items have been removed from your cart due to inactivity (30 minutes):\n\n';
          
          itemsToRemove.forEach((item, index) => {
            const menuItem = item.menuItem;
            if (menuItem) {
              message += `${index + 1}. ${menuItem.name} x${item.quantity}\n`;
            }
          });
          
          message += '\n💡 You can add them again anytime!';
          
          try {
            const cartRemovedImageUrl = await chatbotImagesService.getImageUrl('cart_items_removed');
            
            const buttons = [
              { id: 'view_menu', text: 'Menu' },
              { id: 'view_cart', text: 'View Cart' },
              { id: 'open_website', text: 'Website' }
            ];
            
            if (cartRemovedImageUrl) {
              await whatsapp.sendImageWithButtons(customer.phone, cartRemovedImageUrl, message, buttons);
            } else {
              await whatsapp.sendButtons(customer.phone, message, buttons);
            }
            
            console.log(`[Cart Cleanup] Notified ${customer.phone} about ${itemsToRemove.length} removed items`);
            
            // Remove from warned set since items are now cleared
            const warningKeys = Array.from(warnedCustomers).filter(key => key.startsWith(customer.phone));
            warningKeys.forEach(key => warnedCustomers.delete(key));
          } catch (error) {
            console.error(`[Cart Cleanup] Failed to notify ${customer.phone}:`, error.message);
          }
        }
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
  // Send warnings every 5 minutes (for items that will expire in 10 minutes)
  cron.schedule('*/5 * * * *', async () => {
    await sendExpiryWarnings();
  });
  
  // Run cleanup every 5 minutes (to remove expired items)
  cron.schedule('*/5 * * * *', async () => {
    await cleanupExpiredCartItems();
  });
  
  console.log('[Cart Cleanup] Scheduler started - warnings and cleanup running every 5 minutes');
};

module.exports = {
  cleanupExpiredCartItems,
  sendExpiryWarnings,
  startCartCleanupScheduler
};
