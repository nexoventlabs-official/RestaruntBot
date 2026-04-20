/**
 * Payment Initiation Domain Handler - Phase 3.4.5
 * 
 * Responsibilities:
 * - Show payment method options (UPI/COD/Pay at Hotel)
 * - Initiate UPI/online payment with Razorpay
 * - Process COD (Cash on Delivery) orders
 * - Process pickup orders with payment at hotel
 * - Create orders with pending payment status
 * - Generate payment links
 * 
 * Domain Boundaries:
 * - Does NOT handle payment verification (Payment Completion Domain)
 * - Does NOT handle cart management (Cart Domain)
 * - Does NOT handle location (Location Domain)
 * - DOES create orders (this is the order creation domain)
 * - Uses conversationState service for state management
 */

const crypto = require('crypto');
const Order = require('../../models/Order');
const Customer = require('../../models/Customer');
const DashboardStats = require('../../models/DashboardStats');
const User = require('../../models/User');
const conversationState = require('../conversationState');
const whatsapp = require('../whatsapp');
const metaCloud = require('../metaCloud');
const razorpayService = require('../razorpay');
const googleSheets = require('../googleSheets');
const pushNotification = require('../pushNotification');
const whatsappBroadcast = require('../whatsappBroadcast');
const chatbotImagesService = require('../chatbotImages');
const idempotencyService = require('../idempotencyService');
const transactionManager = require('../transactionManager');
const { logger } = require('../correlationContext');
const dataEvents = require('../eventEmitter');

// Payment method constants
const PAYMENT_METHODS = {
  UPI: 'upi',
  COD: 'cod',
  ONLINE: 'online'
};

// Service type constants
const SERVICE_TYPES = {
  DELIVERY: 'delivery',
  PICKUP: 'pickup'
};

/**
 * Generate order ID
 */
function generateOrderId(serviceType = 'delivery') {
  const prefix = serviceType === 'pickup' ? 'PKP' : 'DLV';
  const timestamp = Date.now().toString().slice(-8);
  const random = crypto.randomBytes(4).toString('hex');
  return `${prefix}${timestamp}${random}`;
}

/**
 * Calculate delivery charge
 */
