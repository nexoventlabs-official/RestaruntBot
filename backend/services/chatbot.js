const crypto = require('crypto');
const Customer = require('../models/Customer');
const MenuItem = require('../models/MenuItem');
const Category = require('../models/Category');
const Order = require('../models/Order');
const Settings = require('../models/Settings');
const whatsapp = require('./whatsapp');
const razorpayService = require('./razorpay');
const googleSheets = require('./googleSheets');
const groqAi = require('./groqAi');
const chatbotImagesService = require('./chatbotImages');
const whatsappBroadcast = require('./whatsappBroadcast');
const catalogService = require('./catalogService');
const { transitionStatus } = require('./orderStateMachine');
const transactionManager = require('./transactionManager');
const idempotencyService = require('./idempotencyService');
const axios = require('axios');
const logger = require('./logger');
const { startTimer } = require('./logger');
const { setMetadata } = require('./correlationContext');

// Helper: Count items including variants for accurate WhatsApp display
// If an item has variants, count each variant as a separate item (matches Meta catalog)
function countItemsWithVariants(items) {
  let count = 0;
  for (const item of items) {
    if (item.variants && item.variants.length > 0) {
      count += item.variants.length;
    } else {
      count += 1;
    }
  }
  return count;
}

// ============ IN-MEMORY CACHE for categories & menu items ============
// Avoids 2 full collection scans (Category.find + MenuItem.find) on every single message.
// 15-second TTL ensures changes propagate quickly while saving ~20-80ms per message.
let _menuCache = { categories: null, menuItems: null, ts: 0 };
const MENU_CACHE_TTL = 15 * 1000; // 15 seconds

async function getCachedMenuData() {
  const now = Date.now();
  if (_menuCache.categories && _menuCache.menuItems && (now - _menuCache.ts) < MENU_CACHE_TTL) {
    return { allCategories: _menuCache.categories, allMenuItems: _menuCache.menuItems };
  }
  const [allCategories, allMenuItems] = await Promise.all([
    Category.find({ isActive: true }).lean(),
    MenuItem.find({ available: true }).lean()
  ]);
  _menuCache = { categories: allCategories, menuItems: allMenuItems, ts: now };
  return { allCategories, allMenuItems };
}

// ============ PER-REQUEST ACTIVE OFFERS CACHE ============
// Avoids repeated Customer.findOne + Offer.find in sub-functions (sendItemDetails,
// sendQuantitySelection, sendAddedToCart, sendItemsByTag, etc.)
// 10-second TTL covers an entire handleMessage cycle.
const _activeOffersCache = new Map();
const ACTIVE_OFFERS_CACHE_TTL = 10 * 1000; // 10 seconds

async function getCachedActiveOffers(phone) {
  const cached = _activeOffersCache.get(phone);
  if (cached && Date.now() - cached.timestamp < ACTIVE_OFFERS_CACHE_TTL) {
    return cached.data;
  }
  const cust = await Customer.findOne({ phone }).select('activeOffers').lean();
  // filterActiveOffers is defined below — lazy require to avoid hoisting issues
  const filtered = await filterActiveOffers(cust?.activeOffers || []);
  _activeOffersCache.set(phone, { data: filtered, timestamp: Date.now() });
  // Prevent unbounded growth
  if (_activeOffersCache.size > 500) {
    const oldestKey = _activeOffersCache.keys().next().value;
    _activeOffersCache.delete(oldestKey);
  }
  return filtered;
}

const generateOrderId = (serviceType = 'delivery') => {
  const prefix = serviceType === 'pickup' ? 'S' : 'O';
  const random = crypto.randomBytes(4).toString('hex').toUpperCase();
  return prefix + 'RD' + Date.now().toString(36).toUpperCase() + random;
};

// Haversine formula to calculate straight-line distance between two coordinates in KM
const calculateStraightLineDistance = (lat1, lon1, lat2, lon2) => {
  if (!lat1 || !lon1 || !lat2 || !lon2) return null;
  
  const R = 6371; // Earth's radius in kilometers
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;
  
  return Math.round(distance * 100) / 100; // Round to 2 decimal places
};

// Calculate road distance using OSRM (OpenStreetMap Routing) - FREE API
const calculateOSRMDistance = async (lat1, lon1, lat2, lon2) => {
  const endTimer = startTimer('geo.osrm');
  try {
    // OSRM public API - Note: format is longitude,latitude (NOT lat,lon!)
    const url = `https://router.project-osrm.org/route/v1/driving/${lon1},${lat1};${lon2},${lat2}?overview=false`;
    
    logger.info('OSRM request', { url });
    
    const response = await axios.get(url, { 
      timeout: 10000,
      headers: {
        'User-Agent': 'RestaurantBot/1.0'
      }
    });
    
    logger.info('OSRM response', { code: response.data.code, httpStatus: response.status });
    
    if (response.data.code === 'Ok' && response.data.routes?.[0]) {
      const distanceInMeters = response.data.routes[0].distance;
      const durationInSeconds = response.data.routes[0].duration;
      const distanceInKm = distanceInMeters / 1000;
      const durationInMins = Math.round(durationInSeconds / 60);
      logger.info('OSRM road distance', { distanceKm: distanceInKm.toFixed(2), durationMins: durationInMins });
      endTimer({ success: true, distanceKm: distanceInKm });
      return Math.round(distanceInKm * 100) / 100;
    }
    
    logger.info('OSRM API returned no valid route', { data: response.data });
    endTimer({ success: false, reason: 'no_valid_route' });
    return null;
  } catch (error) {
    endTimer({ success: false, reason: error.message });
    logger.error('OSRM API error', { error: error.message });
    return null;
  }
};

// Alternative: OpenRouteService API (free tier available)
const calculateOpenRouteServiceDistance = async (lat1, lon1, lat2, lon2) => {
  const endTimer = startTimer('geo.openRouteService');
  try {
    // OpenRouteService - coordinates are [lon, lat]
    const url = `https://api.openrouteservice.org/v2/directions/driving-car?start=${lon1},${lat1}&end=${lon2},${lat2}`;
    
    const response = await axios.get(url, { 
      timeout: 10000,
      headers: {
        'Accept': 'application/json'
      }
    });
    
    if (response.data.features?.[0]?.properties?.segments?.[0]) {
      const distanceInMeters = response.data.features[0].properties.segments[0].distance;
      const distanceInKm = distanceInMeters / 1000;
      logger.info('OpenRouteService road distance', { distanceKm: distanceInKm.toFixed(2) });
      endTimer({ success: true, distanceKm: distanceInKm });
      return Math.round(distanceInKm * 100) / 100;
    }
    
    endTimer({ success: false, reason: 'no_route' });
    return null;
  } catch (error) {
    endTimer({ success: false, reason: error.message });
    logger.error('OpenRouteService error', { error: error.message });
    return null;
  }
};

// Main distance calculator - tries multiple free APIs with smart fallback
const calculateDistance = async (lat1, lon1, lat2, lon2) => {
  if (!lat1 || !lon1 || !lat2 || !lon2) {
    logger.info('Missing coordinates for distance calculation');
    return null;
  }
  
  // Ensure coordinates are numbers
  lat1 = parseFloat(lat1);
  lon1 = parseFloat(lon1);
  lat2 = parseFloat(lat2);
  lon2 = parseFloat(lon2);
  
  logger.info('Distance calculation started');
  logger.info('Distance calculation params', { restaurantLat: lat1, restaurantLon: lon1 });
  logger.info('Distance calculation params', { customerLat: lat2, customerLon: lon2 });
  
  // Calculate straight-line first for reference
  const straightLineDistance = calculateStraightLineDistance(lat1, lon1, lat2, lon2);
  logger.info('Straight-line distance', { distanceKm: straightLineDistance });
  
  // Try OSRM API first (free, uses OpenStreetMap data)
  const osrmDistance = await calculateOSRMDistance(lat1, lon1, lat2, lon2);
  if (osrmDistance !== null && osrmDistance > 0) {
    // (removed decoration log)
    return osrmDistance;
  }
  
  // Try OpenRouteService as backup
  const orsDistance = await calculateOpenRouteServiceDistance(lat1, lon1, lat2, lon2);
  if (orsDistance !== null && orsDistance > 0) {
    // (removed decoration log)
    return orsDistance;
  }
  
  // Fall back to straight-line distance with multiplier
  // Using 1.6 multiplier for India (roads are often more winding)
  if (straightLineDistance === null) return null;
  
  const approximateRoadDistance = straightLineDistance * 1.6;
  logger.info('Distance fallback to straight-line', { distanceKm: approximateRoadDistance.toFixed(2), multiplier: 1.6 });
  // (removed decoration log)
  
  return Math.round(approximateRoadDistance * 100) / 100;
};

// Helper to calculate delivery charge based on customer location
const calculateDeliveryCharge = async (customerLat, customerLon) => {
  try {
    // Get restaurant location settings
    const restaurantLocation = await Settings.getValue('restaurantLocation');
    const deliverySettings = await Settings.getValue('deliverySettings');
    
    // If settings not configured, no delivery charge
    if (!restaurantLocation?.latitude || !restaurantLocation?.longitude) {
      logger.info('Restaurant location not configured - no delivery charge');
      return { charge: 0, distance: null, withinFreeRadius: true, message: null };
    }
    
    if (!deliverySettings) {
      logger.info('Delivery settings not configured - no delivery charge');
      return { charge: 0, distance: null, withinFreeRadius: true, message: null };
    }
    
    // Calculate RADIUS distance (straight-line) - not road distance
    // This is simpler and more consistent regardless of route taken
    const distance = calculateStraightLineDistance(
      restaurantLocation.latitude, 
      restaurantLocation.longitude,
      customerLat, 
      customerLon
    );
    
    logger.info('Radius check started');
    logger.info('Radius check params', { restaurantLat: restaurantLocation.latitude, restaurantLon: restaurantLocation.longitude });
    logger.info('Radius check params', { customerLat, customerLon });
    logger.info('Radius distance calculated (straight-line)', { distanceKm: distance });
    // (removed decoration log)
    
    if (distance === null) {
      logger.info('Could not calculate distance - no delivery charge');
      return { charge: 0, distance: null, withinFreeRadius: true, message: null };
    }
    
    logger.info('Distance from restaurant', { distanceKm: distance });
    
    const noFreeDelivery = deliverySettings.noFreeDelivery || false;
    const baseDeliveryCharge = deliverySettings.baseDeliveryCharge || 0;
    const freeRadius = deliverySettings.freeDeliveryRadius || 5;
    const maxRadius = deliverySettings.maxDeliveryRadius;
    const extraChargeEnabled = deliverySettings.enableExtraDeliveryCharge;
    const extraCharge = deliverySettings.extraDeliveryCharge || 0;
    
    // Check if beyond max delivery radius first
    if (maxRadius && distance > maxRadius) {
      logger.info('Beyond max delivery radius', { distanceKm: distance, maxRadiusKm: maxRadius });
      return { 
        charge: null, 
        distance, 
        withinFreeRadius: false, 
        beyondMaxRadius: true,
        maxRadius,
        message: `Sorry, we don't deliver to locations beyond ${maxRadius} KM from our restaurant. Your location is ${distance.toFixed(1)} KM away.`
      };
    }
    
    // If restaurant charges for ALL deliveries (no free delivery)
    if (noFreeDelivery) {
      logger.info('No free delivery zone', { baseDeliveryCharge });
      // If outside free radius AND extra charge enabled, add extra on top of base
      if (distance > freeRadius && extraChargeEnabled && extraCharge > 0) {
        const totalCharge = baseDeliveryCharge + extraCharge;
        logger.info('Delivery charge calculated', { freeRadiusKm: freeRadius, totalCharge });
        return { 
          charge: totalCharge, 
          distance, 
          withinFreeRadius: false, 
          message: `Your location is ${distance.toFixed(1)} KM away. Delivery charge: ₹${totalCharge} (₹${baseDeliveryCharge} base + ₹${extraCharge} extra).`
        };
      }
      return { 
        charge: baseDeliveryCharge, 
        distance, 
        withinFreeRadius: true, 
        message: `Delivery charge: ₹${baseDeliveryCharge}`
      };
    }
    
    // Check if within free delivery radius
    if (distance <= freeRadius) {
      logger.info('Within free delivery radius', { freeRadiusKm: freeRadius });
      return { 
        charge: 0, 
        distance, 
        withinFreeRadius: true, 
        message: null 
      };
    }
    
    // Outside free radius - check if extra charge is enabled
    if (extraChargeEnabled && extraCharge > 0) {
      logger.info('Extra delivery charge added', { extraCharge });
      return { 
        charge: extraCharge, 
        distance, 
        withinFreeRadius: false, 
        message: `Your location is ${distance.toFixed(1)} KM away. A delivery charge of ₹${extraCharge} will be added.`
      };
    }
    
    // Extra charge NOT enabled AND customer is outside free radius - REJECT ORDER
    logger.info('Outside free radius - delivery not available', { freeRadiusKm: freeRadius });
    return { 
      charge: null, 
      distance, 
      withinFreeRadius: false, 
      deliveryNotAvailable: true,
      freeRadius,
      message: `Sorry, our delivery service is available only within ${freeRadius} KM. Your location is ${distance.toFixed(1)} KM away. Please try pickup instead.`
    };
    
  } catch (error) {
    logger.error('Error calculating delivery charge', { error: error.message });
    return { charge: 0, distance: null, withinFreeRadius: true, message: null };
  }
};

// Helper to check if cart items are still available
const checkCartAvailability = async (cart) => {
  if (!cart || cart.length === 0) return { available: true, unavailableItems: [] };
  
  const unavailableItems = [];
  // Use cached categories to avoid redundant DB query
  const { allCategories } = await getCachedMenuData();
  
  // Get scheduled categories that are currently ACTIVE
  const scheduledActiveCategories = allCategories
    .filter(c => c.schedule?.enabled && !c.isPaused && !c.isSoldOut)
    .map(c => c.name);
  
  // Get scheduled categories that are LOCKED
  const scheduledLockedCategories = allCategories
    .filter(c => c.schedule?.enabled && (c.isPaused || c.isSoldOut))
    .map(c => c.name);
  
  // Batch-fetch all cart menu items in one query (replaces N individual findById calls)
  const cartItemIds = cart.map(ci => ci.menuItem).filter(Boolean);
  const menuItemDocs = cartItemIds.length > 0
    ? await MenuItem.find({ _id: { $in: cartItemIds } }).lean()
    : [];
  const menuItemMap = new Map(menuItemDocs.map(mi => [mi._id.toString(), mi]));

  for (const cartItem of cart) {
    const itemId = cartItem.menuItem?._id || cartItem.menuItem;
    const menuItem = menuItemMap.get(itemId?.toString());
    if (!menuItem) {
      unavailableItems.push({ name: cartItem.menuItem?.name || 'Unknown item', reason: 'deleted' });
      continue;
    }
    
    // Check if item is unavailable
    if (!menuItem.available) {
      unavailableItems.push({ name: menuItem.name, reason: 'unavailable' });
      continue;
    }
    
    const itemCategories = Array.isArray(menuItem.category) ? menuItem.category : [menuItem.category];
    
    // Items with no categories bypass category-based checks (always available if item.available)
    if (itemCategories.length === 0 || (itemCategories.length === 1 && !itemCategories[0])) {
      continue;
    }
    
    // Check if item has any scheduled category that is ACTIVE → available
    const hasScheduledActiveCategory = itemCategories.some(cat => scheduledActiveCategories.includes(cat));
    if (hasScheduledActiveCategory) continue; // Item is available
    
    // Check if item has any scheduled category that is LOCKED → unavailable
    const hasScheduledLockedCategory = itemCategories.some(cat => scheduledLockedCategories.includes(cat));
    if (hasScheduledLockedCategory) {
      unavailableItems.push({ name: menuItem.name, reason: 'category_paused' });
      continue;
    }
    
    // Item has no scheduled categories - check if any non-scheduled category is active
    const hasActiveNonScheduledCategory = itemCategories.some(cat => {
      const category = allCategories.find(c => c.name === cat);
      return category && !category.schedule?.enabled && !category.isPaused && !category.isSoldOut;
    });
    
    if (!hasActiveNonScheduledCategory) {
      unavailableItems.push({ name: menuItem.name, reason: 'category_paused' });
    }
  }
  
  return {
    available: unavailableItems.length === 0,
    unavailableItems
  };
};

// Helper to send message with optional image
const sendWithOptionalImage = async (phone, imageUrl, message, buttons, footer = '') => {
  if (imageUrl) {
    await whatsapp.sendImageWithButtons(phone, imageUrl, message, buttons, footer);
  } else {
    await whatsapp.sendButtons(phone, message, buttons, footer);
  }
};

// Helper to send message with optional image and CTA URL
const sendWithOptionalImageCta = async (phone, imageUrl, message, buttonText, url, footer = '') => {
  if (imageUrl) {
    await whatsapp.sendImageWithCtaUrl(phone, imageUrl, message, buttonText, url, footer);
  } else {
    await whatsapp.sendCtaUrl(phone, message, buttonText, url, footer);
  }
};

// Helper to format price with offer
const formatPriceWithOffer = (item) => {
  if (item.offerPrice && item.offerPrice < item.price) {
    const discount = Math.round(((item.price - item.offerPrice) / item.price) * 100);
    return `~₹${item.price}~ ➜ *₹${item.offerPrice}* (${discount}% OFF)`;
  }
  return `₹${item.price}`;
};

// Helper to format price with active offers from customer (for targeted offers)
// This checks both item.offerPrice AND customer's activeOffers
const formatPriceWithActiveOffers = (item, activeOffers) => {
  // First check if item has built-in offerPrice
  if (item.offerPrice && item.offerPrice < item.price) {
    const discount = Math.round(((item.price - item.offerPrice) / item.price) * 100);
    return `~₹${item.price}~ ➜ *₹${item.offerPrice}* (${discount}% OFF)`;
  }
  
  // Then check customer's activeOffers for targeted discounts
  if (activeOffers && activeOffers.length > 0) {
    const offerResult = calculateOfferDiscount(item, activeOffers);
    if (offerResult.discountedPrice !== null && offerResult.discountAmount > 0) {
      const discount = Math.round((offerResult.discountAmount / item.price) * 100);
      return `~₹${item.price}~ ➜ *₹${offerResult.discountedPrice}* (${discount}% OFF 🎁)`;
    }
  }
  
  return `₹${item.price}`;
};

// Helper to format offer types
const formatOfferTypes = (item) => {
  if (item.offerType && Array.isArray(item.offerType) && item.offerType.length > 0) {
    // Join all offer types with comma and space
    const offersList = item.offerType.join(', ');
    return `\n🎉 *Offers:* ${offersList}`;
  } else if (item.offerType && typeof item.offerType === 'string' && item.offerType.trim()) {
    // Handle single offer type as string
    return `\n🎉 *Offers:* ${item.offerType}`;
  }
  return '';
};

// Helper to filter customer's activeOffers by checking if the actual Offer document is still active
// This ensures that when an admin toggles an offer OFF, targeted customers stop seeing the discount
const filterActiveOffers = async (activeOffers) => {
  if (!activeOffers || activeOffers.length === 0) return [];
  
  const Offer = require('../models/Offer');
  const offerIds = activeOffers
    .filter(o => o.offerId)
    .map(o => o.offerId.toString());
  
  if (offerIds.length === 0) return activeOffers;
  
  // Batch lookup: find which of these offers are still active
  const activeOfferDocs = await Offer.find({ 
    _id: { $in: offerIds }, 
    isActive: true 
  }).select('_id').lean();
  
  const activeIdSet = new Set(activeOfferDocs.map(o => o._id.toString()));
  
  // Mark inactive offers so calculateOfferDiscount can skip them
  return activeOffers.map(offer => {
    if (offer.offerId && !activeIdSet.has(offer.offerId.toString())) {
      return { ...offer.toObject ? offer.toObject() : offer, _isInactive: true };
    }
    return offer.toObject ? offer.toObject() : offer;
  });
};

// Helper to calculate offer discounts from customer's activeOffers
// Returns: { discountedPrice, discountAmount, appliedOffer } for an item
const calculateOfferDiscount = (menuItem, activeOffers) => {
  if (!activeOffers || activeOffers.length === 0) {
    return { discountedPrice: null, discountAmount: 0, appliedOffer: null };
  }
  
  const now = new Date();
  
  // Find applicable offer for this item
  for (const offer of activeOffers) {
    // Skip expired offers
    if (offer.validUntil && new Date(offer.validUntil) < now) {
      continue;
    }
    
    // Skip inactive offers (isActive flag set by filterActiveOffers)
    if (offer._isInactive) {
      continue;
    }
    
    // Check if item is applicable to this offer
    let isApplicable = false;
    
    // Check by appliedItems
    if (offer.appliedItems && offer.appliedItems.length > 0) {
      isApplicable = offer.appliedItems.some(itemId => 
        itemId.toString() === menuItem._id.toString()
      );
    }
    
    // Check by appliedCategories
    if (!isApplicable && offer.appliedCategories && offer.appliedCategories.length > 0) {
      isApplicable = offer.appliedCategories.includes(menuItem.category);
    }
    
    // Check by offerType matching item's offerType
    if (!isApplicable && offer.offerType && menuItem.offerType) {
      const itemOfferTypes = Array.isArray(menuItem.offerType) ? menuItem.offerType : [menuItem.offerType];
      isApplicable = itemOfferTypes.includes(offer.offerType);
    }
    
    if (isApplicable) {
      const price = menuItem.price;
      let discountedPrice = price;
      let discountAmount = 0;
      
      // Calculate discount based on type
      if (offer.discountType === 'percentage' && offer.discountValue > 0) {
        discountAmount = Math.round((price * offer.discountValue) / 100);
        discountedPrice = price - discountAmount;
      } else if (offer.discountType === 'fixed' && offer.discountValue > 0) {
        discountAmount = Math.min(offer.discountValue, price);
        discountedPrice = price - discountAmount;
      } else if (offer.percentage && offer.percentage > 0) {
        // Fallback to percentage field
        discountAmount = Math.round((price * offer.percentage) / 100);
        discountedPrice = price - discountAmount;
      }
      
      if (discountAmount > 0) {
        return { discountedPrice, discountAmount, appliedOffer: offer };
      }
    }
  }
  
  return { discountedPrice: null, discountAmount: 0, appliedOffer: null };
};

