const express = require('express');
const MenuItem = require('../models/MenuItem');
const Category = require('../models/Category');
const Order = require('../models/Order');
const router = express.Router();

// Get all categories (public)
router.get('/categories', async (req, res) => {
  try {
    const categories = await Category.find({ isActive: true, isPaused: false }).sort({ sortOrder: 1 });
    res.json(categories);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all menu items (public)
router.get('/menu', async (req, res) => {
  try {
    const { category, foodType } = req.query;
    const query = { available: true };
    if (category) query.category = category;
    if (foodType && foodType !== 'all') query.foodType = foodType;
    
    const items = await MenuItem.find(query).select('-ratings').sort({ name: 1 });
    res.json(items);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get delivered items for a customer to review
router.get('/review/:phone/:orderId', async (req, res) => {
  try {
    const { phone, orderId } = req.params;
    const cleanPhone = phone.replace(/\D/g, '').slice(-10);
    
    const order = await Order.findOne({ 
      orderId,
      'customer.phone': { $regex: cleanPhone },
      status: 'delivered'
    });
    
    if (!order) {
      return res.status(404).json({ error: 'Order not found or not delivered yet' });
    }
    
    // Get menu items with existing ratings from this user
    const itemIds = order.items.map(i => i.menuItem).filter(Boolean);
    const menuItems = await MenuItem.find({ _id: { $in: itemIds } });
    
    const itemsWithRatings = order.items.map(orderItem => {
      const menuItem = menuItems.find(m => m._id.toString() === orderItem.menuItem?.toString());
      const existingRating = menuItem?.ratings?.find(r => r.orderId === orderId);
      
      return {
        menuItemId: orderItem.menuItem,
        name: orderItem.name,
        quantity: orderItem.quantity,
        price: orderItem.price,
        image: menuItem?.image,
        existingRating: existingRating?.rating || null,
        avgRating: menuItem?.avgRating || 0,
        totalRatings: menuItem?.totalRatings || 0
      };
    });
    
    res.json({
      orderId: order.orderId,
      deliveredAt: order.deliveredAt,
      totalAmount: order.totalAmount,
      items: itemsWithRatings
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Submit rating for an item
router.post('/review/:phone/:orderId', async (req, res) => {
  try {
    const { phone, orderId } = req.params;
    const { ratings } = req.body; // Array of { menuItemId, rating }
    const cleanPhone = phone.replace(/\D/g, '').slice(-10);
    
    // Verify order exists and is delivered
    const order = await Order.findOne({ 
      orderId,
      'customer.phone': { $regex: cleanPhone },
      status: 'delivered'
    });
    
    if (!order) {
      return res.status(404).json({ error: 'Order not found or not delivered yet' });
    }
    
    // Update ratings for each item
    for (const { menuItemId, rating } of ratings) {
      if (!menuItemId || !rating || rating < 1 || rating > 5) continue;
      
      const menuItem = await MenuItem.findById(menuItemId);
      if (!menuItem) continue;
      
      // Check if user already rated this item for this order
      const existingRatingIndex = menuItem.ratings.findIndex(r => r.orderId === orderId && r.phone.includes(cleanPhone));
      
      if (existingRatingIndex >= 0) {
        // Update existing rating
        menuItem.ratings[existingRatingIndex].rating = rating;
      } else {
        // Add new rating
        menuItem.ratings.push({ phone: cleanPhone, orderId, rating });
      }
      
      // Recalculate average
      const totalRatings = menuItem.ratings.length;
      const sumRatings = menuItem.ratings.reduce((sum, r) => sum + r.rating, 0);
      menuItem.avgRating = totalRatings > 0 ? Math.round((sumRatings / totalRatings) * 10) / 10 : 0;
      menuItem.totalRatings = totalRatings;
      
      await menuItem.save();
    }
    
    res.json({ success: true, message: 'Thank you for your feedback!' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all delivered orders for a phone number (for review history)
router.get('/orders/:phone', async (req, res) => {
  try {
    const { phone } = req.params;
    const cleanPhone = phone.replace(/\D/g, '').slice(-10);
    
    const orders = await Order.find({ 
      'customer.phone': { $regex: cleanPhone },
      status: 'delivered'
    }).sort({ deliveredAt: -1 }).limit(10);
    
    res.json(orders.map(o => ({
      orderId: o.orderId,
      deliveredAt: o.deliveredAt,
      totalAmount: o.totalAmount,
      itemCount: o.items.length
    })));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