async function calculateDeliveryCharge(latitude, longitude) {
  try {
    const Settings = require('../../models/Settings');
    const restaurantLocation = await Settings.getValue('restaurantLocation');
    const deliverySettings = await Settings.getValue('deliverySettings');
    
    if (!restaurantLocation?.latitude || !restaurantLocation?.longitude) {
      return { charge: 0, distance: null };
    }
    
    if (!deliverySettings) {
      return { charge: 0, distance: null };
    }
    
    // Calculate straight-line distance (Haversine)
    const R = 6371; // Earth's radius in km
    const dLat = (latitude - restaurantLocation.latitude) * Math.PI / 180;
    const dLon = (longitude - restaurantLocation.longitude) * Math.PI / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(restaurantLocation.latitude * Math.PI / 180) * Math.cos(latitude * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c;
    
    const freeRadius = deliverySettings.freeDeliveryRadius || 5;
    const extraCharge = deliverySettings.extraDeliveryCharge || 0;
    const baseCharge = deliverySettings.baseDeliveryCharge || 0;
    const noFreeDelivery = deliverySettings.noFreeDelivery || false;
    
    if (noFreeDelivery) {
      return { charge: baseCharge, distance: Math.round(distance * 100) / 100 };
    }
    
    if (distance <= freeRadius) {
      return { charge: 0, distance: Math.round(distance * 100) / 100 };
    }
    
    return { charge: extraCharge, distance: Math.round(distance * 100) / 100 };
  } catch (error) {
    logger.error('Failed to calculate delivery charge', { error: error.message });
    return { charge: 0, distance: null };
  }
}

/**
 * Calculate offer discount for an item
 */
function calculateOfferDiscount(menuItem, activeOffers) {
  if (!activeOffers || activeOffers.length === 0) {
    return { discountedPrice: null, discountAmount: 0, appliedOffer: null };
  }
  
  for (const offer of activeOffers) {
    // Check if offer applies to this item
    if (offer.applicableItems && offer.applicableItems.length > 0) {
      const itemIdStr = menuItem._id.toString();
      const isApplicable = offer.applicableItems.some(
        id => id.toString() === itemIdStr
      );
      
      if (isApplicable && offer.discountPercentage) {
        const discountAmount = (menuItem.price * offer.discountPercentage) / 100;
        const discountedPrice = menuItem.price - discountAmount;
        return { discountedPrice, discountAmount, appliedOffer: offer };
      }
    }
  }
  
  return { discountedPrice: null, discountAmount: 0, appliedOffer: null };
}

/**
 * Show payment method options
 */
async function showPaymentOptions(customer, phone, params = {}) {
  const { serviceType = 'delivery' } = params;
  
  if (!customer.cart || customer.cart.length === 0) {
    await whatsapp.sendMessage(phone, '🛒 Your cart is empty. Add items first!');
    return;
  }
  
  // Populate cart items
  await customer.populate('cart.menuItem');
  
  // Calculate cart total
  let itemsTotal = 0;
  customer.cart.forEach(cartItem => {
    const item = cartItem.menuItem;
    if (item) {
      const effectivePrice = item.offerPrice || item.price;
      itemsTotal += effectivePrice * cartItem.quantity;
    }
  });
  
  // Calculate delivery charge if delivery
  let deliveryCharge = 0;
  if (serviceType === 'delivery' && customer.deliveryAddress?.latitude && customer.deliveryAddress?.longitude) {
    const deliveryResult = await calculateDeliveryCharge(
      customer.deliveryAddress.latitude,
      customer.deliveryAddress.longitude
    );
    deliveryCharge = deliveryResult.charge || 0;
  }
  
  const total = itemsTotal + deliveryCharge;
  
  // Build message
  let message = '💳 *Select Payment Method*\n\n';
  message += `Items Total: ₹${itemsTotal}\n`;
  if (deliveryCharge > 0) {
    message += `Delivery Charge: ₹${deliveryCharge}\n`;
  }
  message += `*Grand Total: ₹${total}*\n\n`;
  message += 'Choose your preferred payment method:';
  
  const buttons = serviceType === 'pickup'
    ? [
        { id: 'pickup_pay_hotel', text: 'Pay at Hotel' },
        { id: 'pickup_pay_upi', text: 'UPI/App' }
      ]
    : [
        { id: 'pay_upi', text: 'UPI/APP' },
        { id: 'pay_cod', text: 'COD' },
        { id: 'clear_cart', text: 'Cancel' }
      ];
  
  const orderSummaryImageUrl = await chatbotImagesService.getImageUrl('order_summary');
  
  if (orderSummaryImageUrl) {
    await whatsapp.sendImage(phone, orderSummaryImageUrl, message, buttons);
  } else {
    await whatsapp.sendButtons(phone, message, buttons);
  }
  
  conversationState.transitionTo(customer, 'select_payment_method');
  conversationState.setContext(customer, 'serviceType', serviceType);
  await customer.save();
  
  logger.info('Payment options shown', {
    customerId: customer._id,
    serviceType,
    total
  });
}

/**
 * Initiate UPI/online payment
 */
async function initiateOnlinePayment(customer, phone, params = {}) {
  const { serviceType = 'delivery' } = params;
  
  // Order creation dedup — prevent double-tap creating duplicate orders
  const orderDedup = idempotencyService.checkOrderOperation(
    phone, 'upi_initiation', { serviceType }
  );
  if (orderDedup.isDuplicate) {
    logger.warn('Duplicate UPI order initiation prevented', { phone });
    await whatsapp.sendMessage(phone, '⏳ Your order is already being processed. Please wait.');
    return { success: false };
  }

  // Refresh customer from database
  const freshCustomer = await Customer.findOne({ phone: customer.phone }).populate('cart.menuItem');
  
  if (!freshCustomer?.cart?.length) {
    await whatsapp.sendMessage(phone, '🛒 Your cart is empty!');
    return { success: false };
  }
  
  const orderId = generateOrderId(serviceType);
  let itemsTotal = 0;
  let totalDiscount = 0;
  let appliedOfferIds = new Set();
  
  // Get customer's active offers
  const activeOffers = freshCustomer.activeOffers || [];
  
  const items = freshCustomer.cart.filter(item => item.menuItem).map(item => {
    let effectivePrice = item.menuItem.offerPrice || item.menuItem.price;
    let itemDiscount = 0;
    let appliedOfferId = null;
    let itemName = item.menuItem.name;
    let itemUnit = item.menuItem.unit || 'piece';
    let itemUnitQty = item.menuItem.quantity || 1;
    let originalPrice = item.menuItem.price;
    
    // Resolve variant-specific pricing and labels
    if (item.variantIndex !== null && item.variantIndex !== undefined && item.menuItem.variants?.[item.variantIndex]) {
      const variant = item.menuItem.variants[item.variantIndex];
      if (item.quantityIndex !== null && item.quantityIndex !== undefined && variant.quantities?.[item.quantityIndex]) {
        const q = variant.quantities[item.quantityIndex];
        originalPrice = q.price;
        effectivePrice = q.offerPrice && q.offerPrice < q.price ? q.offerPrice : q.price;
        itemName = `${item.menuItem.name} - ${variant.label} (${q.quantity} ${q.unit})`;
        itemUnit = q.unit || variant.unit || item.menuItem.unit || 'piece';
        itemUnitQty = q.quantity || 1;
      } else {
        originalPrice = variant.price;
        effectivePrice = variant.offerPrice && variant.offerPrice < variant.price
          ? variant.offerPrice : variant.price;
        itemName = `${item.menuItem.name} - ${variant.label} (${variant.quantity || 1} ${variant.unit || item.menuItem.unit || 'piece'})`;
        itemUnit = variant.unit || item.menuItem.unit || 'piece';
        itemUnitQty = variant.quantity || 1;
      }
    }
    
    // Check customer's activeOffers for applicable discount
    if (!item.menuItem.offerPrice && activeOffers.length > 0) {
      const offerResult = calculateOfferDiscount(item.menuItem, activeOffers);
      if (offerResult.discountedPrice !== null) {
        effectivePrice = offerResult.discountedPrice;
        itemDiscount = offerResult.discountAmount * item.quantity;
        if (offerResult.appliedOffer?.offerId) {
          appliedOfferId = offerResult.appliedOffer.offerId;
          appliedOfferIds.add(offerResult.appliedOffer.offerId.toString());
        }
      }
    }
    
    const subtotal = effectivePrice * item.quantity;
    itemsTotal += subtotal;
    totalDiscount += itemDiscount;
    
    return {
      menuItem: item.menuItem._id,
      name: itemName,
      quantity: item.quantity,
      price: effectivePrice,
      originalPrice,
      unit: itemUnit,
      unitQty: itemUnitQty,
      image: item.menuItem.image,
      variantIndex: item.variantIndex ?? null,
      variantLabel: item.variantLabel || null,
      quantityIndex: item.quantityIndex ?? null,
      appliedOfferId
    };
  });
  
  if (!items.length) {
    await whatsapp.sendMessage(phone, '🛒 Your cart is empty!');
    return { success: false };
  }
  
  // Calculate delivery charge
  let deliveryCharge = 0;
  let deliveryDistance = null;
  if (serviceType === 'delivery' && freshCustomer.deliveryAddress?.latitude && freshCustomer.deliveryAddress?.longitude) {
    const deliveryResult = await calculateDeliveryCharge(
      freshCustomer.deliveryAddress.latitude,
      freshCustomer.deliveryAddress.longitude
    );
    deliveryCharge = deliveryResult.charge || 0;
    deliveryDistance = deliveryResult.distance;
  }
  
  const total = itemsTotal + deliveryCharge;
  
  // Create order
  const order = new Order({
    orderId,
    customer: {
      phone: freshCustomer.phone,
      name: freshCustomer.name || 'Customer',
      email: freshCustomer.email
    },
    items,
    itemsTotal,
    deliveryCharge,
    deliveryDistance,
    totalAmount: total,
    discountAmount: totalDiscount,
    appliedOfferIds: Array.from(appliedOfferIds),
    serviceType,
    deliveryAddress: freshCustomer.deliveryAddress ? {
      address: freshCustomer.deliveryAddress.address,
      latitude: freshCustomer.deliveryAddress.latitude,
      longitude: freshCustomer.deliveryAddress.longitude
    } : null,
    paymentMethod: PAYMENT_METHODS.UPI,
    status: 'pending',
    paymentStatus: 'pending',
    trackingUpdates: [{ status: 'pending', message: 'Order created, awaiting payment' }]
  });
  
  // Transaction-based checkout: order.save() + cart clear are atomic
  const upiCartUpdate = {
    $set: { cart: [] },
    $push: { orderHistory: order._id }
  };
  if (appliedOfferIds.size > 0) {
    upiCartUpdate.$pull = { activeOffers: { offerId: { $in: Array.from(appliedOfferIds) } } };
  }
  if (!freshCustomer.hasOrdered) {
    upiCartUpdate.$set.hasOrdered = true;
  }
  try {
    await transactionManager.execute(async (session) => {
      await order.save({ session });
      await Customer.findOneAndUpdate({ phone }, upiCartUpdate, { session });
    });
  } catch (txErr) {
    if (txErr.message?.includes('transaction') || txErr.code === 263 || txErr.message?.includes('replica set')) {
      logger.warn('Transactions not supported, falling back to sequential', { error: txErr.message });
      await order.save();
      await Customer.findOneAndUpdate({ phone }, upiCartUpdate);
    } else {
      throw txErr;
    }
  }

  // Mark order creation as processed (dedup)
  orderDedup.mark();
  
  // Add to broadcast contacts
  await whatsappBroadcast.addContact(freshCustomer.phone, freshCustomer.name, new Date());
  
  // Track today's orders
  try {
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    
    await DashboardStats.findOneAndUpdate(
      {},
      { 
        $inc: { todayOrders: 1 },
        $set: { todayDate: todayStr, lastUpdated: new Date() }
      },
      { upsert: true }
    );
  } catch (statsErr) {
    logger.error('Error tracking today orders', { error: statsErr.message });
  }
  
  // Emit events
  dataEvents.emit('orders');
  dataEvents.emit('dashboard');
  
  // Sync to Google Sheets
  googleSheets.addOrder(order).catch(err => logger.error('Google Sheets sync error', { error: err.message }));
  googleSheets.syncTodayDailyReport().catch(err => logger.error('Daily report sync error', { error: err.message }));
  
  // Update dashboard stats in real-time
  googleSheets.incrementDashboardStat('Today Orders', 1).catch(err => logger.error('Dashboard stat error', { error: err.message }));
  googleSheets.incrementDashboardStat('Today Revenue', total).catch(err => logger.error('Dashboard stat error', { error: err.message }));
  googleSheets.incrementDashboardStat('Total Orders', 1).catch(err => logger.error('Dashboard stat error', { error: err.message }));
  googleSheets.incrementDashboardStat('Total Revenue', total).catch(err => logger.error('Dashboard stat error', { error: err.message }));
  
  // Send push notification to admin
  try {
    const admins = await User.find({ pushToken: { $ne: null } });
    for (const admin of admins) {
      if (admin.pushToken) {
        await pushNotification.sendAdminNewOrderNotification(admin.pushToken, {
          orderId,
          totalAmount: total,
          customerName: freshCustomer.name || 'Customer',
          items
        });
      }
    }
    if (admins.length > 0) {
      logger.info('Admin push sent for UPI order', { orderId });
    }
  } catch (pushErr) {
    logger.error('Admin push error', { error: pushErr.message });
  }
  
  // Cart already cleared atomically in transaction above
  // Update in-memory customer object for state consistency
  customer.cart = [];
  customer.orderHistory = freshCustomer.orderHistory || [];
  
  // Store pending order ID
  conversationState.setContext(customer, 'pendingOrderId', orderId);
  await customer.save();
  
  // Generate payment page URL
  try {
    const frontendUrl = process.env.FRONTEND_URL || 'https://restarunt-bot.vercel.app';
    const paymentPageUrl = `${frontendUrl}/pay/${orderId}`;
    
    const orderDetailsImageUrl = await chatbotImagesService.getImageUrl('order_details');
    await whatsapp.sendOrder(phone, order, items, paymentPageUrl, orderDetailsImageUrl);
    
    conversationState.transitionTo(customer, 'awaiting_payment');
    await customer.save();
    
    logger.info('Online payment initiated', {
      customerId: customer._id,
      orderId,
      total
    });
    
    return { success: true, orderId };
  } catch (err) {
    logger.error('Payment page error', { error: err.message });
    const orderDetailsImg = await chatbotImagesService.getImageUrl('order_details');
    const msg = `\u2705 *Order Created!*\n\nOrder ID: ${orderId}\nTotal: \u20b9${total}\n\n\u26a0\ufe0f Payment link unavailable.\nPlease contact us.`;
    const btns = [
      { id: 'order_status', text: 'Check Status' },
      { id: 'home', text: 'Main Menu' }
    ];
    if (orderDetailsImg) {
      await whatsapp.sendImageWithButtons(phone, orderDetailsImg, msg, btns);
    } else {
      await whatsapp.sendButtons(phone, msg, btns);
    }
    return { success: true, orderId };
  }
}

/**
 * Process COD (Cash on Delivery) order
 */
async function processCODOrder(customer, phone, params = {}) {
  const { serviceType = 'delivery' } = params;
  
  // Order creation dedup — prevent double-tap creating duplicate orders
  const orderDedup = idempotencyService.checkOrderOperation(
    phone, 'cod_initiation', { serviceType }
  );
  if (orderDedup.isDuplicate) {
    logger.warn('Duplicate COD order initiation prevented', { phone });
    await whatsapp.sendMessage(phone, '⏳ Your order is already being processed. Please wait.');
    return { success: false };
  }

  // Refresh customer from database
  const freshCustomer = await Customer.findOne({ phone: customer.phone }).populate('cart.menuItem');
  
  if (!freshCustomer?.cart?.length) {
    await whatsapp.sendMessage(phone, '🛒 Your cart is empty!');
    return { success: false };
  }
  
  const orderId = generateOrderId(serviceType);
  let itemsTotal = 0;
  let totalDiscount = 0;
  let appliedOfferIds = new Set();
  
  // Get customer's active offers
  const activeOffers = freshCustomer.activeOffers || [];
  
  const items = freshCustomer.cart.filter(item => item.menuItem).map(item => {
    let effectivePrice = item.menuItem.offerPrice || item.menuItem.price;
    let itemDiscount = 0;
    let appliedOfferId = null;
    let itemName = item.menuItem.name;
    let itemUnit = item.menuItem.unit || 'piece';
    let itemUnitQty = item.menuItem.quantity || 1;
    let originalPrice = item.menuItem.price;
    
    // Resolve variant-specific pricing and labels
    if (item.variantIndex !== null && item.variantIndex !== undefined && item.menuItem.variants?.[item.variantIndex]) {
      const variant = item.menuItem.variants[item.variantIndex];
      if (item.quantityIndex !== null && item.quantityIndex !== undefined && variant.quantities?.[item.quantityIndex]) {
        const q = variant.quantities[item.quantityIndex];
        originalPrice = q.price;
        effectivePrice = q.offerPrice && q.offerPrice < q.price ? q.offerPrice : q.price;
        itemName = `${item.menuItem.name} - ${variant.label} (${q.quantity} ${q.unit})`;
        itemUnit = q.unit || variant.unit || item.menuItem.unit || 'piece';
        itemUnitQty = q.quantity || 1;
      } else {
        originalPrice = variant.price;
        effectivePrice = variant.offerPrice && variant.offerPrice < variant.price
          ? variant.offerPrice : variant.price;
        itemName = `${item.menuItem.name} - ${variant.label} (${variant.quantity || 1} ${variant.unit || item.menuItem.unit || 'piece'})`;
        itemUnit = variant.unit || item.menuItem.unit || 'piece';
        itemUnitQty = variant.quantity || 1;
      }
    }
    
    // If no offerPrice, check customer's activeOffers for applicable discount
    if (!item.menuItem.offerPrice && activeOffers.length > 0) {
      const offerResult = calculateOfferDiscount(item.menuItem, activeOffers);
      if (offerResult.discountedPrice !== null) {
        effectivePrice = offerResult.discountedPrice;
        itemDiscount = offerResult.discountAmount * item.quantity;
        if (offerResult.appliedOffer?.offerId) {
          appliedOfferId = offerResult.appliedOffer.offerId;
          appliedOfferIds.add(offerResult.appliedOffer.offerId.toString());
        }
      }
    }
    
    const subtotal = effectivePrice * item.quantity;
    itemsTotal += subtotal;
    totalDiscount += itemDiscount;
    
    return {
      menuItem: item.menuItem._id,
      name: itemName,
      quantity: item.quantity,
      price: effectivePrice,
      originalPrice,
      unit: itemUnit,
      unitQty: itemUnitQty,
      image: item.menuItem.image,
      variantIndex: item.variantIndex ?? null,
      variantLabel: item.variantLabel || null,
      quantityIndex: item.quantityIndex ?? null,
      appliedOfferId
    };
  });
  
  if (!items.length) {
    await whatsapp.sendMessage(phone, '🛒 Your cart is empty!');
    return { success: false };
  }
  
  // Calculate delivery charge
  let deliveryCharge = 0;
  let deliveryDistance = null;
  if (serviceType === 'delivery' && freshCustomer.deliveryAddress?.latitude && freshCustomer.deliveryAddress?.longitude) {
    const deliveryResult = await calculateDeliveryCharge(
      freshCustomer.deliveryAddress.latitude,
      freshCustomer.deliveryAddress.longitude
    );
    deliveryCharge = deliveryResult.charge || 0;
    deliveryDistance = deliveryResult.distance;
  }
  
  const total = itemsTotal + deliveryCharge;
  
  // Create order
  const order = new Order({
    orderId,
    customer: {
      phone: freshCustomer.phone,
      name: freshCustomer.name || 'Customer',
      email: freshCustomer.email
    },
    items,
    itemsTotal,
    deliveryCharge,
    deliveryDistance,
    totalAmount: total,
    discountAmount: totalDiscount,
    appliedOfferIds: Array.from(appliedOfferIds),
    serviceType,
    deliveryAddress: freshCustomer.deliveryAddress ? {
      address: freshCustomer.deliveryAddress.address,
      latitude: freshCustomer.deliveryAddress.latitude,
      longitude: freshCustomer.deliveryAddress.longitude
    } : null,
    paymentMethod: PAYMENT_METHODS.COD,
    status: 'confirmed',
    paymentStatus: 'pending',
    trackingUpdates: [{ status: 'confirmed', message: 'Order confirmed - Cash on Delivery' }]
  });
  
  // Transaction-based checkout: order.save() + cart clear are atomic
  const codCartUpdate = {
    $set: { cart: [], 'conversationState.currentStep': 'order_placed' },
    $push: { orderHistory: order._id }
  };
  if (appliedOfferIds.size > 0) {
    codCartUpdate.$pull = { activeOffers: { offerId: { $in: Array.from(appliedOfferIds) } } };
  }
  if (!freshCustomer.hasOrdered) {
    codCartUpdate.$set.hasOrdered = true;
  }
  try {
    await transactionManager.execute(async (session) => {
      await order.save({ session });
      await Customer.findOneAndUpdate({ phone }, codCartUpdate, { session });
    });
  } catch (txErr) {
    if (txErr.message?.includes('transaction') || txErr.code === 263 || txErr.message?.includes('replica set')) {
      logger.warn('Transactions not supported, falling back to sequential', { error: txErr.message });
      await order.save();
      await Customer.findOneAndUpdate({ phone }, codCartUpdate);
    } else {
      throw txErr;
    }
  }

  // Mark order creation as processed (dedup)
  orderDedup.mark();
  
  // Add to broadcast contacts
  await whatsappBroadcast.addContact(freshCustomer.phone, freshCustomer.name, new Date());
  
  // Track today's orders
  try {
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    
    await DashboardStats.findOneAndUpdate(
      {},
      { 
        $inc: { todayOrders: 1 },
        $set: { todayDate: todayStr, lastUpdated: new Date() }
      },
      { upsert: true }
    );
  } catch (statsErr) {
    logger.error('Error tracking today orders', { error: statsErr.message });
  }
  
  // Emit events
  dataEvents.emit('orders');
  dataEvents.emit('dashboard');
  
  // Sync to Google Sheets
  googleSheets.addOrder(order).catch(err => logger.error('Google Sheets sync error', { error: err.message }));
  googleSheets.syncTodayDailyReport().catch(err => logger.error('Daily report sync error', { error: err.message }));
  
  // Update dashboard stats in real-time
  googleSheets.incrementDashboardStat('Today Orders', 1).catch(err => logger.error('Dashboard stat error', { error: err.message }));
  googleSheets.incrementDashboardStat('Today Revenue', total).catch(err => logger.error('Dashboard stat error', { error: err.message }));
  googleSheets.incrementDashboardStat('Total Orders', 1).catch(err => logger.error('Dashboard stat error', { error: err.message }));
  googleSheets.incrementDashboardStat('Total Revenue', total).catch(err => logger.error('Dashboard stat error', { error: err.message }));
  
  // Send push notification to admin
  try {
    const admins = await User.find({ pushToken: { $ne: null } });
    for (const admin of admins) {
      if (admin.pushToken) {
        await pushNotification.sendAdminNewOrderNotification(admin.pushToken, {
          orderId,
          totalAmount: total,
          customerName: freshCustomer.name || 'Customer',
          items
        });
      }
    }
    if (admins.length > 0) {
      logger.info('Admin push sent for COD order', { orderId });
    }
  } catch (pushErr) {
    logger.error('Admin push error', { error: pushErr.message });
  }
  
  // Cart already cleared atomically in transaction above
  // Update in-memory customer object for state consistency
  customer.cart = [];
  customer.orderHistory = freshCustomer.orderHistory || [];
  
  // Store pending order ID
  conversationState.setContext(customer, 'pendingOrderId', orderId);
  await customer.save();
  
  // Build confirmation message (differs for delivery vs pickup)
  const isPickup = serviceType === 'pickup';
  let confirmMsg = isPickup
    ? `✅ *Order Request Successful!*\n\n`
    : `✅ *Order Confirmed!*\n\n`;
  confirmMsg += `📦 Order ID: *${orderId}*\n`;
  if (isPickup) {
    confirmMsg += `🏪 Service: *Self-Pickup*\n`;
    confirmMsg += `💰 Total: *₹${itemsTotal}*\n`;
    confirmMsg += `� Payment: *Pay at Hotel*\n\n`;
  } else {
    confirmMsg += `�💵 Payment: *Cash on Delivery*\n\n`;
  }
  confirmMsg += `━━━━━━━━━━━━━━━\n`;
  confirmMsg += `*Items:*\n`;
  items.forEach((item, i) => {
    confirmMsg += `${i + 1}. *${item.name}*\n   Qty: ${item.quantity} × ₹${item.price} = ₹${item.price * item.quantity}\n\n`;
  });
  confirmMsg += `━━━━━━━━━━━━━━━\n`;
  confirmMsg += `*Items Total:* ₹${itemsTotal}\n`;
  if (deliveryCharge > 0) {
    confirmMsg += `*Delivery Charge:* ₹${deliveryCharge}\n`;
  }
  confirmMsg += `*Grand Total:* ₹${total}\n\n`;
  if (isPickup) {
    confirmMsg += `📍 Please come to the restaurant to pick up your order.\n`;
    confirmMsg += `💵 Payment will be collected at the hotel.\n`;
    confirmMsg += `⏰ We will notify you when your order is ready!\n\n`;
    confirmMsg += `Thank you for your order! 🙏`;
  } else {
    confirmMsg += `🙏 Thank you for your order!\nPlease keep ₹${total} ready for payment.`;
  }

  const headerImageKey = isPickup ? 'pickup_order_requested' : 'order_confirmed';
  const confirmedImageUrl = await chatbotImagesService.getImageUrl(headerImageKey);

  // Try Order Actions Flow first (single "Order Details" button that opens a flow with track/cancel/reorder/main menu)
  let confirmationSent = false;
  const orderActionsFlowId = process.env.WHATSAPP_ORDER_ACTIONS_FLOW_ID;
  if (orderActionsFlowId) {
    try {
      const cleanPhone = phone.replace('@c.us', '').replace(/\D/g, '');
      await metaCloud.sendFlowMessage(phone, {
        flowId: orderActionsFlowId,
        flowCta: 'Order Details',
        headerImageUrl: confirmedImageUrl || undefined,
        headerText: confirmedImageUrl ? undefined : (isPickup ? 'Order Request' : 'Order Confirmed'),
        bodyText: confirmMsg,
        flowToken: `order_actions_${cleanPhone}_${orderId}`,
        flowAction: 'data_exchange'
      });
      confirmationSent = true;
    } catch (flowErr) {
      logger.error('Order actions flow failed on order confirm, falling back to buttons', {
        phone, orderId, serviceType, error: flowErr.message
      });
    }
  }

  // Fallback: image+buttons (used only if flow is not configured or failed)
  if (!confirmationSent) {
    const confirmButtons = [
      { id: 'track_order', text: 'Track Order' },
      { id: `cancel_${orderId}`, text: 'Cancel Order' },
      { id: 'home', text: 'Main Menu' }
    ];
    // Truncate body to WhatsApp interactive body limit (1024 chars)
    const bodyText = confirmMsg.length > 1000 ? confirmMsg.substring(0, 997) + '...' : confirmMsg;
    try {
      if (confirmedImageUrl) {
        await whatsapp.sendImageWithButtons(phone, confirmedImageUrl, bodyText, confirmButtons, 'Perivi Hotel');
      } else {
        await whatsapp.sendButtons(phone, bodyText, confirmButtons, 'Perivi Hotel');
      }
    } catch (msgErr) {
      logger.error('Order confirmation message failed', { phone, orderId, error: msgErr.message });
      try {
        await whatsapp.sendMessage(phone, confirmMsg);
      } catch (fallbackErr) {
        logger.error('Order confirmation fallback also failed', { phone, orderId, error: fallbackErr.message });
      }
    }
  }

  // Mark WhatsApp confirmation sent for reconciliation
  try {
    order.whatsappConfirmationSent = true;
    await order.save();
  } catch (saveErr) {
    logger.error('Could not mark whatsappConfirmationSent', { orderId, error: saveErr.message });
  }
  
  conversationState.transitionTo(customer, 'order_confirmed');
  await customer.save();
  
  logger.info('COD order processed', {
    customerId: customer._id,
    orderId,
    total
  });
  
  return { success: true, orderId };
}

/**
 * Process pickup order with payment at hotel
 */
async function processPickupOrder(customer, phone) {
  return await processCODOrder(customer, phone, { serviceType: SERVICE_TYPES.PICKUP });
}

module.exports = {
  // Core payment initiation
  showPaymentOptions,
  initiateOnlinePayment,
  processCODOrder,
  processPickupOrder,
  
  // Helper functions
  generateOrderId,
  calculateDeliveryCharge,
  calculateOfferDiscount,
  
  // Constants
  PAYMENT_METHODS,
  SERVICE_TYPES
};
