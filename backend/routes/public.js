const express = require('express');
const MenuItem = require('../models/MenuItem');
const Category = require('../models/Category');
const Order = require('../models/Order');
const DeliveryBoy = require('../models/DeliveryBoy');
const HeroSection = require('../models/HeroSection');
const Offer = require('../models/Offer');
const whatsapp = require('../services/whatsapp');
const router = express.Router();

// Get active hero sections (public)
router.get('/hero-sections', async (req, res) => {
  try {
    const heroes = await HeroSection.find({ isActive: true }).sort({ order: 1, createdAt: -1 });
    res.json(heroes);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get active offers (public)
router.get('/offers', async (req, res) => {
  try {
    const now = new Date();
    const offers = await Offer.find({ 
      isActive: true,
      $or: [
        { validUntil: null },
        { validUntil: { $gte: now } }
      ],
      validFrom: { $lte: now }
    }).sort({ createdAt: -1 });
    res.json(offers);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get popup offers (public)
router.get('/popup-offers', async (req, res) => {
  try {
    const now = new Date();
    const offers = await Offer.find({ 
      isActive: true,
      showAsPopup: true,
      $or: [
        { validUntil: null },
        { validUntil: { $gte: now } }
      ],
      validFrom: { $lte: now }
    }).sort({ createdAt: -1 }).limit(1);
    res.json(offers[0] || null);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

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
    
    // Get delivery partner info if assigned
    let deliveryPartner = null;
    if (order.assignedTo && order.serviceType === 'delivery') {
      const partner = await DeliveryBoy.findById(order.assignedTo).select('name photo avgRating totalRatings ratings');
      if (partner) {
        const existingDeliveryRating = partner.ratings?.find(r => r.orderId === orderId);
        deliveryPartner = {
          id: partner._id,
          name: partner.name,
          photo: partner.photo,
          avgRating: partner.avgRating || 0,
          totalRatings: partner.totalRatings || 0,
          existingRating: existingDeliveryRating?.rating || null
        };
      }
    }
    
    res.json({
      orderId: order.orderId,
      deliveredAt: order.deliveredAt,
      totalAmount: order.totalAmount,
      serviceType: order.serviceType,
      items: itemsWithRatings,
      deliveryPartner
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Submit rating for an item
router.post('/review/:phone/:orderId', async (req, res) => {
  try {
    const { phone, orderId } = req.params;
    const { ratings, deliveryRating } = req.body; // ratings: Array of { menuItemId, rating }, deliveryRating: number
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
    
    // Update delivery partner rating if provided
    if (deliveryRating && order.assignedTo && deliveryRating >= 1 && deliveryRating <= 5) {
      const deliveryBoy = await DeliveryBoy.findById(order.assignedTo);
      if (deliveryBoy) {
        // Check if user already rated this delivery partner for this order
        const existingDeliveryRatingIndex = deliveryBoy.ratings.findIndex(r => r.orderId === orderId);
        
        if (existingDeliveryRatingIndex >= 0) {
          // Update existing rating
          deliveryBoy.ratings[existingDeliveryRatingIndex].rating = deliveryRating;
        } else {
          // Add new rating
          deliveryBoy.ratings.push({ phone: cleanPhone, orderId, rating: deliveryRating });
        }
        
        // Recalculate average
        const totalDeliveryRatings = deliveryBoy.ratings.length;
        const sumDeliveryRatings = deliveryBoy.ratings.reduce((sum, r) => sum + r.rating, 0);
        deliveryBoy.avgRating = totalDeliveryRatings > 0 ? Math.round((sumDeliveryRatings / totalDeliveryRatings) * 10) / 10 : 0;
        deliveryBoy.totalRatings = totalDeliveryRatings;
        
        await deliveryBoy.save();
      }
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

// Track order by orderId (public)
router.get('/track/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;
    
    const order = await Order.findOne({ orderId });
    
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    
    // Return order tracking details
    res.json({
      orderId: order.orderId,
      status: order.status,
      paymentStatus: order.paymentStatus,
      paymentMethod: order.paymentMethod,
      totalAmount: order.totalAmount,
      serviceType: order.serviceType,
      items: order.items.map(item => ({
        name: item.name,
        quantity: item.quantity,
        price: item.price,
        unit: item.unit,
        unitQty: item.unitQty
      })),
      deliveryAddress: order.deliveryAddress?.address || null,
      trackingUpdates: order.trackingUpdates || [],
      estimatedDeliveryTime: order.estimatedDeliveryTime,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get order details for payment page (public)
router.get('/order/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;
    
    const order = await Order.findOne({ orderId });
    
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    
    // Return order details for payment
    res.json({
      orderId: order.orderId,
      status: order.status,
      paymentStatus: order.paymentStatus,
      paymentMethod: order.paymentMethod,
      totalAmount: order.totalAmount,
      serviceType: order.serviceType,
      items: order.items.map(item => ({
        name: item.name,
        quantity: item.quantity,
        price: item.price,
        unit: item.unit,
        unitQty: item.unitQty
      })),
      customer: {
        phone: order.customer?.phone
      },
      deliveryAddress: order.deliveryAddress?.address || null,
      createdAt: order.createdAt
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Send item details via WhatsApp (for website integration)
router.post('/whatsapp-item/:itemId', async (req, res) => {
  try {
    const { itemId } = req.params;
    const { phone } = req.body;
    
    if (!phone) {
      return res.status(400).json({ error: 'Phone number is required' });
    }
    
    const item = await MenuItem.findById(itemId);
    if (!item) {
      return res.status(404).json({ error: 'Item not found' });
    }
    
    // Check if item is available
    if (!item.available) {
      return res.status(400).json({ error: 'Item is currently unavailable' });
    }
    
    // Format food type label
    const foodTypeLabel = item.foodType === 'veg' ? '🥦 Veg' : 
                          item.foodType === 'nonveg' ? '🍗 Non-Veg' : 
                          item.foodType === 'egg' ? '🥚 Egg' : '';
    
    // Rating display
    let ratingDisplay = '';
    if (item.totalRatings > 0) {
      const fullStars = Math.floor(item.avgRating);
      const stars = '⭐'.repeat(fullStars);
      ratingDisplay = `${stars} ${item.avgRating} (${item.totalRatings} reviews)`;
    } else {
      ratingDisplay = '☆☆☆☆☆ No ratings yet';
    }
    
    // Build message
    let msg = `*${item.name}*${foodTypeLabel ? ` ${foodTypeLabel}` : ''}\n\n`;
    msg += `${ratingDisplay}\n\n`;
    msg += `💰 *Price:* ₹${item.price} / ${item.quantity || 1} ${item.unit || 'piece'}\n`;
    msg += `⏱️ *Prep Time:* ${item.preparationTime || 15} mins\n`;
    if (item.tags?.length) msg += `🏷️ *Tags:* ${item.tags.join(', ')}\n`;
    msg += `\n📝 ${item.description || 'Delicious dish prepared fresh!'}`;
    
    const buttons = [
      { id: `add_${item._id}`, text: 'Add to Cart' },
      { id: 'view_menu', text: 'Back to Menu' },
      { id: 'review_pay', text: 'Review & Pay' }
    ];
    
    // Send via WhatsApp
    if (item.image && !item.image.startsWith('data:')) {
      await whatsapp.sendImageWithButtons(phone, item.image, msg, buttons);
    } else {
      await whatsapp.sendButtons(phone, msg, buttons);
    }
    
    res.json({ success: true, message: 'Item details sent to WhatsApp' });
  } catch (error) {
    console.error('Error sending item to WhatsApp:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