const chatbot = {
  // Helper to detect cancel order intent from text/voice
  isCancelIntent(text) {
    if (!text) return false;
    const lowerText = ' ' + text.toLowerCase() + ' ';
    const cancelPatterns = [
      /\bcancel\b/, /\bcancel order\b/, /\bcancel my order\b/, /\bcancel the order\b/, /\bcancel item\b/,
      /\bremove order\b/, /\bstop order\b/, /\bdon'?t want\b/, /\bdont want\b/, /\bno need\b/,
      /\bcancel it\b/, /\bcancel this\b/, /\bcancel that\b/, /\bplease cancel\b/,
      /\bi want to cancel\b/, /\bwant to cancel\b/, /\bneed to cancel\b/, /\bcan you cancel\b/,
      /\bcancel please\b/, /\bcancel pls\b/, /\bcancel plz\b/,
      /\bplz cancel\b/, /\bpls cancel\b/, /\bplease cancel order\b/,
      /\bi dont want order\b/, /\bi don't want order\b/, /\bi dont want this order\b/
    ];
    return cancelPatterns.some(pattern => pattern.test(lowerText));
  },

  // Helper to detect cart intent from text/voice
  isCartIntent(text) {
    if (!text) return false;
    const lowerText = ' ' + text.toLowerCase() + ' ';
    
    // IMPORTANT: First check if this is a cancel intent - those take priority
    if (this.isCancelIntent(text)) {
      return false;
    }
    
    const cartPatterns = [
      /\bmy cart\b/, /\bview cart\b/, /\bshow cart\b/, /\bsee cart\b/, /\bcheck cart\b/, /\bopen cart\b/,
      /\bmy items\b/, /\bshow items\b/, /\bview items\b/, /\bsee items\b/, /\bcheck items\b/,
      /\bshow my items\b/, /\bview my items\b/, /\bsee my items\b/, /\bcheck my items\b/,
      /\bmy basket\b/, /\bshow basket\b/, /\bview basket\b/, /\bsee basket\b/,
      /\bwhat'?s in my cart\b/, /\bwhats in cart\b/, /\bwhat'?s in cart\b/, /\bwhat in cart\b/,
      /^cart$/, /^items$/, /^basket$/,
      /^view cart$/, /^view my cart$/, /^show cart$/, /^show my cart$/, /^my cart$/,
      /\bplease show cart\b/, /\bplease show items\b/, /\bplease show my cart\b/,
      /\bwant to see cart\b/, /\bwant to see items\b/, /\bwant to view cart\b/,
      /\bi want see cart\b/, /\bi want my cart\b/
    ];
    return cartPatterns.some(pattern => pattern.test(lowerText));
  },

  // Helper to detect simple/standalone cart keyword
  isSimpleCartKeyword(text) {
    if (!text) return false;
    const trimmed = text.trim().toLowerCase();
    const simpleCartPatterns = [/^cart$/, /^items$/, /^basket$/];
    return simpleCartPatterns.some(pattern => pattern.test(trimmed));
  },

  // Helper to detect clear/empty cart intent from text/voice
  isClearCartIntent(text) {
    if (!text) return false;
    const lowerText = ' ' + text.toLowerCase() + ' ';
    const clearCartPatterns = [
      /\bclear cart\b/, /\bclear my cart\b/, /\bclear the cart\b/, /\bempty cart\b/, /\bempty my cart\b/,
      /\bremove cart\b/, /\bremove my cart\b/, /\bremove the cart\b/, /\bremove all from cart\b/,
      /\bremove all\b/, /\bremove items\b/, /\bremove all items\b/, /\bremove my items\b/, /\bremove everything\b/,
      /\bdelete cart\b/, /\bdelete my cart\b/, /\bdelete the cart\b/,
      /\bdelete all\b/, /\bdelete items\b/, /\bdelete my items\b/, /\bdelete all items\b/, /\bdelete everything\b/,
      /\bclean cart\b/, /\bclean my cart\b/, /\breset cart\b/, /\breset my cart\b/,
      /\bcancel cart\b/, /\bcancel my cart\b/, /\bcancel items\b/, /\bcancel my items\b/, /\bcancel all\b/,
      /\bclear basket\b/, /\bempty basket\b/, /\bremove basket\b/, /\bdelete basket\b/,
      /\bclear all\b/, /\bclear items\b/, /\bclear my items\b/, /\bclear all items\b/,
      /\bstart fresh\b/, /\bstart over\b/, /\bfresh start\b/,
      /\bplease clear cart\b/, /\bplease remove cart\b/, /\bplease delete cart\b/,
      /\bplease clear items\b/, /\bplease remove items\b/, /\bplease delete items\b/,
      /\bwant to clear cart\b/, /\bwant to remove cart\b/, /\bwant to delete cart\b/,
      /\bwant to clear items\b/, /\bwant to remove items\b/, /\bwant to delete items\b/
    ];
    return clearCartPatterns.some(pattern => pattern.test(lowerText));
  },

  // Helper to detect "add to cart" intent from text/voice
  // Returns: { itemName: string } or null
  isAddToCartIntent(text) {
    if (!text) return null;
    const lowerText = text.toLowerCase().trim();
    
    // Patterns to extract item name from "add X to cart" style messages
    const addPatterns = [
      /add\s+(.+?)\s+to\s+cart/i,
      /add\s+(.+?)\s+(?:to\s+)?(?:my\s+)?cart/i,
      /(?:i\s+)?want\s+(?:to\s+)?add\s+(.+?)\s+(?:to\s+)?cart/i,
      /put\s+(.+?)\s+in\s+cart/i,
      /(.+?)\s+add\s+(?:to\s+)?cart/i,
      /^(.+?)\s+add$/i,
      /^add\s+(.+)$/i,
    ];
    
    for (const pattern of addPatterns) {
      const match = lowerText.match(pattern);
      if (match && match[1]) {
        const itemName = match[1].trim();
        // Filter out common words that aren't item names
        if (itemName.length > 1 && !['to', 'the', 'a', 'an', 'my', 'this', 'that'].includes(itemName)) {
          return { itemName };
        }
      }
    }
    return null;
  },

  // Helper to detect website CART order format (multiple items)
  // Detects: "🛒 Order from Website\n1. Item x2 - ₹XXX\n2. Item x1 - ₹XXX\nTotal: ₹XXX"
  // Returns: { items: [{ name, quantity, price }], total: number, offerIds: [] } or null
  isWebsiteCartOrderIntent(text) {
    if (!text || typeof text !== 'string') return null;
    
    const lowerText = text.toLowerCase();
    
    // Must contain "order from website" or similar cart indicators
    if (!lowerText.includes('order from website') && !lowerText.includes('cart order')) {
      return null;
    }
    
    logger.info('Website CART order check - message', { cart: text });
    
    const items = [];
    let total = null;
    const offerIds = [];
    
    // Parse each line looking for item patterns like "1. Item Name x2 - ₹398"
    const lines = text.split('\n').map(l => l.trim()).filter(l => l);
    
    for (const line of lines) {
      // Pattern: "1. Item Name (Variant) x2 - ₹398 🎁 #itemId_v0" or without ID
      const itemMatch = line.match(/^\d+\.\s*(.+?)\s*x(\d+)\s*[-–]\s*₹?(\d+)/i);
      if (itemMatch) {
        const rawName = itemMatch[1].trim();
        const quantity = parseInt(itemMatch[2]);
        const price = parseInt(itemMatch[3]);
        const hasOffer = line.includes('🎁');
        
        // Extract item ID if present: #<24-char hex>_v<N>_q<N> or #<24-char hex>_v<N> or #<24-char hex>
        const idMatch = line.match(/#([a-f0-9]{24})(?:_v(\d+))?(?:_q(\d+))?/i);
        const itemId = idMatch ? idMatch[1] : null;
        const variantIndex = idMatch && idMatch[2] !== undefined ? parseInt(idMatch[2]) : null;
        const quantityIndex = idMatch && idMatch[3] !== undefined ? parseInt(idMatch[3]) : null;
        
        // Clean name: strip variant label in parentheses and quantity in brackets for name matching
        const name = rawName.replace(/\s*\([^)]+\)\s*/g, ' ').replace(/\s*\[[^\]]+\]\s*/g, ' ').trim();
        const variantLabel = rawName.match(/\(([^)]+)\)$/)?.[1] || null;
        // Extract quantity label from square brackets e.g. [1 kg]
        const quantityLabelMatch = rawName.match(/\[([^\]]+)\]/);
        const quantityLabel = quantityLabelMatch ? quantityLabelMatch[1] : null;
        
        items.push({ name, quantity, price, hasOffer, itemId, variantIndex, variantLabel, quantityIndex, quantityLabel });
        logger.info('Found cart item', { name, quantity, price, hasOffer, itemId, variantIndex, variantLabel, quantityIndex, quantityLabel });
      }
      
      // Extract total
      const totalMatch = line.match(/total[:\s]*₹?\s*(\d+)/i);
      if (totalMatch) {
        total = parseInt(totalMatch[1]);
      }
      
      // Extract offer IDs - Pattern: "(ID: 507f1f77bcf86cd799439011)"
      const offerIdMatch = line.match(/\(ID:\s*([a-f0-9]{24})\)/i);
      if (offerIdMatch) {
        offerIds.push(offerIdMatch[1]);
        logger.info('Found offer ID', { offer: offerIdMatch[1] });
      }
    }
    
    if (items.length > 0) {
      logger.info('Website cart order extracted', { items, total, offerIds });
      return { items, total, offerIds };
    }
    
    return null;
  },

  // Helper to detect website order format (single item)
  // Detects messages from website with item name and price, or #WEB_<itemId> format
  // Returns: { itemName: string, price: number, itemId: string|null, variantIndex: number|null, quantityIndex: number|null, quantity: number } or null
  isWebsiteOrderIntent(text) {
    if (!text || typeof text !== 'string') return null;
    
    const lowerText = text.toLowerCase();
    
    // Method 1: Check for #WEB_<itemId> pattern (new format from website)
    // Format: #WEB_<itemId>[_v<variantIndex>][_q<quantityOptionIndex>]
    const webIdMatch = text.match(/#WEB_([a-f0-9]{24})(?:_v(\d+))?(?:_q(\d+))?/i);
    if (webIdMatch) {
      const itemId = webIdMatch[1];
      const variantIndex = webIdMatch[2] !== undefined ? parseInt(webIdMatch[2]) : null;
      const quantityIndex = webIdMatch[3] !== undefined ? parseInt(webIdMatch[3]) : null;
      
      // Extract purchase quantity from "x{number}" in message
      const qtyMatch = text.match(/\sx(\d+)\s/);
      const quantity = qtyMatch ? parseInt(qtyMatch[1]) : 1;
      
      // Extract item name from bold text
      const nameMatch = text.match(/\*([^*]+)\*/);
      const itemName = nameMatch ? nameMatch[1].trim() : null;
      
      // Extract price
      const priceMatch = text.match(/₹\s*(\d+)/);
      const price = priceMatch ? parseInt(priceMatch[1]) : null;
      
      logger.info('Website order (ID format)', { itemId, variantIndex, quantityIndex, quantity, itemName, price });
      return { itemName, price, itemId, variantIndex, quantityIndex, quantity };
    }
    
    // Method 2: Legacy format detection (text-based)
    // Must contain order-related phrases or website format markers
    const hasOrderPhrase = lowerText.includes('like to order') || 
                          lowerText.includes('want to order') ||
                          lowerText.includes("i'd like to order");
    const hasWebsiteFormat = lowerText.includes('price') && text.includes('₹');
    
    if (!hasOrderPhrase && !hasWebsiteFormat) {
      return null;
    }
    
    logger.info('Website order check - message', { order: text });
    
    let itemName = null;
    let price = null;
    
    // Method 1: Parse line by line
    const lines = text.split('\n').map(l => l.trim()).filter(l => l);
    logger.info('Lines', { line: lines });
    
    for (const line of lines) {
      const lowerLine = line.toLowerCase();
      
      // Skip lines that contain "price", "hi", "please", "confirm", "availability"
      if (lowerLine.includes('price') || 
          lowerLine.includes('hi!') || 
          lowerLine.includes('please') || 
          lowerLine.includes('confirm') ||
          lowerLine.includes('availability') ||
          lowerLine.includes('order')) {
        continue;
      }
      
      // This line might be the item name - clean it up
      // Remove ALL non-alphanumeric characters from start, keep the rest
      // This handles any unicode symbols like ◆ ◇ ♦ ● etc
      let cleanedLine = line;
      
      // Remove any character that's not a letter, number, or space from the beginning
      cleanedLine = cleanedLine.replace(/^[^\w\s]+/g, '').trim();
      // Also remove from end
      cleanedLine = cleanedLine.replace(/[^\w\s]+$/g, '').trim();
      // Remove asterisks anywhere
      cleanedLine = cleanedLine.replace(/\*/g, '').trim();
      
      logger.info('Cleaned line', { line: `"${line}" -> "${cleanedLine}"` });
      
      if (cleanedLine.length > 1) {
        itemName = cleanedLine;
        logger.info('Found item name', { items: itemName });
        break; // Take the first valid line as item name
      }
    }
    
    // Extract price
    const priceMatch = text.match(/₹\s*(\d+)/);
    if (priceMatch) price = parseInt(priceMatch[1]);
    
    if (itemName && itemName.length > 1) {
      logger.info('Website order extracted', { itemName, price });
      return { itemName, price, itemId: null, variantIndex: null, quantity: 1 };
    }
    
    logger.info('Could not extract item name from website order');
    return null;
  },

  // Smart word boundary matching - prevents "ice" from matching "rice"
  // Short search terms (3 chars or less) must match at word boundary (start of word or exact match)
  // Longer terms can match anywhere but with lower priority for mid-word matches
  smartIncludes(searchTerm, targetText) {
    if (!searchTerm || !targetText) return false;
    
    const search = searchTerm.toLowerCase().trim();
    const target = targetText.toLowerCase();
    
    // Exact match - always valid
    if (target === search) return true;
    
    // For very short search terms (1-3 chars), require word boundary matching
    if (search.length <= 3) {
      // Create regex that matches search term at word boundary
      // This matches: "ice cream" when searching "ice", but NOT "rice" when searching "ice"
      const wordBoundaryRegex = new RegExp(`(^|\\s|-)${this.escapeRegex(search)}(\\s|$|-)`, 'i');
      const startsWithRegex = new RegExp(`(^|\\s|-)${this.escapeRegex(search)}`, 'i');
      
      // Check if it matches as a complete word or at start of a word
      if (wordBoundaryRegex.test(target)) return true;
      if (startsWithRegex.test(target)) return true;
      
      return false;
    }
    
    // For longer search terms (4+ chars), check if it appears at word start
    // This allows "biryani" to match "chicken biryani" and also "bir" at start
    const wordStartRegex = new RegExp(`(^|\\s|-)${this.escapeRegex(search)}`, 'i');
    if (wordStartRegex.test(target)) return true;
    
    // Also allow if search term contains the target as a whole word
    // e.g., "chicken biryani" contains "chicken" ✓, but "rice" should NOT match "ice" ✗
    if (search.includes(target)) {
      // Verify target appears at a word boundary within search
      const targetBoundaryRegex = new RegExp(`(^|\\s|-)${this.escapeRegex(target)}(\\s|$|-)`, 'i');
      if (targetBoundaryRegex.test(search)) return true;
    }
    
    // For 4+ char terms, allow substring match but only at word start
    const targetWords = target.split(/\s+/);
    for (const word of targetWords) {
      if (word.startsWith(search)) return true;
      // Allow if search is at least 60% of the word length and matches from start of word
      if (search.length >= 4 && word.length >= 4 && word.startsWith(search) && search.length >= word.length * 0.6) {
        return true;
      }
    }
    
    return false;
  },

  // Helper to escape special regex characters
  escapeRegex(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  },

  // Helper to detect show menu/items intent from text
  // Returns: { showMenu: true, foodType: 'veg'|'nonveg'|'both'|null, searchTerm: string|null }
  isShowMenuIntent(text) {
    if (!text) return null;
    const lowerText = ' ' + text.toLowerCase() + ' ';
    
    // Patterns for showing menu/items
    const menuPatterns = [
      /\bshow\s+(?:me\s+)?(?:the\s+)?menu\b/, /\bshow\s+(?:me\s+)?(?:all\s+)?items\b/,
      /\bshow\s+(?:me\s+)?(?:the\s+)?food\b/, /\bwhat\s+(?:do\s+you\s+have|items|food)\b/,
      /\blist\s+(?:all\s+)?(?:items|menu|food)\b/, /\bdisplay\s+(?:menu|items)\b/,
      /\bsee\s+(?:the\s+)?(?:menu|items|food)\b/, /\bview\s+(?:all\s+)?(?:items|food)\b/,
      /\ball\s+items\b/, /\bfull\s+menu\b/, /\bentire\s+menu\b/,
      /\ball\s+menu\b/, /\bshow\s+all\s+menu\b/, /\bview\s+all\s+menu\b/, /\bsee\s+all\s+menu\b/,
      /\bcomplete\s+menu\b/, /\bwhole\s+menu\b/, /\ball\s+food\b/, /\bshow\s+all\s+food\b/,
      /\bbrowse\s+(?:the\s+)?menu\b/, /\bbrowse\s+(?:the\s+)?items\b/,
      /\bexplore\s+(?:the\s+)?menu\b/, /\bcheck\s+(?:the\s+)?menu\b/,
      /\bopen\s+(?:the\s+)?menu\b/, /\bview\s+(?:the\s+)?menu\b/
    ];
    
    // Patterns specifically for veg items
    const vegPatterns = [
      /\bveg\s+(?:items?|menu|food|dishes?)\b/, /\bvegetarian\s+(?:items?|menu|food|dishes?)\b/,
      /\bshow\s+(?:me\s+)?veg\b/, /\bonly\s+veg\b/, /\bpure\s+veg\b/
    ];
    
    // Patterns specifically for egg items
    const eggPatterns = [
      /\begg\s+(?:items?|menu|food|dishes?)\b/,
      /\bshow\s+(?:me\s+)?egg\b/, /\bonly\s+egg\b/
    ];
    
    // Patterns specifically for non-veg items
    const nonvegPatterns = [
      /\bnon[\s-]?veg\s+(?:items?|menu|food|dishes?)\b/, /\bnonveg\s+(?:items?|menu|food|dishes?)\b/,
      /\bshow\s+(?:me\s+)?non[\s-]?veg\b/, /\bonly\s+non[\s-]?veg\b/,
      /\bmeat\s+(?:items?|menu|dishes?)\b/
    ];
    
    const trimmedText = text.toLowerCase().trim();
    const words = trimmedText.split(/\s+/).filter(w => w.length > 0);
    const menuWords = ['menu', 'items', 'item', 'food', 'dishes', 'dish', 'show', 'me', 'the', 'all', 'only'];
    
    const isStandaloneKeyword = (keywords) => {
      const nonMenuWords = words.filter(w => !keywords.includes(w) && !menuWords.includes(w));
      return nonMenuWords.length === 0 && words.some(w => keywords.includes(w));
    };
    
    // Check for egg-specific intent
    const isEggCompound = eggPatterns.some(pattern => pattern.test(lowerText));
    const isEggStandalone = isStandaloneKeyword(['egg', 'eggs']);
    if (isEggCompound || isEggStandalone) {
      return { showMenu: true, foodType: 'egg', searchTerm: null };
    }
    
    // Check for non-veg-specific intent
    const hasNonPrefix = /\bnon[\s-]?veg/i.test(lowerText) || /\bnonveg/i.test(lowerText);
    const isNonvegCompound = hasNonPrefix && nonvegPatterns.some(pattern => pattern.test(lowerText));
    const isNonvegStandalone = isStandaloneKeyword(['nonveg', 'non-veg']) || (hasNonPrefix && words.filter(w => !menuWords.includes(w) && w !== 'non' && w !== 'veg' && w !== 'nonveg' && w !== 'non-veg').length === 0);
    if (isNonvegCompound || isNonvegStandalone) {
      return { showMenu: true, foodType: 'nonveg', searchTerm: null };
    }
    
    // Check for veg-specific intent
    const isVegCompound = vegPatterns.some(pattern => pattern.test(lowerText));
    const isVegStandalone = !hasNonPrefix && isStandaloneKeyword(['veg', 'vegetarian', 'veggie']);
    if (isVegCompound || isVegStandalone) {
      return { showMenu: true, foodType: 'veg', searchTerm: null };
    }
    
    // Check for general menu intent
    if (menuPatterns.some(pattern => pattern.test(lowerText))) {
      return { showMenu: true, foodType: 'both', searchTerm: null };
    }
    
    // Check for standalone menu keywords
    const standaloneMenuPatterns = [
      /^menu$/, /^browse menu$/, /^view menu$/, /^show menu$/, /^see menu$/,
      /^check menu$/, /^open menu$/, /^explore menu$/, /^the menu$/,
      /^food menu$/, /^our menu$/, /^your menu$/
    ];
    if (standaloneMenuPatterns.some(pattern => pattern.test(trimmedText))) {
      return { showMenu: true, foodType: 'both', searchTerm: null };
    }
    
    return null;
  },

  // Helper to detect track order intent from text
  isTrackIntent(text) {
    if (!text) return false;
    const lowerText = ' ' + text.toLowerCase() + ' ';
    const trackPatterns = [
      /\btrack\b/, /\btrack order\b/, /\btrack my order\b/, /\btracking\b/,
      /\bwhere is my order\b/, /\bwhere'?s my order\b/, /\border location\b/,
      /\bdelivery status\b/, /\bwhen will.+arrive\b/, /\bwhere is.+order\b/
    ];
    return trackPatterns.some(pattern => pattern.test(lowerText));
  },

  // Helper to detect order status intent from text
  isOrderStatusIntent(text) {
    if (!text) return false;
    const lowerText = ' ' + text.toLowerCase() + ' ';
    
    // First check if it's actually a cancel/track intent - those take priority
    if (this.isCancelIntent(text) || this.isTrackIntent(text)) {
      return false;
    }
    
    const statusPatterns = [
      /\border status\b/, /\bcheck order\b/, /\border history\b/, /\bprevious order\b/,
      /\bpast order\b/, /\bshow order\b/, /\bview order\b/, /\border details\b/,
      /\bmy orders\b/, /\bmy order\b/, /\bstatus\b/,
      /^order$/, /^orders$/
    ];
    return statusPatterns.some(pattern => pattern.test(lowerText));
  },

  // Helper to find category by name
  findCategory(text, menuItems) {
    // Flatten category arrays and dedupe (category is an array field)
    const categories = [...new Set(menuItems.flatMap(m => Array.isArray(m.category) ? m.category : [m.category]))];
    const lowerText = text.toLowerCase().trim();
    
    // First try exact match or whole-word match (prevents "ice" matching "Rice Bowls")
    const exactMatch = categories.find(cat => {
      const catLower = cat.toLowerCase();
      if (catLower === lowerText) return true;
      // Check if search text matches a whole word in category name
      const searchWordRegex = new RegExp(`(^|\\s|-)${lowerText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$|-)`, 'i');
      if (searchWordRegex.test(catLower)) return true;
      // Check if category name matches a whole word in search text
      const catWordRegex = new RegExp(`(^|\\s|-)${catLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$|-)`, 'i');
      if (catWordRegex.test(lowerText)) return true;
      return false;
    });
    if (exactMatch) return exactMatch;
    
    // Try fuzzy matching for category
    let bestMatch = null;
    let bestScore = 0;
    
    for (const cat of categories) {
      const catLower = cat.toLowerCase();
      const score = this.similarityRatio(lowerText, catLower);
      if (score > bestScore && score >= 0.6) {
        bestScore = score;
        bestMatch = cat;
      }
    }
    
    return bestMatch;
  },

  // Helper to calculate Levenshtein distance between two strings
  // Used for fuzzy matching to handle typos like "manchuya" → "manchurian"
  levenshteinDistance(str1, str2) {
    const m = str1.length;
    const n = str2.length;
    
    // Create a matrix to store distances
    const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));
    
    // Initialize first column and row
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    
    // Fill in the rest of the matrix
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (str1[i - 1] === str2[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1];
        } else {
          dp[i][j] = 1 + Math.min(
            dp[i - 1][j],     // deletion
            dp[i][j - 1],     // insertion
            dp[i - 1][j - 1]  // substitution
          );
        }
      }
    }
    
    return dp[m][n];
  },

  // Helper to calculate similarity ratio (0 to 1, where 1 is exact match)
  similarityRatio(str1, str2) {
    const s1 = str1.toLowerCase();
    const s2 = str2.toLowerCase();
    const distance = this.levenshteinDistance(s1, s2);
    const maxLen = Math.max(s1.length, s2.length);
    if (maxLen === 0) return 1;
    return 1 - (distance / maxLen);
  },

  // Helper to check if search query is gibberish (random characters with no meaning)
  isGibberishSearch(query) {
    if (!query || query.length < 2) return true;
    const cleaned = query.toLowerCase().trim();
    
    // Check for common patterns that indicate gibberish
    // 1. Too many consonants in a row (more than 4 without vowels)
    const consonantStreak = /[bcdfghjklmnpqrstvwxyz]{5,}/i.test(cleaned);
    if (consonantStreak) return true;
    
    // 2. No vowels at all in a word of 4+ chars
    const words = cleaned.split(/\s+/);
    for (const word of words) {
      if (word.length >= 4 && !/[aeiou]/i.test(word)) {
        return true;
      }
    }
    
    // 3. Unusual character repetition (same char 3+ times)
    if (/(.)\1{2,}/.test(cleaned)) return true;
    
    // 4. Very low vowel-to-consonant ratio for longer words
    for (const word of words) {
      if (word.length >= 5) {
        const vowels = (word.match(/[aeiou]/gi) || []).length;
        const ratio = vowels / word.length;
        if (ratio < 0.15) return true; // Less than 15% vowels
      }
    }
    
    return false;
  },

  // Helper to find fuzzy matches for a search term
  // Returns items where name or tags have similarity >= threshold
  fuzzySearchItems(searchTerm, menuItems, threshold = 0.5) {
    if (!searchTerm || searchTerm.length < 2) return [];
    
    // Skip fuzzy search for gibberish queries
    if (this.isGibberishSearch(searchTerm)) {
      logger.info('Gibberish search detected', { searchTerm });
      return [];
    }
    
    const searchLower = searchTerm.toLowerCase().trim();
    const searchWords = searchLower.split(/\s+/).filter(w => w.length >= 2);
    const fuzzyMatches = [];
    
    for (const item of menuItems) {
      let bestScore = 0;
      let matchedOn = null;
      
      // Check item name
      const nameLower = item.name.toLowerCase();
      let nameScore = this.similarityRatio(searchLower, nameLower);
      // Also check if search matches a word in the name
      const nameWords = nameLower.split(/\s+/);
      for (const nw of nameWords) {
        if (nw.length >= 2) {
          nameScore = Math.max(nameScore, this.similarityRatio(searchLower, nw));
          for (const sw of searchWords) {
            nameScore = Math.max(nameScore, this.similarityRatio(sw, nw));
          }
        }
      }
      if (nameScore > bestScore) {
        bestScore = nameScore;
        matchedOn = 'name';
      }
      
      // Check tags
      if (item.tags && item.tags.length > 0) {
        for (const tag of item.tags) {
          const tagLower = tag.toLowerCase();
          let tagScore = this.similarityRatio(searchLower, tagLower);
          const tagWords = tagLower.split(/\s+/);
          for (const tw of tagWords) {
            if (tw.length >= 2) {
              tagScore = Math.max(tagScore, this.similarityRatio(searchLower, tw));
              for (const sw of searchWords) {
                tagScore = Math.max(tagScore, this.similarityRatio(sw, tw));
              }
            }
          }
          if (tagScore > bestScore) {
            bestScore = tagScore;
            matchedOn = 'tag';
          }
        }
      }
      
      // Check categories
      const categories = Array.isArray(item.category) ? item.category : [item.category];
      for (const cat of categories) {
        if (cat) {
          const catScore = this.similarityRatio(searchLower, cat.toLowerCase());
          if (catScore > bestScore) {
            bestScore = catScore;
            matchedOn = 'category';
          }
        }
      }
      
      // Check variant labels
      if (item.variants && item.variants.length > 0) {
        for (const variant of item.variants) {
          if (variant.label) {
            const variantLower = variant.label.toLowerCase();
            let variantScore = this.similarityRatio(searchLower, variantLower);
            const variantWords = variantLower.split(/\s+/);
            for (const vw of variantWords) {
              if (vw.length >= 3) {
                variantScore = Math.max(variantScore, this.similarityRatio(searchLower, vw));
                for (const sw of searchWords) {
                  variantScore = Math.max(variantScore, this.similarityRatio(sw, vw));
                }
              }
            }
            if (variantScore > bestScore) {
              bestScore = variantScore;
              matchedOn = 'variant';
            }
          }
        }
      }
      
      // If best score meets threshold, add to results
      if (bestScore >= threshold) {
        fuzzyMatches.push({
          item,
          score: bestScore,
          matchedOn
        });
      }
    }
    
    // Sort by score (highest first) and return items
    return fuzzyMatches
      .sort((a, b) => b.score - a.score)
      .map(m => m.item);
  },

  // Helper to find item by name
  findItem(text, menuItems) {
    const lowerText = text.toLowerCase().trim();
    
    // First try exact match
    const exactMatch = menuItems.find(item => 
      item.name.toLowerCase() === lowerText
    );
    if (exactMatch) return exactMatch;
    
    // Then try smart word boundary matching (prevents "ice" → "rice")
    const smartMatch = menuItems.find(item => 
      this.smartIncludes(lowerText, item.name) || 
      this.smartIncludes(item.name.toLowerCase(), lowerText)
    );
    if (smartMatch) return smartMatch;
    
    // Fuzzy fallback
    if (lowerText.length >= 2) {
      for (const item of menuItems) {
        const nameLower = item.name.toLowerCase();
        if (this.similarityRatio(lowerText, nameLower) >= 0.6) {
          return item;
        }
      }
    }
    
    return null;
  },

  // Helper to find items by tag keyword
  findItemsByTag(text, menuItems) {
    const lowerText = text.toLowerCase().trim();
    if (lowerText.length < 2) return null;
    
    // First try exact match on tags
    let matchingItems = menuItems.filter(item => 
      item.tags?.some(tag => tag.toLowerCase() === lowerText)
    );
    
    // Then try smart word boundary matching (prevents "ice" → "rice")
    if (matchingItems.length === 0) {
      matchingItems = menuItems.filter(item => 
        item.tags?.some(tag => 
          this.smartIncludes(lowerText, tag) || 
          this.smartIncludes(tag.toLowerCase(), lowerText)
        )
      );
    }
    
    // Fuzzy fallback if no exact matches
    if (matchingItems.length === 0 && lowerText.length >= 2) {
      matchingItems = menuItems.filter(item => {
        return item.tags?.some(tag => {
          const tagLower = tag.toLowerCase();
          return this.similarityRatio(lowerText, tagLower) >= 0.6;
        });
      });
    }
    
    return matchingItems.length > 0 ? matchingItems : null;
  },

  // Helper to find items by name OR tag keyword (exact matching only - no fuzzy/typo)
  // Multi-keyword search priority:
  // 1. ALL keywords match in same item (AND logic) - exact match
  // 2. ANY keyword matches exactly (OR logic) - shows all items matching any keyword
  findItemsByNameOrTag(text, menuItems) {
    const lowerText = text.toLowerCase().trim();
    if (lowerText.length < 2) return null;
    
    // Split into keywords (no typo correction)
    const keywords = lowerText.split(/\s+/).filter(k => k.length >= 2);
    
    // Helper to check if item matches a keyword (exact or smart boundary)
    const itemMatchesKeyword = (item, keyword) => {
      const nameLower = item.name.toLowerCase();
      // Exact name match
      if (nameLower === keyword) return true;
      // Exact tag match
      if (item.tags?.some(tag => tag.toLowerCase() === keyword)) return true;
      // Smart boundary match on name (prevents "ice" → "rice")
      if (this.smartIncludes(keyword, item.name)) return true;
      // Smart boundary match on tags
      if (item.tags?.some(tag => this.smartIncludes(keyword, tag))) return true;
      return false;
    };
    
    // ========== STEP 1: ALL keywords match same item (AND logic) ==========
    if (keywords.length >= 2) {
      const andMatches = menuItems.filter(item => {
        // Every keyword must match this item
        return keywords.every(kw => itemMatchesKeyword(item, kw));
      });
      
      if (andMatches.length > 0) {
        logger.info('Multi-keyword AND match', { text, matchCount: andMatches.length });
        return andMatches;
      }
    }
    
    // ========== STEP 2: ANY keyword matches (OR logic) ==========
    // Find all items that match ANY of the keywords
    let matchingItems = menuItems.filter(item => {
      for (const keyword of keywords) {
        if (itemMatchesKeyword(item, keyword)) return true;
      }
      return false;
    });
    
    if (matchingItems.length > 0) {
      logger.info('Multi-keyword OR match', { text, matchCount: matchingItems.length });
      return matchingItems;
    }
    
    // Also check full text as single term (for multi-word item names like "ice cream")
    const fullTextMatch = menuItems.filter(item => itemMatchesKeyword(item, lowerText));
    if (fullTextMatch.length > 0) {
      logger.info('Full text match', { text, matchCount: fullTextMatch.length });
      return fullTextMatch;
    }
    
    return null;
  },

  // Helper to detect food type preference from message text
  // Returns: 'veg', 'nonveg', 'egg', or specific ingredient like 'chicken', 'mutton', etc.
  detectFoodTypeFromMessage(text) {
    const lowerText = ' ' + text.toLowerCase() + ' ';
    
    // Check for specific non-veg ingredients first (most specific)
    const specificNonveg = [
      { pattern: /\bchicken\b/, type: 'chicken' },
      { pattern: /\bmutton\b/, type: 'mutton' },
      { pattern: /\bfish\b/, type: 'fish' },
      { pattern: /\bprawn\b/, type: 'prawn' },
      { pattern: /\bkeema\b/, type: 'keema' },
      { pattern: /\bbeef\b/, type: 'beef' },
      { pattern: /\bpork\b/, type: 'pork' },
      { pattern: /\bseafood\b/, type: 'seafood' },
    ];
    
    for (const item of specificNonveg) {
      if (item.pattern.test(lowerText)) {
        return { type: 'specific', ingredient: item.type };
      }
    }
    
    // Check for egg specifically
    if (/\begg\b/.test(lowerText) && !/\beggless\b/.test(lowerText)) {
      // If "egg" appears with other meaningful words (e.g. "egg curry", "egg biryani"),
      // treat as specific ingredient search so it matches by name/tags, not just foodType
      const withoutEgg = lowerText.replace(/\begg\b/g, '').trim();
      if (withoutEgg.replace(/\s+/g, '').length >= 2) {
        return { type: 'specific', ingredient: 'egg' };
      }
      return { type: 'egg' };
    }
    
    // Check for nonveg general keywords (with space variations)
    const nonvegPatterns = [/\bnonveg\b/, /\bnon-veg\b/, /\bnon\s+veg\b/, /\bmeat\b/];
    const hasNonveg = nonvegPatterns.some(pattern => pattern.test(lowerText));
    
    // Check for veg keywords - but make sure "non veg" doesn't match as "veg"
    const hasNonVegPhrase = /\bnon[\s-]?veg/.test(lowerText);
    const vegPatterns = [/\bveg\b/, /\bvegetarian\b/, /\bveggie\b/, /\bpure veg\b/, /\beggless\b/];
    const hasVeg = !hasNonVegPhrase && vegPatterns.some(pattern => pattern.test(lowerText));
    
    if (hasVeg && !hasNonveg) return { type: 'veg' };
    if (hasNonveg) return { type: 'nonveg' }; // nonveg includes egg
    
    return null;
  },

  // Helper to remove food type keywords from search text
  // Only removes general food type keywords (veg/nonveg), NOT specific ingredients like chicken/mutton
  removeFoodTypeKeywords(text) {
    let cleanText = text.toLowerCase();
    // Remove only general food type keywords, keep specific ingredients for search
    const patterns = [
      /\bpure veg\b/gi, /\bnon[\s-]?veg\b/gi,  // Multi-word first
      /\bvegetarian\b/gi, /\bveggie\b/gi, /\bveg\b/gi,
      /\bnonveg\b/gi
      // Removed: chicken, mutton, fish, prawn, egg, meat, keema, beef, pork, seafood
      // These are kept for searching items by ingredient
    ];
    patterns.forEach(pattern => {
      cleanText = cleanText.replace(pattern, ' ');
    });
    return cleanText.trim().replace(/\s+/g, ' ');
  },

  // Helper to normalize text by removing common plural suffixes
  // This helps match "milk shakes" with "milk shake", "biryanis" with "biryani", etc.
  normalizePlural(text) {
    if (!text) return text;
    let normalized = text.toLowerCase().trim();
    // Remove trailing 's' or 'es' for common plural forms
    // But be careful with words that naturally end in 's' (like 'rice', 'juice')
    const preserveWords = ['rice', 'juice', 'fries', 'noodles', 'pickles', 'chips', 'oats', 'nuts', 'peas', 'beans', 'greens', 'meals', 'sweets'];
    
    // Check each word in the text
    const words = normalized.split(/\s+/);
    const normalizedWords = words.map(word => {
      // Skip if word should be preserved
      if (preserveWords.includes(word)) return word;
      // Skip short words
      if (word.length <= 3) return word;
      // Remove 'es' suffix (cakes -> cake, shakes -> shake)
      if (word.endsWith('es') && word.length > 4) {
        return word.slice(0, -1); // shakes -> shake (remove just 's', keep 'e')
      }
      // Remove 's' suffix (items -> item, biryanis -> biryani)
      if (word.endsWith('s') && !word.endsWith('ss')) {
        return word.slice(0, -1);
      }
      return word;
    });
    return normalizedWords.join(' ');
  },

  // Simple pass-through for search text (no translation)
  async translateWithAI(text) {
    const lowerText = text.toLowerCase().trim();
    return { primary: lowerText, variations: [lowerText] };
  },

  // Smart search - detects food type and searches by name/tag (async for AI translation)
  // Improved: Tag-based search with food type, quantity, and unit matching
  // Reduced AI dependency - uses local tag matching first
  // Example: "veg curry" → finds items with tags containing "veg" AND "curry"
  // Example: "5 piece" → finds items with quantity/unit tag "5 piece"
  async smartSearch(text, menuItems) {
    // (removed decoration log);
    logger.info('Smart search called', { text });
    // (removed decoration log);
    
    // Early return for gibberish searches
    if (this.isGibberishSearch(text)) {
      logger.info('Gibberish search detected', { text });
      return null;
    }
    
    // ========== DETECT FOOD TYPE FIRST ==========
    const originalText = text.toLowerCase().trim();
    const originalFoodType = this.detectFoodTypeFromMessage(originalText);
    logger.info('Food type detection', { text });
    
    // ========== NO TYPO CORRECTION - USE ORIGINAL TEXT DIRECTLY ==========
    // Typo correction was causing issues like "liver" → "liter", "bread" → "cream"
    // Just use the original text as-is
    let correctedText = originalText;
    const words = originalText.split(/\s+/);
    
    // Use original text for translation (no typo correction)
    const translationResult = await this.translateWithAI(correctedText);
    const primaryText = translationResult.primary.toLowerCase().trim();
    let allVariations = translationResult.variations || [primaryText];
    
    // Add original text if different from translation
    if (originalText !== primaryText && !allVariations.includes(originalText)) {
      allVariations.push(originalText);
    }
    
    if (primaryText.length < 2) return null;
    
    // Use the original food type detection
    const detected = originalFoodType || this.detectFoodTypeFromMessage(primaryText);
    logger.info('Smart search details', { text, primaryText, detected });
    
    // Remove food type keywords to get clean search terms
    // Use ORIGINAL text for removing keywords to preserve user intent
    const primarySearchTerm = this.removeFoodTypeKeywords(originalText);
    logger.info('Food type keywords removed', { text });
    
    // Get all search variations (cleaned of food type keywords)
    const searchVariations = allVariations.map(v => this.removeFoodTypeKeywords(v.toLowerCase())).filter(v => v.length >= 2);
    // Also add the original search term
    if (!searchVariations.includes(primarySearchTerm) && primarySearchTerm.length >= 2) {
      searchVariations.unshift(primarySearchTerm);
    }
    
    // Expand search terms with normalized plurals
    const expandedTerms = [];
    for (const term of searchVariations) {
      expandedTerms.push(term);
      // Also add normalized plural version (e.g., "milk shakes" → "milk shake")
      const normalizedTerm = this.normalizePlural(term);
      if (normalizedTerm !== term) {
        expandedTerms.push(normalizedTerm);
      }
      // Also add normalized plural of each word
      const words = term.split(/\s+/).filter(w => w.length >= 2);
      for (const word of words) {
        expandedTerms.push(word);
        const normalizedWord = this.normalizePlural(word);
        if (normalizedWord !== word) {
          expandedTerms.push(normalizedWord);
        }
      }
    }
    
    // Add unique variations
    let uniqueSearchTerms = [...new Set(expandedTerms)];
    
    // ========== AI-POWERED TAG MATCHING ==========
    // Use Groq AI to match native language or variations to actual tags
    // Collect all available tags from menu items (including variant labels and variant tags)
    const allAvailableTags = [...new Set(menuItems.flatMap(item => [
      ...(item.tags || []),
      ...((item.variants || []).flatMap(v => [v.label, ...(v.tags || [])].filter(Boolean)))
    ]))];
    
    // If search has non-English characters OR limited matches, use AI to find matching tags
    const hasNonEnglish = /[^\x00-\x7F]/.test(text);
    if (hasNonEnglish && allAvailableTags.length > 0) {
      try {
        const aiMatchedTags = await groqAi.matchSearchToTags(text, allAvailableTags);
        if (aiMatchedTags && aiMatchedTags.length > 0) {
          uniqueSearchTerms = [...new Set([...uniqueSearchTerms, ...aiMatchedTags])];
          logger.info('AI tags added', { tags: aiMatchedTags });
        }
      } catch (error) {
        logger.error('AI tag matching failed', { error: error.message });
      }
    }
    
    logger.info('Search terms expanded', { text });
    
    // If search term is too short after removing keywords, search by ingredient/type only
    const hasSearchTerm = primarySearchTerm.length >= 2;
    
    // ========== FILTER ITEMS BY DETECTED FOOD TYPE FIRST ==========
    // If user searched "veg dosa", filter to only veg items before searching
    let searchableItems = menuItems;
    let foodTypeLabel = null;
    
    logger.info('Menu items count', { count: menuItems.length });
    
    if (detected) {
      if (detected.type === 'veg') {
        searchableItems = menuItems.filter(item => item.foodType === 'veg');
        foodTypeLabel = '🌿 Veg';
        logger.info('Filtered to veg items', { count: menuItems.length });
        logger.info('Veg items listed');
      } else if (detected.type === 'egg') {
        // Include items with foodType 'egg' AND items whose name/tags/variants mention 'egg'
        searchableItems = menuItems.filter(item => {
          if (item.foodType === 'egg') return true;
          if (this.smartIncludes('egg', item.name)) return true;
          if (item.tags?.some(tag => this.smartIncludes('egg', tag))) return true;
          if ((item.variants || []).some(v => {
            if (v.label && this.smartIncludes('egg', v.label)) return true;
            if (v.tags?.some(tag => this.smartIncludes('egg', tag))) return true;
            return false;
          })) return true;
          return false;
        });
        foodTypeLabel = '🥚 Egg';
        logger.info('Filtered to egg items', { count: menuItems.length });
      } else if (detected.type === 'nonveg') {
        searchableItems = menuItems.filter(item => item.foodType === 'nonveg' || item.foodType === 'egg');
        foodTypeLabel = '🍗 Non-Veg';
        logger.info('Filtered to non-veg items', { count: menuItems.length });
      } else if (detected.type === 'specific') {
        // For specific ingredients like "chicken", "mutton"
        const ingredient = detected.ingredient;
        searchableItems = menuItems.filter(item => {
          const inName = this.smartIncludes(ingredient, item.name);
          const inTags = item.tags?.some(tag => this.smartIncludes(ingredient, tag));
          // Also check variant labels and variant tags
          const inVariants = (item.variants || []).some(v => {
            if (v.label && this.smartIncludes(ingredient, v.label)) return true;
            if (v.tags?.some(tag => this.smartIncludes(ingredient, tag))) return true;
            return false;
          });
          return inName || inTags || inVariants;
        });
        foodTypeLabel = `🍗 ${ingredient.charAt(0).toUpperCase() + ingredient.slice(1)}`;
        logger.info('Filtered by ingredient', { ingredient, count: menuItems.length });
      }
    } else {
      logger.info('No food type detected, searching all items');
    }
    
    // Helper to normalize text for comparison (removes spaces for flexible matching)
    const normalizeForMatch = (text) => text.toLowerCase().replace(/\s+/g, '');
    
    // Helper to check if words match in any order (e.g., "idli sambar" matches "sambar idli")
    const matchesInAnyOrder = (searchWords, targetText) => {
      const targetLower = targetText.toLowerCase();
      const targetNorm = normalizeForMatch(targetText);
      // Check if all search words appear in the target (in any order)
      return searchWords.every(word => {
        const wordLower = word.toLowerCase();
        // Check both normal and normalized versions
        return targetLower.includes(wordLower) || targetNorm.includes(wordLower);
      });
    };
    
    // ========== VARIANT-LEVEL MATCHING (HIGHEST PRIORITY) ==========
    // Uses ORIGINAL search text (before food-type keyword removal) to match variant labels/tags
    // This ensures "chicken biryani" matches "Chicken Biryani" variant, not "Egg Biryani"
    // When search matches parent name broadly (e.g. "biryani" → "Biryani"), shows ALL variants as catalog list
    {
      const originalWords = originalText.split(/\s+/).filter(w => w.length >= 2);
      
      if (originalWords.length >= 1) {
        // Collect all search words (original + translated variations)
        const allSearchWordsSet = new Set(originalWords);
        for (const term of uniqueSearchTerms) {
          for (const w of term.split(/\s+/).filter(w => w.length >= 2)) {
            allSearchWordsSet.add(w);
          }
        }
        
        // Track ALL matching variants per item (not just the best)
        // Map: itemId → { item, matches: [{ vi, matchCount, allMatch, label }] }
        const variantMatchesPerItem = new Map();
        
        for (const item of searchableItems) {
          if (!item.variants || item.variants.length === 0) continue;
          
          const itemId = item._id.toString();
          const matches = [];
          const parentNameLower = item.name.toLowerCase();
          const parentTagsStr = (item.tags || []).join(' ').toLowerCase();
          
          for (let vi = 0; vi < item.variants.length; vi++) {
            const variant = item.variants[vi];
            if (!variant.label) continue;
            
            const variantLabel = variant.label.toLowerCase();
            const variantTagsStr = (variant.tags || []).join(' ').toLowerCase();
            // Variant-specific text (label + variant tags only)
            const variantOwnText = `${variantLabel} ${variantTagsStr}`;
            // Parent-level text (parent name + parent tags)
            const parentText = `${parentNameLower} ${parentTagsStr}`;
            // Combined for overall matching
            const combinedText = `${parentText} ${variantOwnText}`;
            
            // Match original words against combined parent + variant text
            // Also track whether the match comes from variant's own text
            let matchCount = 0;
            let variantOwnMatchCount = 0;
            for (const word of originalWords) {
              const matchesInCombined = combinedText.includes(word) || this.smartIncludes(word, item.name) || this.smartIncludes(word, variant.label);
              if (matchesInCombined) {
                matchCount++;
                // Check if this word matches in the variant's own text (label/tags)
                if (variantOwnText.includes(word) || this.smartIncludes(word, variant.label)) {
                  variantOwnMatchCount++;
                }
              }
            }
            
            if (matchCount === 0) continue;
            
            matches.push({
              vi,
              matchCount,
              variantOwnMatchCount,
              allMatch: matchCount === originalWords.length,
              // A variant is a "true" variant-level match only if at least one
              // search word matched in the variant's own label/tags (not just parent)
              variantSpecific: variantOwnMatchCount > 0,
              label: variant.label
            });
          }
          
          if (matches.length > 0) {
            variantMatchesPerItem.set(itemId, { item, matches });
          }
        }
        
        if (variantMatchesPerItem.size > 0) {
          // Separate items into: those with ALL-keyword variant matches vs partial-only
          const allKeywordItems = []; // items where at least one variant matches ALL search words
          const partialOnlyItems = []; // items where variants only partially match
          
          for (const [itemId, { item, matches }] of variantMatchesPerItem) {
            const hasAllKeywordMatch = matches.some(m => m.allMatch);
            if (hasAllKeywordMatch) {
              allKeywordItems.push({ itemId, item, matches });
            } else {
              partialOnlyItems.push({ itemId, item, matches });
            }
          }
          
          // PRIORITY: Only use all-keyword matches if any exist; fall back to partial only if none
          // But for partial-only: only keep items that have at least one variant-specific match
          // This prevents "egg idli" from returning ALL egg items just because "egg" matches parent name
          let selectedItems;
          if (allKeywordItems.length > 0) {
            selectedItems = allKeywordItems;
          } else {
            // For partial matches, only keep items where at least one variant matches in its own text
            const variantSpecificPartialItems = partialOnlyItems.filter(({ matches }) =>
              matches.some(m => m.variantSpecific)
            );
            selectedItems = variantSpecificPartialItems;
          }
          
          // Also check for non-variant items whose name matches ALL search words
          // These would be missed since variant matching only checks items WITH variants
          const nonVariantMatches = searchableItems.filter(item => {
            if (item.variants && item.variants.length > 0) return false; // already handled above
            const nameLower = item.name.toLowerCase();
            const nameNorm = normalizeForMatch(item.name);
            const tagStr = (item.tags || []).join(' ').toLowerCase();
            const combined = `${nameLower} ${tagStr}`;
            return originalWords.every(w => 
              combined.includes(w) || this.smartIncludes(w, item.name)
            );
          });
          
          // If no meaningful variant matches remain, skip variant matching entirely
          // and let the search fall through to name/tag matching phases
          if (selectedItems.length === 0 && nonVariantMatches.length === 0) {
            logger.info('VARIANT MATCH: No variant-specific matches found, falling through to name/tag search');
          } else {
          const matchedVariants = {};
          const resultItems = [];
          
          for (const { itemId, item, matches } of selectedItems) {
            // Check if ALL search words appear in the parent item name
            const parentNameLower = item.name.toLowerCase();
            const parentNorm = normalizeForMatch(item.name);
            const parentMatchesAll = originalWords.every(w =>
              parentNameLower.includes(w.toLowerCase()) || parentNorm.includes(w.toLowerCase())
            );
            
            // Count variants where ALL keywords match
            const allKeywordMatches = matches.filter(m => m.allMatch);
            
            // Filter to only variants that have at least one word matching in their own label/tags
            // This prevents parent tags (e.g. "idli" tag on parent "Break Fast") from
            // making ALL variants (Puri, Parotta, etc.) appear as matches
            const variantSpecificMatches = allKeywordMatches.filter(m => m.variantSpecific);
            
            if (variantSpecificMatches.length === 1 && !parentMatchesAll) {
              // Exactly ONE variant matches ALL keywords in its own text AND parent name doesn't match
              // → show that specific variant (e.g. "chicken biryani" → Chicken Biryani variant)
              matchedVariants[itemId] = variantSpecificMatches[0].vi;
            } else if (variantSpecificMatches.length > 1 && !parentMatchesAll) {
              // Multiple variants match in their own label/tags — show only those
              matchedVariants[itemId] = variantSpecificMatches.map(m => m.vi);
            } else if (parentMatchesAll) {
              // Parent name matches ALL keywords (e.g. "biryani" → parent "Biryani")
              // → show ALL variants as product list
              matchedVariants[itemId] = null;
            } else if (allKeywordMatches.length >= 1 && variantSpecificMatches.length === 0) {
              // All matches come ONLY from parent tags, not variant text
              // → treat as parent-level match: show ALL variants
              matchedVariants[itemId] = null;
            } else {
              // Multiple partial matches - show ONLY the matched variants (not all)
              const specificPartial = matches.filter(m => m.variantSpecific);
              if (specificPartial.length > 0) {
                matchedVariants[itemId] = specificPartial.map(m => m.vi);
              } else {
                matchedVariants[itemId] = null;
              }
            }
            
            resultItems.push(item);
          }
          
          // Include non-variant items that match by name/tags
          for (const nvItem of nonVariantMatches) {
            resultItems.push(nvItem);
          }
          
          // Sort by best match count across variants (non-variant items sort last)
          resultItems.sort((a, b) => {
            const aEntry = variantMatchesPerItem.get(a._id.toString());
            const bEntry = variantMatchesPerItem.get(b._id.toString());
            const aMax = aEntry ? Math.max(...aEntry.matches.map(m => m.matchCount)) : 0;
            const bMax = bEntry ? Math.max(...bEntry.matches.map(m => m.matchCount)) : 0;
            return bMax - aMax;
          });
          
          logger.info('Variant match results', { count: resultItems.length });
          for (const { itemId, item, matches } of selectedItems) {
            const mode = matchedVariants[itemId] === null ? 'ALL VARIANTS' : Array.isArray(matchedVariants[itemId]) ? `array[${matchedVariants[itemId]}]` : `specific[${matchedVariants[itemId]}]`;
            logger.info('Variant match detail', { item: item.name, variantCount: matches.length });
            // Variant detail logging moved to debug level;
          }
          
          return {
            items: resultItems,
            foodType: detected,
            searchTerm: originalText,
            label: foodTypeLabel,
            exactMatch: true,
            matchedVariants
          };
          } // end else (selectedItems.length > 0)
        }
      }
    }
    
    // ========== CHECK FOR EXACT NAME MATCH FIRST ==========
    // If search term exactly matches item name(s) (with or without spaces), return ALL exact matches
    if (hasSearchTerm) {
      const searchWords = primarySearchTerm.toLowerCase().split(/\s+/).filter(w => w.length >= 2);
      
      for (const searchTerm of uniqueSearchTerms) {
        const searchLower = searchTerm.toLowerCase();
        const searchNorm = normalizeForMatch(searchTerm);
        const termWords = searchLower.split(/\s+/).filter(w => w.length >= 2);
        
        // Find ALL items with exact name match (not just first one) - use searchableItems (filtered by food type)
        // Also checks variant labels for matches
        const exactMatches = searchableItems.filter(item => {
          const nameLower = item.name.toLowerCase();
          const nameNorm = normalizeForMatch(item.name);
          // Match exact (with spaces) OR normalized (without spaces)
          if (nameLower === searchLower || nameNorm === searchNorm) return true;
          // Match words in any order (e.g., "idli sambar" matches "sambar idli")
          if (termWords.length > 1 && matchesInAnyOrder(termWords, item.name)) return true;
          // Check variant labels for exact match
          if (item.variants && item.variants.length > 0) {
            const variantMatch = item.variants.some(v => {
              if (!v.label) return false;
              const vLower = v.label.toLowerCase();
              const vNorm = normalizeForMatch(v.label);
              if (vLower === searchLower || vNorm === searchNorm) return true;
              if (termWords.length > 1 && matchesInAnyOrder(termWords, v.label)) return true;
              return false;
            });
            if (variantMatch) return true;
          }
          return false;
        });
        
        if (exactMatches.length > 0) {
          logger.info('Exact name match found', { searchTerm });
          return { 
            items: exactMatches, 
            foodType: detected, 
            searchTerm: searchTerm, 
            label: foodTypeLabel,
            exactMatch: true 
          };
        }
      }
      
      // ========== CHECK FOR EXACT TAG OR CATEGORY MATCH ==========
      // Split search into individual keywords
      const searchKeywords = primarySearchTerm.split(/\s+/).filter(k => k.length >= 2);
      
      // Helper to check if item matches a keyword using STRICT smart boundary matching
      // Prevents "ice" from matching "rice", "gobi" from matching "bi" etc.
      const itemMatchesKeyword = (item, keyword) => {
        const kwLower = keyword.toLowerCase().trim();
        
        // Check tags using smart boundary matching
        const tagMatch = (item.tags || []).some(tag => {
          const tagLower = tag.toLowerCase().trim();
          // Exact match
          if (tagLower === kwLower) return true;
          // Smart boundary match (prevents "ice" matching "rice")
          if (this.smartIncludes(kwLower, tag)) return true;
          return false;
        });
        if (tagMatch) return true;
        
        // Check category names with smart boundary matching
        const itemCategories = Array.isArray(item.category) ? item.category : [item.category];
        const categoryMatch = itemCategories.some(cat => {
          const catLower = cat.toLowerCase().trim();
          // Exact match
          if (catLower === kwLower) return true;
          // Smart boundary match
          if (this.smartIncludes(kwLower, cat)) return true;
          return false;
        });
        if (categoryMatch) return true;
        
        // Check variant labels and variant tags
        if (item.variants && item.variants.length > 0) {
          const variantMatch = item.variants.some(v => {
            // Check variant label (name)
            if (v.label && (v.label.toLowerCase().trim() === kwLower || this.smartIncludes(kwLower, v.label))) return true;
            // Check variant tags
            if (v.tags?.some(tag => tag.toLowerCase().trim() === kwLower || this.smartIncludes(kwLower, tag))) return true;
            return false;
          });
          if (variantMatch) return true;
        }
        
        return false;
      };
      
      // First try: Find items where ALL keywords match tags or category exactly - use searchableItems (filtered by food type)
      const allKeywordsTagMatches = searchableItems.filter(item => {
        // Check if ALL search keywords match at least one tag or category
        return searchKeywords.every(keyword => itemMatchesKeyword(item, keyword));
      });
      
      if (allKeywordsTagMatches.length > 0) {
        logger.info('All keywords tag/category match', { text });
        return { 
          items: allKeywordsTagMatches, 
          foodType: detected, 
          searchTerm: primarySearchTerm, 
          label: foodTypeLabel,
          exactMatch: true 
        };
      }
      
      // Second try: Find items where ANY keyword matches tags or category
      // Sort by match count - items matching more keywords appear first
      const anyKeywordTagMatches = new Map();
      for (const keyword of searchKeywords) {
        for (const item of searchableItems) {
          if (itemMatchesKeyword(item, keyword)) {
            const id = item._id.toString();
            if (!anyKeywordTagMatches.has(id)) {
              anyKeywordTagMatches.set(id, { item, matchCount: 0, matchedKeywords: [] });
            }
            anyKeywordTagMatches.get(id).matchCount++;
            anyKeywordTagMatches.get(id).matchedKeywords.push(keyword);
          }
        }
      }
      
      if (anyKeywordTagMatches.size > 0) {
        // Sort by match count (items matching more keywords first)
        const sortedMatches = Array.from(anyKeywordTagMatches.values())
          .sort((a, b) => b.matchCount - a.matchCount)
          .map(m => m.item);
        
        // For multi-keyword searches, only return items matching ALL keywords
        // For single keyword searches, return all matches
        const totalKeywords = searchKeywords.length;
        const filteredMatches = totalKeywords > 1 
          ? sortedMatches.filter(item => {
              const id = item._id.toString();
              const matchData = anyKeywordTagMatches.get(id);
              return matchData && matchData.matchCount === totalKeywords;
            })
          : sortedMatches;
        
        if (filteredMatches.length > 0) {
          logger.info('Any keyword tag match', { text });
          return { 
            items: filteredMatches, 
            foodType: detected, 
            searchTerm: primarySearchTerm, 
            label: foodTypeLabel,
            exactMatch: true // Mark as exact since all keywords matched
          };
        }
      }
    }
    
    // If only food type specified (e.g., just "veg" or "nonveg"), return all items of that type
    if (!hasSearchTerm && detected) {
      if (searchableItems.length > 0) {
        return { items: searchableItems, foodType: detected, searchTerm: detected.type, label: foodTypeLabel, exactMatch: true };
      }
      return null;
    }
    
    if (!hasSearchTerm) return null;
    
    // Helper to normalize text for comparison (removes spaces for flexible matching)
    // "ground nuts" → "groundnuts", "veg biryani" → "vegbiryani"
    const normalizeText = (text) => text.toLowerCase().replace(/\s+/g, '');
    
    // Helper to normalize plural forms for comparison
    // "milk shakes" → "milk shake", "biryanis" → "biryani"
    const normalizePluralText = (text) => this.normalizePlural(text);
    
    // Helper to check if two strings match (with or without spaces, with or without plural 's')
    // Matches: "groundnuts" with "ground nuts", "milk shakes" with "milk shake"
    const flexibleMatch = (str1, str2) => {
      const norm1 = normalizeText(str1);
      const norm2 = normalizeText(str2);
      const plural1 = normalizeText(normalizePluralText(str1));
      const plural2 = normalizeText(normalizePluralText(str2));
      return norm1 === norm2 || norm1.includes(norm2) || norm2.includes(norm1) ||
             plural1 === plural2 || plural1.includes(plural2) || plural2.includes(plural1) ||
             norm1 === plural2 || norm2 === plural1;
    };
    
    // Helper to check if search term matches tag/name (strict matching)
    // Only allows: exact match OR tag contains search term (not search term contains tag)
    // This prevents "gobi" from matching items with tag "bi" or "go"
    // strictMatch - uses smartIncludes to prevent "ice" matching "rice"
    const strictMatch = (tagOrName, searchTerm) => {
      if (!tagOrName || !searchTerm) return false;
      const tagLower = tagOrName.toLowerCase().trim();
      const termLower = searchTerm.toLowerCase().trim();
      
      // Exact match
      if (tagLower === termLower) return true;
      
      // Use smartIncludes for word boundary checking (prevents "ice" → "rice")
      if (this.smartIncludes(termLower, tagOrName)) return true;
      
      return false;
    };
    
    // Helper to find ALL items with exact tag OR category match (strict matching)
    const findAllExactTagMatches = (items, term) => {
      return items.filter(item => {
        // Check tags
        const tagMatch = item.tags?.some(tag => strictMatch(tag, term));
        if (tagMatch) return true;
        
        // Check category names
        const itemCategories = Array.isArray(item.category) ? item.category : [item.category];
        const categoryMatch = itemCategories.some(cat => strictMatch(cat, term));
        if (categoryMatch) return true;
        
        // Check variant labels and variant tags
        if (item.variants && item.variants.length > 0) {
          const variantMatch = item.variants.some(v => {
            if (v.label && strictMatch(v.label, term)) return true;
            if (v.tags?.some(tag => strictMatch(tag, term))) return true;
            return false;
          });
          if (variantMatch) return true;
        }
        
        return false;
      });
    };
    
    // Non-veg ingredient keywords - if search contains these, filter out veg items
    const nonVegKeywords = ['mutton', 'chicken', 'fish', 'prawn', 'prawns', 'egg', 'meat', 'keema', 'beef', 'pork', 'seafood', 'crab', 'lobster', 'lamb', 'goat', 'kodi', 'mamsam', 'chepa', 'royyalu'];
    
    // Veg-only keywords - if search contains ONLY these (no non-veg), filter out non-veg items
    const vegKeywords = ['paneer', 'dal', 'sabji', 'vegetable', 'aloo', 'gobi', 'palak', 'mushroom', 'tofu', 'soya', 'rajma', 'chole', 'chana'];
    
    // Check if search contains non-veg keywords
    const searchLower = primarySearchTerm.toLowerCase();
    const hasNonVegKeyword = nonVegKeywords.some(kw => searchLower.includes(kw));
    const hasVegKeyword = vegKeywords.some(kw => searchLower.includes(kw));
    
    // Determine food type filter based on search keywords
    let searchFoodTypeFilter = null;
    if (hasNonVegKeyword && !hasVegKeyword) {
      searchFoodTypeFilter = 'nonveg'; // Search has non-veg ingredient, show only non-veg/egg
    } else if (hasVegKeyword && !hasNonVegKeyword) {
      searchFoodTypeFilter = 'veg'; // Search has veg ingredient, show only veg
    }
    // If neither or both, show all (generic search like "curry", "biryani")
    
    // ========== CHECK FOR EXACT TAG MATCH - PRIORITIZE ITEMS MATCHING ALL KEYWORDS ==========
    if (hasSearchTerm) {
      // Split search into individual keywords
      const searchKeywords = primarySearchTerm.split(/\s+/).filter(k => k.length >= 2);
      
      // Get all unique keywords including synonyms
      const allKeywords = [];
      for (const searchTerm of uniqueSearchTerms) {
        const words = searchTerm.split(/\s+/).filter(w => w.length >= 2);
        allKeywords.push(...words);
      }
      const uniqueKeywords = [...new Set(allKeywords)];
      
      logger.info('Tag search started', { text });
      
      // Helper to check if item tags OR name OR category match a keyword
      // Uses smartIncludes to prevent "ice" matching "rice"
      const itemMatchesKeyword = (item, keyword) => {
        const kwLower = keyword.toLowerCase().trim();
        
        // Check item NAME first (highest priority) - use smart boundary matching
        if (this.smartIncludes(kwLower, item.name)) return true;
        
        // Check TAGS - use smart boundary matching
        const tagMatch = (item.tags || []).some(tag => {
          const tagLower = tag.toLowerCase().trim();
          // Exact match
          if (tagLower === kwLower) return true;
          // Smart boundary match (prevents "ice" matching "rice")
          if (this.smartIncludes(kwLower, tag)) return true;
          return false;
        });
        if (tagMatch) return true;
        
        // Check CATEGORY - use smart boundary matching
        const categories = Array.isArray(item.category) ? item.category : [item.category];
        const categoryMatch = categories.some(cat => {
          if (!cat) return false;
          if (this.smartIncludes(kwLower, cat)) return true;
          return false;
        });
        if (categoryMatch) return true;
        
        // Check VARIANT labels and variant tags
        if (item.variants && item.variants.length > 0) {
          const variantMatch = item.variants.some(v => {
            if (v.label && (v.label.toLowerCase().trim() === kwLower || this.smartIncludes(kwLower, v.label))) return true;
            if (v.tags?.some(tag => tag.toLowerCase().trim() === kwLower || this.smartIncludes(kwLower, tag))) return true;
            return false;
          });
          if (variantMatch) return true;
        }
        
        return false;
      };
      
      // PRIORITY 1: Items where ALL primary search keywords match (name, tags, or category)
      // Uses searchableItems which is already filtered by food type
      const allKeywordsMatch = searchableItems.filter(item => {
        return searchKeywords.every(kw => itemMatchesKeyword(item, kw));
      });
      
      if (allKeywordsMatch.length > 0) {
        logger.info('Priority 1 all keywords match', { text });
        return { 
          items: allKeywordsMatch, 
          foodType: detected, 
          searchTerm: primarySearchTerm, 
          label: foodTypeLabel,
          exactMatch: true 
        };
      }
      
      // PRIORITY 2: Items matching SOME keywords - sorted by match count
      const partialTagMatches = new Map();
      
      for (const item of searchableItems) {
        // Count how many search keywords match this item
        let matchCount = 0;
        const matchedKeywords = [];
        
        for (const kw of searchKeywords) {
          if (itemMatchesKeyword(item, kw)) {
            matchCount++;
            matchedKeywords.push(kw);
          }
        }
        
        if (matchCount > 0) {
          const id = item._id.toString();
          partialTagMatches.set(id, { item, matchCount, matchedKeywords });
        }
      }
      
      if (partialTagMatches.size > 0) {
        // Sort by match count (more matches = higher priority)
        const sortedMatches = Array.from(partialTagMatches.values())
          .sort((a, b) => b.matchCount - a.matchCount)
          .map(m => m.item);
        
        // For multi-keyword searches, only return items matching ALL keywords
        // For single keyword searches, return all matches
        const totalKeywords = searchKeywords.length;
        const filteredMatches = totalKeywords > 1 
          ? sortedMatches.filter(item => {
              const id = item._id.toString();
              const matchData = partialTagMatches.get(id);
              return matchData && matchData.matchCount === totalKeywords;
            })
          : sortedMatches;
        
        if (filteredMatches.length > 0) {
          const matchCounts = Array.from(partialTagMatches.values())
            .filter(m => filteredMatches.includes(m.item))
            .map(m => `${m.item.name}(${m.matchCount})`);
          logger.info('Priority 2 partial tag matches', { text });
          
          return { 
            items: filteredMatches, 
            foodType: detected, 
            searchTerm: primarySearchTerm, 
            label: foodTypeLabel,
            exactMatch: true // Mark as exact since all keywords matched
          };
        }
      }
    }
    
    // Helper function to search items by a term (checks tags, category, then name)
    // Uses strict matching to prevent false positives
    const searchByTerm = (items, term) => {
      if (!term || term.length < 2) return [];
      
      // First check tags using strict matching
      const tagMatches = items.filter(item => 
        item.tags?.some(tag => strictMatch(tag, term))
      );
      
      const tagMatchIds = new Set(tagMatches.map(i => i._id.toString()));
      
      // Then check category names using strict matching
      const categoryMatches = items.filter(item => {
        if (tagMatchIds.has(item._id.toString())) return false;
        const itemCategories = Array.isArray(item.category) ? item.category : [item.category];
        return itemCategories.some(cat => strictMatch(cat, term));
      });
      
      const catMatchIds = new Set(categoryMatches.map(i => i._id.toString()));
      
      // Then check item names using strict matching
      const nameMatches = items.filter(item => {
        if (tagMatchIds.has(item._id.toString()) || catMatchIds.has(item._id.toString())) return false;
        return strictMatch(item.name, term);
      });
      
      const nameMatchIds = new Set(nameMatches.map(i => i._id.toString()));
      
      // Then check variant labels and variant tags using strict matching
      const variantMatches = items.filter(item => {
        const id = item._id.toString();
        if (tagMatchIds.has(id) || catMatchIds.has(id) || nameMatchIds.has(id)) return false;
        if (!item.variants || item.variants.length === 0) return false;
        return item.variants.some(v => {
          if (v.label && strictMatch(v.label, term)) return true;
          if (v.tags?.some(tag => strictMatch(tag, term))) return true;
          return false;
        });
      });
      
      return [...tagMatches, ...categoryMatches, ...nameMatches, ...variantMatches];
    };
    
    // Helper to search by multiple terms/keywords and combine results
    const searchByMultipleTerms = (items, terms) => {
      const itemMatches = new Map();
      
      for (const term of terms) {
        if (term.length < 2) continue;
        const termLower = term.toLowerCase();
        
        // Check for exact name match first (highest priority)
        for (const item of items) {
          const nameLower = item.name.toLowerCase();
          if (nameLower === termLower) {
            const id = item._id.toString();
            if (!itemMatches.has(id)) {
              itemMatches.set(id, { item, score: 0 });
            }
            itemMatches.get(id).score += 100; // Exact name match = 100 points
          }
        }
        
        // Check for exact tag match (high priority)
        for (const item of items) {
          if (item.tags?.some(tag => tag.toLowerCase() === termLower)) {
            const id = item._id.toString();
            if (!itemMatches.has(id)) {
              itemMatches.set(id, { item, score: 0 });
            }
            itemMatches.get(id).score += 50; // Exact tag match = 50 points
          }
        }
        
        // Check for smart boundary match on name (prevents "ice" → "rice")
        for (const item of items) {
          if (this.smartIncludes(termLower, item.name)) {
            const id = item._id.toString();
            if (!itemMatches.has(id)) {
              itemMatches.set(id, { item, score: 0 });
            }
            itemMatches.get(id).score += 30; // Smart name match = 30 points
          }
        }
        
        // Check for smart boundary match on tags
        for (const item of items) {
          if (item.tags?.some(tag => this.smartIncludes(termLower, tag))) {
            const id = item._id.toString();
            if (!itemMatches.has(id)) {
              itemMatches.set(id, { item, score: 0 });
            }
            itemMatches.get(id).score += 20; // Smart tag match = 20 points
          }
        }
        
        // Check variant labels for exact match (high priority - same as name)
        for (const item of items) {
          if (item.variants?.some(v => v.label && v.label.toLowerCase() === termLower)) {
            const id = item._id.toString();
            if (!itemMatches.has(id)) {
              itemMatches.set(id, { item, score: 0 });
            }
            itemMatches.get(id).score += 90; // Exact variant label match = 90 points
          }
        }
        
        // Check variant labels for smart boundary match
        for (const item of items) {
          if (item.variants?.some(v => v.label && this.smartIncludes(termLower, v.label))) {
            const id = item._id.toString();
            if (!itemMatches.has(id)) {
              itemMatches.set(id, { item, score: 0 });
            }
            itemMatches.get(id).score += 25; // Smart variant label match = 25 points
          }
        }
        
        // Check variant tags for exact/smart match
        for (const item of items) {
          if (item.variants?.some(v => v.tags?.some(tag => tag.toLowerCase() === termLower || this.smartIncludes(termLower, tag)))) {
            const id = item._id.toString();
            if (!itemMatches.has(id)) {
              itemMatches.set(id, { item, score: 0 });
            }
            itemMatches.get(id).score += 20; // Variant tag match = 20 points
          }
        }
      }
      
      // Sort by score (higher = better match)
      return Array.from(itemMatches.values())
        .sort((a, b) => b.score - a.score)
        .map(m => m.item);
    };
    
    let matchingItems = [];
    
    if (hasSearchTerm) {
      // Search using ALL translation variations - use searchableItems (filtered by food type)
      logger.info('Searching with variations', { text });
      matchingItems = searchByMultipleTerms(searchableItems, uniqueSearchTerms);
      
      // IMPORTANT: If user explicitly specified food type (e.g., "veg curry"), do NOT fall back to all items
      // Only try all items if no food type was detected (generic search like "curry")
      if (matchingItems.length === 0 && !detected && searchableItems.length < menuItems.length) {
        logger.info('No food type, falling back to keyword search');
        matchingItems = searchByMultipleTerms(menuItems, uniqueSearchTerms);
      }
      
      // If still no results, try finding items that match ANY keyword (show all related items)
      if (matchingItems.length === 0) {
        const allKeywords = uniqueSearchTerms.flatMap(term => term.split(/\s+/).filter(k => k.length >= 2));
        if (allKeywords.length > 0) {
          logger.info('Fallback to any keyword match');
          // Search keywords only in searchableItems (respects food type filter)
          matchingItems = searchByMultipleTerms(searchableItems, allKeywords);
          // Only fall back to all items if NO food type was specified
          if (matchingItems.length === 0 && !detected) {
            logger.info('No food type, trying all items');
            matchingItems = searchByMultipleTerms(menuItems, allKeywords);
          }
        }
      }
      
      // No fuzzy matching - if no exact match found, return null
      // This prevents mismatches like "ice" showing "rice" items
      
      // ========== SKIP EXCESSIVE AI CALLS ==========
      // The menu items now have auto-generated tags including food type, quantity, and name words
      // If fuzzy search also failed, it means the item truly doesn't exist in the menu
      // Instead of calling multiple AI services, just return no results
      // This is more honest to the user and reduces API costs
      
      logger.info('No matching items found', { text });
      
    } else if (detected?.type === 'specific' && searchableItems.length > 0) {
      // For specific ingredient searches (e.g., "chicken"), return filtered items
      matchingItems = searchableItems;
    }
    
    // FINAL DEBUG LOG - what are we returning?
    // (removed decoration log);
    logger.info('Smart search result', { text });
    logger.info('Smart search debug', {
      detectedFoodType: detected || 'NONE',
      searchableCount: searchableItems?.length || 0,
      matchingCount: matchingItems?.length || 0
    });
    if (matchingItems?.length > 0) {
      logger.info('Smart search returning items', {
        count: matchingItems.length,
        sample: matchingItems.slice(0, 5).map(i => i.name)
      });
    }
    // (removed decoration log)
    
    return matchingItems.length > 0 
      ? { items: matchingItems, foodType: detected, searchTerm: primarySearchTerm, label: foodTypeLabel, exactMatch: true }
      : null;
  },

  // Helper to filter items by food type preference
  filterByFoodType(menuItems, preference) {
    if (preference === 'both') return menuItems;

    // Check both parent foodType AND variant-level foodType
    // Items with foodType 'none' (unset) are included in ALL food type filters
    const matchesFoodType = (item, pref) => {
      // If parent foodType is 'none' (never set), include in all filters
      if (item.foodType === 'none' || !item.foodType) return true;

      // Check parent item foodType
      if (pref === 'veg' && item.foodType === 'veg') return true;
      if (pref === 'egg' && item.foodType === 'egg') return true;
      if (pref === 'nonveg' && (item.foodType === 'nonveg' || item.foodType === 'egg')) return true;

      // Also check variant-level foodType
      if (item.variants && item.variants.length > 0) {
        return item.variants.some(v => {
          const vFoodType = v.foodType || item.foodType;
          if (!vFoodType || vFoodType === 'none') return true;
          if (pref === 'veg') return vFoodType === 'veg';
          if (pref === 'egg') return vFoodType === 'egg';
          if (pref === 'nonveg') return vFoodType === 'nonveg' || vFoodType === 'egg';
          return false;
        });
      }
      return false;
    };

    return menuItems.filter(item => matchesFoodType(item, preference));
  },

  // Reverse geocode coordinates to get readable address
  async reverseGeocode(latitude, longitude) {
    try {
      logger.info('Reverse geocoding coordinates', { latitude, longitude });
      
      // Only use OpenCage API (most reliable for production)
      if (process.env.OPENCAGE_API_KEY) {
        const endTimer = startTimer('geo.openCage');
        try {
          logger.info('Using OpenCage API for geocoding');
          const opencageResponse = await axios.get(
            `https://api.opencagedata.com/geocode/v1/json`,
            {
              params: {
                q: `${latitude},${longitude}`,
                key: process.env.OPENCAGE_API_KEY,
                language: 'en',
                no_annotations: 1,
                limit: 1
              },
              timeout: 8000
            }
          );
          
          logger.info('OpenCage response', {
            status: opencageResponse.status,
            hasResults: !!opencageResponse.data?.results?.length,
            resultCount: opencageResponse.data?.results?.length || 0
          });
          
          if (opencageResponse.data && opencageResponse.data.results && opencageResponse.data.results.length > 0) {
            const result = opencageResponse.data.results[0];
            
            // Try to build custom address from components first
            if (result.components) {
              const comp = result.components;
              const parts = [];
              
              // Building/place
              if (comp.building) parts.push(comp.building);
              if (comp.shop) parts.push(comp.shop);
              if (comp.amenity && !comp.building) parts.push(comp.amenity);
              
              // House number and road
              if (comp.house_number) parts.push(comp.house_number);
              if (comp.road) parts.push(comp.road);
              
              // Neighborhood/suburb
              if (comp.neighbourhood) parts.push(comp.neighbourhood);
              else if (comp.suburb) parts.push(comp.suburb);
              
              // City
              if (comp.city) parts.push(comp.city);
              else if (comp.town) parts.push(comp.town);
              else if (comp.village) parts.push(comp.village);
              
              // State and postcode
              if (comp.state) parts.push(comp.state);
              if (comp.postcode) parts.push(comp.postcode);
              
              if (parts.length >= 3) {
                const address = parts.join(', ');
                logger.info('OpenCage custom address', { address: address.substring(0, 150) });
                endTimer({ success: true, source: 'components' });
                return address;
              }
            }
            
            // Use formatted address as fallback
            if (result.formatted) {
              logger.info('OpenCage formatted address', { address: result.formatted.substring(0, 150) });
              endTimer({ success: true, source: 'formatted' });
              return result.formatted;
            }
          }
        } catch (opencageError) {
          endTimer({ success: false, reason: opencageError.message });
          logger.error('OpenCage geocoding failed', { 
            error: opencageError.message,
            code: opencageError.code,
            status: opencageError.response?.status,
            statusText: opencageError.response?.statusText
          });
        }
      } else {
        logger.warn('OpenCage API key not configured');
      }
      
      logger.warn('Geocoding failed - no address found');
      return null;
    } catch (error) {
      logger.error('Reverse geocoding error', { 
        error: error.message,
        code: error.code
      });
      return null;
    }
  },

  async handleMessage(phone, message, messageType = 'text', selectedId = null, senderName = null, options = {}) {
    // Check if holiday mode is enabled
    const holidayMode = await Settings.getValue('holidayMode', false);
    if (holidayMode) {
      logger.info('Holiday mode active', { phone });
      await whatsapp.sendMessage(phone, 
        `🏖️ *Holiday Notice*\n\n` +
        `Dear Customer,\n\n` +
        `We are currently closed for today. We apologize for any inconvenience caused.\n\n` +
        `We will be back soon to serve you delicious food! 🍽️\n\n` +
        `Thank you for your understanding. 🙏`
      );
      return;
    }

    let customer = await Customer.findOne({ phone });
    if (!customer) {
      customer = new Customer({ 
        phone, 
        name: senderName || null,
        conversationState: { currentStep: 'welcome' }, 
        cart: [] 
      });
      await customer.save();
    } else if (senderName && (!customer.name || customer.name === 'Unknown' || customer.name === 'Customer')) {
      // Update name if we now have it and customer didn't have a proper name
      customer.name = senderName;
      await customer.save();
    }

    // Prime the activeOffers cache so sub-functions don't re-fetch customer
    // (non-blocking — runs in parallel with broadcast/sheets below)
    const _primeOffersPromise = (customer.activeOffers?.length > 0)
      ? filterActiveOffers(customer.activeOffers).then(filtered => {
          _activeOffersCache.set(phone, { data: filtered, timestamp: Date.now() });
        }).catch(err => logger.warn('Failed to prime active offers cache', { phone, error: err.message }))
      : Promise.resolve(_activeOffersCache.set(phone, { data: [], timestamp: Date.now() }));

    // Save WhatsApp contact for broadcast (non-blocking)
    whatsappBroadcast.addContact(phone, customer.name || senderName, new Date()).catch(err => {
      logger.error('[Chatbot] Failed to save WhatsApp contact', { error: err.message });
    });

    // Save customer to Google Sheets for cost-saving (non-blocking)
    googleSheets.addOrUpdateCustomer(phone, customer.name || senderName, customer.deliveryAddress?.address).catch(err => {
      logger.error('[Chatbot] Failed to save customer to Google Sheets', { error: err.message });
    });

    // Get all categories and menu items (cached, 15s TTL — saves ~20-80ms per message)
    const { allCategories, allMenuItems: _allMenuItems } = await getCachedMenuData();
    
    // Get scheduled categories that are currently ACTIVE (within time, not paused)
    const scheduledActiveCategories = allCategories
      .filter(c => c.schedule?.enabled && !c.isPaused && !c.isSoldOut)
      .map(c => c.name);
    
    // Get scheduled categories that are LOCKED (scheduled but paused/outside time)
    const scheduledLockedCategories = allCategories
      .filter(c => c.schedule?.enabled && (c.isPaused || c.isSoldOut))
      .map(c => c.name);
    
    // Get manually paused/sold out categories (non-scheduled)
    const manuallyLockedCategories = allCategories
      .filter(c => !c.schedule?.enabled && (c.isPaused || c.isSoldOut))
      .map(c => c.name);
    
    // Get available menu items:
    // Logic matches app behavior:
    // 1. If item has ANY scheduled ACTIVE category → SHOW
    // 2. If item has ANY scheduled LOCKED category (and no scheduled active) → HIDE
    // 3. If item has NO scheduled categories → show if any non-scheduled category is not locked
    const allMenuItems = _allMenuItems;
    const menuItems = allMenuItems
      .filter(item => {
        const itemCategories = Array.isArray(item.category) ? item.category.filter(Boolean) : [item.category].filter(Boolean);
        
        // Items with no categories assigned → always show (no category lock applies)
        if (itemCategories.length === 0) return true;
        
        // Check if item has any scheduled category that is ACTIVE → SHOW
        const hasScheduledActiveCategory = itemCategories.some(cat => scheduledActiveCategories.includes(cat));
        if (hasScheduledActiveCategory) return true;
        
        // Check if item has any scheduled category that is LOCKED → HIDE
        const hasScheduledLockedCategory = itemCategories.some(cat => scheduledLockedCategories.includes(cat));
        if (hasScheduledLockedCategory) return false;
        
        // Item has no scheduled categories - check if any non-scheduled category is active
        const hasActiveNonScheduledCategory = itemCategories.some(cat => {
          const category = allCategories.find(c => c.name === cat);
          return category && !category.schedule?.enabled && !category.isPaused && !category.isSoldOut;
        });
        
        return hasActiveNonScheduledCategory;
      });
    
    // Debug log
    logger.info('Scheduled categories active');
    logger.info('Scheduled categories locked');
    logger.info('Manually locked categories');
    logger.info('Menu items filtered', { total: allMenuItems.length });
    
    // Log filtered out items for debugging
    const filteredOutItems = allMenuItems.filter(item => !menuItems.includes(item));
    if (filteredOutItems.length > 0) {
      logger.info('Categories filtered out');
    }
    
    const state = customer.conversationState || { currentStep: 'welcome' };
    
    // Handle message - could be string or object (for location)
    const msg = typeof message === 'string' ? message.toLowerCase().trim() : '';
    const selection = selectedId || msg;

    logger.info('Chatbot', { phone, msg, selection, messageType, currentStep: state.currentStep });

    try {
      // ========== HANDLE WHATSAPP CATALOG ORDER (cart submission) ==========
      if (messageType === 'order') {
        const orderData = typeof message === 'object' ? message : {};
        logger.info('📦 Catalog order processing', { phone, itemCount: orderData.product_items?.length || 0 });

        try {
          const parsed = await catalogService.parseWhatsAppOrder(orderData);

          if (!parsed.items.length) {
            const helpImg = await chatbotImagesService.getImageUrl('help_support');
            await whatsapp.sendMessage(phone, '❌ Sorry, we couldn\'t process your cart. Please try again.');
            state.currentStep = 'main_menu';
            customer.conversationState = state;
            await customer.save();
            return;
          }

          // Add all catalog items to customer cart
          customer.cart = customer.cart || [];
          for (const item of parsed.items) {
            if (!item.menuItemId) {
              logger.warn('Catalog order item missing menuItem mapping', { retailerId: item.retailerId });
              continue;
            }
            // For variant items, match by menuItem + variantIndex + quantityIndex
            const existingIndex = customer.cart.findIndex(c => {
              const sameItem = c.menuItem?.toString() === item.menuItemId.toString();
              if (item.variantIndex !== null && item.variantIndex !== undefined) {
                if (item.quantityIndex !== null && item.quantityIndex !== undefined) {
                  return sameItem && c.variantIndex === item.variantIndex && c.quantityIndex === item.quantityIndex;
                }
                return sameItem && c.variantIndex === item.variantIndex;
              }
              return sameItem && (c.variantIndex === null || c.variantIndex === undefined);
            });
            if (existingIndex >= 0) {
              customer.cart[existingIndex].quantity += item.quantity;
              customer.cart[existingIndex].addedAt = new Date();
            } else {
              const cartEntry = {
                menuItem: item.menuItemId,
                quantity: item.quantity,
                addedAt: new Date()
              };
              if (item.variantIndex !== null && item.variantIndex !== undefined) {
                cartEntry.variantIndex = item.variantIndex;
                cartEntry.variantLabel = item.variantLabel || null;
                if (item.quantityIndex !== null && item.quantityIndex !== undefined) {
                  cartEntry.quantityIndex = item.quantityIndex;
                }
              }
              customer.cart.push(cartEntry);
            }
          }
          await customer.save();

          // Show native catalog cart (product list with images + Place Order buttons)
          await this.sendCart(phone, customer);

          state.currentStep = 'item_added';
          customer.conversationState = state;
          await customer.save();
        } catch (catalogOrderErr) {
          logger.error('Catalog order processing error', { phone, error: catalogOrderErr.message });
          const helpImg = await chatbotImagesService.getImageUrl('help_support');
          await whatsapp.sendMessage(phone, '❌ Something went wrong processing your cart. Please try again.');
          state.currentStep = 'main_menu';
          customer.conversationState = state;
          await customer.save();
        }
        return;
      }

      // ========== HANDLE LOCATION MESSAGE ==========
      if (messageType === 'location') {
        // message contains location data: { latitude, longitude, name, address }
        const locationData = typeof message === 'object' ? message : {};
        
        logger.info('Location received', { location: locationData });
        
        // Get proper address - prefer WhatsApp's address, only geocode if no address provided
        let formattedAddress = null;
        
        // First, try to use the address from WhatsApp location data
        if (locationData.address && locationData.address.trim() && locationData.address !== 'undefined') {
          formattedAddress = locationData.address.trim();
          // If there's also a name/place, prepend it
          if (locationData.name && locationData.name.trim() && locationData.name !== locationData.address) {
            formattedAddress = `${locationData.name.trim()}, ${formattedAddress}`;
          }
          logger.info('Using WhatsApp provided address', { address: formattedAddress });
        } else if (locationData.name && locationData.name.trim() && locationData.name !== 'undefined') {
          // If only name is provided (like a place name), use it
          formattedAddress = locationData.name.trim();
          logger.info('Using WhatsApp location name', { location: formattedAddress });
        }
        
        // If NO address from WhatsApp (current location with only coordinates), use OpenCage geocoding
        if (!formattedAddress && locationData.latitude && locationData.longitude) {
          logger.info('No address from WhatsApp - current location shared, using OpenCage geocoding...');
          const geocodedAddress = await this.reverseGeocode(locationData.latitude, locationData.longitude);
          if (geocodedAddress) {
            formattedAddress = geocodedAddress;
            logger.info('Got address from OpenCage geocoding', { address: formattedAddress });
          } else {
            logger.warn('OpenCage geocoding failed to return address');
          }
        }
        
        // Final fallback - use coordinates (should rarely happen with OpenCage)
        if (!formattedAddress) {
          formattedAddress = `Location: ${locationData.latitude.toFixed(6)}, ${locationData.longitude.toFixed(6)}`;
          logger.warn('No address available, using coordinates', { formattedAddress });
        }
        
        // Check delivery radius BEFORE saving location
        if (locationData.latitude && locationData.longitude && customer.cart?.length > 0) {
          const deliveryResult = await calculateDeliveryCharge(locationData.latitude, locationData.longitude);
          
          // If beyond max delivery radius, reject the order
          if (deliveryResult.beyondMaxRadius) {
            const outOfRangeImg = await chatbotImagesService.getImageUrl('out_of_delivery_range');
            const message = `❌ *Delivery Not Available*\n\n${deliveryResult.message}\n\nWould you like to try a different address or opt for self-pickup?`;
            
            await whatsapp.sendMessage(phone, message);
            state.currentStep = 'awaiting_location';
            customer.conversationState = state;
            await customer.save();
            return;
          }
          
          // If delivery not available (outside free radius and extra charge not enabled)
          if (deliveryResult.deliveryNotAvailable) {
            const outOfRangeImg = await chatbotImagesService.getImageUrl('out_of_delivery_range');
            const message = `❌ *Delivery Not Available*\n\n${deliveryResult.message}\n\nWould you like to try a different address or opt for self-pickup?`;
            
            await whatsapp.sendMessage(phone, message);
            state.currentStep = 'awaiting_location';
            customer.conversationState = state;
            await customer.save();
            return;
          }
          
          // Store delivery charge info in customer state for later use
          state.deliveryCharge = deliveryResult.charge || 0;
          state.deliveryDistance = deliveryResult.distance;
        }
        
        customer.deliveryAddress = {
          latitude: locationData.latitude,
          longitude: locationData.longitude,
          address: formattedAddress,
          updatedAt: new Date()
        };
        await customer.save();
        
        // If customer has items in cart, show order summary with payment options
        if (customer.cart?.length > 0) {
          const launched = await this.launchPaymentFlow(phone, 'delivery');
          if (!launched) {
            await this.sendPaymentMethodOptions(phone, customer, state);
          }
          state.currentStep = 'select_payment_method';
        } else {
          // No cart items, just confirm location saved
          const deliveryLocationImg = await chatbotImagesService.getImageUrl('delivery_location');
          await whatsapp.sendMessage(phone, `📍 Location saved!\n\n${formattedAddress}\n\nStart ordering to use this address.`);
          state.currentStep = 'main_menu';
        }
      }
      // ========== FLOW REPLY: Account Form / View Order / Flow Triggers ==========
      else if (messageType === 'flow_reply' || messageType === 'flow_trigger') {
        let flowData = {};
        try { flowData = typeof message === 'string' ? JSON.parse(message) : message; } catch (e) { /* ignore */ }

        if (flowData.type === 'account_form') {
          await this.handleAccountFormResponse(phone, customer, flowData);
          state.currentStep = 'main_menu';
        } else if (flowData.type === 'view_order') {
          // User selected an order from My Orders flow
          await this.handleViewOrderDetails(phone, customer, flowData.orderId);
          state.currentStep = 'main_menu';
        } else if (flowData.type === 'food_type_selection') {
          // Send food type selection flow after Order Food selected
          await this.sendFoodTypeSelectionFlow(phone);
          state.currentStep = 'main_menu';
        } else if (flowData.type === 'my_orders_list') {
          // Send recent orders list flow after My Orders selected
          await this.sendMyOrdersListFlow(phone, customer);
          state.currentStep = 'main_menu';
        } else if (flowData.type === 'my_orders_empty') {
          // No orders found for this phone — send a friendly message
          await whatsapp.sendMessage(phone, '📋 *No Recent Orders*\n\nYou don\'t have any orders yet. Place your first order now! 🍽️');
          await this.sendWelcome(phone);
          state.currentStep = 'main_menu';
        } else if (flowData.type === 'no_offers') {
          // No eligible offers for this phone
          await whatsapp.sendMessage(phone, '🏷️ *No Offers Available*\n\nThere are no offers available for you right now. Check back soon! 🎉');
          await this.sendWelcome(phone);
          state.currentStep = 'main_menu';
        } else if (flowData.type === 'no_menu_items') {
          // No menu items found for selected food type
          await whatsapp.sendMessage(phone, '📋 *No Items Found*\n\nNo menu items available for this food type right now. Try a different option! 🍽️');
          await this.sendWelcome(phone);
          state.currentStep = 'main_menu';
        } else {
          logger.info('Unknown flow_reply type', { phone, flowData });
          await this.sendWelcome(phone);
          state.currentStep = 'main_menu';
        }
      }
      // ========== WEBSITE CART ORDER (multiple items from website cart) ==========
      // Detect cart orders from website with format "🛒 Order from Website\n1. Item x2 - ₹XXX"
      else if (!selectedId && message && this.isWebsiteCartOrderIntent(message)) {
        const cartOrder = this.isWebsiteCartOrderIntent(message);
        logger.info('Website CART order detected', { cart: cartOrder });
        
        // Check for offer eligibility if offer IDs are present
        let eligibleOffers = [];
        let ineligibleOffers = [];
        
        if (cartOrder.offerIds && cartOrder.offerIds.length > 0) {
          logger.info('Checking offer eligibility for', { offer: cartOrder.offerIds });
          
          for (const offerId of cartOrder.offerIds) {
            try {
              const offer = await Offer.findById(offerId);
              if (!offer) {
                logger.info('Offer not found', { offerId });
                continue;
              }
              
              // Check if offer is still active
              const now = new Date();
              if (!offer.isActive || (offer.validUntil && new Date(offer.validUntil) < now)) {
                logger.info('Offer expired or inactive', { offerId });
                ineligibleOffers.push({ offer, reason: 'expired' });
                continue;
              }
              
              // Check targeting eligibility
              const isTargeted = ['top_percentage', 'min_spent', 'min_orders'].includes(offer.targetType);
              if (isTargeted && offer.targetedCustomers && offer.targetedCustomers.length > 0) {
                const normalizedPhone = phone.replace(/[^0-9]/g, '');
                const isEligible = offer.targetedCustomers.some(targetPhone => {
                  const normalizedTarget = targetPhone.replace(/[^0-9]/g, '');
                  return normalizedTarget.includes(normalizedPhone) || normalizedPhone.includes(normalizedTarget);
                });
                
                if (!isEligible) {
                  logger.info('Customer not eligible for offer', { offerId });
                  let reason = 'not_eligible';
                  if (offer.targetType === 'min_spent') {
                    reason = `Requires ₹${offer.targetMinSpent}+ total spending`;
                  } else if (offer.targetType === 'min_orders') {
                    reason = `Requires ${offer.targetMinOrders}+ orders`;
                  } else if (offer.targetType === 'top_percentage') {
                    reason = 'For top customers only';
                  }
                  ineligibleOffers.push({ offer, reason });
                  continue;
                }
              }
              
              // Customer is eligible for this offer
              logger.info('Customer eligible for offer', { offerId });
              eligibleOffers.push(offer);
              
            } catch (err) {
              logger.error('Error checking offer', { offerId }, { error: err.message });
            }
          }
        }
        
        // If there are ineligible offers, inform customer
        if (ineligibleOffers.length > 0 && eligibleOffers.length === 0) {
          let ineligibleMsg = `❌ *Offer Not Available*\n\nSorry, you're not eligible for the following offer(s):\n\n`;
          ineligibleOffers.forEach(({ offer, reason }) => {
            ineligibleMsg += `• *${offer.title || offer.offerType}*\n  Reason: ${reason}\n`;
          });
          ineligibleMsg += `\nYou can still order at regular prices, or browse other offers!`;
          
          const offerNotEligibleImg = await chatbotImagesService.getImageUrl('offer_not_eligible');
          await whatsapp.sendMessage(phone, ineligibleMsg);
          
          // Store cart order in state for "proceed_without_offer"
          state.pendingCartOrder = cartOrder;
          state.currentStep = 'offer_not_eligible';
          customer.conversationState = state;
          await customer.save();
          return;
        }
        
        // Add all items to customer's cart
        customer.cart = customer.cart || [];
        let addedCount = 0;
        let notFoundItems = [];
        let totalDiscount = 0;
        
        for (const cartItem of cartOrder.items) {
          // Find menu item: try by ID first, then by name
          let menuItem = null;
          if (cartItem.itemId) {
            menuItem = menuItems.find(m => m._id.toString() === cartItem.itemId) ||
                       allMenuItems.find(m => m._id.toString() === cartItem.itemId);
          }
          if (!menuItem) {
            menuItem = menuItems.find(m => 
              m.name.toLowerCase().trim() === cartItem.name.toLowerCase().trim()
            );
          }
          
          if (menuItem) {
            // Calculate offer discount if item has offer and customer is eligible
            let offerDiscount = 0;
            let appliedOffer = null;
            
            if (cartItem.hasOffer && eligibleOffers.length > 0) {
              // Find matching offer that applies to this item
              for (const offer of eligibleOffers) {
                // Check if offer applies to this item (by appliedItems or appliedCategories)
                const appliesToItem = (offer.appliedItems && offer.appliedItems.some(id => id.toString() === menuItem._id.toString())) ||
                                     (offer.appliedCategories && offer.appliedCategories.includes(menuItem.category));
                
                // If offer has offerType, check if item's offerType matches
                const matchesOfferType = offer.offerType && menuItem.offerType && 
                  (Array.isArray(menuItem.offerType) ? menuItem.offerType.includes(offer.offerType) : menuItem.offerType === offer.offerType);
                
                if (appliesToItem || matchesOfferType) {
                  appliedOffer = offer;
                  
                  // Calculate discount
                  if (offer.discountType === 'percentage' && offer.discountValue > 0) {
                    offerDiscount = Math.round((menuItem.price * offer.discountValue) / 100) * cartItem.quantity;
                  } else if (offer.discountType === 'fixed' && offer.discountValue > 0) {
                    offerDiscount = offer.discountValue * cartItem.quantity;
                  } else if (offer.percentage && offer.percentage > 0) {
                    offerDiscount = Math.round((menuItem.price * offer.percentage) / 100) * cartItem.quantity;
                  }
                  
                  totalDiscount += offerDiscount;
                  logger.info('Offer applied', { offerTitle: offer.title, menuItem: menuItem.name });
                  break;
                }
              }
            }
            
            // Check if already in cart (match by item + variant + quantityIndex)
            const existingIndex = customer.cart.findIndex(c => {
              const sameItem = c.menuItem?.toString() === menuItem._id.toString();
              if (cartItem.variantIndex !== null && cartItem.variantIndex !== undefined) {
                const sameVariant = c.variantIndex === cartItem.variantIndex;
                if (cartItem.quantityIndex !== null && cartItem.quantityIndex !== undefined) {
                  return sameItem && sameVariant && c.quantityIndex === cartItem.quantityIndex;
                }
                return sameItem && sameVariant && (c.quantityIndex === null || c.quantityIndex === undefined);
              }
              return sameItem && (c.variantIndex === null || c.variantIndex === undefined);
            });
            
            if (existingIndex >= 0) {
              customer.cart[existingIndex].quantity += cartItem.quantity;
              customer.cart[existingIndex].addedAt = new Date();
              if (appliedOffer) {
                customer.cart[existingIndex].appliedOffer = {
                  offerId: appliedOffer._id,
                  title: appliedOffer.title || appliedOffer.offerType,
                  discount: offerDiscount
                };
              }
            } else {
              const cartEntry = { 
                menuItem: menuItem._id, 
                quantity: cartItem.quantity, 
                addedAt: new Date() 
              };
              // Add variant info if present
              if (cartItem.variantIndex !== null && cartItem.variantIndex !== undefined && menuItem.variants?.[cartItem.variantIndex]) {
                cartEntry.variantIndex = cartItem.variantIndex;
                cartEntry.variantLabel = cartItem.variantLabel || menuItem.variants[cartItem.variantIndex].label || null;
                // Add quantity option index if present
                if (cartItem.quantityIndex !== null && cartItem.quantityIndex !== undefined) {
                  const variant = menuItem.variants[cartItem.variantIndex];
                  if (variant.quantities?.[cartItem.quantityIndex]) {
                    cartEntry.quantityIndex = cartItem.quantityIndex;
                  }
                }
              }
              if (appliedOffer) {
                cartEntry.appliedOffer = {
                  offerId: appliedOffer._id,
                  title: appliedOffer.title || appliedOffer.offerType,
                  discount: offerDiscount
                };
              }
              customer.cart.push(cartEntry);
            }
            addedCount++;
            logger.info('Added to cart', { item: menuItem.name, quantity: cartItem.quantity, offerDiscount: appliedOffer ? offerDiscount : undefined });
          } else {
            notFoundItems.push(cartItem.name);
            logger.info('Cart item not found', { item: cartItem.name });
          }
        }
        
        // Store applied offers info for order
        if (eligibleOffers.length > 0) {
          customer.pendingOffers = eligibleOffers.map(o => ({
            offerId: o._id,
            title: o.title || o.offerType,
            discountType: o.discountType,
            discountValue: o.discountValue || o.percentage
          }));
          customer.totalOfferDiscount = totalDiscount;
        }
        
        await customer.save();
        
        if (addedCount > 0) {
          // Show cart summary with offer discount info
          if (totalDiscount > 0) {
            await whatsapp.sendMessage(phone, `🎁 *Offer Applied!*\n\nYou've saved ₹${totalDiscount} with ${eligibleOffers.map(o => o.title || o.offerType).join(', ')}!`);
          }
          await this.sendCart(phone, customer);
          state.currentStep = 'viewing_cart';
        } else {
          // No items were added
          const itemNotAvailableImg = await chatbotImagesService.getImageUrl('item_not_available');
          await whatsapp.sendMessage(phone, `❌ Sorry, we couldn't find the items in your order.\n\nPlease browse our menu to add items.`);
          state.currentStep = 'main_menu';
        }
      }
      // ========== WEBSITE ORDER DETECTION (exact match on item name) ==========
      // Detect orders coming from website with #WEB_<itemId> or "Hi! I'd like to order: * ItemName *"
      else if (!selectedId && message && this.isWebsiteOrderIntent(message)) {
        const websiteOrder = this.isWebsiteOrderIntent(message);
        logger.info('Website order detected', { order: websiteOrder });
        
        let matchedItem = null;
        
        // Method 1: Direct ID lookup (new format from website)
        if (websiteOrder.itemId) {
          matchedItem = menuItems.find(item => item._id.toString() === websiteOrder.itemId) ||
                        allMenuItems.find(item => item._id.toString() === websiteOrder.itemId);
          if (matchedItem) {
            logger.info('Direct ID match found', { match: matchedItem.name, id: websiteOrder.itemId });
          }
        }
        
        // Method 2: Name-based matching (legacy format)
        if (!matchedItem && websiteOrder.itemName) {
          const searchName = websiteOrder.itemName.toLowerCase().trim();
          matchedItem = menuItems.find(item => 
            item.name.toLowerCase().trim() === searchName
          );
        }
        
        if (matchedItem) {
          // Add item to cart with variant and quantity if specified
          const needsCartUpdate = websiteOrder.quantity > 1 || websiteOrder.variantIndex !== null || websiteOrder.quantityIndex !== null;
          
          if (needsCartUpdate) {
            customer.cart = customer.cart || [];
            const cartEntry = { 
              menuItem: matchedItem._id, 
              quantity: websiteOrder.quantity || 1, 
              addedAt: new Date(),
              _addedFrom: 'website'  // Track source for debugging
            };
            if (websiteOrder.variantIndex !== null && matchedItem.variants?.[websiteOrder.variantIndex]) {
              cartEntry.variantIndex = websiteOrder.variantIndex;
              cartEntry.variantLabel = matchedItem.variants[websiteOrder.variantIndex].label || null;
              logger.info('Website order: added variantIndex', { variantIndex: websiteOrder.variantIndex, variantLabel: cartEntry.variantLabel });
            }
            // Add quantity option index if specified (for size selection)
            if (websiteOrder.quantityIndex !== null && websiteOrder.variantIndex !== null && 
                matchedItem.variants?.[websiteOrder.variantIndex]?.quantities?.[websiteOrder.quantityIndex]) {
              cartEntry.quantityIndex = websiteOrder.quantityIndex;
              const q = matchedItem.variants[websiteOrder.variantIndex].quantities[websiteOrder.quantityIndex];
              cartEntry.quantityLabel = `${q.quantity} ${q.unit}`;
              logger.info('Website order: added quantityIndex', { quantityIndex: websiteOrder.quantityIndex, quantityLabel: cartEntry.quantityLabel });
            }
            
            logger.info('Website order: cart entry created', { 
              itemId: matchedItem._id, 
              variantIndex: cartEntry.variantIndex, 
              quantityIndex: cartEntry.quantityIndex,
              quantity: cartEntry.quantity
            });
            
            // Check if already in cart (same item + variant + quantityIndex)
            const existingIdx = customer.cart.findIndex(c => {
              const sameItem = c.menuItem?.toString() === matchedItem._id.toString();
              if (websiteOrder.variantIndex !== null) {
                const sameVariant = c.variantIndex === websiteOrder.variantIndex;
                if (websiteOrder.quantityIndex !== null) {
                  // Match on variant + quantity option
                  return sameItem && sameVariant && c.quantityIndex === websiteOrder.quantityIndex;
                }
                // Match on variant only
                return sameItem && sameVariant && (c.quantityIndex === null || c.quantityIndex === undefined);
              }
              return sameItem && (c.variantIndex === null || c.variantIndex === undefined);
            });
            
            if (existingIdx >= 0) {
              logger.info('Website order: merging with existing cart item', { existingIdx, addQuantity: cartEntry.quantity });
              customer.cart[existingIdx].quantity += cartEntry.quantity;
              customer.cart[existingIdx].addedAt = new Date();
            } else {
              logger.info('Website order: adding new cart item');
              customer.cart.push(cartEntry);
            }
            await customer.save();
          }
          
          // Send the full cart with catalog (no need for separate product card)
          await this.sendCart(phone, customer);
          // Item is already added to cart above, so set step to 'viewing_cart'
          // NOT 'viewing_item_details' — that would cause the checkout handler to add +1 again
          state.selectedItem = null;
          state.currentStep = 'viewing_cart';
        } else if (websiteOrder.itemName) {
          const searchName = websiteOrder.itemName.toLowerCase().trim();
          // No exact match - try to find items that START with the search term
          // This prevents "Chicken" from matching "Gongura Chicken"
          let partialMatches = menuItems.filter(item => 
            item.name.toLowerCase().trim().startsWith(searchName) ||
            searchName.startsWith(item.name.toLowerCase().trim())
          );
          
          // If no startsWith matches, try contains but only if search term is significant
          if (partialMatches.length === 0 && searchName.length >= 4) {
            partialMatches = menuItems.filter(item => 
              this.smartIncludes(searchName, item.name)
            );
          }
          
          if (partialMatches.length === 1) {
            // Single partial match - show item details
            const item = partialMatches[0];
            logger.info('Single partial match found', { match: item.name });
            state.selectedItem = item._id.toString();
            customer.conversationState = state;
            await customer.save();
            await this.sendItemDetailsForOrder(phone, item);
            
            // Also send the full cart after showing the product
            await this.sendCart(phone, customer);
            state.currentStep = 'viewing_item_details';
          } else if (partialMatches.length > 1) {
            // Multiple matches - show options as list
            logger.info('Multiple matches found', { match: partialMatches.map(i => i.name) });
            const activeOffers = await getCachedActiveOffers(phone);
            const sections = [{
              title: `Items matching "${websiteOrder.itemName}"`,
              rows: partialMatches.slice(0, 10).map(item => ({
                id: `view_${item._id}`,
                title: item.name.substring(0, 24),
                description: `${formatPriceWithActiveOffers(item, activeOffers)} • ${item.foodType === 'veg' ? '🟢 Veg' : item.foodType === 'nonveg' ? '🔴 Non-Veg' : '🟡 Egg'}`
              }))
            }];
            await whatsapp.sendList(phone, '🔍 Select Item', `Found ${partialMatches.length} items. Please select one:`, 'View Items', sections, 'Tap to view details');
            state.currentStep = 'select_item';
          } else {
            // No match found
            logger.info('No match found for', { match: websiteOrder.itemName });
            const itemNotAvailableImageUrl = await chatbotImagesService.getImageUrl('item_not_available');
            await whatsapp.sendMessage(phone, `❌ Sorry, "${websiteOrder.itemName}" is not available.\n\nPlease browse our menu!`);
            state.currentStep = 'main_menu';
          }
        } else {
          // Item ID provided but not found in menu
          logger.info('Website order item not found by ID', { itemId: websiteOrder.itemId });
          const itemNotAvailableImageUrl = await chatbotImagesService.getImageUrl('item_not_available');
          await whatsapp.sendMessage(phone, `❌ Sorry, this item is currently not available.\n\nPlease browse our menu!`);
          state.currentStep = 'main_menu';
        }
      }
      // ========== GLOBAL COMMANDS (work from any state) ==========
      // Greeting patterns - support common variations with extra letters (hi, hii, hiii, hey, heyyy, etc.)
      else if (/^h+i+$/i.test(msg) || /^h+e+y+$/i.test(msg) || /^h+e+l+o+$/i.test(msg) || msg === 'hello' || msg === 'start' || msg === 'hai' || msg === 'hlo' || msg === 'helo') {
        await this.sendWelcome(phone);
        state.currentStep = 'main_menu';
      }
      // ========== OFFER CLAIM CHECK (handle claim_offer_OFFERID button) ==========
      else if (selection?.startsWith('claim_offer_')) {
        const offerId = selection.replace('claim_offer_', '');
        await this.handleOfferClaim(phone, offerId, customer);
        state.currentStep = 'main_menu';
      }
      else if (selection === 'home' || selection === 'back' || msg === 'home' || msg === 'back') {
        await this.sendWelcome(phone);
        state.currentStep = 'main_menu';
      }
      // ========== CART COMMANDS (check CLEAR first, then VIEW - order matters!) ==========
      // Clear cart must be checked BEFORE view cart because "clear my cart" contains "my cart"
      else if (selection === 'clear_cart') {
        const itemCount = customer.cart?.length || 0;
        customer.cart = [];
        await customer.save();
        
        const cartClearedImageUrl = await chatbotImagesService.getImageUrl('cart_cleared');
        
        let message = '🗑️ *Cart Cleared Successfully!*\n\n';
        if (itemCount > 0) {
          message += `✅ Removed ${itemCount} item${itemCount > 1 ? 's' : ''} from your cart.\n\n`;
        }
        message += `🛒 Your cart is now empty and ready for a fresh start!\n\n`;
        message += `🍽️ Browse our delicious menu and discover your favorites! 😋`;
        
        await whatsapp.sendMessage(phone, message);
        state.currentStep = 'main_menu';
      }
      else if (selection === 'view_cart') {
        await this.sendCart(phone, customer);
        state.currentStep = 'viewing_cart';
      }
      // Handle proceed without offer - add items to cart without discount
      else if (selection === 'proceed_without_offer') {
        const pendingCartOrder = state.pendingCartOrder;
        if (pendingCartOrder && pendingCartOrder.items) {
          customer.cart = customer.cart || [];
          let addedCount = 0;
          
          for (const cartItem of pendingCartOrder.items) {
            const menuItem = menuItems.find(m => 
              m.name.toLowerCase().trim() === cartItem.name.toLowerCase().trim()
            );
            
            if (menuItem) {
              const existingIndex = customer.cart.findIndex(c => 
                c.menuItem?.toString() === menuItem._id.toString()
              );
              
              if (existingIndex >= 0) {
                customer.cart[existingIndex].quantity += cartItem.quantity;
                customer.cart[existingIndex].addedAt = new Date();
              } else {
                customer.cart.push({ menuItem: menuItem._id, quantity: cartItem.quantity, addedAt: new Date() });
              }
              addedCount++;
            }
          }
          
          // Clear pending order
          state.pendingCartOrder = null;
          await customer.save();
          
          if (addedCount > 0) {
            await this.sendCart(phone, customer);
            state.currentStep = 'viewing_cart';
          } else {
            const itemNotAvailableImg = await chatbotImagesService.getImageUrl('item_not_available');
            await whatsapp.sendMessage(phone, `❌ Sorry, we couldn't find the items.\n\nPlease browse our menu to add items.`);
            state.currentStep = 'main_menu';
          }
        } else {
          await this.sendMainMenu(phone);
          state.currentStep = 'main_menu';
        }
      }
      // Handle simple cart keyword (just "cart") - show welcome flow
      else if (!selectedId && this.isSimpleCartKeyword(msg)) {
        await this.sendWelcome(phone);
        state.currentStep = 'main_menu';
      }
      // Handle full cart intent ("view cart", "my cart", etc.) - show welcome flow
      else if (!selectedId && this.isCartIntent(msg)) {
        await this.sendWelcome(phone);
        state.currentStep = 'main_menu';
      }
      else if (selection === 'view_menu') {
        await this.sendFoodTypeSelection(phone);
        state.currentStep = 'select_food_type';
      }
      // Handle veg_only / nonveg_only / egg_only / show_all (from "Item Not Available" browse menu buttons or "Add More")
      else if (selection === 'veg_only' || selection === 'nonveg_only' || selection === 'egg_only' || selection === 'show_all') {
        const foodTypeMap = { veg_only: 'veg', nonveg_only: 'nonveg', egg_only: 'egg', show_all: 'both' };
        state.foodTypePreference = foodTypeMap[selection];
        const filteredItems = this.filterByFoodType(menuItems, state.foodTypePreference);
        const labelMap = { veg_only: '🌿 Veg Menu', nonveg_only: '🍗 Non-Veg Menu', egg_only: '🥚 Egg Menu', show_all: '🍽️ All Menu' };
        
        if (filteredItems.length > 0) {
          // If coming from order flow (Add More / Order Food), show title list; otherwise category browsing
          if (state.currentStep === 'select_food_type_order') {
            await this.sendTitleListForOrder(phone, menuItems, state.foodTypePreference, labelMap[selection]);
            state.currentStep = 'select_title_order';
          } else {
            await this.sendMenuCategoriesWithLabel(phone, filteredItems, labelMap[selection]);
            state.currentStep = 'select_category';
          }
        } else {
          const itemNotAvailableImg = await chatbotImagesService.getImageUrl('item_not_available');
          await whatsapp.sendMessage(phone, `❌ No ${labelMap[selection]} items available right now.`);
          state.currentStep = 'main_menu';
        }
      }
      // Handle text/voice menu intent — redirect to welcome flow
      else if (!selectedId && this.isShowMenuIntent(msg)) {
        await this.sendWelcome(phone);
        state.currentStep = 'main_menu';
      }
      else if (selection === 'food_all' || selection === 'food_veg' || selection === 'food_nonveg' || selection === 'food_egg') {
        state.foodTypePreference = selection.replace('food_', '');
        logger.info('Food type selected', { data: state.foodTypePreference });
        const filteredItems = selection === 'food_all' ? menuItems : this.filterByFoodType(menuItems, state.foodTypePreference);
        
        const foodTypeLabels = {
          all: '🍽️ All Menu',
          veg: '🌿 Veg Menu',
          nonveg: '🍗 Non-Veg Menu',
          egg: '🟡 Egg Menu'
        };
        
        // If coming from order flow, show title list; otherwise category browsing
        if (state.currentStep === 'select_food_type_order') {
          await this.sendTitleListForOrder(phone, menuItems, state.foodTypePreference, foodTypeLabels[state.foodTypePreference]);
          state.currentStep = 'select_title_order';
        } else {
          await this.sendMenuCategoriesWithLabel(phone, filteredItems, foodTypeLabels[state.foodTypePreference]);
          state.currentStep = 'select_category';
        }
      }
      else if (selection === 'place_order' || selection === 'order_now') {
        // Skip service type selection and go directly to food type selection
        await this.sendFoodTypeSelection(phone);
        state.currentStep = 'select_food_type_order';
      }
      // Check cancel/track BEFORE order status (they're more specific)
      // Only button selections — text-based intents redirect to welcome flow below
      else if (selection === 'cancel_order') {
        await this.sendCancelOptions(phone);
        state.currentStep = 'select_cancel';
      }
      else if (selection === 'track_order') {
        await this.sendTrackingOptions(phone);
        state.currentStep = 'select_track';
      }
      else if (selection === 'order_status') {
        await this.sendOrderStatus(phone);
        state.currentStep = 'main_menu';
      }
      else if (selection === 'help') {
        await this.sendHelp(phone);
        state.currentStep = 'main_menu';
      }
      else if (selection === 'open_website') {
        await this.sendWebsiteLink(phone);
        state.currentStep = 'main_menu';
      }
      // ========== VIEW OFFERS BUTTON (from welcome flow) ==========
      else if (selection === 'view_offers') {
        await this.sendViewOffers(phone);
        state.currentStep = 'main_menu';
      }
      // ========== ORDER FOOD BUTTON (from welcome message) ==========
      else if (selection === 'order_food') {
        await this.sendOrderFoodMenu(phone);
        state.currentStep = 'select_food_type_order';
      }
      // ========== MY ORDERS BUTTON (from welcome message) ==========
      else if (selection === 'my_orders') {
        await this.sendMyOrdersMenu(phone);
        state.currentStep = 'main_menu';
      }
      // ========== VIEW ORDER (from My Orders flow screen) ==========
      else if (selection?.startsWith('view_order_')) {
        const orderId = selection.replace('view_order_', '');
        await this.handleViewOrderDetails(phone, customer, orderId);
        state.currentStep = 'main_menu';
      }
      // ========== VIEW OFFER (from View Offers flow screen) ==========
      else if (selection?.startsWith('view_offer_')) {
        const offerId = selection.replace('view_offer_', '');
        await this.handleOfferClaim(phone, offerId, customer);
        state.currentStep = 'main_menu';
      }
      // ========== SHARE LOCATION FOR ADDRESS ==========
      else if (selection === 'share_location_address') {
        await whatsapp.sendMessage(phone, '📍 Please share your current location using the attachment (📎) button → Location.\n\nWe\'ll automatically fill your address from your location.');
        state.currentStep = 'awaiting_address_location';
      }
      // ========== TEXT-BASED ADD TO CART (e.g., "add biryani to cart") ==========
      else if (!selectedId && this.isAddToCartIntent(msg)) {
        const addIntent = this.isAddToCartIntent(msg);
        logger.info('Add to cart intent detected', { cart: addIntent });
        
        // Search for item by name using smart matching
        const searchTerm = addIntent.itemName.toLowerCase();
        const matchingItems = menuItems.filter(item => 
          this.smartIncludes(searchTerm, item.name) ||
          (item.tags && item.tags.some(tag => this.smartIncludes(searchTerm, tag)))
        );
        
        if (matchingItems.length === 1) {
          // Exact match - add to cart with qty 1
          const item = matchingItems[0];
          customer.cart = customer.cart || [];
          const existingIndex = customer.cart.findIndex(c => c.menuItem?.toString() === item._id.toString());
          if (existingIndex >= 0) {
            customer.cart[existingIndex].quantity += 1;
            customer.cart[existingIndex].addedAt = new Date(); // Update timestamp when quantity changes
          } else {
            customer.cart.push({ menuItem: item._id, quantity: 1, addedAt: new Date() });
          }
          await customer.save();
          await this.sendAddedToCart(phone, item, 1, customer.cart);
          state.currentStep = 'item_added';
        } else if (matchingItems.length > 1) {
          // Multiple matches - show options
          const activeOffers = await getCachedActiveOffers(phone);
          const sections = [{
            title: `Items matching "${addIntent.itemName}"`,
            rows: matchingItems.slice(0, 10).map(item => ({
              id: `add_${item._id}`,
              title: item.name.substring(0, 24),
              description: `${formatPriceWithActiveOffers(item, activeOffers)} • ${item.foodType === 'veg' ? '🟢 Veg' : item.foodType === 'nonveg' ? '🔴 Non-Veg' : '🟡 Egg'}`
            }))
          }];
          await whatsapp.sendList(phone, '🔍 Multiple Items Found', `Found ${matchingItems.length} items matching "${addIntent.itemName}"`, 'Select Item', sections, 'Tap to add to cart');
          state.currentStep = 'select_item';
        } else {
          // No match found
          const searchNoResultsImg = await chatbotImagesService.getImageUrl('search_no_results');
          await whatsapp.sendMessage(phone, `❌ No items found matching "${addIntent.itemName}"\n\nTry browsing our menu!`);
          state.currentStep = 'main_menu';
        }
      }
      else if (selection === 'checkout' || selection === 'review_pay' || selection === 'cart_place_order') {
        // Reset state if customer was in order_confirmed or order_placed state
        if (state.currentStep === 'order_confirmed' || state.currentStep === 'order_placed' || state.currentStep === 'awaiting_payment') {
          logger.info('Resetting state from previous order', { previousStep: state.currentStep });
          state.currentStep = 'main_menu';
          state.selectedItem = null;
          state.serviceType = null;
          state.paymentMethod = null;
        }
        
        // If user has a selected item they're viewing (but hasn't added it yet), add it to cart with qty 1
        // Only add if user is on 'viewing_item_details' step - otherwise item was already added via quantity selection
        if (state.selectedItem && state.currentStep === 'viewing_item_details') {
          const item = menuItems.find(m => m._id.toString() === state.selectedItem);
          if (item) {
            // Check if item already in cart
            const existingIndex = customer.cart?.findIndex(c => c.menuItem.toString() === state.selectedItem);
            if (existingIndex >= 0) {
              // Item already in cart, increment quantity
              customer.cart[existingIndex].quantity += 1;
              customer.cart[existingIndex].addedAt = new Date(); // Update timestamp when quantity changes
            } else {
              // Add new item to cart
              if (!customer.cart) customer.cart = [];
              customer.cart.push({ menuItem: item._id, quantity: 1, addedAt: new Date() });
            }
            await customer.save();
            logger.info('Item added to cart before checkout', { item: item.name });
          }
        }
        // Clear selectedItem to prevent duplicate additions on subsequent review_pay clicks
        state.selectedItem = null;
        
        if (!customer.cart?.length) {
          const cartEmptyImg = await chatbotImagesService.getImageUrl('cart_empty');
          await whatsapp.sendMessage(phone, 'Your cart is empty! Please add items first.');
          state.currentStep = 'main_menu';
        } else {
          // Check if cart items are still available
          const availabilityCheck = await checkCartAvailability(customer.cart);
          
          if (!availabilityCheck.available) {
            // Some items are unavailable - notify user
            const unavailableNames = availabilityCheck.unavailableItems.map(i => i.name).join(', ');
            const itemNotAvailableImageUrl = await chatbotImagesService.getImageUrl('item_not_available');
            
            const msg = `😔 *Sorry!*\n\nSome items in your cart are currently unavailable:\n\n❌ ${unavailableNames}\n\nPlease remove these items from your cart and try again.`;
            
            await whatsapp.sendMessage(phone, msg);
            state.currentStep = 'viewing_cart';
          } else {
            // All items available — launch order confirmation flow (or fallback to buttons)
            const orderFlowId = catalogService.getOrderConfirmFlowId();
            if (orderFlowId) {
              try {
                const metaCloud = require('./metaCloud');
                const flowToken = `order_confirm_${phone}`;
                const checkoutImg = await chatbotImagesService.getImageUrl('checkout');
                await metaCloud.sendFlowMessage(phone, {
                  flowId: orderFlowId,
                  flowCta: 'Review & Place Order',
                  headerImageUrl: checkoutImg || undefined,
                  headerText: 'Order Confirmation',
                  bodyText: '📋 Review your order and choose delivery type',
                  footerText: 'Perivi Hotel',
                  flowToken,
                  flowAction: 'data_exchange',
                  mode: 'published'
                });
                state.currentStep = 'order_confirm_flow';
                logger.info('Sent order confirmation flow', { phone, flowId: orderFlowId });
              } catch (flowErr) {
                logger.error('Order confirm flow failed', { error: flowErr.message });
                await whatsapp.sendMessage(phone, '⚠️ Unable to load order confirmation. Please try again.');
              }
            } else {
              // No order confirm flow configured — use original buttons
              await this.sendServiceTypeSelection(phone);
              state.currentStep = 'select_service_type';
            }
          }
        }
      }
      else if (selection === 'service_delivery') {
        // Customer chose delivery service - proceed to location
        state.serviceType = 'delivery';
        await this.requestLocation(phone);
        state.currentStep = 'awaiting_location';
      }
      else if (selection === 'service_pickup') {
        // Customer chose self-pickup - skip location, go to payment method
        state.serviceType = 'pickup';
        customer.deliveryAddress = {
          address: 'Self-Pickup at Restaurant',
          updatedAt: new Date()
        };
        await customer.save();
        const launched = await this.launchPaymentFlow(phone, 'pickup');
        if (!launched) {
          await this.sendPickupPaymentMethodOptions(phone, customer);
        }
        state.currentStep = 'select_pickup_payment_method';
      }
      else if (selection === 'share_location') {
        // User tapped share location button - remind them to share
        await whatsapp.sendMessage(phone,
          `📍 Please share your location:\n\n` +
          `1️⃣ Tap the 📎 attachment icon below\n` +
          `2️⃣ Select "Location"\n` +
          `3️⃣ Send your current location\n\n` +
          `We're waiting for your location! 🛵`
        );
        state.currentStep = 'awaiting_location';
      }
      else if (selection === 'skip_location') {
        // Skip location - proceed to payment without address
        customer.deliveryAddress = {
          address: 'Address not provided - will confirm on call',
          updatedAt: new Date()
        };
        await customer.save();
        const launched = await this.launchPaymentFlow(phone, 'delivery');
        if (!launched) {
          await this.sendPaymentMethodOptions(phone, customer);
        }
        state.currentStep = 'select_payment_method';
      }
      else if (selection === 'pay_upi') {
        if (!customer.cart?.length) {
          const cartEmptyImg = await chatbotImagesService.getImageUrl('cart_empty');
          await whatsapp.sendMessage(phone, '🛒 Your cart is empty!');
          state.currentStep = 'main_menu';
        } else {
          // Check if cart items are still available before payment
          const availabilityCheck = await checkCartAvailability(customer.cart);
          
          if (!availabilityCheck.available) {
            const unavailableNames = availabilityCheck.unavailableItems.map(i => i.name).join(', ');
            const itemNotAvailableImageUrl = await chatbotImagesService.getImageUrl('item_not_available');
            
            const msg = `😔 *Sorry!*\n\nSome items in your cart are currently unavailable:\n\n❌ ${unavailableNames}\n\nPlease remove these items from your cart and try again.`;
            
            await whatsapp.sendMessage(phone, msg);
            state.currentStep = 'viewing_cart';
          } else {
            state.paymentMethod = 'upi';
            const result = await this.processCheckout(phone, customer, state);
            if (result.success) state.currentStep = 'awaiting_payment';
          }
        }
      }
      else if (selection === 'pay_cod') {
        if (!customer.cart?.length) {
          const cartEmptyImg = await chatbotImagesService.getImageUrl('cart_empty');
          await whatsapp.sendMessage(phone, '🛒 Your cart is empty!');
          state.currentStep = 'main_menu';
        } else {
          // Check if cart items are still available before COD order
          const availabilityCheck = await checkCartAvailability(customer.cart);
          
          if (!availabilityCheck.available) {
            const unavailableNames = availabilityCheck.unavailableItems.map(i => i.name).join(', ');
            const itemNotAvailableImageUrl = await chatbotImagesService.getImageUrl('item_not_available');
            
            const msg = `😔 *Sorry!*\n\nSome items in your cart are currently unavailable:\n\n❌ ${unavailableNames}\n\nPlease remove these items from your cart and try again.`;
            
            await whatsapp.sendMessage(phone, msg);
            state.currentStep = 'viewing_cart';
          } else {
            state.paymentMethod = 'cod';
            const result = await this.processCODOrder(phone, customer, state);
            if (result.success) state.currentStep = 'order_confirmed';
          }
        }
      }
      else if (selection === 'pickup_pay_hotel') {
        // Self-pickup with payment at hotel
        if (!customer.cart?.length) {
          const cartEmptyImg = await chatbotImagesService.getImageUrl('cart_empty');
          await whatsapp.sendMessage(phone, '🛒 Your cart is empty!');
          state.currentStep = 'main_menu';
        } else {
          state.paymentMethod = 'cod'; // Use COD for at-hotel payment
          state.serviceType = 'pickup';
          const result = await this.processPickupCheckout(phone, customer, state);
          if (result.success) state.currentStep = 'order_placed';
        }
      }
      else if (selection === 'pickup_pay_upi') {
        // Self-pickup with UPI/App payment
        if (!customer.cart?.length) {
          const cartEmptyImg = await chatbotImagesService.getImageUrl('cart_empty');
          await whatsapp.sendMessage(phone, '🛒 Your cart is empty!');
          state.currentStep = 'main_menu';
        } else {
          // Check if cart items are still available before payment
          const availabilityCheck = await checkCartAvailability(customer.cart);
          
          if (!availabilityCheck.available) {
            const unavailableNames = availabilityCheck.unavailableItems.map(i => i.name).join(', ');
            const itemNotAvailableImageUrl = await chatbotImagesService.getImageUrl('item_not_available');
            
            const msg = `😔 *Sorry!*\n\nSome items in your cart are currently unavailable:\n\n❌ ${unavailableNames}\n\nPlease remove these items from your cart and try again.`;
            
            await whatsapp.sendMessage(phone, msg);
            state.currentStep = 'viewing_cart';
          } else {
            state.paymentMethod = 'upi';
            state.serviceType = 'pickup';
            const result = await this.processCheckout(phone, customer, state);
            if (result.success) state.currentStep = 'awaiting_payment';
          }
        }
      }
      else if (selection === 'confirm_order' || selection === 'pay_now') {
        if (!customer.cart?.length) {
          const cartEmptyImg = await chatbotImagesService.getImageUrl('cart_empty');
          await whatsapp.sendMessage(phone, '🛒 Your cart is empty!');
          state.currentStep = 'main_menu';
        } else {
          const result = await this.processCheckout(phone, customer, state);
          if (result.success) state.currentStep = 'awaiting_payment';
        }
      }
      else if (selection === 'add_more') {
        // Show Browse Menu with image (same as Order Food)
        await this.sendFoodTypeSelection(phone);
        state.currentStep = 'select_food_type_order';
      }

      // ========== CATEGORY SELECTION ==========
      else if (selection === 'cat_all') {
        // Show all items from all categories (within selected food type)
        const preference = state.foodTypePreference || 'both';
        const filteredItems = this.filterByFoodType(menuItems, preference);
        logger.info('All items selected - Food preference', { preference, totalItems: filteredItems.length });
        await this.sendAllItems(phone, filteredItems);
        state.selectedCategory = 'all';
        state.currentStep = 'viewing_items';
      }
      else if (selection.startsWith('cat_')) {
        const sanitizedCat = selection.replace('cat_', '');
        const preference = state.foodTypePreference || 'both';
        const filteredItems = this.filterByFoodType(menuItems, preference);
        // Find original category name from sanitized ID
        const allCategories = [...new Set(filteredItems.flatMap(m => Array.isArray(m.category) ? m.category : [m.category]))];
        const category = allCategories.find(c => c.replace(/[^a-zA-Z0-9_]/g, '_') === sanitizedCat) || sanitizedCat;
        logger.info('Category selection - Food preference', { preference, category });
        logger.info('After filter', { items: filteredItems.length, inCategory: filteredItems.filter(m => Array.isArray(m.category) ? m.category.includes(category) : m.category === category).length });
        await this.sendCategoryItems(phone, filteredItems, category);
        state.selectedCategory = category;
        state.currentStep = 'viewing_items';
      }
      else if (selection === 'order_cat_all') {
        // Show all items for ordering (within selected food type)
        const filteredItems = this.filterByFoodType(menuItems, state.foodTypePreference || 'both');
        logger.info('All items for order - Total items', { items: filteredItems.length });
        await this.sendAllItemsForOrder(phone, filteredItems);
        state.selectedCategory = 'all';
        state.currentStep = 'selecting_item';
      }
      else if (selection.startsWith('order_title_')) {
        // User selected a title (menu item) from the title list — show its variants via catalog
        const titleItemId = selection.replace('order_title_', '');
        const foodType = state.foodTypePreference || 'both';
        logger.info('Title selected for order', { titleItemId, foodType });
        await this.sendTitleVariantsForOrder(phone, menuItems, titleItemId, foodType);
        state.selectedTitle = titleItemId;
        state.currentStep = 'selecting_item';
      }
      else if (selection.startsWith('flow_order_')) {
        // From WhatsApp Flow: flow_order_{foodPref}_{menuItemId}
        const parts = selection.replace('flow_order_', '').split('_');
        const foodPref = parts.shift(); // all, veg, nonveg, egg
        const titleItemId = parts.join('_');
        state.foodTypePreference = foodPref;
        state.currentStep = 'select_title_order';
        logger.info('Flow order category selected', { titleItemId, foodPref });
        await this.sendTitleVariantsForOrder(phone, menuItems, titleItemId, foodPref === 'all' ? 'both' : foodPref);
        state.selectedTitle = titleItemId;
        state.currentStep = 'selecting_item';
      }
      // User selected a specific variant from the fallback list (Android users)
      else if (selection.startsWith('add_variant_')) {
        const parts = selection.replace('add_variant_', '').split('_');
        const variantIndex = parseInt(parts.pop());
        const menuItemId = parts.join('_');
        const menuItem = menuItems.find(m => m._id.toString() === menuItemId);

        if (menuItem && menuItem.variants && menuItem.variants[variantIndex]) {
          const variant = menuItem.variants[variantIndex];
          // If variant has quantities, show quantity options as buttons
          if (variant.quantities && variant.quantities.length > 0) {
            const rows = variant.quantities.slice(0, 10).map((q, qIdx) => {
              const price = q.offerPrice && q.offerPrice < q.price ? q.offerPrice : q.price;
              return {
                rowId: `addqty_${menuItemId}_${variantIndex}_${qIdx}`,
                title: `${q.quantity} ${q.unit}`.substring(0, 24),
                description: `₹${price}`
              };
            });
            await whatsapp.sendList(
              phone,
              `${variant.label}`.substring(0, 24),
              `📋 *${menuItem.name} — ${variant.label}*\nSelect quantity:`,
              'Choose Size',
              [{ title: 'Quantities', rows }],
              'Pick a size'
            );
            state.currentStep = 'selecting_quantity';
          } else {
            // No quantities — add variant directly to cart
            customer.cart = customer.cart || [];
            const existingIdx = customer.cart.findIndex(c =>
              c.menuItem?.toString() === menuItemId && c.variantIndex === variantIndex
            );
            if (existingIdx >= 0) {
              customer.cart[existingIdx].quantity += 1;
            } else {
              customer.cart.push({
                menuItem: menuItem._id,
                quantity: 1,
                variantIndex,
                variantLabel: variant.label,
                addedAt: new Date()
              });
            }
            await customer.save();
            await this.sendCart(phone, customer);
            state.currentStep = 'item_added';
          }
        } else {
          const itemNotAvailableImg = await chatbotImagesService.getImageUrl('item_not_available');
          await whatsapp.sendMessage(phone, '❌ Variant not found.');
        }
      }
      // User selected a quantity for a variant (from add_variant flow)
      else if (selection.startsWith('addqty_')) {
        const parts = selection.replace('addqty_', '').split('_');
        const qIdx = parseInt(parts.pop());
        const vIdx = parseInt(parts.pop());
        const menuItemId = parts.join('_');
        const menuItem = menuItems.find(m => m._id.toString() === menuItemId);

        if (menuItem && menuItem.variants?.[vIdx]?.quantities?.[qIdx]) {
          customer.cart = customer.cart || [];
          const existingIdx = customer.cart.findIndex(c =>
            c.menuItem?.toString() === menuItemId && c.variantIndex === vIdx && c.quantityIndex === qIdx
          );
          if (existingIdx >= 0) {
            customer.cart[existingIdx].quantity += 1;
          } else {
            const variant = menuItem.variants[vIdx];
            const qty = variant.quantities[qIdx];
            customer.cart.push({
              menuItem: menuItem._id,
              quantity: 1,
              variantIndex: vIdx,
              variantLabel: `${variant.label} - ${qty.quantity} ${qty.unit}`,
              quantityIndex: qIdx,
              addedAt: new Date()
            });
          }
          await customer.save();
          await this.sendCart(phone, customer);
          state.currentStep = 'item_added';
        } else {
          const itemNotAvailableImg = await chatbotImagesService.getImageUrl('item_not_available');
          await whatsapp.sendMessage(phone, '❌ Option not found.');
        }
      }
      else if (selection.startsWith('order_cat_')) {
        const sanitizedCat = selection.replace('order_cat_', '');
        const filteredItems = this.filterByFoodType(menuItems, state.foodTypePreference || 'both');
        // Find original category name from sanitized ID
        const allCategories = [...new Set(filteredItems.flatMap(m => Array.isArray(m.category) ? m.category : [m.category]))];
        const category = allCategories.find(c => c.replace(/[^a-zA-Z0-9_]/g, '_') === sanitizedCat) || sanitizedCat;
        await this.sendItemsForOrder(phone, filteredItems, category);
        state.selectedCategory = category;
        state.currentStep = 'selecting_item';
      }

      // ========== PAGINATION HANDLERS ==========
      // Category list pagination (for browsing)
      else if (selection.startsWith('menucat_page_')) {
        const page = parseInt(selection.replace('menucat_page_', ''));
        const filteredItems = this.filterByFoodType(menuItems, state.foodTypePreference || 'both');
        state.categoryPage = page;
        await this.sendMenuCategories(phone, filteredItems, 'Our Menu', page);
        state.currentStep = 'select_category';
      }
      // Category list pagination (for ordering)
      else if (selection.startsWith('ordercat_page_')) {
        const page = parseInt(selection.replace('ordercat_page_', ''));
        const filteredItems = this.filterByFoodType(menuItems, state.foodTypePreference || 'both');
        state.categoryPage = page;
        await this.sendMenuForOrder(phone, filteredItems, 'Select Items', page);
        state.currentStep = 'browsing_menu';
      }
      // All items pagination (for browsing)
      else if (selection.startsWith('allitems_page_')) {
        const page = parseInt(selection.replace('allitems_page_', ''));
        const filteredItems = this.filterByFoodType(menuItems, state.foodTypePreference || 'both');
        state.currentPage = page;
        await this.sendAllItems(phone, filteredItems, page);
        state.currentStep = 'viewing_items';
      }
      // All items pagination (for ordering)
      else if (selection.startsWith('orderitems_page_')) {
        const page = parseInt(selection.replace('orderitems_page_', ''));
        const filteredItems = this.filterByFoodType(menuItems, state.foodTypePreference || 'both');
        state.currentPage = page;
        await this.sendAllItemsForOrder(phone, filteredItems, page);
        state.currentStep = 'selecting_item';
      }
      else if (selection.startsWith('catpage_')) {
        const parts = selection.replace('catpage_', '').split('_');
        const page = parseInt(parts.pop());
        const safeCat = parts.join('_');
        const filteredItems = this.filterByFoodType(menuItems, state.foodTypePreference || 'both');
        const allCategories = [...new Set(filteredItems.flatMap(m => Array.isArray(m.category) ? m.category : [m.category]))];
        const category = allCategories.find(c => c.replace(/[^a-zA-Z0-9]/g, '_') === safeCat) || safeCat;
        state.currentPage = page;
        state.selectedCategory = category;
        await this.sendCategoryItems(phone, filteredItems, category, page);
        state.currentStep = 'viewing_items';
      }
      else if (selection.startsWith('ordercatpage_')) {
        const parts = selection.replace('ordercatpage_', '').split('_');
        const page = parseInt(parts.pop());
        const safeCat = parts.join('_');
        const filteredItems = this.filterByFoodType(menuItems, state.foodTypePreference || 'both');
        const allCategories = [...new Set(filteredItems.flatMap(m => Array.isArray(m.category) ? m.category : [m.category]))];
        const category = allCategories.find(c => c.replace(/[^a-zA-Z0-9]/g, '_') === safeCat) || safeCat;
        state.currentPage = page;
        state.selectedCategory = category;
        await this.sendItemsForOrder(phone, filteredItems, category, page);
        state.currentStep = 'selecting_item';
      }
      // Tag search pagination — use cached tagSearchResults to avoid re-running AI search
      else if (selection.startsWith('tagpage_')) {
        const parts = selection.replace('tagpage_', '').split('_');
        const page = parseInt(parts.pop());
        const safeTag = parts.join('_');
        // Restore original search term from state or use safe version
        const searchTerm = state.searchTag || safeTag.replace(/_/g, ' ');

        // Use cached search result IDs if available (avoids re-running Groq AI translation)
        let matchingItems;
        let displayLabel;
        if (state.tagSearchResults && state.tagSearchResults.length > 0) {
          matchingItems = state.tagSearchResults
            .map(id => menuItems.find(m => m._id.toString() === id))
            .filter(Boolean);
          displayLabel = `"${searchTerm}"`;
        } else {
          // Fallback: re-run search only if cached IDs are missing
          const searchResult = await this.smartSearch(searchTerm, menuItems);
          matchingItems = searchResult?.items || [];
          displayLabel = searchResult?.label 
            ? (searchResult.searchTerm ? `${searchResult.label} "${searchResult.searchTerm}"` : searchResult.label)
            : (searchResult?.searchTerm ? `"${searchResult.searchTerm}"` : `"${searchTerm}"`);
        }

        state.currentPage = page;
        await this.sendItemsByTag(phone, matchingItems, displayLabel, page);
        state.currentStep = 'viewing_tag_results';
      }

      // ========== ITEM SELECTION ==========
      else if (selection.startsWith('view_')) {
        const itemId = selection.replace('view_', '');
        await this.sendItemDetails(phone, menuItems, itemId);
        state.selectedItem = itemId;
        state.currentStep = 'viewing_item_details';
      }
      else if (selection.startsWith('add_')) {
        const itemId = selection.replace('add_', '');
        const item = menuItems.find(m => m._id.toString() === itemId);
        if (item) {
          state.selectedItem = itemId;
          // Save state immediately to ensure selectedItem persists
          customer.conversationState = state;
          await customer.save();
          // Show item details first, then user can click "Add to Cart" to select quantity
          await this.sendItemDetails(phone, menuItems, itemId);
          state.currentStep = 'viewing_item_details';
        } else {
          logger.info('Item not found for add_', { items: itemId });
          const itemNotAvailableImg = await chatbotImagesService.getImageUrl('item_not_available');
          await whatsapp.sendMessage(phone, '⚠️ This item is no longer available. Please select another item.');
          state.currentStep = 'main_menu';
        }
      }
      else if (selection.startsWith('confirm_add_')) {
        const itemId = selection.replace('confirm_add_', '');
        const item = menuItems.find(m => m._id.toString() === itemId);
        if (item) {
          state.selectedItem = itemId;
          // Save state immediately to ensure selectedItem persists
          customer.conversationState = state;
          await customer.save();
          await this.sendQuantitySelection(phone, item);
          state.currentStep = 'select_quantity';
        } else {
          logger.info('Item not found for confirm_add_', { items: itemId });
          const itemNotAvailableImg = await chatbotImagesService.getImageUrl('item_not_available');
          await whatsapp.sendMessage(phone, '⚠️ This item is no longer available. Please select another item.');
          state.currentStep = 'main_menu';
        }
      }

      // ========== QUANTITY SELECTION ==========
      else if (selection.startsWith('qty_')) {
        const qty = parseInt(selection.replace('qty_', ''));
        logger.info('Quantity selected', { qty, selectedItem: state.selectedItem });
        
        const item = menuItems.find(m => m._id.toString() === state.selectedItem);
        
        if (item && qty > 0) {
          customer.cart = customer.cart || [];
          // Check if item already in cart
          const existingIndex = customer.cart.findIndex(c => c.menuItem?.toString() === item._id.toString());
          if (existingIndex >= 0) {
            customer.cart[existingIndex].quantity += qty;
            customer.cart[existingIndex].addedAt = new Date(); // Update timestamp when quantity changes
          } else {
            customer.cart.push({ menuItem: item._id, quantity: qty, addedAt: new Date() });
          }
          // Save cart immediately to persist the change
          await customer.save();
          logger.info('Cart updated and saved', { cartSize: customer.cart.length });
          await this.sendAddedToCart(phone, item, qty, customer.cart);
          // Clear selectedItem after successful cart addition to prevent duplicate additions
          state.selectedItem = null;
          state.currentStep = 'item_added';
        } else {
          // Item not found - maybe state was lost, show menu again
          logger.info('Item not found for qty selection, selectedItem', { items: state.selectedItem });
          const helpImg = await chatbotImagesService.getImageUrl('help_support');
          await whatsapp.sendMessage(phone, '⚠️ Something went wrong. Please select an item again.');
          state.currentStep = 'main_menu';
        }
      }

      // ========== SERVICE TYPE SELECTION ==========
      else if (state.currentStep === 'select_service') {
        const services = { 'delivery': 'delivery', 'pickup': 'pickup', 'dine_in': 'dine_in' };
        if (services[selection]) {
          state.selectedService = services[selection];
          // Ask for food type preference before showing menu
          await this.sendFoodTypeSelection(phone);
          state.currentStep = 'select_food_type_order';
        }
      }

      // ========== ORDER TRACKING ==========
      else if (selection.startsWith('track_')) {
        const orderId = selection.replace('track_', '');
        await this.sendTrackingDetails(phone, orderId);
        state.currentStep = 'main_menu';
      }

      // ========== ORDER CANCELLATION ==========
      else if (selection.startsWith('cancel_')) {
        const orderId = selection.replace('cancel_', '');
        await this.processCancellation(phone, orderId);
        state.currentStep = 'main_menu';
      }

      // ========== CART ITEM REMOVAL ==========
      else if (selection.startsWith('remove_')) {
        const index = parseInt(selection.replace('remove_', ''));
        if (customer.cart && customer.cart[index]) {
          customer.cart.splice(index, 1);
          await this.sendCart(phone, customer);
          state.currentStep = 'viewing_cart';
        }
      }

      // ========== NUMBER SELECTION (for paginated categories) ==========
      else if (/^\d+$/.test(msg) && (state.currentStep === 'select_category' || state.currentStep === 'browsing_menu')) {
        const catNum = parseInt(msg);
        const filteredItems = this.filterByFoodType(menuItems, state.foodTypePreference || 'both');
        const categories = [...new Set(filteredItems.flatMap(m => Array.isArray(m.category) ? m.category : [m.category]))];
        
        if (catNum === 0) {
          // "All Items" selected
          if (state.currentStep === 'browsing_menu') {
            await this.sendAllItemsForOrder(phone, filteredItems);
            state.selectedCategory = 'all';
            state.currentStep = 'selecting_item';
          } else {
            await this.sendAllItems(phone, filteredItems);
            state.selectedCategory = 'all';
            state.currentStep = 'viewing_items';
          }
        } else if (catNum >= 1 && catNum <= categories.length) {
          const category = categories[catNum - 1];
          if (state.currentStep === 'browsing_menu') {
            await this.sendItemsForOrder(phone, filteredItems, category);
            state.selectedCategory = category;
            state.currentStep = 'selecting_item';
          } else {
            await this.sendCategoryItems(phone, filteredItems, category);
            state.selectedCategory = category;
            state.currentStep = 'viewing_items';
          }
        } else {
          const helpImg = await chatbotImagesService.getImageUrl('help_support');
          await whatsapp.sendMessage(phone, `❌ Invalid number. Please enter 0 for All Items or 1-${categories.length} for a category.`);
        }
      }

      // ========== NUMBER SELECTION (for paginated items) ==========
      else if (/^\d+$/.test(msg) && (state.currentStep === 'viewing_items' || state.currentStep === 'selecting_item')) {
        const itemNum = parseInt(msg);
        const filteredItems = this.filterByFoodType(menuItems, state.foodTypePreference || 'both');
        let itemsList = filteredItems;
        
        // If a category is selected, filter by it
        if (state.selectedCategory && state.selectedCategory !== 'all') {
          itemsList = filteredItems.filter(m => 
            Array.isArray(m.category) ? m.category.includes(state.selectedCategory) : m.category === state.selectedCategory
          );
        }
        
        if (itemNum >= 1 && itemNum <= itemsList.length) {
          const item = itemsList[itemNum - 1];
          // Always show item details first, then user can click "Add to Cart"
          await this.sendItemDetails(phone, menuItems, item._id.toString());
          state.selectedItem = item._id.toString();
          state.currentStep = 'viewing_item_details';
        } else {
          const helpImg = await chatbotImagesService.getImageUrl('help_support');
          await whatsapp.sendMessage(phone, `❌ Invalid number. Please enter a number between 1 and ${itemsList.length}.`);
        }
      }

      // ========== TEXT-BASED INTENT → WELCOME FLOW ==========
      // When user types commands like "cancel", "track", "status", "help", "menu", "cart", "order", "offers"
      // redirect them to the welcome flow instead of handling individually
      else if (!selectedId && (
        this.isCancelIntent(msg) || this.isTrackIntent(msg) || this.isOrderStatusIntent(msg) ||
        this.isClearCartIntent(msg) ||
        msg === 'help' || msg === 'menu' || msg === 'order' || msg === 'status' || msg === 'track' ||
        msg === 'offers' || msg === 'offer'
      )) {
        await this.sendWelcome(phone);
        state.currentStep = 'main_menu';
      }

      // ========== FALLBACK: SMART SEARCH ==========
      else {
        // Welcome for new/unknown state
        if (state.currentStep === 'welcome' || !state.currentStep) {
          await this.sendWelcome(phone);
          state.currentStep = 'main_menu';
        } else if (!selectedId && msg && msg.length >= 2) {
          // Try smart search — match user text against item names, tags, variant labels
          const searchResult = await this.smartSearch(msg, menuItems);

          if (searchResult && searchResult.items && searchResult.items.length > 0) {
            const items = searchResult.items;
            const matchedVariants = searchResult.matchedVariants || {};
            const searchLabel = searchResult.label
              ? (searchResult.searchTerm ? `${searchResult.label} "${searchResult.searchTerm}"` : searchResult.label)
              : `"${msg}"`;

            logger.info('Smart search found items', { query: msg, count: items.length });

            // Cache search result IDs for pagination
            state.tagSearchResults = items.map(i => i._id.toString());
            state.searchTag = msg;

            if (items.length <= 5) {
              // Small result set — show as catalog cards
              await this.sendSearchResultCards(phone, items, searchLabel, matchedVariants);
            } else {
              // Larger result set — show as catalog list
              await this.sendItemsByTag(phone, items, searchLabel, 0, matchedVariants);
            }
            state.currentStep = 'viewing_tag_results';
          } else {
            // No items found — send message + welcome flow
            logger.info('Smart search no results', { query: msg });
            await whatsapp.sendMessage(phone, `🔍 No items found for "${msg}".`);
            await this.sendWelcome(phone);
            state.currentStep = 'main_menu';
          }
        } else {
          // Default fallback
          await whatsapp.sendMessage(phone, options.isVoiceMessage
              ? `🎤 Sorry, I couldn't understand your voice message.\n\nPlease try again or send *Hi* to start.`
              : `🤔 I didn't understand that.\n\nSend *Hi* to see our services.`);
        }
      }
    } catch (error) {
      logger.error('Chatbot error', { error: error.message });
      const helpImg = await chatbotImagesService.getImageUrl('help_support');
      await whatsapp.sendMessage(phone, '❌ Something went wrong. Please try again.');
    }

    // Refresh customer from DB to avoid version conflicts, then update state
    try {
      const latestCustomer = await Customer.findOne({ phone });
      if (latestCustomer) {
        latestCustomer.conversationState = state;
        latestCustomer.conversationState.lastInteraction = new Date();
        await latestCustomer.save();
      }
    } catch (saveErr) {
      logger.error('Error saving conversation state', { error: saveErr.message });
    }
  },

  // ============ OFFER ELIGIBILITY CHECK ============
  async handleOfferClaim(phone, offerId, customer) {
    try {
      const Offer = require('../models/Offer');
      const offer = await Offer.findById(offerId);
      
      if (!offer) {
        const offerNotEligibleImg = await chatbotImagesService.getImageUrl('offer_not_eligible');
        await whatsapp.sendMessage(phone, '❌ This offer is no longer available.');
        return;
      }
      
      // Check if offer is active and valid
      const now = new Date();
      if (!offer.isActive) {
        const offerNotEligibleImg = await chatbotImagesService.getImageUrl('offer_not_eligible');
        await whatsapp.sendMessage(phone, '❌ This offer is no longer active.');
        return;
      }
      
      if (offer.validUntil && new Date(offer.validUntil) < now) {
        const offerNotEligibleImg = await chatbotImagesService.getImageUrl('offer_not_eligible');
        await whatsapp.sendMessage(phone, '⏰ This offer has expired.');
        return;
      }
      
      // Check targeting - applies to all targeted offer types
      const isTargeted = ['top_percentage', 'min_spent', 'min_orders'].includes(offer.targetType);
      if (isTargeted && offer.targetedCustomers && offer.targetedCustomers.length > 0) {
        // Normalize customer phone for comparison
        const normalizedPhone = phone.replace(/[^0-9]/g, '');
        const isEligible = offer.targetedCustomers.some(targetPhone => {
          const normalizedTarget = targetPhone.replace(/[^0-9]/g, '');
          return normalizedTarget.includes(normalizedPhone) || normalizedPhone.includes(normalizedTarget);
        });
        
        if (!isEligible) {
          // Customer is NOT eligible for this targeted offer
          const notEligibleImage = await chatbotImagesService.getImageUrl('offer_not_eligible');
          
          // Build contextual message based on targeting type
          let eligibilityHint = 'This is a special offer for selected customers only.';
          if (offer.targetType === 'min_spent') {
            eligibilityHint = `This offer is for customers who have spent ₹${offer.targetMinSpent || 0}+ with us.`;
          } else if (offer.targetType === 'min_orders') {
            eligibilityHint = `This offer is for customers who have placed ${offer.targetMinOrders || 0}+ orders with us.`;
          } else if (offer.targetType === 'top_percentage') {
            eligibilityHint = 'This is an exclusive offer for our top customers.';
          }
          
          const message = `❌ *Offer Not Available*\n\n` +
            `Sorry, your number is not eligible for this exclusive offer.\n\n` +
            `${eligibilityHint}\n\n` +
            `Keep ordering to unlock more exclusive offers! 🍽️`;
          
          if (notEligibleImage) {
            await whatsapp.sendMessage(phone, message);
          } else {
            const offerFallbackImg = await chatbotImagesService.getImageUrl('offer_not_eligible');
            await whatsapp.sendMessage(phone, message);
          }
          return;
        }
      }
      
      // Customer IS eligible - show offer and menu
      const successMessage = `🎉 *${offer.title || 'Special Offer'}*\n\n` +
        (offer.offerType ? `🏷️ *${offer.offerType}*\n\n` : '') +
        (offer.description ? `${offer.description}\n\n` : '') +
        `✅ You're eligible for this offer!\n\n` +
        `Browse our menu to claim your offer. 🍽️`;
      
      if (offer.image) {
        await whatsapp.sendMessage(phone, successMessage);
      } else {
        const offerAppliedImg = await chatbotImagesService.getImageUrl('offer_applied');
        await whatsapp.sendMessage(phone, successMessage);
      }
    } catch (error) {
      logger.error('Error handling offer claim', { error: error.message });
      const helpImg = await chatbotImagesService.getImageUrl('help_support');
      await whatsapp.sendMessage(phone, '❌ Something went wrong. Please try again.');
    }
  },

  // ============ WELCOME & MAIN MENU ============
  async sendWelcome(phone) {
    const welcomeImageUrl = await chatbotImagesService.getImageUrl('welcome');
    const welcomeMessage = `🏨 *Perivi Hotel*\n\n` +
      `Welcome! 🙏\n\n` +
      `We're delighted to serve you delicious food. How can we help you today?`;

    try {
      const metaCloud = require('./metaCloud');
      const flowId = catalogService.getWelcomeFlowId();
      const flowMode = catalogService.getWelcomeFlowMode();
      const flowData = await catalogService.buildWelcomeFlowData(`welcome_service_${phone}`, phone);

      await metaCloud.sendFlowMessage(phone, {
        flowId,
        flowCta: 'Choose Service',
        headerImageUrl: welcomeImageUrl || undefined,
        headerText: 'Perivi Hotel',
        bodyText: welcomeMessage,
        footerText: 'Powered by JRB Gold',
        screenName: 'SERVICE_SELECT',
        screenData: flowData,
        flowToken: `welcome_service_${phone}`,
        mode: flowMode
      });

      logger.info('Sent Welcome Flow service selector', { phone, flowId, mode: flowMode });
    } catch (err) {
      logger.error('Welcome Flow failed', { phone, error: err.message });
      await whatsapp.sendMessage(phone, '⚠️ Something went wrong loading our services. Please try again by sending *Hi*.');
    }
  },

  // ============ ORDER FOOD MENU ============
  async sendOrderFoodMenu(phone) {
    // Send only the browse menu options (same as sendFoodTypeSelection)
    await this.sendFoodTypeSelection(phone);
  },

  // ============ MY ORDERS MENU ============
  async sendMyOrdersMenu(phone) {
    const myOrdersImageUrl = await chatbotImagesService.getImageUrl('my_orders');
    const myOrdersMessage = `📦 *My Orders*\n\n` +
      `Check your order status, track delivery, or cancel an order:`;
    
    await whatsapp.sendMessage(phone, myOrdersMessage);
  },

  /**
   * Handle viewing order details when user selects an order from My Orders flow
   */
  async handleViewOrderDetails(phone, customer, orderId) {
    try {
      const Order = require('../models/Order');
      const order = await Order.findById(orderId);

      if (!order) {
        await whatsapp.sendMessage(phone, '❌ Order not found. Please try again.');
        await this.sendMyOrdersMenu(phone);
        return;
      }

      // Build order details message
      const statusEmoji = {
        'pending': '⏳ Pending',
        'confirmed': '✅ Confirmed',
        'preparing': '👨‍🍳 Preparing',
        'ready': '🎉 Ready',
        'out_for_delivery': '🚚 Out for Delivery',
        'delivered': '✓ Delivered',
        'cancelled': '❌ Cancelled'
      };

      let orderMsg = `📦 *Order #${order.orderNumber}*\n\n`;
      orderMsg += `*Status:* ${statusEmoji[order.status] || order.status}\n`;
      orderMsg += `*Date:* ${new Date(order.createdAt).toLocaleString('en-IN')}\n\n`;
      
      orderMsg += `*Items:*\n`;
      order.items.forEach((item, idx) => {
        orderMsg += `${idx + 1}. ${item.name} x${item.quantity} - ₹${item.price * item.quantity}\n`;
      });
      
      orderMsg += `\n*Total Amount:* ₹${order.totalAmount}\n`;
      orderMsg += `*Service Type:* ${order.serviceType === 'delivery' ? '🚚 Delivery' : '🏪 Takeaway'}\n`;
      
      if (order.serviceType === 'delivery' && order.deliveryAddress) {
        orderMsg += `\n*Delivery Address:*\n${order.deliveryAddress.address}`;
        if (order.deliveryAddress.landmark) orderMsg += `\nLandmark: ${order.deliveryAddress.landmark}`;
      }

      await whatsapp.sendMessage(phone, orderMsg);
      
      logger.info('Order details sent from flow', { phone, orderId, orderNumber: order.orderNumber });
    } catch (error) {
      logger.error('Error fetching order details', { phone, orderId, error: error.message });
      await whatsapp.sendMessage(phone, '❌ Unable to fetch order details. Please try again later.');
    }
  },

  /**
   * Send food type selection flow (Veg/Non-Veg/Egg) after Order Food is selected
   */
  async sendFoodTypeSelectionFlow(phone) {
    // For now, use the existing food type selection with buttons
    // This can be enhanced with a dedicated flow later
    await this.sendFoodTypeSelection(phone);
  },

  /**
   * Send My Orders list flow showing recent orders
   */
  async sendMyOrdersListFlow(phone, customer) {
    try {
      const Order = require('../models/Order');
      const orders = await Order.find({ phone })
        .sort({ createdAt: -1 })
        .limit(5)
        .select('orderNumber totalAmount status createdAt items');

      if (orders.length === 0) {
        await whatsapp.sendMessage(phone, '📦 *My Orders*\n\nYou haven\'t placed any orders yet.');
        return;
      }

      // Build orders list message
      let ordersMsg = `📦 *Your Recent Orders*\n\n`;
      ordersMsg += `You have ${orders.length} recent order${orders.length > 1 ? 's' : ''}:\n\n`;

      orders.forEach((order, idx) => {
        const statusEmoji = {
          'pending': '⏳',
          'confirmed': '✅',
          'preparing': '👨‍🍳',
          'ready': '🎉',
          'out_for_delivery': '🚚',
          'delivered': '✓',
          'cancelled': '❌'
        };
        
        const emoji = statusEmoji[order.status] || '📦';
        const statusText = order.status.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
        const date = new Date(order.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
        const itemCount = order.items?.length || 0;
        
        ordersMsg += `${idx + 1}. *Order #${order.orderNumber}*\n`;
        ordersMsg += `   ${emoji} ${statusText} • ₹${order.totalAmount}\n`;
        ordersMsg += `   ${itemCount} items • ${date}\n\n`;
      });

      await whatsapp.sendMessage(phone, ordersMsg);

      logger.info('Recent orders list sent', { phone, orderCount: orders.length });
    } catch (error) {
      logger.error('Error fetching recent orders', { phone, error: error.message });
      await whatsapp.sendMessage(phone, '❌ Unable to fetch your orders. Please try again later.');
    }
  },

  // ============ MENU BROWSING ============
  async sendFoodTypeSelection(phone) {
    await whatsapp.sendMessage(phone, '🍽️ *Browse Menu*\n\nWhat would you like to see?\n\n1. 🟢 Veg\n2. 🔴 Non-Veg\n3. 🟡 Egg\n\nReply with your choice.');
  },

  async sendMenuCategories(phone, menuItems, label = 'Our Menu', page = 0) {
    // Flatten category arrays and dedupe (category is an array field)
    const categories = [...new Set(menuItems.flatMap(m => Array.isArray(m.category) ? m.category : [m.category]))];
    
    if (!categories.length) {
      await whatsapp.sendMessage(phone, '📋 No menu items available right now.');
      return;
    }

    // ===== TRY WHATSAPP FLOW FOR CATEGORY SELECTION =====
    try {
      const flowId = catalogService.getCategoryFlowId();
      const flowMode = catalogService.getCategoryFlowMode();
      if (flowId && flowMode && catalogService.isEnabled()) {
        const metaCloud = require('./metaCloud');
        const flowData = await catalogService.buildCategoryFlowDataSorted(menuItems, `category_select_${phone}`);

        if (flowData.categories.length > 0) {
          // Send WhatsApp Flow message for category selection (categories first, catalog after selection)
          logger.info('Attempting Flow category send', { phone, flowId, mode: flowMode, categories: flowData.categories.length });
          await metaCloud.sendFlowMessage(phone, {
            flowId,
            flowCta: 'Browse by Category',
            headerText: `${label}`,
            bodyText: `Browse our ${flowData.categories.length} categories to find your favorite dishes!\nTap the button below to select a category.`,
            footerText: 'Powered by JRB Gold',
            screenName: 'CATEGORY_SELECT',
            screenData: flowData,
            flowToken: `category_select_${phone}`,
            mode: flowMode
          });

          logger.info('Sent Flow category selector', { phone, categoryCount: flowData.categories.length, mode: flowMode });
          return;
        }
      }
    } catch (flowErr) {
      logger.error('Flow category send failed', { error: flowErr.message });
      await whatsapp.sendMessage(phone, '⚠️ Unable to load menu categories. Please try again.');
    }
  },

  async sendMenuCategoriesWithLabel(phone, menuItems, label, page = 0) {
    await this.sendMenuCategories(phone, menuItems, label, page);
  },

  async sendCategoryItems(phone, menuItems, category, page = 0) {
    // Filter items that include this category (category is an array field)
    const items = menuItems.filter(m => Array.isArray(m.category) ? m.category.includes(category) : m.category === category);
    const itemCountWithVariants = countItemsWithVariants(items);
    
    if (!items.length) {
      const itemNotAvailableImg = await chatbotImagesService.getImageUrl('item_not_available');
      await whatsapp.sendMessage(phone, `📋 No items in ${category} right now.`);
      return;
    }

    // Try WhatsApp Catalog product_list (native catalog cards with images/prices)
    try {
      const catalogResult = await catalogService.buildCategorySections(items, category);
      if (catalogResult) {
        const catalogId = catalogService.getCatalogId();
        await whatsapp.sendProductList(
          phone,
          catalogId,
          `📋 ${category}`,
          `${catalogResult.totalMapped} items • Add to cart directly!\nTap any item to view details, select size/variant & add to order`,
          catalogResult.sections,
          'Perivi Hotel'
        );
        return;
      }
    } catch (catalogErr) {
      logger.error('Catalog failed for category items', { category, error: catalogErr.message });
      await whatsapp.sendMessage(phone, `⚠️ Unable to load ${category} items. Please try again.`);
    }
  },

  // Send all items (for browsing)
  async sendAllItems(phone, menuItems, page = 0) {
    if (!menuItems.length) {
      const browseMenuImg = await chatbotImagesService.getImageUrl('browse_menu');
      await whatsapp.sendMessage(phone, '📋 No items available right now.');
      return;
    }

    // Try WhatsApp Catalog (native catalog cards with images/prices)
    try {
      if (catalogService.isEnabled()) {
        const map = await catalogService.getCatalogMap();
        if (map.size > 0) {
          // For large menus (>30 items), send catalog_message (shows entire catalog)
          // For smaller sets, send product_list with sections
          if (menuItems.length > 30) {
            // Get a thumbnail retailer ID from the first mapped item
            const firstMapped = menuItems.find(item => map.has(item._id.toString()));
            const thumbnailId = firstMapped ? map.get(firstMapped._id.toString()) : '';
            await whatsapp.sendCatalogMessage(
              phone,
              `🍽️ Browse our full menu!\n${menuItems.length} items available\n\nTap "View catalog" to see all items with images & prices. Add items to your cart and place your order!`,
              'Perivi Hotel',
              thumbnailId
            );
            return;
          }

          // For <=30 items, use product_list with category sections
          const catalogResult = await catalogService.buildProductSections(menuItems);
          if (catalogResult) {
            const catalogId = catalogService.getCatalogId();
            await whatsapp.sendProductList(
              phone,
              catalogId,
              '📋 Our Menu',
              `${catalogResult.totalMapped} items available\nBrowse, tap & add to cart!`,
              catalogResult.sections,
              'Perivi Hotel'
            );
            return;
          }
        }
      }
    } catch (catalogErr) {
      logger.error('Catalog failed for all items', { error: catalogErr.message });
      await whatsapp.sendMessage(phone, '⚠️ Unable to load menu items. Please try again.');
    }
  },

  // Send items matching a tag keyword (for tag-based search)
  async sendItemsByTag(phone, items, tagKeyword, page = 0, matchedVariants = null) {
    if (!items.length) {
      await whatsapp.sendMessage(phone, `🔍 No items found for "${tagKeyword}".`);
      await this.sendWelcome(phone);
      return;
    }

    // For small result sets (2-5 items), show individual catalog-style cards
    if (items.length <= 5 && page === 0) {
      await this.sendSearchResultCards(phone, items, tagKeyword, matchedVariants);
      return;
    }

    // Try WhatsApp Catalog for search results (uses lenient threshold for search)
    try {
      // If we have matched variant info, build variant-specific catalog sections
      if (matchedVariants && Object.keys(matchedVariants).length > 0) {
        const catalogId = catalogService.getCatalogId();
        const retailerIds = [];
        
        for (const item of items) {
          const itemId = item._id.toString();
          const baseRetailerId = await catalogService.ensureCatalogMapping(item);
          if (!baseRetailerId) continue;
          
          const vi = matchedVariants[itemId];
          if (Array.isArray(vi)) {
            // Array of matched variant indices → include all (unavailable shown grayed out by Meta)
            for (const vIdx of vi) {
              const variant = item.variants?.[vIdx];
              if (!variant) continue;
              if (variant.quantities && variant.quantities.length > 0) {
                variant.quantities.forEach((_, qIdx) => {
                  retailerIds.push(`${itemId}_v${vIdx}_q${qIdx}`);
                });
              } else {
                retailerIds.push(`${itemId}_v${vIdx}`);
              }
            }
          } else if (typeof vi === 'number' && item.variants?.[vi]) {
            // Single specific variant matched → include ALL sizes/quantities of that variant
            const variant = item.variants[vi];
            if (variant.quantities && variant.quantities.length > 0) {
              variant.quantities.forEach((_, qIdx) => {
                retailerIds.push(`${itemId}_v${vi}_q${qIdx}`);
              });
            } else {
              retailerIds.push(`${itemId}_v${vi}`);
            }
          } else if (vi === null) {
            // Show ALL variants for this item
            const allIds = await catalogService.ensureAllCatalogMappings(item);
            if (allIds && allIds.length > 0) {
              retailerIds.push(...allIds);
            } else {
              retailerIds.push(baseRetailerId);
            }
          } else {
            retailerIds.push(baseRetailerId);
          }
        }
        
        if (retailerIds.length > 0) {
          const sections = [{ title: `🏷️ ${tagKeyword}`.substring(0, 24), productRetailerIds: retailerIds }];
          await whatsapp.sendProductList(
            phone,
            catalogId,
            `🏷️ ${tagKeyword}`.substring(0, 60),
            `Found ${retailerIds.length} items matching "${tagKeyword}"\nTap to view details & add to cart`,
            sections,
            'Perivi Hotel'
          );
          return;
        }
      }

      const catalogResult = await catalogService.buildSearchResultSections(items);
      if (catalogResult) {
        const catalogId = catalogService.getCatalogId();
        await whatsapp.sendProductList(
          phone,
          catalogId,
          `🏷️ ${tagKeyword}`.substring(0, 60),
          `Found ${items.length} items matching "${tagKeyword}"\nTap to view details & add to cart`,
          catalogResult.sections,
          'Perivi Hotel'
        );
        return;
      }
    } catch (catalogErr) {
      logger.error('Catalog failed for search results', { tagKeyword, error: catalogErr.message });
      await whatsapp.sendMessage(phone, `⚠️ Unable to load search results for "${tagKeyword}". Please try again.`);
    }
  },

  // Send products with images
  async sendProductsWithImages(phone, items) {
    const getFoodTypeIcon = (type) => type === 'veg' ? '🟢' : type === 'nonveg' ? '🔴' : type === 'egg' ? '🟡' : '';
    
    await whatsapp.sendMessage(phone, '🍽️ *Our Menu*\nBrowse items below and tap to add to cart!');
    
    for (const item of items.slice(0, 5)) {
      const icon = getFoodTypeIcon(item.foodType);
      const msg = `${icon} *${item.name}*\n💰 ₹${item.price}\n\n${item.description || 'Delicious!'}`;
      
      const itemImg = (item.image && !item.image.startsWith('data:')) ? item.image : null;
      await whatsapp.sendMessage(phone, msg);
    }
    
    const browseMenuImg = await chatbotImagesService.getImageUrl('browse_menu');
    await whatsapp.sendMessage(phone, 'Want to see more items?');
  },

  // Build a rich catalog-style card message for a single item (reusable)
  buildItemCardMessage(item, activeOffers) {
    const foodTypeLabel = item.foodType === 'veg' ? '🌿 Veg' : item.foodType === 'nonveg' ? '🍗 Non-Veg' : item.foodType === 'egg' ? '🥚 Egg' : '';
    
    // Rating display with breakdown
    let ratingDisplay = '';
    if (item.totalRatings > 0) {
      const fullStars = Math.floor(item.avgRating);
      const stars = '⭐'.repeat(fullStars);
      ratingDisplay = `${stars} ${item.avgRating} (${item.totalRatings} reviews)`;
      
      // Show rating breakdown if there are multiple ratings
      if (item.ratings && item.ratings.length > 1) {
        const counts = [0, 0, 0, 0, 0]; // index 0=1star, 4=5star
        item.ratings.forEach(r => { if (r.rating >= 1 && r.rating <= 5) counts[r.rating - 1]++; });
        const breakdown = [];
        for (let i = 4; i >= 0; i--) {
          if (counts[i] > 0) breakdown.push(`${i + 1}★: ${counts[i]}`);
        }
        if (breakdown.length > 0) ratingDisplay += `\n   ${breakdown.join(' | ')}`;
      }
    } else {
      ratingDisplay = '☆☆☆☆☆ No ratings yet';
    }
    
    let msg = `*${item.name}*${foodTypeLabel ? ` ${foodTypeLabel}` : ''}\n\n`;
    msg += `${ratingDisplay}\n\n`;
    msg += `💰 *Price:* ${formatPriceWithActiveOffers(item, activeOffers)} / ${item.quantity || 1} ${item.unit || 'piece'}\n`;
    msg += `⏱️ *Prep Time:* ${item.preparationTime || 15} mins\n`;
    if (item.tags?.length) msg += `🏷️ *Tags:* ${item.tags.join(', ')}\n`;
    // Show variant names if item has variants (including unavailable ones marked as out of stock)
    if (item.variants && item.variants.length > 0) {
      const variantLabels = item.variants.filter(v => v.label).map(v => {
        if (v.available === false) return `${v.label} (Out of stock)`;
        return v.label;
      });
      if (variantLabels.length > 0) {
        msg += `🔖 *Variants:* ${variantLabels.join(', ')}\n`;
      }
    }
    msg += formatOfferTypes(item);
    msg += `\n\n📝 ${item.description || 'Delicious dish prepared fresh!'}`;
    
    return msg;
  },

  // Send multiple items as individual catalog-style cards (for 2-5 search results)
  async sendSearchResultCards(phone, items, searchLabel, matchedVariants = null) {
    // Try WhatsApp Catalog product_list for search results (native catalog cards)
    try {
      // If we have matched variant info, build variant-specific catalog sections
      if (matchedVariants && Object.keys(matchedVariants).length > 0) {
        const catalogId = catalogService.getCatalogId();
        const retailerIds = [];
        
        for (const item of items) {
          const itemId = item._id.toString();
          const baseRetailerId = await catalogService.ensureCatalogMapping(item);
          if (!baseRetailerId) continue;
          
          const vi = matchedVariants[itemId];
          if (Array.isArray(vi)) {
            // Array of matched variant indices → include all (unavailable shown grayed out by Meta)
            for (const vIdx of vi) {
              const variant = item.variants?.[vIdx];
              if (!variant) continue;
              if (variant.quantities && variant.quantities.length > 0) {
                variant.quantities.forEach((_, qIdx) => {
                  retailerIds.push(`${itemId}_v${vIdx}_q${qIdx}`);
                });
              } else {
                retailerIds.push(`${itemId}_v${vIdx}`);
              }
            }
          } else if (typeof vi === 'number' && item.variants?.[vi]) {
            // Single specific variant matched → include ALL sizes/quantities of that variant
            const variant = item.variants[vi];
            if (variant.quantities && variant.quantities.length > 0) {
              variant.quantities.forEach((_, qIdx) => {
                retailerIds.push(`${itemId}_v${vi}_q${qIdx}`);
              });
            } else {
              retailerIds.push(`${itemId}_v${vi}`);
            }
          } else if (vi === null) {
            // Show ALL variants for this item (e.g. "biryani" → all biryani variants)
            const allIds = await catalogService.ensureAllCatalogMappings(item);
            if (allIds && allIds.length > 0) {
              retailerIds.push(...allIds);
            } else {
              retailerIds.push(baseRetailerId);
            }
          } else {
            retailerIds.push(baseRetailerId);
          }
        }
        
        if (retailerIds.length > 0) {
          const sections = [{ title: `🔍 ${searchLabel}`.substring(0, 24), productRetailerIds: retailerIds }];
          await whatsapp.sendProductList(
            phone,
            catalogId,
            `🔍 ${searchLabel}`.substring(0, 60),
            `Found ${retailerIds.length} items matching ${searchLabel}\nTap to view details & add to cart`,
            sections,
            'Perivi Hotel'
          );
          return;
        }
      }
      
      const catalogResult = await catalogService.buildSearchResultSections(items);
      if (catalogResult && catalogResult.sections.length > 0) {
        const catalogId = catalogService.getCatalogId();
        await whatsapp.sendProductList(
          phone,
          catalogId,
          `🔍 ${searchLabel}`.substring(0, 60),
          `Found ${items.length} items matching ${searchLabel}\nTap to view details & add to cart`,
          catalogResult.sections,
          'Perivi Hotel'
        );
        return;
      }
    } catch (catalogErr) {
      logger.error('Catalog failed for search result cards', { searchLabel, error: catalogErr.message });
      await whatsapp.sendMessage(phone, `⚠️ Unable to load results for ${searchLabel}. Please try again.`);
    }
  },

  async sendItemDetails(phone, menuItems, itemId, matchedVariantIndex = null) {
    const item = menuItems.find(m => m._id.toString() === itemId);
    if (!item) {
      const itemNotAvailableImg = await chatbotImagesService.getImageUrl('item_not_available');
      await whatsapp.sendMessage(phone, '❌ Item not found.');
      return;
    }

    // Normalize matchedVariantIndex:
    // - number → single variant index
    // - array → list of matched variant indices (show only these)
    // - null → show ALL variants
    const isArrayMatch = Array.isArray(matchedVariantIndex);
    const isSingleMatch = typeof matchedVariantIndex === 'number';

    // Try WhatsApp Catalog product card (native catalog display with image, price, rating)
    try {
      if (catalogService.isEnabled()) {
        // Auto-ensure catalog mapping exists (creates on-the-fly if missing)
        const baseRetailerId = await catalogService.ensureCatalogMapping(item);
        if (baseRetailerId) {
          const catalogId = catalogService.getCatalogId();
          const variantsArr = item.variants || [];
          const totalCatalogProducts = variantsArr.reduce((sum, v) => {
            return sum + (v.quantities && v.quantities.length > 0 ? v.quantities.length : 1);
          }, 0);
          
          logger.info('sendItemDetails', { item: item.name });
          
          // === CASE 1: Specific single variant matched AND has multiple sizes/quantities ===
          if (isSingleMatch && item.variants?.[matchedVariantIndex]) {
            const matchedVariant = item.variants[matchedVariantIndex];
            if (matchedVariant.quantities && matchedVariant.quantities.length > 1) {
              const itemId = item._id.toString();
              const variantRetailerIds = matchedVariant.quantities.map((_, qIdx) => 
                `${itemId}_v${matchedVariantIndex}_q${qIdx}`
              );
              logger.info('Single variant with sizes', { sizeCount: matchedVariant.quantities.length });
              const variantLabel = matchedVariant.label || item.name;
              const sections = [{
                title: variantLabel.trim().substring(0, 24),
                productRetailerIds: variantRetailerIds
              }];
              await whatsapp.sendProductList(
                phone,
                catalogId,
                `🛒 ${variantLabel.trim()}`.substring(0, 60),
                `${matchedVariant.quantities.length} sizes • Tap to add to cart 🛒`,
                sections,
                'View & order!'
              );
              return;
            }
          }
          
          // === CASE 2: Array of matched variant indices → include all (unavailable shown grayed out by Meta) ===
          if (isArrayMatch && matchedVariantIndex.length > 0) {
            const retailerIds = [];
            for (const vi of matchedVariantIndex) {
              const variant = item.variants?.[vi];
              if (!variant) continue;
              if (variant.quantities && variant.quantities.length > 0) {
                variant.quantities.forEach((_, qIdx) => {
                  retailerIds.push(`${item._id.toString()}_v${vi}_q${qIdx}`);
                });
              } else {
                retailerIds.push(`${item._id.toString()}_v${vi}`);
              }
            }
            if (retailerIds.length > 1) {
              logger.info('Array match variants', { count: matchedVariantIndex.length });
              const sections = [{
                title: item.name.substring(0, 24),
                productRetailerIds: retailerIds.slice(0, 30)
              }];
              await whatsapp.sendProductList(
                phone,
                catalogId,
                `🛒 ${item.name}`.substring(0, 60),
                `${retailerIds.length} options • Tap to add to cart 🛒`,
                sections,
                'View & order!'
              );
              return;
            }
          }
          
          // === CASE 3: null → show ALL variants ===
          if (matchedVariantIndex === null && totalCatalogProducts > 1) {
            const allRetailerIds = await catalogService.ensureAllCatalogMappings(item);
            if (allRetailerIds && allRetailerIds.length > 1) {
              const bodyText = `${allRetailerIds.length} variants • Tap to add to cart 🛒`;
              const sections = [{
                title: item.name.substring(0, 24),
                productRetailerIds: allRetailerIds.slice(0, 30)
              }];
              await whatsapp.sendProductList(
                phone,
                catalogId,
                `🛒 ${item.name}`.substring(0, 60),
                bodyText,
                sections,
                'View & order!'
              );
              return;
            }
          }
          
          // === CASE 4: Single product card (no sizes, single variant, or array with 1 result) ===
          let retailerId = baseRetailerId;
          const singleVi = isSingleMatch ? matchedVariantIndex : (isArrayMatch && matchedVariantIndex.length === 1 ? matchedVariantIndex[0] : null);
          if (singleVi !== null && item.variants && item.variants[singleVi]) {
            const variant = item.variants[singleVi];
            if (variant.quantities && variant.quantities.length > 0) {
              retailerId = `${item._id.toString()}_v${singleVi}_q0`;
            } else {
              retailerId = `${item._id.toString()}_v${singleVi}`;
            }
          } else if (item.variants && item.variants.length > 0 && !isSingleMatch && !isArrayMatch) {
            const firstVariant = item.variants[0];
            if (firstVariant && firstVariant.quantities && firstVariant.quantities.length > 0) {
              retailerId = `${item._id.toString()}_v0_q0`;
            } else {
              retailerId = `${item._id.toString()}_v0`;
            }
          }
          
          const ratingStr = item.totalRatings > 0 ? `⭐${item.avgRating} (${item.totalRatings} reviews)` : '';
          const foodIcon = item.foodType === 'veg' ? '🌿 Veg' : item.foodType === 'nonveg' ? '🍗 Non-Veg' : item.foodType === 'egg' ? '🥚 Egg' : '';
          let bodyText = `${foodIcon} ${ratingStr}\n⏱️ ${item.preparationTime || 15} mins prep time`;
          if (singleVi !== null && item.variants?.[singleVi]?.label) {
            bodyText = `🔖 *${item.variants[singleVi].label}*\n${bodyText}`;
          }
          bodyText += '\nTap to add to cart!';
          await whatsapp.sendProduct(phone, catalogId, retailerId, bodyText, 'Perivi Hotel');
          return;
        }
      }
    } catch (catalogErr) {
      logger.error('Catalog failed for item details', { itemId, error: catalogErr.message });
      await whatsapp.sendMessage(phone, '⚠️ Unable to load item details. Please try again.');
    }
  },

  // Send item details for order flow (with Add to Cart focus)
  async sendItemDetailsForOrder(phone, item, variantIndex = null, quantityIndex = null) {
    // Try WhatsApp Catalog single product card
    try {
      if (catalogService.isEnabled()) {
        // Ensure product is synced to Meta and get the correct retailer ID
        const baseRetailerId = await catalogService.ensureCatalogMapping(item);
        if (baseRetailerId) {
          // Determine which product variant to show
          let retailerId = baseRetailerId;
          if (item.variants && item.variants.length > 0) {
            // If specific variant+quantityIndex was selected, use that exact product
            if (variantIndex !== null && quantityIndex !== null && 
                item.variants[variantIndex]?.quantities?.[quantityIndex]) {
              retailerId = `${item._id.toString()}_v${variantIndex}_q${quantityIndex}`;
            } 
            // If only variant was selected (no quantity option), use first quantity option or base variant
            else if (variantIndex !== null && item.variants[variantIndex]) {
              const variant = item.variants[variantIndex];
              if (variant.quantities && variant.quantities.length > 0) {
                retailerId = `${item._id.toString()}_v${variantIndex}_q0`;
              } else {
                retailerId = `${item._id.toString()}_v${variantIndex}`;
              }
            } 
            // If no variant specified, show first variant (first quantity if has quantities)
            else {
              const firstVariant = item.variants[0];
              if (firstVariant && firstVariant.quantities && firstVariant.quantities.length > 0) {
                retailerId = `${item._id.toString()}_v0_q0`;
              } else {
                retailerId = `${item._id.toString()}_v0`;
              }
            }
          }
          
          const catalogId = catalogService.getCatalogId();
          const ratingStr = item.totalRatings > 0 ? `⭐${item.avgRating} (${item.totalRatings} reviews)` : '';
          const foodIcon = item.foodType === 'veg' ? '🌿 Veg' : item.foodType === 'nonveg' ? '🍗 Non-Veg' : item.foodType === 'egg' ? '🥚 Egg' : '';
          const bodyText = `${foodIcon} ${ratingStr}\n⏱️ ${item.preparationTime || 15} mins prep time\nTap to add to cart!`;
          await whatsapp.sendProduct(phone, catalogId, retailerId, bodyText, 'Perivi Hotel');
          return;
        }
      }
    } catch (catalogErr) {
      logger.error('Catalog failed for order item details', { itemId: item._id, error: catalogErr.message });
      await whatsapp.sendMessage(phone, '⚠️ Unable to load item details. Please try again.');
    }
  },

  // ============ ORDERING ============
  async sendServiceType(phone) {
    const checkoutImg = await chatbotImagesService.getImageUrl('checkout');
    await whatsapp.sendMessage(phone, '🛒 *Place Order*\n\nHow would you like to receive your order?');
  },

  async sendMenuForOrder(phone, menuItems, label = 'Select Items', page = 0) {
    // Flatten category arrays and dedupe (category is an array field)
    const categories = [...new Set(menuItems.flatMap(m => Array.isArray(m.category) ? m.category : [m.category]))];
    
    if (!categories.length) {
      const browseMenuImg = await chatbotImagesService.getImageUrl('browse_menu');
      await whatsapp.sendMessage(phone, '📋 No menu items available.');
      return;
    }

    // ===== TRY WHATSAPP FLOW FOR CATEGORY SELECTION =====
    try {
      const flowId = catalogService.getCategoryFlowId();
      const flowMode = catalogService.getCategoryFlowMode();
      if (flowId && flowMode && catalogService.isEnabled()) {
        const metaCloud = require('./metaCloud');
        const flowData = await catalogService.buildCategoryFlowDataSorted(menuItems, `category_select_order_${phone}`);

        if (flowData.categories.length > 0) {
          // Send the catalog product_list first (all items)
          const catalogId = catalogService.getCatalogId();
          const catalogResult = await catalogService.buildProductSections(menuItems);

          if (catalogResult && catalogResult.sections.length > 0) {
            if (catalogResult.totalMapped <= 30) {
              await whatsapp.sendProductList(
                phone,
                catalogId,
                `🛒 ${label}`,
                `${catalogResult.totalInSections} items in ${catalogResult.sections.length} categories\nTap any item to add to cart 🛒`,
                catalogResult.sections,
                'Fresh & Delicious!'
              );
            } else {
              const pages = await catalogService.buildPaginatedProductSections(menuItems);
              if (pages && pages.length > 0) {
                for (const pg of pages) {
                  const pageLabel = pages.length > 1
                    ? `🛒 ${label} (${pg.pageNumber}/${pg.totalPages})`
                    : `🛒 ${label}`;
                  await whatsapp.sendProductList(
                    phone,
                    catalogId,
                    pageLabel,
                    `${pg.totalInPage} items • Tap to view & add to cart 🛒`,
                    pg.sections,
                    'Fresh & Delicious!'
                  );
                }
              }
            }
          }

          // Send WhatsApp Flow message for category selection
          logger.info('Attempting Flow category send (order)', { phone, flowId, mode: flowMode, categories: flowData.categories.length });
          await metaCloud.sendFlowMessage(phone, {
            flowId,
            flowCta: 'Browse by Category',
            headerText: `${label}`,
            bodyText: `Browse our ${flowData.categories.length} categories to add items to your cart!\nTap the button below to select a category.`,
            footerText: 'Powered by JRB Gold',
            screenName: 'CATEGORY_SELECT',
            screenData: flowData,
            flowToken: `category_select_order_${phone}`,
            mode: flowMode
          });

          logger.info('Sent Flow category selector (order)', { phone, categoryCount: flowData.categories.length, mode: flowMode });
          return;
        }
      }
    } catch (flowErr) {
      logger.error('Flow category send failed (order)', { error: flowErr.message });
      await whatsapp.sendMessage(phone, '⚠️ Unable to load menu categories. Please try again.');
    }
  },

  async sendMenuForOrderWithLabel(phone, menuItems, label, page = 0) {
    await this.sendMenuForOrder(phone, menuItems, label, page);
  },

  /**
   * Send a WhatsApp list of menu item TITLES (names) that have variants matching the food type.
   * User picks a title → we send catalog with only matching variants.
   */
  async sendTitleListForOrder(phone, menuItems, foodType, label = 'Select Item') {
    // Strict food-type filtering: for variant items, only include if at least one variant matches
    const matchesFoodType = (ft, pref) => {
      if (!ft || ft === 'none') return false; // unset = no match (strict)
      if (pref === 'veg') return ft === 'veg';
      if (pref === 'nonveg') return ft === 'nonveg' || ft === 'egg';
      if (pref === 'egg') return ft === 'egg';
      return false;
    };

    let matchingItems;
    if (foodType === 'both') {
      matchingItems = menuItems;
    } else {
      matchingItems = menuItems.filter(item => {
        if (item.variants && item.variants.length > 0) {
          // Item has variants — check if ANY variant matches the food type
          return item.variants.some(v => {
            const vft = v.foodType || item.foodType;
            return matchesFoodType(vft, foodType);
          });
        } else {
          // Non-variant item — check item's own foodType
          // Items with 'none'/unset foodType are included in all filters
          const ft = item.foodType;
          if (!ft || ft === 'none') return true;
          return matchesFoodType(ft, foodType);
        }
      });
    }

    if (!matchingItems.length) {
      const searchNoResultsImg = await chatbotImagesService.getImageUrl('search_no_results');
      await whatsapp.sendMessage(phone, '📋 No matching items found.');
      return;
    }

    // Use the selected food type's icon for all items in this list
    const foodTypeIcon = foodType === 'veg' ? '🟢' : foodType === 'nonveg' ? '🔴' : foodType === 'egg' ? '🟡' : '';

    // Build list rows — each row is a menu item title
    const rows = matchingItems.slice(0, 10).map(item => {
      const safeId = item._id.toString();
      let description;
      if (item.variants && item.variants.length > 0) {
        // Count only variants matching the selected food type, including quantity options
        const matchingVariants = foodType === 'both' ? item.variants : item.variants.filter(v => {
          const vft = v.foodType || item.foodType;
          return matchesFoodType(vft, foodType);
        });
        // Count total products (expand quantity options like catalog does)
        let variantCount = 0;
        matchingVariants.forEach(v => {
          if (v.quantities && v.quantities.length > 0) {
            variantCount += v.quantities.length;
          } else {
            variantCount += 1;
          }
        });
        description = `${variantCount} variant${variantCount > 1 ? 's' : ''} available`;
      } else {
        description = `₹${item.offerPrice || item.price}`;
      }
      return {
        rowId: `order_title_${safeId}`,
        title: `${foodTypeIcon} ${item.name}`.substring(0, 24),
        description
      };
    });

    await whatsapp.sendList(
      phone,
      label,
      `We found ${matchingItems.length} items.\nPick one to see its variants:`,
      'View Items',
      [{ title: 'Menu Items', rows }],
      'Select an item'
    );
  },

  /**
   * Send catalog product_list with only the variants of a specific title (menu item)
   * that match the selected food type.
   */
  async sendTitleVariantsForOrder(phone, menuItems, titleItemId, foodType) {
    const menuItem = menuItems.find(m => m._id.toString() === titleItemId);

    if (!menuItem) {
      const itemNotAvailableImg = await chatbotImagesService.getImageUrl('item_not_available');
      await whatsapp.sendMessage(phone, '📋 Item not found.');
      return;
    }

    // Non-variant item — show item details directly
    if (!menuItem.variants || menuItem.variants.length === 0) {
      await this.sendItemDetails(phone, menuItems, titleItemId);
      return;
    }

    // Build matching variants list (needed for both catalog and fallback)
    const getFoodTypeIcon = (type) => type === 'veg' ? '🟢' : type === 'nonveg' ? '🔴' : type === 'egg' ? '🟡' : '';
    const matchingVariants = menuItem.variants
      .map((v, idx) => ({ ...v, originalIndex: idx }))
      .filter(v => {
        const vFoodType = v.foodType || menuItem.foodType || 'none';
        if (foodType === 'both') return true;
        if (foodType === 'veg') return vFoodType === 'veg';
        if (foodType === 'nonveg') return vFoodType === 'nonveg' || vFoodType === 'egg';
        return true;
      });

    if (!matchingVariants.length) {
      const itemNotAvailableImg = await chatbotImagesService.getImageUrl('item_not_available');
      await whatsapp.sendMessage(phone, `📋 No matching variants in ${menuItem.name}.`);
      return;
    }

    // Try sending via catalog product_list (iOS gets variant picker via item_group_id)
    let catalogSent = false;
    try {
      if (catalogService.isEnabled()) {
        const catalogResult = await catalogService.buildTitleVariantSections(menuItem, foodType);
        if (catalogResult && catalogResult.sections.length > 0) {
          const catalogId = catalogService.getCatalogId();
          await whatsapp.sendProductList(
            phone,
            catalogId,
            `📋 ${menuItem.name}`,
            `${catalogResult.totalMapped} variant${catalogResult.totalMapped > 1 ? 's' : ''} • Tap to add to cart 🛒`,
            catalogResult.sections,
            'View & order!'
          );
          catalogSent = true;
        }
      }
    } catch (catalogErr) {
      logger.error('Catalog failed for title variants', { error: catalogErr.message });
      await whatsapp.sendMessage(phone, '⚠️ Unable to load variant options. Please try again.');
    }
  },

  async sendItemsForOrder(phone, menuItems, category, page = 0) {
    // Filter items that include this category (category is an array field)
    const items = menuItems.filter(m => Array.isArray(m.category) ? m.category.includes(category) : m.category === category);
    
    if (!items.length) {
      const itemNotAvailableImg = await chatbotImagesService.getImageUrl('item_not_available');
      await whatsapp.sendMessage(phone, `📋 No items in ${category}.`);
      return;
    }

    // Try WhatsApp Catalog for order items
    try {
      const catalogResult = await catalogService.buildCategorySections(items, category);
      if (catalogResult) {
        const catalogId = catalogService.getCatalogId();
        await whatsapp.sendProductList(
          phone,
          catalogId,
          `📋 ${category}`,
          `${items.length} items • Add to cart directly!`,
          catalogResult.sections,
          'Perivi Hotel'
        );
        return;
      }
    } catch (catalogErr) {
      logger.error('Catalog failed for order items', { category, error: catalogErr.message });
      await whatsapp.sendMessage(phone, `⚠️ Unable to load ${category} items. Please try again.`);
    }
  },

  // Send all items for ordering with pagination
  async sendAllItemsForOrder(phone, menuItems, page = 0) {
    if (!menuItems.length) {
      const browseMenuImg = await chatbotImagesService.getImageUrl('browse_menu');
      await whatsapp.sendMessage(phone, '📋 No items available.');
      return;
    }

    // Try WhatsApp Catalog for order flow
    try {
      if (catalogService.isEnabled()) {
        const map = await catalogService.getCatalogMap();
        if (map.size > 0) {
          if (menuItems.length > 30) {
            const firstMapped = menuItems.find(item => map.has(item._id.toString()));
            const thumbnailId = firstMapped ? map.get(firstMapped._id.toString()) : '';
            await whatsapp.sendCatalogMessage(
              phone,
              `🍽️ Browse all items!\n${menuItems.length} items available\n\nTap "View catalog" to browse, add to cart & order!`,
              'Perivi Hotel',
              thumbnailId
            );
            return;
          }

          const catalogResult = await catalogService.buildProductSections(menuItems);
          if (catalogResult) {
            const catalogId = catalogService.getCatalogId();
            await whatsapp.sendProductList(
              phone,
              catalogId,
              '📋 All Items',
              `${catalogResult.totalMapped} items • Add to cart directly!`,
              catalogResult.sections,
              'Perivi Hotel'
            );
            return;
          }
        }
      }
    } catch (catalogErr) {
      logger.error('Catalog failed for all order items', { error: catalogErr.message });
      await whatsapp.sendMessage(phone, '⚠️ Unable to load menu items. Please try again.');
    }
  },

  async sendQuantitySelection(phone, item) {
    // Get customer's activeOffers (cached per-request — avoids redundant DB calls)
    const activeOffers = await getCachedActiveOffers(phone);
    
    const unitLabel = item.unit || 'piece';
    const baseQty = item.quantity || 1; // Base quantity per unit (e.g., 2 for "2 piece", 500 for "500ml")
    const priceDisplay = formatPriceWithActiveOffers(item, activeOffers);
    
    // Calculate effective price considering activeOffers
    let effectivePrice = item.offerPrice || item.price;
    if (!item.offerPrice && activeOffers.length > 0) {
      const offerResult = calculateOfferDiscount(item, activeOffers);
      if (offerResult.discountedPrice !== null) {
        effectivePrice = offerResult.discountedPrice;
      }
    }
    
    // Create quantity options - show multiples of base quantity
    // e.g., if item is "2 piece" → show 2, 4, 6, 8... pieces
    // e.g., if item is "500ml" → show 500, 1000, 1500... ml
    const rows = [];
    for (let i = 1; i <= 10; i++) {
      const totalQty = baseQty * i;
      const totalPrice = effectivePrice * i;
      
      // Format display based on unit type
      let displayText;
      if (unitLabel === 'piece' || unitLabel === 'pieces') {
        displayText = `${totalQty} ${totalQty === 1 ? 'piece' : 'pieces'}`;
      } else {
        // For ml, liter, kg, g, etc. - just show number + unit
        displayText = `${totalQty} ${unitLabel}`;
      }
      
      rows.push({
        id: `qty_${i}`,
        title: displayText,
        description: `₹${totalPrice}`
      });
    }
    
    const sections = [{
      title: 'Quantity',
      rows: rows
    }];
    
    // Remove markdown from title for interactive list
    const cleanTitle = item.name.replace(/\*/g, '');
    
    await whatsapp.sendList(
      phone,
      cleanTitle,
      `💰 ${priceDisplay} / ${baseQty} ${unitLabel}\n\nHow many would you like to add?`,
      'Select Quantity',
      sections
    );
  },

  async sendAddedToCart(phone, item, qty, cart) {
    // Get customer's activeOffers (cached per-request — avoids redundant DB calls)
    const activeOffers = await getCachedActiveOffers(phone);
    
    const cartCount = cart.reduce((sum, c) => sum + c.quantity, 0);
    const unitInfo = `${item.quantity || 1} ${item.unit || 'piece'}`;
    const priceDisplay = formatPriceWithActiveOffers(item, activeOffers);
    
    // Calculate effective price considering activeOffers
    let effectivePrice = item.offerPrice || item.price;
    if (!item.offerPrice && activeOffers.length > 0) {
      const offerResult = calculateOfferDiscount(item, activeOffers);
      if (offerResult.discountedPrice !== null) {
        effectivePrice = offerResult.discountedPrice;
      }
    }
    
    const addedToCartImageUrl = await chatbotImagesService.getImageUrl('added_to_cart');
    
    await whatsapp.sendMessage(phone, `✅ *Added to Cart!*\n\n*${item.name}* (${unitInfo})\nQty: ${qty} × ₹${effectivePrice} = ₹${effectivePrice * qty}\n\n🛒 Cart: ${cartCount} items`);
  },

  // ============ CART & CHECKOUT ============
  async sendCheckoutOptions(phone, customer) {
    // Refresh customer from database to ensure we have latest cart data
    const freshCustomer = await Customer.findOne({ phone }).populate('cart.menuItem');
    
    if (!freshCustomer?.cart?.length) {
      const cartEmptyImg = await chatbotImagesService.getImageUrl('cart_empty');
      await whatsapp.sendMessage(phone, '🛒 Your cart is empty!');
      return;
    }

    // Get customer's activeOffers for targeted discounts
    const activeOffers = freshCustomer.activeOffers || [];

    let total = 0;
    let cartMsg = '🛒 *Your Cart*\n\n';
    let validItems = 0;
    
    freshCustomer.cart.forEach((item, i) => {
      if (item.menuItem) {
        // Resolve variant-specific pricing
        let effectivePrice = item.menuItem.offerPrice || item.menuItem.price;
        let unitInfo = `${item.menuItem.quantity || 1} ${item.menuItem.unit || 'piece'}`;
        let displayName = item.menuItem.name;

        // If variant was selected, use variant price & label
        if (item.variantIndex !== null && item.variantIndex !== undefined && item.menuItem.variants?.[item.variantIndex]) {
          const variant = item.menuItem.variants[item.variantIndex];
          // Check for quantity option (3-level: title → variant → quantity)
          if (item.quantityIndex !== null && item.quantityIndex !== undefined && variant.quantities?.[item.quantityIndex]) {
            const q = variant.quantities[item.quantityIndex];
            effectivePrice = q.offerPrice && q.offerPrice < q.price ? q.offerPrice : q.price;
            displayName = `${item.menuItem.name} - ${variant.label}`;
            unitInfo = `${q.quantity || 1} ${q.unit || 'piece'}`;
          } else {
            effectivePrice = variant.offerPrice && variant.offerPrice < variant.price
              ? variant.offerPrice : variant.price;
            displayName = `${item.menuItem.name} - ${variant.label}`;
            unitInfo = `${variant.quantity || 1} ${variant.unit || item.menuItem.unit || 'piece'}`;
          }
        } else if (!item.menuItem.offerPrice && activeOffers.length > 0) {
          const offerResult = calculateOfferDiscount(item.menuItem, activeOffers);
          if (offerResult.discountedPrice !== null) {
            effectivePrice = offerResult.discountedPrice;
          }
        }
        const subtotal = effectivePrice * item.quantity;
        total += subtotal;
        validItems++;
        cartMsg += `${validItems}. *${displayName}* (${unitInfo})\n`;
        cartMsg += `   Qty: ${item.quantity} × ₹${effectivePrice} = ₹${subtotal}\n\n`;
      }
    });
    
    if (validItems === 0) {
      // Clean up invalid cart items
      freshCustomer.cart = [];
      await freshCustomer.save();
      
      const cartEmptyImg = await chatbotImagesService.getImageUrl('cart_empty');
      await whatsapp.sendMessage(phone, '🛒 Your cart is empty!');
      return;
    }
    
    cartMsg += `━━━━━━━━━━━━━━━\n`;
    cartMsg += `*Total: ₹${total}*`;

    // Show Review & Order, Add More, Cancel buttons
    const viewCartImg = await chatbotImagesService.getImageUrl('view_cart');
    await whatsapp.sendMessage(phone, cartMsg);
  },

  async requestLocation(phone) {
    // Request location with action buttons
    await whatsapp.sendLocationRequest(phone,
      `📍 *Share Your Delivery Location*\n\nPlease share your location for accurate delivery.`
    );
  },

  /**
   * Launch Payment Method Selection Flow (or fall back to buttons).
   * @param {string} phone - Customer phone number
   * @param {string} serviceType - 'delivery' or 'pickup'
   */
  async launchPaymentFlow(phone, serviceType) {
    const paymentFlowId = catalogService.getPaymentFlowId();
    if (paymentFlowId) {
      try {
        const metaCloud = require('./metaCloud');
        const flowToken = `payment_${phone}_${serviceType}`;
        const orderSummaryImg = await chatbotImagesService.getImageUrl(
          serviceType === 'pickup' ? 'pickup_order_summary' : 'order_summary'
        );
        await metaCloud.sendFlowMessage(phone, {
          flowId: paymentFlowId,
          flowCta: 'Select Payment',
          headerImageUrl: orderSummaryImg || undefined,
          headerText: 'Payment Method',
          bodyText: '💳 Choose your payment method',
          footerText: 'Perivi Hotel',
          flowToken,
          flowAction: 'data_exchange',
          mode: 'published'
        });
        logger.info('Sent payment method flow', { phone, serviceType, flowId: paymentFlowId });
        return true;
      } catch (flowErr) {
        logger.error('Payment flow failed', { error: flowErr.message });
        await whatsapp.sendMessage(phone, '⚠️ Unable to load payment options. Please try again.');
      }
    }
    return false;
  },

  async sendPaymentMethodOptions(phone, customer, state = {}) {
    // Refresh customer from database to ensure we have latest cart data
    const freshCustomer = await Customer.findOne({ phone }).populate('cart.menuItem');
    
    if (!freshCustomer?.cart?.length) {
      const cartEmptyImg = await chatbotImagesService.getImageUrl('cart_empty');
      await whatsapp.sendMessage(phone, '🛒 Your cart is empty!');
      return;
    }

    // Get customer's activeOffers for targeted discounts
    const activeOffers = freshCustomer.activeOffers || [];

    let itemsTotal = 0;
    let cartMsg = '🛒 *Order Summary*\n\n';
    let validItems = 0;
    
    freshCustomer.cart.forEach((item, i) => {
      if (item.menuItem) {
        // Resolve variant-specific pricing
        let effectivePrice = item.menuItem.offerPrice || item.menuItem.price;
        let unitInfo = `${item.menuItem.quantity || 1} ${item.menuItem.unit || 'piece'}`;
        let displayName = item.menuItem.name;

        if (item.variantIndex !== null && item.variantIndex !== undefined && item.menuItem.variants?.[item.variantIndex]) {
          const variant = item.menuItem.variants[item.variantIndex];
          if (item.quantityIndex !== null && item.quantityIndex !== undefined && variant.quantities?.[item.quantityIndex]) {
            const q = variant.quantities[item.quantityIndex];
            effectivePrice = q.offerPrice && q.offerPrice < q.price ? q.offerPrice : q.price;
            displayName = `${item.menuItem.name} - ${variant.label}`;
            unitInfo = `${q.quantity || 1} ${q.unit || 'piece'}`;
          } else {
            effectivePrice = variant.offerPrice && variant.offerPrice < variant.price
              ? variant.offerPrice : variant.price;
            displayName = `${item.menuItem.name} - ${variant.label}`;
            unitInfo = `${variant.quantity || 1} ${variant.unit || item.menuItem.unit || 'piece'}`;
          }
        } else if (!item.menuItem.offerPrice && activeOffers.length > 0) {
          const offerResult = calculateOfferDiscount(item.menuItem, activeOffers);
          if (offerResult.discountedPrice !== null) {
            effectivePrice = offerResult.discountedPrice;
          }
        }
        const subtotal = effectivePrice * item.quantity;
        itemsTotal += subtotal;
        validItems++;
        cartMsg += `${validItems}. *${displayName}* (${unitInfo})\n`;
        cartMsg += `   Qty: ${item.quantity} × ₹${effectivePrice} = ₹${subtotal}\n\n`;
      }
    });
    
    if (validItems === 0) {
      // Clean up invalid cart items
      freshCustomer.cart = [];
      await freshCustomer.save();
      
      const cartEmptyImg = await chatbotImagesService.getImageUrl('cart_empty');
      await whatsapp.sendMessage(phone, '🛒 Your cart is empty!');
      return;
    }
    
    cartMsg += `━━━━━━━━━━━━━━━\n`;
    cartMsg += `*Items Total: ₹${itemsTotal}*\n`;
    
    // Calculate delivery charge if applicable
    let deliveryCharge = state.deliveryCharge || 0;
    const serviceType = state.serviceType || 'delivery';
    
    // Recalculate delivery charge if customer has location and service type is delivery
    if (serviceType === 'delivery' && freshCustomer.deliveryAddress?.latitude && freshCustomer.deliveryAddress?.longitude) {
      const deliveryResult = await calculateDeliveryCharge(
        freshCustomer.deliveryAddress.latitude,
        freshCustomer.deliveryAddress.longitude
      );
      deliveryCharge = deliveryResult.charge || 0;
      
      if (deliveryResult.distance) {
        cartMsg += `📍 *Distance:* ${deliveryResult.distance} KM\n`;
      }
    }
    
    // Show delivery charge if applicable
    if (deliveryCharge > 0) {
      cartMsg += `🚚 *Delivery Charge:* ₹${deliveryCharge}\n`;
    } else if (serviceType === 'delivery') {
      cartMsg += `🚚 *Delivery:* FREE\n`;
    }
    
    const grandTotal = itemsTotal + deliveryCharge;
    cartMsg += `━━━━━━━━━━━━━━━\n`;
    cartMsg += `*Grand Total: ₹${grandTotal}*\n\n`;
    
    // Show delivery address if available
    if (freshCustomer.deliveryAddress?.address && serviceType === 'delivery') {
      cartMsg += `📍 *Delivery Address:*\n${freshCustomer.deliveryAddress.address}\n\n`;
    } else if (serviceType === 'pickup') {
      cartMsg += `🏪 *Self-Pickup at Restaurant*\n\n`;
    }
    
    cartMsg += `💳 Select payment method:`;

    const orderSummaryImageUrl = await chatbotImagesService.getImageUrl('order_summary');
    await whatsapp.sendMessage(phone, cartMsg);
  },

  async processCODOrder(phone, customer, state) {
    // Order creation dedup — prevent double-tap creating duplicate orders
    const orderDedup = idempotencyService.checkOrderOperation(
      phone, 'cod_checkout', { serviceType: state.serviceType || state.selectedService || 'delivery' }
    );
    if (orderDedup.isDuplicate) {
      logger.warn('Duplicate COD order creation prevented', { phone });
      await whatsapp.sendMessage(phone, '⏳ Your order is already being processed. Please wait.');
      return { success: false };
    }

    // Refresh customer from database to ensure we have latest cart data
    const freshCustomer = await Customer.findOne({ phone }).populate('cart.menuItem');
    
    if (!freshCustomer?.cart?.length) {
      const cartEmptyImg = await chatbotImagesService.getImageUrl('cart_empty');
      await whatsapp.sendMessage(phone, '🛒 Your cart is empty!');
      return { success: false };
    }

    const serviceType = state.serviceType || state.selectedService || 'delivery';
    const orderId = generateOrderId(serviceType);
    setMetadata('orderId', orderId);
    setMetadata('phone', phone);
    logger.info('Order created', { orderId, serviceType, phone, via: 'COD' });
    let itemsTotal = 0;
    let totalDiscount = 0;
    let appliedOfferIds = new Set();
    
    // Get customer's active offers
    const activeOffers = freshCustomer.activeOffers || [];
    
    const items = freshCustomer.cart.filter(item => item.menuItem).map(item => {
      // Resolve variant-specific pricing
      let effectivePrice = item.menuItem.offerPrice || item.menuItem.price;
      let itemDiscount = 0;
      let appliedOfferId = null;
      let itemName = item.menuItem.name;
      let itemUnit = item.menuItem.unit || 'piece';
      let itemUnitQty = item.menuItem.quantity || 1;
      let originalPrice = item.menuItem.price;

      // If a variant was selected, use variant pricing
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
      } else if (!item.menuItem.offerPrice && activeOffers.length > 0) {
        // If no offerPrice, check customer's activeOffers for applicable discount
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
      
      const subtotal = Math.round(effectivePrice * item.quantity * 100) / 100;
      itemsTotal += subtotal;
      totalDiscount += itemDiscount;
      
      // Use variant-specific image if available, else parent item image
      let itemImage = item.menuItem.image;
      if (item.variantIndex !== null && item.variantIndex !== undefined && item.menuItem.variants?.[item.variantIndex]?.image) {
        itemImage = item.menuItem.variants[item.variantIndex].image;
      }

      return {
        menuItem: item.menuItem._id,
        name: itemName,
        quantity: item.quantity,
        price: effectivePrice,
        originalPrice,
        unit: itemUnit,
        unitQty: itemUnitQty,
        image: itemImage,
        variantIndex: item.variantIndex ?? null,
        variantLabel: item.variantLabel || null,
        quantityIndex: item.quantityIndex ?? null,
        appliedOfferId
      };
    });

    if (!items.length) {
      const cartEmptyImg = await chatbotImagesService.getImageUrl('cart_empty');
      await whatsapp.sendMessage(phone, '🛒 Your cart is empty!');
      return { success: false };
    }

    // Calculate delivery charge for delivery orders
    let deliveryCharge = 0;
    let deliveryDistance = null;
    if (serviceType === 'delivery' && freshCustomer.deliveryAddress?.latitude && freshCustomer.deliveryAddress?.longitude) {
      const deliveryResult = await calculateDeliveryCharge(
        freshCustomer.deliveryAddress.latitude,
        freshCustomer.deliveryAddress.longitude
      );
      deliveryCharge = Math.max(0, deliveryResult.charge || 0);
      deliveryDistance = deliveryResult.distance;
    }
    
    itemsTotal = Math.round(itemsTotal * 100) / 100;
    const total = Math.round((itemsTotal + deliveryCharge) * 100) / 100;

    const order = new Order({
      orderId,
      customer: { phone: freshCustomer.phone, name: freshCustomer.name || 'Customer', email: freshCustomer.email },
      items,
      itemsTotal,
      deliveryCharge,
      deliveryDistance,
      totalAmount: total,
      discountAmount: totalDiscount,
      appliedOfferIds: Array.from(appliedOfferIds),
      serviceType: state.serviceType || state.selectedService || 'delivery',
      deliveryAddress: freshCustomer.deliveryAddress ? {
        address: freshCustomer.deliveryAddress.address,
        latitude: freshCustomer.deliveryAddress.latitude,
        longitude: freshCustomer.deliveryAddress.longitude
      } : null,
      paymentMethod: 'cod',
      status: 'confirmed',
      trackingUpdates: [{ status: 'confirmed', message: 'Order confirmed - Cash on Delivery' }]
    });
    // Transaction-based checkout: order.save() + cart clear are atomic
    // Falls back to sequential if transactions not supported (standalone MongoDB)
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

    // Add to WhatsApp broadcast contacts
    await whatsappBroadcast.addContact(freshCustomer.phone, freshCustomer.name, new Date());

    // Track today's orders count
    try {
      const DashboardStats = require('../models/DashboardStats');
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
      logger.error('Error tracking today orders', { error: statsErr.message, stack: statsErr.stack });
    }

    // Emit event for real-time updates
    const dataEvents = require('./eventEmitter');
    dataEvents.emit('orders');
    dataEvents.emit('dashboard');

    // Sync to Google Sheets
    googleSheets.addOrder(order).catch(err => logger.error('Google Sheets sync error', { error: err.message }));
    
    // Update daily report in real-time
    googleSheets.syncTodayDailyReport().catch(err => logger.error('Daily report sync error', { error: err.message }));

    // Send push notification to admin for new COD order
    try {
      const User = require('../models/User');
      const pushNotification = require('./pushNotification');
      
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
      if (admins.length > 0) logger.info('Admin push sent for COD order', { orderId });
    } catch (pushErr) {
      logger.error('Admin push error', { error: pushErr.message });
    }

    // Update in-memory customer object for state consistency
    freshCustomer.cart = [];
    freshCustomer.orderHistory = freshCustomer.orderHistory || [];
    freshCustomer.orderHistory.push(order._id);
    
    // Also update the original customer object for state consistency
    customer.cart = [];
    customer.orderHistory = freshCustomer.orderHistory;
    
    state.pendingOrderId = orderId;

    // Keep confirmation body short — full item list lives in the Order Actions
    // flow (ORDER_DETAILS screen) accessible via the "Order Details" CTA button.
    let confirmMsg = `✅ *Order Confirmed!*\n\n`;
    confirmMsg += `📦 Order ID: *${orderId}*\n`;
    confirmMsg += `🛵 Service: *Delivery*\n`;
    confirmMsg += `💵 Payment: *Cash on Delivery*\n`;
    if (deliveryCharge > 0) {
      confirmMsg += `🚚 Delivery Charge: *₹${deliveryCharge}*\n`;
    }
    confirmMsg += `💰 Grand Total: *₹${total}*\n\n`;
    confirmMsg += `🛒 Tap *Order Details* below to view your items.\n\n`;
    confirmMsg += `🙏 Thank you for your order!\nPlease keep ₹${total} ready for payment.`;

    const confirmedImageUrl = await chatbotImagesService.getImageUrl('order_confirmed');
    
    // Send as flow with "Order Details" CTA if order actions flow is available
    const orderActionsFlowId = process.env.WHATSAPP_ORDER_ACTIONS_FLOW_ID;
    let confirmSent = false;
    if (orderActionsFlowId) {
      try {
        const metaCloud = require('./metaCloud');
        const cleanPhone = phone.replace('@c.us', '').replace(/\D/g, '');
        await metaCloud.sendFlowMessage(phone, {
          flowId: orderActionsFlowId,
          flowCta: 'Order Details',
          headerImageUrl: confirmedImageUrl || undefined,
          headerText: confirmedImageUrl ? undefined : 'Order Confirmed',
          bodyText: confirmMsg,
          flowToken: `order_actions_${cleanPhone}_${orderId}`,
          flowAction: 'data_exchange'
        });
        confirmSent = true;
      } catch (flowErr) {
        logger.error('Order actions flow failed on COD confirm', { error: flowErr.message });
      }
    }
    // Fallback: send regular message if flow was not available or failed
    if (!confirmSent) {
      if (confirmedImageUrl) {
        await whatsapp.sendImage(phone, confirmedImageUrl, confirmMsg);
      } else {
        await whatsapp.sendMessage(phone, confirmMsg);
      }
    }

    // Mark WhatsApp confirmation sent for reconciliation
    order.whatsappConfirmationSent = true;
    await order.save();

    return { success: true };
  },

  async sendOrderReview(phone, customer) {
    // Refresh customer from database to ensure we have latest cart data
    const freshCustomer = await Customer.findOne({ phone }).populate('cart.menuItem');
    
    if (!freshCustomer?.cart?.length) {
      const cartEmptyImg = await chatbotImagesService.getImageUrl('cart_empty');
      await whatsapp.sendMessage(phone, '🛒 Your cart is empty!');
      return;
    }

    // Get customer's activeOffers for targeted discounts
    const activeOffers = freshCustomer.activeOffers || [];

    let total = 0;
    let reviewMsg = '📋 *Review Your Order*\n\n';
    let validItems = 0;
    
    freshCustomer.cart.forEach((item, i) => {
      if (item.menuItem) {
        // Resolve variant-specific name and pricing
        let effectivePrice = item.menuItem.offerPrice || item.menuItem.price;
        let itemName = item.menuItem.name;
        let itemUnit = item.menuItem.unit || 'piece';
        let itemUnitQty = item.menuItem.quantity || 1;
        
        if (item.variantIndex !== null && item.variantIndex !== undefined && item.menuItem.variants?.[item.variantIndex]) {
          const variant = item.menuItem.variants[item.variantIndex];
          if (item.quantityIndex !== null && item.quantityIndex !== undefined && variant.quantities?.[item.quantityIndex]) {
            const q = variant.quantities[item.quantityIndex];
            effectivePrice = q.offerPrice && q.offerPrice < q.price ? q.offerPrice : q.price;
            itemName = `${item.menuItem.name} - ${variant.label} (${q.quantity} ${q.unit})`;
            itemUnit = q.unit || variant.unit || item.menuItem.unit || 'piece';
            itemUnitQty = q.quantity || 1;
          } else {
            effectivePrice = variant.offerPrice && variant.offerPrice < variant.price
              ? variant.offerPrice : variant.price;
            itemName = `${item.menuItem.name} - ${variant.label} (${variant.quantity || 1} ${variant.unit || item.menuItem.unit || 'piece'})`;
            itemUnit = variant.unit || item.menuItem.unit || 'piece';
            itemUnitQty = variant.quantity || 1;
          }
        }
        
        if (!item.menuItem.offerPrice && activeOffers.length > 0) {
          const offerResult = calculateOfferDiscount(item.menuItem, activeOffers);
          if (offerResult.discountedPrice !== null) {
            effectivePrice = offerResult.discountedPrice;
          }
        }
        const subtotal = effectivePrice * item.quantity;
        total += subtotal;
        validItems++;
        reviewMsg += `${validItems}. *${itemName}*\n`;
        reviewMsg += `   Qty: ${item.quantity} × ₹${effectivePrice} = ₹${subtotal}\n\n`;
      }
    });
    
    if (validItems === 0) {
      // Clean up invalid cart items
      freshCustomer.cart = [];
      await freshCustomer.save();
      
      const cartEmptyImg = await chatbotImagesService.getImageUrl('cart_empty');
      await whatsapp.sendMessage(phone, '🛒 Your cart is empty!');
      return;
    }
    
    reviewMsg += `━━━━━━━━━━━━━━━\n`;
    reviewMsg += `*Total: ₹${total}*\n\n`;
    reviewMsg += `Please confirm your order to proceed with payment.`;

    const orderSummaryImg = await chatbotImagesService.getImageUrl('order_summary');
    await whatsapp.sendMessage(phone, reviewMsg);
  },

  // Send cart options menu when user types just "cart"
  async sendCartOptionsMenu(phone) {
    const cartOptionsImageUrl = await chatbotImagesService.getImageUrl('cart_options');
    const message = `🛒 *Cart Options*\n\nWhat would you like to do?`;
    
    await whatsapp.sendMessage(phone, message);
  },

  async sendCart(phone, customer) {
    // Refresh customer from database to ensure we have latest cart data
    const freshCustomer = await Customer.findOne({ phone }).populate('cart.menuItem');
    
    if (!freshCustomer?.cart?.length) {
      const cartEmptyImg = await chatbotImagesService.getImageUrl('cart_empty');
      await whatsapp.sendMessage(phone, '🛒 *Your Cart is Empty*\n\nTap the 🛒 cart icon at the top right to view your WhatsApp cart, or browse our menu to add items!');
      return;
    }

    let total = 0;
    let totalDiscount = 0;
    let cartMsg = '🛒 *Your Cart*\n\n';
    let validItems = 0;
    let appliedOfferNames = new Set();
    
    // Get customer's active offers
    const activeOffers = freshCustomer.activeOffers || [];
    
    freshCustomer.cart.forEach((item, i) => {
      if (item.menuItem) {
        // First check if item has built-in offerPrice
        let effectivePrice = item.menuItem.offerPrice || item.menuItem.price;
        let itemDiscount = 0;
        let offerApplied = null;
        let displayName = item.menuItem.name;
        let unitInfo = `${item.menuItem.quantity || 1} ${item.menuItem.unit || 'piece'}`;

        // If variant was selected, use variant price & label
        if (item.variantIndex !== null && item.variantIndex !== undefined && item.menuItem.variants && item.menuItem.variants.length > item.variantIndex) {
          const variant = item.menuItem.variants[item.variantIndex];
          if (variant) {
            if (item.quantityIndex !== null && item.quantityIndex !== undefined && variant.quantities && variant.quantities.length > item.quantityIndex) {
              const q = variant.quantities[item.quantityIndex];
              if (q) {
                effectivePrice = q.offerPrice && q.offerPrice < q.price ? q.offerPrice : q.price;
                displayName = variant.label;  // Just the variant label, no quantity
                unitInfo = `${q.quantity} ${q.unit}`;  // Quantity in unitInfo only
              }
            } else {
              effectivePrice = variant.offerPrice && variant.offerPrice < variant.price
                ? variant.offerPrice : variant.price;
              displayName = variant.label;
              unitInfo = `${variant.quantity || 1} ${variant.unit || item.menuItem.unit || 'piece'}`;
            }
          }
        }
        
        // If no offerPrice, check customer's activeOffers for applicable discount
        if (!item.menuItem.offerPrice && activeOffers.length > 0) {
          const offerResult = calculateOfferDiscount(item.menuItem, activeOffers);
          if (offerResult.discountedPrice !== null) {
            effectivePrice = offerResult.discountedPrice;
            itemDiscount = offerResult.discountAmount * item.quantity;
            offerApplied = offerResult.appliedOffer;
            if (offerApplied) {
              appliedOfferNames.add(offerApplied.offerType || offerApplied.title || 'Special Offer');
            }
          }
        }
        
        const subtotal = effectivePrice * item.quantity;
        total += subtotal;
        totalDiscount += itemDiscount;
        validItems++;
        
        // Show price with discount if applicable
        let priceDisplay;
        // Always use effectivePrice (which accounts for variant/quantity options)
        if (offerApplied && itemDiscount > 0) {
          const originalPrice = item.variantIndex !== null ? 
            (item.menuItem.variants[item.variantIndex]?.price || item.menuItem.price) : 
            item.menuItem.price;
          priceDisplay = `~₹${originalPrice}~ ➜ *₹${effectivePrice}* 🎁`;
        } else {
          priceDisplay = `*₹${effectivePrice}*`;
        }
        
        cartMsg += `${validItems}. *${displayName}* (${unitInfo})\n`;
        cartMsg += `   ${item.quantity} × ${priceDisplay} = ₹${subtotal}\n\n`;
      }
    });
    
    // If no valid items (all menu items were deleted), clean up cart and show empty message
    if (validItems === 0) {
      // Clean up invalid cart items
      freshCustomer.cart = [];
      await freshCustomer.save();
      
      const cartEmptyImg = await chatbotImagesService.getImageUrl('cart_empty');
      await whatsapp.sendMessage(phone, '🛒 *Your Cart is Empty*\n\nTap the 🛒 cart icon at the top right to view your WhatsApp cart, or browse our menu to add items!');
      return;
    }

    cartMsg += `━━━━━━━━━━━━━━━\n`;
    
    // Show offer applied message if discounts were applied
    if (totalDiscount > 0 && appliedOfferNames.size > 0) {
      const offersList = Array.from(appliedOfferNames).join(', ');
      cartMsg += `🎁 *Offer Applied:* ${offersList}\n`;
      cartMsg += `💰 *You Save:* ₹${totalDiscount}\n`;
    }
    
    cartMsg += `*Total: ₹${total}*`;

    // Send cart summary as image + body + reply buttons (Delivery / Self-Pickup)
    // (Replaces previous WhatsApp catalog product_list + Cart Review Flow combo)
    const viewCartImageUrl = await chatbotImagesService.getImageUrl('view_cart');
    const serviceButtons = [
      { id: 'service_delivery', text: 'Delivery' },
      { id: 'service_pickup', text: 'Self-Pickup' }
    ];

    // WhatsApp interactive body text limit is 1024 chars — truncate gracefully if needed
    const bodyText = cartMsg.length > 1000 ? cartMsg.substring(0, 997) + '...' : cartMsg;

    try {
      if (viewCartImageUrl) {
        await whatsapp.sendImageWithButtons(phone, viewCartImageUrl, bodyText, serviceButtons, 'Perivi Hotel');
      } else {
        await whatsapp.sendButtons(phone, bodyText, serviceButtons, 'Perivi Hotel');
      }
      logger.info('Sent cart summary with delivery/pickup buttons', { phone, items: validItems, total });
    } catch (err) {
      logger.error('Cart summary buttons failed', { phone, error: err.message });
      // Fallback: send plain text + simple buttons
      await whatsapp.sendMessage(phone, cartMsg);
      await whatsapp.sendButtons(phone, '🛍️ How would you like to receive your order?', serviceButtons);
    }
  },

  async processCheckout(phone, customer, state) {
    // Order creation dedup — prevent double-tap creating duplicate orders
    const orderDedup = idempotencyService.checkOrderOperation(
      phone, 'upi_checkout', { serviceType: state.serviceType || state.selectedService || 'delivery' }
    );
    if (orderDedup.isDuplicate) {
      logger.warn('Duplicate UPI order creation prevented', { phone });
      await whatsapp.sendMessage(phone, '⏳ Your order is already being processed. Please wait.');
      return { success: false };
    }

    // Refresh customer from database to ensure we have latest cart data
    const freshCustomer = await Customer.findOne({ phone }).populate('cart.menuItem');
    
    if (!freshCustomer?.cart?.length) {
      const cartEmptyImg = await chatbotImagesService.getImageUrl('cart_empty');
      await whatsapp.sendMessage(phone, '🛒 Your cart is empty!');
      return { success: false };
    }

    const serviceType = state.serviceType || state.selectedService || 'delivery';
    const orderId = generateOrderId(serviceType);
    setMetadata('orderId', orderId);
    setMetadata('phone', phone);
    logger.info('Order created', { orderId, serviceType, phone, via: 'UPI' });
    let itemsTotal = 0;
    let totalDiscount = 0;
    let appliedOfferIds = new Set();
    
    // Get customer's active offers
    const activeOffers = freshCustomer.activeOffers || [];
    
    const items = freshCustomer.cart.filter(item => item.menuItem).map(item => {
      // First check if item has built-in offerPrice
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
      
      const subtotal = Math.round(effectivePrice * item.quantity * 100) / 100;
      itemsTotal += subtotal;
      totalDiscount += itemDiscount;
      
      // Use variant-specific image if available, else parent item image
      let itemImage = item.menuItem.image;
      if (item.variantIndex !== null && item.variantIndex !== undefined && item.menuItem.variants?.[item.variantIndex]?.image) {
        itemImage = item.menuItem.variants[item.variantIndex].image;
      }
      
      return {
        menuItem: item.menuItem._id,
        name: itemName,
        quantity: item.quantity,
        price: effectivePrice,
        originalPrice,
        unit: itemUnit,
        unitQty: itemUnitQty,
        image: itemImage,
        variantIndex: item.variantIndex ?? null,
        variantLabel: item.variantLabel || null,
        quantityIndex: item.quantityIndex ?? null,
        appliedOfferId
      };
    });

    if (!items.length) {
      const cartEmptyImg = await chatbotImagesService.getImageUrl('cart_empty');
      await whatsapp.sendMessage(phone, '🛒 Your cart is empty!');
      return { success: false };
    }

    // Calculate delivery charge for delivery orders
    let deliveryCharge = 0;
    let deliveryDistance = null;
    if (serviceType === 'delivery' && freshCustomer.deliveryAddress?.latitude && freshCustomer.deliveryAddress?.longitude) {
      const deliveryResult = await calculateDeliveryCharge(
        freshCustomer.deliveryAddress.latitude,
        freshCustomer.deliveryAddress.longitude
      );
      deliveryCharge = Math.max(0, deliveryResult.charge || 0);
      deliveryDistance = deliveryResult.distance;
    }
    
    itemsTotal = Math.round(itemsTotal * 100) / 100;
    const total = Math.round((itemsTotal + deliveryCharge) * 100) / 100;

    const order = new Order({
      orderId,
      customer: { phone: freshCustomer.phone, name: freshCustomer.name || 'Customer', email: freshCustomer.email },
      items,
      itemsTotal,
      deliveryCharge,
      deliveryDistance,
      totalAmount: total,
      // Store discount info
      discountAmount: totalDiscount,
      appliedOfferIds: Array.from(appliedOfferIds),
      serviceType: state.serviceType || state.selectedService || 'delivery',
      deliveryAddress: freshCustomer.deliveryAddress ? {
        address: freshCustomer.deliveryAddress.address,
        latitude: freshCustomer.deliveryAddress.latitude,
        longitude: freshCustomer.deliveryAddress.longitude
      } : null,
      paymentMethod: 'upi',
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
      if (!upiCartUpdate.$set) upiCartUpdate.$set = {};
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

    // Add to WhatsApp broadcast contacts
    await whatsappBroadcast.addContact(freshCustomer.phone, freshCustomer.name, new Date());

    // Track today's orders count
    try {
      const DashboardStats = require('../models/DashboardStats');
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
      logger.error('Error tracking today orders', { error: statsErr.message, stack: statsErr.stack });
    }

    // Emit event for real-time updates
    const dataEvents = require('./eventEmitter');
    dataEvents.emit('orders');
    dataEvents.emit('dashboard');

    // Sync to Google Sheets
    googleSheets.addOrder(order).catch(err => logger.error('Google Sheets sync error', { error: err.message }));
    
    // Update daily report in real-time
    googleSheets.syncTodayDailyReport().catch(err => logger.error('Daily report sync error', { error: err.message }));

    // Send push notification to admin for new UPI order
    // (For native WhatsApp payment, admin push is sent after payment confirmation in webhook)
    const sendAdminPush = async () => {
      try {
        const User = require('../models/User');
        const pushNotification = require('./pushNotification');
        
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
        if (admins.length > 0) logger.info('Admin push sent for UPI order', { orderId });
      } catch (pushErr) {
        logger.error('Admin push error', { error: pushErr.message });
      }
    };

    // Update in-memory customer objects for state consistency (DB already updated atomically above)
    freshCustomer.cart = [];
    freshCustomer.orderHistory = freshCustomer.orderHistory || [];
    freshCustomer.orderHistory.push(order._id);
    
    // Also update the original customer object for state consistency
    customer.cart = [];
    customer.orderHistory = freshCustomer.orderHistory;
    
    state.pendingOrderId = orderId;

    // ===== TRY WHATSAPP NATIVE PAYMENT (order_details) FIRST =====
    const paymentConfig = process.env.WHATSAPP_PAYMENT_CONFIG || process.env.RAZORPAY_CONFIG_ID;
    if (catalogService.isEnabled() && paymentConfig) {
      try {
        // Build items with retailer_id from catalog mappings
        const menuItemIds = items.map(i => i.menuItem.toString());
        const retailerMappings = await catalogService.getRetailerIds(menuItemIds);
        const retailerMap = new Map(retailerMappings.map(m => [m.menuItemId, m.retailerId]));

        // Only use native payment if ALL items have catalog mappings
        if (retailerMappings.length === items.length) {
          const orderItems = items.map(item => {
            const baseId = item.menuItem.toString();
            // Build the correct retailer_id for variant/quantity items
            // so WhatsApp can match the exact catalog product (with its image)
            let retailerId;
            if (item.variantIndex != null) {
              if (item.quantityIndex != null) {
                retailerId = `${baseId}_v${item.variantIndex}_q${item.quantityIndex}`;
              } else {
                retailerId = `${baseId}_v${item.variantIndex}`;
              }
            } else {
              retailerId = retailerMap.get(baseId) || baseId;
            }
            return {
              retailerId,
              name: item.name,
              imageUrl: item.image || null,
              priceAmount: item.originalPrice || item.price,
              saleAmount: item.price !== item.originalPrice ? item.price : undefined,
              quantity: item.quantity
            };
          });

          const orderDetailsImg = await chatbotImagesService.getImageUrl('order_details');
          try {
            await whatsapp.sendOrderDetails(phone, orderId, orderItems, total, {
              tax: 0,
              shipping: deliveryCharge,
              discount: totalDiscount,
              headerImageUrl: orderDetailsImg || null
            });
          } catch (sendErr) {
            // Meta API may have already delivered the message even if post-send tracking failed
            logger.warn('sendOrderDetails post-processing error', { orderId, error: sendErr.message });
          }

          // Don't send admin push yet — wait for payment confirmation webhook
          logger.info('Native WhatsApp payment sent', { orderId, total });
          return { success: true };
        } else {
          logger.info('Not all items mapped to catalog, falling back to CTA payment', {
            orderId,
            mapped: retailerMappings.length,
            total: items.length
          });
        }
      } catch (nativePayErr) {
        logger.warn('Native WhatsApp payment failed, falling back to CTA', {
          orderId,
          error: nativePayErr.response?.data || nativePayErr.message
        });
      }
    }

    // Native payment failed — notify user
    await sendAdminPush();
    await whatsapp.sendMessage(phone, `⚠️ Unable to process payment. Please try again.`);
    return { success: false };
  },


  // ============ ORDER MANAGEMENT ============
  async sendOrderStatus(phone) {
    const orders = await Order.find({ 'customer.phone': phone }).sort({ createdAt: -1 }).limit(5);
    
    if (!orders.length) {
      const noOrdersFoundImageUrl = await chatbotImagesService.getImageUrl('no_orders_found');
      await whatsapp.sendMessage(phone, '📋 *No Orders Found*\n\nYou haven\'t placed any orders yet.');
      return;
    }

    const statusEmoji = {
      pending: '⏳', confirmed: '✅', preparing: '👨‍🍳', ready: '📦',
      out_for_delivery: '🛵', delivered: '✅', cancelled: '❌'
    };

    let msg = '📋 *Your Orders*\n\n';
    orders.forEach(o => {
      const isPickup = o.serviceType === 'pickup';
      const paymentLabel = o.paymentMethod === 'cod' 
        ? (isPickup ? '💵 Pay at Hotel' : '💵 COD')
        : '💳 Paid';
      
      // Show "Completed" for delivered pickup orders
      let statusText = o.status;
      if (o.status === 'delivered' && isPickup) {
        statusText = 'Completed';
      } else {
        const statusLabels = {
          pending: 'Pending', confirmed: 'Confirmed', preparing: 'Preparing', ready: 'Ready',
          out_for_delivery: 'On the Way', delivered: 'Delivered', cancelled: 'Cancelled'
        };
        statusText = statusLabels[o.status] || o.status.replace('_', ' ');
      }
      
      const serviceIcon = isPickup ? '🏪' : '🛵';
      
      msg += `${statusEmoji[o.status] || '•'} *${o.orderId}* ${serviceIcon}\n`;
      msg += `   ${statusText} | ₹${o.totalAmount} | ${paymentLabel}\n`;
      msg += `   ${new Date(o.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' })}\n\n`;
    });

    const yourOrdersImageUrl = await chatbotImagesService.getImageUrl('your_orders');
    await whatsapp.sendMessage(phone, msg);
  },

  async sendTrackingOptions(phone) {
    const orders = await Order.find({
      'customer.phone': phone,
      status: { $nin: ['delivered', 'cancelled'] }
    }).sort({ createdAt: -1 }).limit(5);

    if (!orders.length) {
      const noActiveOrdersImageUrl = await chatbotImagesService.getImageUrl('no_active_orders');
      await whatsapp.sendMessage(phone, '📍 *No Active Orders*\n\nNo orders to track right now.');
      return;
    }

    // If only 1 order, directly show tracking details
    if (orders.length === 1) {
      await this.sendTrackingDetails(phone, orders[0].orderId);
      return;
    }

    // Multiple orders - show list to choose
    const statusLabel = {
      pending: 'Pending', confirmed: 'Confirmed', preparing: 'Preparing', ready: 'Ready',
      out_for_delivery: 'On the Way', delivered: 'Delivered', cancelled: 'Cancelled'
    };
    const rows = orders.map(o => ({
      rowId: `track_${o.orderId}`,
      title: o.orderId,
      description: `₹${o.totalAmount} - ${statusLabel[o.status] || o.status.replace('_', ' ')}`
    }));

    await whatsapp.sendList(phone,
      'Track Order',
      `You have ${orders.length} active orders. Select which one to track.`,
      'Select Order',
      [{ title: 'Active Orders', rows }]
    );
  },

  async sendTrackingDetails(phone, orderId) {
    const order = await Order.findOne({ orderId, 'customer.phone': phone });
    
    if (!order) {
      const noOrdersImg = await chatbotImagesService.getImageUrl('no_orders_found');
      await whatsapp.sendMessage(phone, '❌ Order not found.');
      return;
    }

    const isPickup = order.serviceType === 'pickup';

    const statusEmoji = {
      pending: '⏳', confirmed: '✅', preparing: '👨‍🍳', ready: '📦',
      out_for_delivery: '🛵', delivered: '✅', cancelled: '❌'
    };
    const statusLabel = {
      pending: 'Pending', confirmed: 'Confirmed', preparing: 'Preparing', ready: 'Ready',
      out_for_delivery: 'On the Way', delivered: isPickup ? 'Completed' : 'Delivered', 
      cancelled: 'Cancelled'
    };

    // Different messages for pickup vs delivery
    let msg = isPickup 
      ? `🏪 *Pickup Order Tracking*\n\n`
      : `📍 *Order Tracking*\n\n`;
    
    msg += `Order: *${order.orderId}*\n`;
    msg += `Status: ${statusEmoji[order.status] || '•'} *${(statusLabel[order.status] || order.status.replace('_', ' ')).toUpperCase()}*\n`;
    msg += `Amount: ₹${order.totalAmount}\n`;
    
    if (isPickup) {
      msg += `Service: 🏪 *Self-Pickup*\n`;
    }
    
    msg += `\n━━━━━━━━━━━━━━━\n*Timeline:*\n\n`;
    
    order.trackingUpdates.forEach(u => {
      msg += `${statusEmoji[u.status] || '•'} ${u.message}\n`;
      msg += `   ${new Date(u.timestamp).toLocaleString('en-IN', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })}\n\n`;
    });

    // Show ETA only for delivery orders
    if (!isPickup && order.estimatedDeliveryTime) {
      msg += `⏰ *ETA:* ${new Date(order.estimatedDeliveryTime).toLocaleString('en-IN', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })}`;
    }

    // Use different images for pickup vs delivery tracking
    const imageKey = isPickup ? 'pickup_tracking' : 'order_tracking';
    const trackingImageUrl = await chatbotImagesService.getImageUrl(imageKey);
    
    await whatsapp.sendMessage(phone, msg);
  },

  async sendCancelOptions(phone) {
    // Can cancel only COD orders that are not delivered or cancelled
    // UPI/app payment orders cannot be cancelled by customer
    // Pickup orders can only be cancelled if status is 'pending' (before confirmation)
    const orders = await Order.find({
      'customer.phone': phone,
      status: { $in: ['pending', 'confirmed', 'preparing', 'ready', 'out_for_delivery'] },
      paymentMethod: 'cod'  // Only COD orders can be cancelled
    }).sort({ createdAt: -1 }).limit(5);

    // Filter out pickup orders that are already confirmed or beyond
    const cancellableOrders = orders.filter(order => {
      if (order.serviceType === 'pickup') {
        // Pickup orders can only be cancelled if pending
        return order.status === 'pending';
      }
      // Delivery orders can be cancelled at any stage before delivery
      return true;
    });

    if (cancellableOrders.length === 0) {
      const noOrdersImageUrl = await chatbotImagesService.getImageUrl('no_orders_found');
      await whatsapp.sendMessage(phone, '❌ *No Orders to Cancel*\n\nNo cancellable orders found.\n\n_Note: Only Cash on Delivery orders can be cancelled. Pickup orders can only be cancelled before confirmation._');
      return;
    }

    // If only 1 order, directly cancel it
    if (cancellableOrders.length === 1) {
      await this.processCancellation(phone, cancellableOrders[0].orderId);
      return;
    }

    // Multiple orders - show list to choose
    const rows = cancellableOrders.map(o => ({
      rowId: `cancel_${o.orderId}`,
      title: o.orderId,
      description: `₹${o.totalAmount} - ${o.status} - ${o.serviceType === 'pickup' ? 'Pickup' : 'Delivery'}`
    }));

    await whatsapp.sendList(phone,
      'Cancel Order',
      `You have ${cancellableOrders.length} cancellable orders. Select which one to cancel.`,
      'Select Order',
      [{ title: 'Your Orders', rows }],
      'This cannot be undone'
    );
  },

  async processCancellation(phone, orderId) {
    const order = await Order.findOne({ orderId, 'customer.phone': phone });
    
    if (!order) {
      const noOrdersImg = await chatbotImagesService.getImageUrl('no_orders_found');
      await whatsapp.sendMessage(phone, '❌ Order not found.');
      return;
    }

    // Cannot cancel delivered or already cancelled orders
    if (['delivered', 'cancelled'].includes(order.status)) {
      const orderCancelledImg = await chatbotImagesService.getImageUrl('order_cancelled');
      await whatsapp.sendMessage(phone, `❌ *Cannot Cancel*\n\nOrder is already ${order.status.replace('_', ' ')}.`);
      return;
    }

    // Pickup orders can only be cancelled if status is 'pending' (before confirmation)
    if (order.serviceType === 'pickup' && order.status !== 'pending') {
      const pickupCancelRestrictedImageUrl = await chatbotImagesService.getImageUrl('pickup_cancel_restricted');
      await whatsapp.sendMessage(phone, `❌ *Cannot Cancel Pickup Order*\n\nOrder ${orderId} has already been confirmed and is being prepared.\n\n🏪 Pickup orders can only be cancelled before confirmation.\n\nPlease contact the restaurant if you need assistance.`);
      return;
    }

    const txResult = transitionStatus(order, 'cancelled', 'Order cancelled by customer');
    if (!txResult.success) {
      logger.warn('Order cancellation transition blocked', { orderId, reason: txResult.reason });
    }
    order.cancellationReason = 'Customer requested';
    
    // Update payment status for COD orders
    if (order.paymentMethod === 'cod' && order.paymentStatus === 'pending') {
      order.paymentStatus = 'cancelled';
    }
    
    const isPickup = order.serviceType === 'pickup';
    let msg = isPickup 
      ? `✅ *Pickup Order Cancelled*\n\nOrder ${orderId} has been cancelled.`
      : `✅ *Order Cancelled*\n\nOrder ${orderId} has been cancelled.`;
    
    await order.save();
    
    // Emit event for real-time updates
    const dataEvents = require('./eventEmitter');
    dataEvents.emit('orders');
    dataEvents.emit('dashboard');

    // Send push notification to admin — customer cancelled (pickup or delivery)
    try {
      const User = require('../models/User');
      const pushNotification = require('./pushNotification');
      
      const typeLabel = isPickup ? '🏪 Pickup' : '🚚 Delivery';
      const admins = await User.find({ pushToken: { $ne: null } });
      for (const admin of admins) {
        if (admin.pushToken) {
          await pushNotification.sendNotification(
            admin.pushToken,
            `❌ ${typeLabel} Order Cancelled`,
            `Order #${order.orderId} - ₹${order.totalAmount}\n${order.customer?.name || 'Customer'} cancelled via WhatsApp`,
            { type: 'order_cancelled', orderId: order.orderId, screen: 'Orders' },
            'order-updates'
          );
        }
      }
    } catch (pushErr) {
      logger.error('Admin push error (customer cancel chatbot)', { error: pushErr.message });
    }

    // Notify assigned delivery partner if order was assigned
    if (order.assignedTo) {
      try {
        const DeliveryBoy = require('../models/DeliveryBoy');
        const pushNotification = require('./pushNotification');
        
        const deliveryBoy = await DeliveryBoy.findById(order.assignedTo);
        if (deliveryBoy && deliveryBoy.pushToken) {
          await pushNotification.sendOrderCancelledNotification(deliveryBoy.pushToken, {
            orderId: order.orderId,
            totalAmount: order.totalAmount
          });
          logger.info('Delivery partner notified of cancellation', { deliveryPartner: deliveryBoy.name });
        }
      } catch (pushErr) {
        logger.error('Delivery push error (customer cancel chatbot)', { error: pushErr.message });
      }
    }
    
    // Sync to Google Sheets
    googleSheets.updateOrderStatus(order.orderId, 'cancelled', order.paymentStatus).catch(err => 
      logger.error('Google Sheets sync error', { error: err.message })
    );
    logger.info('Customer cancelled order, syncing to Google Sheets', { order: order.orderId });

    // Use pickup-specific cancelled image if it's a pickup order
    const imageKey = isPickup ? 'pickup_cancelled' : 'order_cancelled';
    const cancelledImageUrl = await chatbotImagesService.getImageUrl(imageKey);
    
    // Send as flow with "Browse Menu" CTA if reorder flow is available
    const reorderFlowId = process.env.WHATSAPP_REORDER_FLOW_ID;
    if (reorderFlowId) {
      try {
        const metaCloud = require('./metaCloud');
        const cleanPhone = phone.replace('@c.us', '').replace(/\D/g, '');
        await metaCloud.sendFlowMessage(phone, {
          flowId: reorderFlowId,
          flowCta: 'Browse Menu',
          headerImageUrl: cancelledImageUrl || undefined,
          headerText: cancelledImageUrl ? undefined : 'Order Cancelled',
          bodyText: msg,
          flowToken: `reorder_${cleanPhone}`,
          flowAction: 'data_exchange'
        });
      } catch (flowErr) {
        logger.error('Reorder flow failed on cancel', { error: flowErr.message });
      }
    }
  },

  // ============ HELP ============
  async sendHelp(phone) {
    const msg = `❓ *Help & Support*\n\n` +
      `🍽️ *Ordering*\n` +
      `• Browse our delicious menu\n` +
      `• Place orders for delivery, pickup, or dine-in\n` +
      `• Easy payment options available\n\n` +
      `📦 *Order Management*\n` +
      `• Track your order status in real-time\n` +
      `• Cancel orders before preparation starts\n\n` +
      `💬 *Quick Commands*\n` +
      `• "hi" - Return to main menu\n` +
      `• "menu" - Browse our menu\n` +
      `• "cart" - View your cart\n` +
      `• "status" - Check order status\n\n` +
      `📞 *Need Immediate Assistance?*\n` +
      `Our support team is ready to help you with any questions or concerns!`;

    const helpSupportImageUrl = await chatbotImagesService.getImageUrl('help_support');
    const supportPhone = '+919440203095'; // Support phone number
    
    if (helpSupportImageUrl) {
      await whatsapp.sendImageWithCtaPhone(phone, helpSupportImageUrl, msg, '📞 Call Us Now', supportPhone, 'We\'re here to help! 🙂');
    } else {
      await whatsapp.sendCtaPhone(phone, msg, '📞 Call Us Now', supportPhone, 'We\'re here to help! 🙂');
    }
  },

  // ============ WEBSITE LINK ============
  async sendWebsiteLink(phone) {
    const websiteUrl = process.env.FRONTEND_URL || process.env.WEBSITE_URL;
    const msg = `🌐 *Visit Our Website*\n\n` +
      `Order delicious food directly from our website!\n\n` +
      `✨ Browse full menu with images\n` +
      `🛒 Easy ordering experience\n` +
      `📱 Mobile-friendly design`;

    const openWebsiteImageUrl = await chatbotImagesService.getImageUrl('open_website');
    await sendWithOptionalImageCta(phone, openWebsiteImageUrl, msg, 'Open Website', websiteUrl, 'Tap to visit');
  },

  // ============ VIEW OFFERS ============
  async sendViewOffers(phone) {
    const Offer = require('../models/Offer');
    const activeOffers = await Offer.find({ isActive: true }).lean();

    if (activeOffers.length === 0) {
      await whatsapp.sendMessage(phone, '🏷️ *No Active Offers*\n\nThere are no special offers right now.\n\nCheck back later for exciting deals!');
      return;
    }

    let offerMessage = `🏷️ *Current Offers & Deals*\n\n`;
    activeOffers.forEach((offer, i) => {
      offerMessage += `${i + 1}. *${offer.title || 'Special Offer'}*\n`;
      if (offer.description) offerMessage += `   ${offer.description}\n`;
      if (offer.code) offerMessage += `   🎟️ Code: *${offer.code}*\n`;
      if (offer.discountType === 'percentage' && offer.discountValue) {
        offerMessage += `   💰 ${offer.discountValue}% OFF\n`;
      } else if (offer.discountType === 'fixed' && offer.discountValue) {
        offerMessage += `   💰 ₹${offer.discountValue} OFF\n`;
      }
      offerMessage += '\n';
    });

    offerMessage += `Tap 'Order Food' to start ordering!`;

    await whatsapp.sendMessage(phone, offerMessage);
  },

  // ============ SERVICE TYPE SELECTION ============
  async sendServiceTypeSelection(phone) {
    const checkoutImg = await chatbotImagesService.getImageUrl('checkout');
    await whatsapp.sendMessage(phone, '🚚 *Choose Service Type*\n\nHow would you like to receive your order?');
  },

  // ============ PICKUP PAYMENT METHOD ============
  async sendPickupPaymentMethodOptions(phone, customer) {
    // Refresh customer from database to ensure we have latest cart data
    const freshCustomer = await Customer.findOne({ phone }).populate('cart.menuItem');
    if (!freshCustomer || !freshCustomer.cart?.length) {
      const cartEmptyImg = await chatbotImagesService.getImageUrl('cart_empty');
      await whatsapp.sendMessage(phone, '🛒 Your cart is empty!');
      return;
    }

    // Calculate total
    let total = 0;
    let totalDiscount = 0;
    const items = [];
    
    // Get customer's active offers
    const activeOffers = freshCustomer.activeOffers || [];
    
    for (const cartItem of freshCustomer.cart) {
      if (!cartItem.menuItem) continue;
      const item = cartItem.menuItem;
      let effectivePrice = item.offerPrice && item.offerPrice < item.price ? item.offerPrice : item.price;
      let itemDiscount = 0;
      let itemName = item.name;
      let itemUnit = item.unit || 'piece';
      let itemUnitQty = item.quantity || 1;
      let originalPrice = item.price;
      
      // Resolve variant-specific pricing and labels
      if (cartItem.variantIndex !== null && cartItem.variantIndex !== undefined && item.variants?.[cartItem.variantIndex]) {
        const variant = item.variants[cartItem.variantIndex];
        if (cartItem.quantityIndex !== null && cartItem.quantityIndex !== undefined && variant.quantities?.[cartItem.quantityIndex]) {
          const q = variant.quantities[cartItem.quantityIndex];
          originalPrice = q.price;
          effectivePrice = q.offerPrice && q.offerPrice < q.price ? q.offerPrice : q.price;
          itemName = `${item.name} - ${variant.label} (${q.quantity} ${q.unit})`;
          itemUnit = q.unit || variant.unit || item.unit || 'piece';
          itemUnitQty = q.quantity || 1;
        } else {
          originalPrice = variant.price;
          effectivePrice = variant.offerPrice && variant.offerPrice < variant.price
            ? variant.offerPrice : variant.price;
          itemName = `${item.name} - ${variant.label} (${variant.quantity || 1} ${variant.unit || item.unit || 'piece'})`;
          itemUnit = variant.unit || item.unit || 'piece';
          itemUnitQty = variant.quantity || 1;
        }
      }
      
      // If no offerPrice, check customer's activeOffers for applicable discount
      if (!(item.offerPrice && item.offerPrice < item.price) && activeOffers.length > 0) {
        const offerResult = calculateOfferDiscount(item, activeOffers);
        if (offerResult.discountedPrice !== null) {
          effectivePrice = offerResult.discountedPrice;
          itemDiscount = offerResult.discountAmount * cartItem.quantity;
        }
      }
      
      const itemTotal = effectivePrice * cartItem.quantity;
      total += itemTotal;
      totalDiscount += itemDiscount;
      items.push({
        name: itemName,
        quantity: cartItem.quantity,
        price: effectivePrice,
        unit: itemUnit,
        unitQty: itemUnitQty
      });
    }

    // Build order summary message
    let msg = '📋 *Order Summary (Self-Pickup)*\n\n';
    items.forEach((item, index) => {
      msg += `${index + 1}. *${item.name}*\n`;
      msg += `   Qty: ${item.quantity} × ₹${item.price} = ₹${item.price * item.quantity}\n\n`;
    });
    msg += `━━━━━━━━━━━━━━━\n`;
    msg += `💰 *Total: ₹${total}*\n`;
    if (totalDiscount > 0) {
      msg += `🎁 *You Save: ₹${totalDiscount}*\n`;
    }
    msg += '\n🏪 *Pickup Location:* Restaurant\n\n';
    msg += '💳 *Choose Payment Method:*';

    // Get pickup order summary image
    const pickupOrderSummaryImageUrl = await chatbotImagesService.getImageUrl('pickup_order_summary');
    await whatsapp.sendMessage(phone, msg);
  },

  // ============ PROCESS PICKUP CHECKOUT ============
  async processPickupCheckout(phone, customer, state) {
    // Order creation dedup — prevent double-tap creating duplicate orders
    const orderDedup = idempotencyService.checkOrderOperation(
      phone, 'pickup_checkout', { serviceType: 'pickup' }
    );
    if (orderDedup.isDuplicate) {
      logger.warn('Duplicate pickup order creation prevented', { phone });
      await whatsapp.sendMessage(phone, '⏳ Your order is already being processed. Please wait.');
      return { success: false };
    }

    try {
      // Refresh customer from database
      const freshCustomer = await Customer.findOne({ phone }).populate('cart.menuItem');
      if (!freshCustomer || !freshCustomer.cart?.length) {
        const cartEmptyImg = await chatbotImagesService.getImageUrl('cart_empty');
        await whatsapp.sendMessage(phone, '🛒 Your cart is empty!');
        return { success: false };
      }

      // Calculate total and prepare items
      let itemsTotal = 0;
      let totalDiscount = 0;
      let appliedOfferIds = new Set();
      const items = [];
      
      // Get customer's active offers
      const activeOffers = freshCustomer.activeOffers || [];
      
      for (const cartItem of freshCustomer.cart) {
        if (!cartItem.menuItem) continue;
        const item = cartItem.menuItem;
        let effectivePrice = item.offerPrice && item.offerPrice < item.price ? item.offerPrice : item.price;
        let itemDiscount = 0;
        let appliedOfferId = null;
        let itemName = item.name;
        let itemUnit = item.unit || 'piece';
        let itemUnitQty = item.quantity || 1;
        let originalPrice = item.price;
        
        // Resolve variant-specific pricing and labels
        if (cartItem.variantIndex !== null && cartItem.variantIndex !== undefined && item.variants?.[cartItem.variantIndex]) {
          const variant = item.variants[cartItem.variantIndex];
          if (cartItem.quantityIndex !== null && cartItem.quantityIndex !== undefined && variant.quantities?.[cartItem.quantityIndex]) {
            const q = variant.quantities[cartItem.quantityIndex];
            originalPrice = q.price;
            effectivePrice = q.offerPrice && q.offerPrice < q.price ? q.offerPrice : q.price;
            itemName = `${item.name} - ${variant.label} (${q.quantity} ${q.unit})`;
            itemUnit = q.unit || variant.unit || item.unit || 'piece';
            itemUnitQty = q.quantity || 1;
          } else {
            originalPrice = variant.price;
            effectivePrice = variant.offerPrice && variant.offerPrice < variant.price
              ? variant.offerPrice : variant.price;
            itemName = `${item.name} - ${variant.label} (${variant.quantity || 1} ${variant.unit || item.unit || 'piece'})`;
            itemUnit = variant.unit || item.unit || 'piece';
            itemUnitQty = variant.quantity || 1;
          }
        }
        
        // If no offerPrice, check customer's activeOffers for applicable discount
        if (!(item.offerPrice && item.offerPrice < item.price) && activeOffers.length > 0) {
          const offerResult = calculateOfferDiscount(item, activeOffers);
          if (offerResult.discountedPrice !== null) {
            effectivePrice = offerResult.discountedPrice;
            itemDiscount = offerResult.discountAmount * cartItem.quantity;
            if (offerResult.appliedOffer?.offerId) {
              appliedOfferId = offerResult.appliedOffer.offerId;
              appliedOfferIds.add(offerResult.appliedOffer.offerId.toString());
            }
          }
        }
        
        const itemTotal = Math.round(effectivePrice * cartItem.quantity * 100) / 100;
        itemsTotal += itemTotal;
        totalDiscount += itemDiscount;
        
        // Use variant-specific image if available, else parent item image
        let itemImage = item.image;
        if (cartItem.variantIndex !== null && cartItem.variantIndex !== undefined && item.variants?.[cartItem.variantIndex]?.image) {
          itemImage = item.variants[cartItem.variantIndex].image;
        }
        
        items.push({
          menuItem: item._id,
          name: itemName,
          quantity: cartItem.quantity,
          price: effectivePrice,
          originalPrice,
          unit: itemUnit,
          unitQty: itemUnitQty,
          image: itemImage,
          variantIndex: cartItem.variantIndex ?? null,
          variantLabel: cartItem.variantLabel || null,
          quantityIndex: cartItem.quantityIndex ?? null,
          appliedOfferId
        });
      }

      // Create order
      const orderId = generateOrderId('pickup');
      setMetadata('orderId', orderId);
      setMetadata('phone', freshCustomer.phone);
      logger.info('Order created', { orderId, serviceType: 'pickup', phone: freshCustomer.phone, via: 'pickup' });
      const order = new Order({
        orderId,
        customer: {
          phone: freshCustomer.phone,
          name: freshCustomer.name || 'Customer',
          email: freshCustomer.email
        },
        deliveryAddress: {
          address: 'Self-Pickup at Restaurant'
        },
        items,
        itemsTotal,
        deliveryCharge: 0,
        deliveryDistance: null,
        totalAmount: Math.round(itemsTotal * 100) / 100,
        discountAmount: totalDiscount,
        appliedOfferIds: Array.from(appliedOfferIds),
        serviceType: 'pickup',
        paymentMethod: state.paymentMethod || 'cod',
        paymentStatus: 'pending',
        status: 'pending',
        trackingUpdates: [{ status: 'pending', message: 'Pickup order created, awaiting confirmation' }]
      });

      // Transaction-based checkout: order.save() + cart clear are atomic
      const pickupUpdate = { 
        $set: { cart: [], 'conversationState.currentStep': 'order_placed' },
        $push: { orderHistory: order._id }
      };
      if (appliedOfferIds.size > 0) {
        pickupUpdate.$pull = { activeOffers: { offerId: { $in: Array.from(appliedOfferIds) } } };
      }
      if (!freshCustomer.hasOrdered) {
        pickupUpdate.$set.hasOrdered = true;
      }
      try {
        await transactionManager.execute(async (session) => {
          await order.save({ session });
          await Customer.findOneAndUpdate({ phone }, pickupUpdate, { session });
        });
      } catch (txErr) {
        if (txErr.message?.includes('transaction') || txErr.code === 263 || txErr.message?.includes('replica set')) {
          logger.warn('Transactions not supported, falling back to sequential', { error: txErr.message });
          await order.save();
          await Customer.findOneAndUpdate({ phone }, pickupUpdate);
        } else {
          throw txErr;
        }
      }

      // Mark order creation as processed (dedup)
      orderDedup.mark();

      logger.info('Pickup order created', { orderId });

      // Add to WhatsApp broadcast contacts
      await whatsappBroadcast.addContact(freshCustomer.phone, freshCustomer.name, new Date());

      // Track today's orders count
      try {
        const DashboardStats = require('../models/DashboardStats');
        const now = new Date();
        const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        await DashboardStats.findOneAndUpdate(
          {},
          { $inc: { todayOrders: 1 }, $set: { todayDate: todayStr, lastUpdated: new Date() } },
          { upsert: true }
        );
      } catch (statsErr) {
        logger.error('Error tracking today orders', { error: statsErr.message, stack: statsErr.stack });
      }

      // In-memory update for state consistency (DB already updated atomically above)
      freshCustomer.cart = [];
      freshCustomer.conversationState = { currentStep: 'order_placed' };

      // Send confirmation message — keep body short; full item list is shown
      // inside the Order Actions flow (ORDER_DETAILS screen) accessible via the
      // "Order Details" CTA button below.
      let msg = '✅ *Order Request Successful!*\n\n';
      msg += `📦 Order ID: *${orderId}*\n`;
      msg += `🏪 Service: *Self-Pickup*\n`;
      msg += `💰 Total: *₹${itemsTotal}*\n`;
      msg += `💳 Payment: *${state.paymentMethod === 'cod' ? 'Pay at Hotel' : 'UPI/App'}*\n\n`;

      if (state.paymentMethod === 'cod') {
        msg += '✨ Your order has been received!\n\n';
        msg += '📍 Please come to the restaurant to pick up your order.\n';
        msg += '💵 Payment will be collected at the hotel.\n\n';
        msg += '⏰ We will notify you when your order is ready!\n\n';
        msg += '🛒 Tap *Order Details* below to view your items.\n\n';
        msg += 'Thank you for your order! 🙏';
      } else {
        msg += '⏳ Waiting for payment confirmation...\n\n';
        msg += 'Please complete the payment to confirm your order.';
      }

      // Get pickup order requested image and send with flow CTA or buttons
      const pickupOrderRequestedImageUrl = await chatbotImagesService.getImageUrl('pickup_order_requested');
      const orderActionsFlowId = process.env.WHATSAPP_ORDER_ACTIONS_FLOW_ID;
      if (orderActionsFlowId) {
        try {
          const metaCloud = require('./metaCloud');
          const cleanPhone = phone.replace('@c.us', '').replace(/\D/g, '');
          await metaCloud.sendFlowMessage(phone, {
            flowId: orderActionsFlowId,
            flowCta: 'Order Details',
            headerImageUrl: pickupOrderRequestedImageUrl || undefined,
            headerText: pickupOrderRequestedImageUrl ? undefined : 'Order Request',
            bodyText: msg,
            flowToken: `order_actions_${cleanPhone}_${orderId}`,
            flowAction: 'data_exchange'
          });
        } catch (flowErr) {
          logger.error('Order actions flow failed on pickup confirm', { error: flowErr.message });
        }
      }

      // Mark WhatsApp confirmation sent for reconciliation
      order.whatsappConfirmationSent = true;
      await order.save();

      // Emit event for real-time updates (SSE)
      const dataEvents = require('./eventEmitter');
      dataEvents.emit('orders');
      dataEvents.emit('dashboard');

      // Sync to Google Sheets
      googleSheets.addOrder(order).catch(err =>
        logger.error('Google Sheets sync error', { error: err.message })
      );
      
      // Update daily report in real-time
      googleSheets.syncTodayDailyReport().catch(err => logger.error('Daily report sync error', { error: err.message }));

      // Send push notification to admin for new pickup order
      try {
        const User = require('../models/User');
        const pushNotification = require('./pushNotification');
        
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
        if (admins.length > 0) logger.info('Admin push sent for pickup order', { orderId });
      } catch (pushErr) {
        logger.error('Admin push error', { error: pushErr.message });
      }

      // Update customer order history
      freshCustomer.orderHistory = freshCustomer.orderHistory || [];
      freshCustomer.orderHistory.push(order._id);
      await freshCustomer.save();

      return { success: true, orderId };
    } catch (error) {
      logger.error('Pickup checkout error', { error: error.message });
      const helpImg = await chatbotImagesService.getImageUrl('help_support');
      await whatsapp.sendMessage(phone, '❌ Failed to process your order. Please try again.');
      return { success: false };
    }
  },

  // ==================== ACCOUNT DETAILS METHODS ====================

  /**
   * Handle the Account Details form response from the Flow.
   */
  async handleAccountFormResponse(phone, customer, flowData) {
    const { customer_name, customer_phone, customer_email } = flowData;

    // Update customer profile
    if (customer_name) customer.name = customer_name.trim();
    if (customer_email) customer.email = customer_email.trim();
    // Don't overwrite phone — it's the primary key
    await customer.save();

    logger.info('Account details saved from Flow', { phone, name: customer.name, email: customer.email });

    let confirmMsg = `✅ *Account Details Saved!*\n\n`;
    confirmMsg += `📛 *Name:* ${customer.name}\n`;
    const displayPhone = phone.length > 10 ? phone.slice(-10) : phone;
    confirmMsg += `📱 *Mobile:* ${displayPhone}\n`;
    if (customer.email) {
      confirmMsg += `📧 *Email:* ${customer.email}\n`;
    }
    confirmMsg += `\nYour profile has been updated. You can view or edit it anytime from the welcome menu.`;

    await whatsapp.sendMessage(phone, confirmMsg);

    // Send welcome flow so user can browse menu
    await this.sendWelcome(phone);
  }
};

module.exports = chatbot;


