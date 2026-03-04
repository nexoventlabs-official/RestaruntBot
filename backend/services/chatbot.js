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

// ============ TRANSLATION CACHE for Groq AI ============
// Caches AI translation results to avoid repeated API calls for the same text.
// 5-minute TTL, max 200 entries. Huge win for repeated searches.
const _translationCache = new Map();
const TRANSLATION_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const TRANSLATION_CACHE_MAX = 200;

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
  // Supports: English, Hindi, Telugu, Tamil, Kannada, Malayalam, Bengali, Marathi, Gujarati
  // Enhanced with voice recognition alternatives
  isCancelIntent(text) {
    if (!text) return false;
    const lowerText = ' ' + text.toLowerCase() + ' ';
    const cancelPatterns = [
      // ========== ENGLISH - Primary patterns ==========
      /\bcancel\b/, /\bcancel order\b/, /\bcancel my order\b/, /\bcancel the order\b/, /\bcancel item\b/,
      /\bremove order\b/, /\bstop order\b/, /\bdon'?t want\b/, /\bdont want\b/, /\bno need\b/,
      /\bcancel it\b/, /\bcancel this\b/, /\bcancel that\b/, /\bplease cancel\b/,
      /\bi want to cancel\b/, /\bi want cancel\b/, /\bwant to cancel\b/, /\bwant cancel\b/,
      /\bneed to cancel\b/, /\bhave to cancel\b/, /\bcan you cancel\b/, /\bcould you cancel\b/,
      /\bcancel please\b/, /\bcancel pls\b/, /\bcancel plz\b/,
      // Voice recognition alternatives for "cancel"
      /\bkansil\b/, /\bkancel\b/, /\bcancil\b/, /\bcancal\b/, /\bcansal\b/, /\bcansil\b/,
      /\bkensel\b/, /\bkencel\b/, /\bcancel\b/, /\bcancell\b/,
      // "cancel my order" voice alternatives
      /\bcancel my\b/, /\bkansil my\b/, /\bcansal my\b/, /\bcancil my\b/,
      /\bcancel mai\b/, /\bcancel meri\b/, /\bcancel mera\b/,
      // ========== HINDI ==========
      /\bcancel karo\b/, /\bcancel kar do\b/, /\border cancel\b/, /\bcancel करो\b/,
      /\bऑर्डर कैंसल\b/, /\bकैंसल\b/, /\bरद्द करो\b/, /\bरद्द कर दो\b/,
      /\bcancel karna hai\b/, /\bcancel karna\b/, /\bcancel chahiye\b/,
      /\border cancel karo\b/, /\border cancel kar do\b/, /\bmera order cancel\b/,
      /\bcancel kar dijiye\b/, /\bcancel karwa do\b/, /\bcancel karwao\b/,
      /\bband karo\b/, /\bband kar do\b/, /\border band karo\b/,
      // ========== TELUGU ==========
      /\bcancel cheyyi\b/, /\bcancel cheyyandi\b/, /\border cancel cheyyi\b/,
      /\bక్యాన్సల్\b/, /\bఆర్డర్ క్యాన్సల్\b/, /\bరద్దు చేయండి\b/, /\bరద్దు\b/,
      /\bcancel chey\b/, /\bcancel chesko\b/, /\bcancel cheyali\b/,
      /\bnaa order cancel\b/, /\border cancel cheyyandi\b/,
      // ========== TAMIL ==========
      /\bcancel pannunga\b/, /\bcancel pannu\b/, /\border cancel\b/,
      /\bகேன்சல்\b/, /\bஆர்டர் கேன்சல்\b/, /\bரத்து செய்\b/, /\bரத்து\b/,
      /\bcancel panna\b/, /\bcancel pannanum\b/, /\bcancel pannunga\b/,
      /\ben order cancel\b/, /\border cancel pannunga\b/,
      // ========== KANNADA ==========
      /\bcancel maadi\b/, /\border cancel maadi\b/,
      /\bಕ್ಯಾನ್ಸಲ್\b/, /\bಆರ್ಡರ್ ಕ್ಯಾನ್ಸಲ್\b/, /\bರದ್ದು\b/,
      /\bcancel madu\b/, /\bcancel madbeku\b/, /\bnanna order cancel\b/,
      // ========== MALAYALAM ==========
      /\bcancel cheyyuka\b/, /\bക്യാൻസൽ\b/, /\bഓർഡർ ക്യാൻസൽ\b/, /\bറദ്ദാക്കുക\b/,
      /\bcancel cheyyu\b/, /\bcancel cheyyane\b/, /\bente order cancel\b/,
      // ========== BENGALI ==========
      /\bcancel koro\b/, /\bক্যান্সেল\b/, /\bঅর্ডার ক্যান্সেল\b/, /\bবাতিল করো\b/,
      /\bcancel kore dao\b/, /\bcancel korte chai\b/, /\bamar order cancel\b/,
      // ========== MARATHI ==========
      /\bcancel kara\b/, /\bकॅन्सल करा\b/, /\bऑर्डर कॅन्सल\b/, /\bरद्द करा\b/,
      /\bcancel karaycha\b/, /\bcancel karun dya\b/, /\bmaza order cancel\b/,
      // ========== GUJARATI ==========
      /\bcancel karo\b/, /\bકેન્સલ\b/, /\bઓર્ડર કેન્સલ\b/, /\bરદ કરો\b/,
      /\bcancel karvu\b/, /\bcancel kari do\b/, /\bmaru order cancel\b/,
      // ========== MIXED PATTERNS ==========
      /\bcancel krdo\b/, /\bcancel krna\b/, /\bcancel krne\b/,
      /\border ko cancel\b/, /\border cancel krdo\b/, /\border cancel krna\b/,
      /\bplz cancel\b/, /\bpls cancel\b/, /\bplease cancel order\b/,
      /\bi dont want order\b/, /\bi don't want order\b/, /\bi dont want this order\b/
    ];
    return cancelPatterns.some(pattern => pattern.test(lowerText));
  },

  // Helper to detect cart intent from text/voice
  // Handles voice recognition mistakes like "card", "cut", "kart", "cot", "caught", "cat", "court" instead of "cart"
  // Also handles "items" variations in all languages
  isCartIntent(text) {
    if (!text) return false;
    const lowerText = ' ' + text.toLowerCase() + ' ';
    
    // IMPORTANT: First check if this is a cancel intent - those take priority
    if (this.isCancelIntent(text)) {
      return false;
    }
    
    const cartPatterns = [
      // ========== ENGLISH - ALL VOICE MISTAKES ==========
      // Cart variations (cart, card, cut, kart, cot, caught, cat, court, art, heart, part, curt, coat, cart)
      /\bmy cart\b/, /\bview cart\b/, /\bshow cart\b/, /\bsee cart\b/, /\bcheck cart\b/, /\bopen cart\b/,
      /\bmy card\b/, /\bview card\b/, /\bshow card\b/, /\bsee card\b/, /\bcheck card\b/, /\bopen card\b/,
      /\bmy cut\b/, /\bview cut\b/, /\bshow cut\b/, /\bsee cut\b/, /\bcheck cut\b/,
      /\bmy kart\b/, /\bview kart\b/, /\bshow kart\b/, /\bsee kart\b/, /\bcheck kart\b/,
      /\bmy cot\b/, /\bview cot\b/, /\bshow cot\b/, /\bsee cot\b/,
      /\bmy caught\b/, /\bview caught\b/, /\bshow caught\b/, /\bsee caught\b/,
      /\bmy cat\b/, /\bview cat\b/, /\bshow cat\b/, /\bsee cat\b/,
      /\bmy court\b/, /\bview court\b/, /\bshow court\b/, /\bsee court\b/,
      // "art" - very common voice mistake for "cart" (view my art = view my cart)
      /\bmy art\b/, /\bview art\b/, /\bshow art\b/, /\bsee art\b/, /\bcheck art\b/, /\bopen art\b/,
      /\bview my art\b/, /\bshow my art\b/, /\bsee my art\b/, /\bcheck my art\b/,
      // "heart" - voice mistake for "cart"
      /\bmy heart\b/, /\bview heart\b/, /\bshow heart\b/, /\bsee heart\b/,
      /\bview my heart\b/, /\bshow my heart\b/, /\bsee my heart\b/,
      // "part" - voice mistake for "cart"
      /\bmy part\b/, /\bview part\b/, /\bshow part\b/, /\bsee part\b/,
      /\bview my part\b/, /\bshow my part\b/, /\bsee my part\b/,
      // "curt" - voice mistake for "cart"
      /\bmy curt\b/, /\bview curt\b/, /\bshow curt\b/, /\bsee curt\b/,
      // "coat" - voice mistake for "cart"
      /\bmy coat\b/, /\bview coat\b/, /\bshow coat\b/, /\bsee coat\b/,
      // "cart" with extra letters (cartt, carrt, caart)
      /\bmy cartt\b/, /\bview cartt\b/, /\bmy caart\b/, /\bview caart\b/,
      // "got" - voice mistake for "cart" (view my got)
      /\bview my got\b/, /\bshow my got\b/, /\bsee my got\b/,
      // "guard" - voice mistake for "cart"
      /\bmy guard\b/, /\bview guard\b/, /\bshow guard\b/, /\bview my guard\b/,
      // Items variations (but NOT "cancel my order" type patterns)
      /\bmy items\b/, /\bshow items\b/, /\bview items\b/, /\bsee items\b/, /\bcheck items\b/,
      /\bshow my items\b/, /\bview my items\b/, /\bsee my items\b/, /\bcheck my items\b/,
      /\bmy order items\b/,
      // Basket variations
      /\bmy basket\b/, /\bshow basket\b/, /\bview basket\b/, /\bsee basket\b/,
      // What's in cart
      /\bwhat'?s in my cart\b/, /\bwhats in cart\b/, /\bwhat'?s in cart\b/,
      /\bwhat'?s in my card\b/, /\bwhats in card\b/, /\bwhat in cart\b/, /\bwhat in card\b/,
      /\bwhat'?s in my art\b/, /\bwhats in art\b/, /\bwhat in art\b/,
      // "view" misheard as "you", "few", "v", "vew", "veiw", "viu"
      /\byou cart\b/, /\byou my cart\b/, /\byou card\b/, /\byou my card\b/,
      /\bfew cart\b/, /\bfew my cart\b/, /\bfew card\b/,
      /\bvew cart\b/, /\bvew my cart\b/, /\bveiw cart\b/, /\bveiw my cart\b/,
      /\bviu cart\b/, /\bviu my cart\b/, /\bvu cart\b/, /\bvu my cart\b/,
      /\byou art\b/, /\byou my art\b/, /\bfew art\b/, /\bfew my art\b/,
      /\bvew art\b/, /\bvew my art\b/, /\bveiw art\b/, /\bveiw my art\b/,
      // "view cart" without space or with typos
      /\bviewcart\b/, /\bviewcard\b/, /\bviewart\b/, /\bshowcart\b/, /\bshowcard\b/,
      // Standalone words (only match if short message)
      /^cart$/, /^card$/, /^kart$/, /^items$/, /^basket$/, /^art$/,
      // Short phrases that mean "view cart"
      /^view cart$/, /^view my cart$/, /^show cart$/, /^show my cart$/,
      /^view card$/, /^view my card$/, /^show card$/, /^show my card$/,
      /^view art$/, /^view my art$/, /^show art$/, /^show my art$/,
      /^my cart$/, /^my card$/, /^my art$/,
      
      // ========== HINDI ==========
      /\bcart me kya hai\b/, /\bcart dikhao\b/, /\bcart dekho\b/, /\bmera cart\b/, /\bcart dekhao\b/,
      /\bcard me kya hai\b/, /\bcard dikhao\b/, /\bcard dekho\b/, /\bmera card\b/, /\bcard dekhao\b/,
      /\bमेरा कार्ट\b/, /\bकार्ट\b/, /\bकार्ट दिखाओ\b/, /\bकार्ट में क्या है\b/, /\bकार्ट देखो\b/,
      /\bआइटम दिखाओ\b/, /\bमेरे आइटम\b/, /\bसामान दिखाओ\b/, /\bमेरा सामान\b/, /\bआइटम्स दिखाओ\b/,
      /\bitems dikhao\b/, /\bmere items\b/, /\bsaman dikhao\b/, /\bmera saman\b/,
      
      // ========== TELUGU ==========
      /\bcart chupinchu\b/, /\bnaa cart\b/, /\bcart chudu\b/, /\bcart choodu\b/,
      /\bcard chupinchu\b/, /\bnaa card\b/, /\bcard chudu\b/,
      /\bకార్ట్\b/, /\bనా కార్ట్\b/, /\bకార్ట్ చూపించు\b/, /\bకార్ట్ చూడు\b/,
      /\bనా ఐటమ్స్\b/, /\bఐటమ్స్ చూపించు\b/, /\bఐటమ్స్ చూడు\b/, /\bసామాన్లు చూపించు\b/,
      /\bitems chupinchu\b/, /\bnaa items\b/, /\bsamanlu chupinchu\b/,
      
      // ========== TAMIL ==========
      /\bcart kaattu\b/, /\ben cart\b/, /\bcart paaru\b/, /\bcart kaatu\b/,
      /\bcard kaattu\b/, /\ben card\b/, /\bcard paaru\b/,
      /\bகார்ட்\b/, /\bஎன் கார்ட்\b/, /\bகார்ட் காட்டு\b/, /\bகார்ட் பாரு\b/,
      /\bஎன் ஐட்டம்ஸ்\b/, /\bஐட்டம்ஸ் காட்டு\b/, /\bபொருட்கள் காட்டு\b/,
      /\bitems kaattu\b/, /\ben items\b/, /\bporulgal kaattu\b/,
      
      // ========== KANNADA ==========
      /\bcart toorisu\b/, /\bnanna cart\b/, /\bcart nodu\b/, /\bcart thoorisu\b/,
      /\bcard toorisu\b/, /\bnanna card\b/, /\bcard nodu\b/,
      /\bಕಾರ್ಟ್\b/, /\bನನ್ನ ಕಾರ್ಟ್\b/, /\bಕಾರ್ಟ್ ತೋರಿಸು\b/, /\bಕಾರ್ಟ್ ನೋಡು\b/,
      /\bನನ್ನ ಐಟಮ್ಸ್\b/, /\bಐಟಮ್ಸ್ ತೋರಿಸು\b/, /\bಸಾಮಾನು ತೋರಿಸು\b/,
      /\bitems toorisu\b/, /\bnanna items\b/, /\bsamanu toorisu\b/,
      
      // ========== MALAYALAM ==========
      /\bcart kaanikkuka\b/, /\bente cart\b/, /\bcart kaanu\b/, /\bcart kanikkuka\b/,
      /\bcard kaanikkuka\b/, /\bente card\b/, /\bcard kaanu\b/,
      /\bകാർട്ട്\b/, /\bഎന്റെ കാർട്ട്\b/, /\bകാർട്ട് കാണിക്കുക\b/, /\bകാർട്ട് കാണു\b/,
      /\bഎന്റെ ഐറ്റംസ്\b/, /\bഐറ്റംസ് കാണിക്കുക\b/, /\bസാധനങ്ങൾ കാണിക്കുക\b/,
      /\bitems kaanikkuka\b/, /\bente items\b/, /\bsadhanangal kaanikkuka\b/,
      
      // ========== BENGALI ==========
      /\bcart dekho\b/, /\bamar cart\b/, /\bcart dekhao\b/, /\bcart dao\b/,
      /\bcard dekho\b/, /\bamar card\b/, /\bcard dekhao\b/,
      /\bকার্ট\b/, /\bআমার কার্ট\b/, /\bকার্ট দেখো\b/, /\bকার্ট দেখাও\b/,
      /\bআমার আইটেম\b/, /\bআইটেম দেখো\b/, /\bজিনিস দেখো\b/,
      /\bitems dekho\b/, /\bamar items\b/, /\bjinis dekho\b/,
      
      // ========== MARATHI ==========
      /\bcart dakhva\b/, /\bmaza cart\b/, /\bcart bagha\b/, /\bcart dakhava\b/,
      /\bcard dakhva\b/, /\bmaza card\b/, /\bcard bagha\b/,
      /\bकार्ट\b/, /\bमाझा कार्ट\b/, /\bकार्ट दाखवा\b/, /\bकार्ट बघा\b/,
      /\bमाझे आइटम\b/, /\bआइटम दाखवा\b/, /\bसामान दाखवा\b/,
      /\bitems dakhva\b/, /\bmaze items\b/, /\bsaman dakhva\b/,
      
      // ========== GUJARATI ==========
      /\bcart batavo\b/, /\bmaru cart\b/, /\bcart juo\b/, /\bcart batao\b/,
      /\bcard batavo\b/, /\bmaru card\b/, /\bcard juo\b/,
      /\bકાર્ટ\b/, /\bમારું કાર્ટ\b/, /\bકાર્ટ બતાવો\b/, /\bકાર્ટ જુઓ\b/,
      /\bમારા આઇટમ્સ\b/, /\bઆઇટમ્સ બતાવો\b/, /\bસામાન બતાવો\b/,
      /\bitems batavo\b/, /\bmara items\b/, /\bsaman batavo\b/,
      
      // ========== MIXED LANGUAGE PATTERNS (Hinglish/Tanglish/etc.) ==========
      // "dekhna hai" / "dekhna" style (want to see)
      /\bcart dekhna hai\b/, /\bcart dekhna\b/, /\bcard dekhna hai\b/, /\bcard dekhna\b/,
      /\bitems dekhna hai\b/, /\bitems dekhna\b/, /\bsaman dekhna hai\b/,
      // "chahiye" / "chai" style (want/need)
      /\bcart dekhna chahiye\b/, /\bcart chahiye\b/, /\bcard chahiye\b/,
      /\bitems dekhna chahiye\b/, /\bitems chahiye\b/, /\bmy items chahiye\b/,
      /\bcart show chai\b/, /\bitems show chai\b/, /\bcart dikhao chai\b/,
      // "karo" / "kar do" / "do" style (please do)
      /\bcart show karo\b/, /\bcart show kar do\b/, /\bcard show karo\b/,
      /\bitems show karo\b/, /\bitems show kar do\b/, /\bitems dikhao na\b/,
      /\bcart dikha do\b/, /\bcard dikha do\b/, /\bitems dikha do\b/,
      // "mujhe" / "mera" / "mere" style (my/mine)
      /\bmujhe cart dikhao\b/, /\bmujhe items dikhao\b/, /\bmujhe cart show karo\b/,
      /\bmera cart dikhao\b/, /\bmera cart show\b/, /\bmera card dikhao\b/,
      /\bmere items dikhao\b/, /\bmere items show\b/, /\bmere saman dikhao\b/,
      // Telugu mixed (chupinchu/chudu at end)
      /\bcart show chupinchu\b/, /\bitems show chupinchu\b/, /\bcart chudu\b/,
      /\bitems chudu\b/, /\bnaa cart chudu\b/, /\bnaa items chudu\b/,
      // Tamil mixed (kaattu/paaru at end)
      /\bcart show kaattu\b/, /\bitems show kaattu\b/, /\bcart paaru\b/,
      /\bitems paaru\b/, /\ben cart paaru\b/, /\ben items paaru\b/,
      // Kannada mixed (toorisu/nodu at end)
      /\bcart show toorisu\b/, /\bitems show toorisu\b/, /\bcart nodu\b/,
      /\bitems nodu\b/, /\bnanna cart nodu\b/, /\bnanna items nodu\b/,
      // Bengali mixed (dekho/dekhao at end)
      /\bcart show dekho\b/, /\bitems show dekho\b/, /\bcart dekhao na\b/,
      /\bitems dekhao na\b/, /\bamar cart dekho\b/, /\bamar items dekho\b/,
      // Marathi mixed (dakhva/bagha at end)
      /\bcart show dakhva\b/, /\bitems show dakhva\b/, /\bcart bagha na\b/,
      /\bitems bagha na\b/, /\bmaza cart bagha\b/, /\bmaze items bagha\b/,
      // Gujarati mixed (batavo/juo at end)
      /\bcart show batavo\b/, /\bitems show batavo\b/, /\bcart juo na\b/,
      /\bitems juo na\b/, /\bmaru cart juo\b/, /\bmara items juo\b/,
      // "please" mixed patterns
      /\bplease show cart\b/, /\bplease show items\b/, /\bplease show my cart\b/,
      /\bcart show please\b/, /\bitems show please\b/, /\bmy cart please\b/,
      // "want to" patterns
      /\bwant to see cart\b/, /\bwant to see items\b/, /\bwant to view cart\b/,
      /\bi want see cart\b/, /\bi want see items\b/, /\bi want my cart\b/,
      // Short forms
      /\bshw cart\b/, /\bshw items\b/, /\bvw cart\b/, /\bvw items\b/
    ];
    return cartPatterns.some(pattern => pattern.test(lowerText));
  },

  // Helper to detect simple/standalone cart keyword (e.g., just "cart" without "my", "view", "show", etc.)
  // When user types just "cart", we show cart options menu instead of directly showing cart
  isSimpleCartKeyword(text) {
    if (!text) return false;
    const trimmed = text.trim().toLowerCase();
    // Match standalone cart-related words (no verbs like "view", "show", "my", etc.)
    const simpleCartPatterns = [
      /^cart$/,
      /^card$/,
      /^kart$/,
      /^cot$/,
      /^caught$/,
      /^cat$/,
      /^court$/,
      /^art$/,
      /^cartt$/,
      /^caart$/,
      /^कार्ट$/,
      /^కార్ట్$/,
      /^கார்ட்$/,
      /^ಕಾರ್ಟ್$/,
      /^കാർട്ട്$/,
      /^কার্ট$/
    ];
    return simpleCartPatterns.some(pattern => pattern.test(trimmed));
  },

  // Helper to detect clear/empty cart intent from text/voice
  // Supports: English, Hindi, Telugu, Tamil, Kannada, Malayalam, Bengali, Marathi, Gujarati
  // Handles voice recognition mistakes like "card", "cut", "kart", "cot", "caught", "cat", "court" instead of "cart"
  // Also handles "items" variations in all languages
  isClearCartIntent(text) {
    if (!text) return false;
    const lowerText = ' ' + text.toLowerCase() + ' ';
    const clearCartPatterns = [
      // ========== ENGLISH - ALL VOICE MISTAKES ==========
      // Clear variations - cart/card/cut/kart/cot/caught/cat/court
      /\bclear cart\b/, /\bclear my cart\b/, /\bclear the cart\b/, /\bempty cart\b/, /\bempty my cart\b/,
      /\bclear card\b/, /\bclear my card\b/, /\bclear the card\b/, /\bempty card\b/, /\bempty my card\b/,
      /\bclear cut\b/, /\bclear my cut\b/, /\bclear the cut\b/, /\bempty cut\b/, /\bempty my cut\b/,
      /\bclear kart\b/, /\bclear my kart\b/, /\bclear the kart\b/, /\bempty kart\b/, /\bempty my kart\b/,
      /\bclear cot\b/, /\bclear my cot\b/, /\bclear the cot\b/, /\bempty cot\b/, /\bempty my cot\b/,
      /\bclear caught\b/, /\bclear my caught\b/, /\bclear the caught\b/, /\bempty caught\b/,
      /\bclear cat\b/, /\bclear my cat\b/, /\bclear the cat\b/, /\bempty cat\b/,
      /\bclear court\b/, /\bclear my court\b/, /\bclear the court\b/, /\bempty court\b/,
      // Remove variations - ALL voice mistakes for cart/card/cut/kart/cot/caught/cat/court
      /\bremove cart\b/, /\bremove my cart\b/, /\bremove the cart\b/, /\bremove all from cart\b/,
      /\bremove card\b/, /\bremove my card\b/, /\bremove the card\b/, /\bremove all from card\b/,
      /\bremove cut\b/, /\bremove my cut\b/, /\bremove the cut\b/,
      /\bremove kart\b/, /\bremove my kart\b/, /\bremove the kart\b/,
      /\bremove cot\b/, /\bremove my cot\b/, /\bremove the cot\b/,
      /\bremove caught\b/, /\bremove my caught\b/, /\bremove the caught\b/,
      /\bremove cat\b/, /\bremove my cat\b/, /\bremove the cat\b/,
      /\bremove court\b/, /\bremove my court\b/, /\bremove the court\b/,
      /\bremove all\b/, /\bremove items\b/, /\bremove all items\b/, /\bremove my items\b/, /\bremove the items\b/,
      /\bremove everything\b/, /\bremove from cart\b/, /\bremove from card\b/,
      // Delete variations - ALL voice mistakes for cart/card/cut/kart/cot/caught/cat/court
      /\bdelete cart\b/, /\bdelete my cart\b/, /\bdelete the cart\b/,
      /\bdelete card\b/, /\bdelete my card\b/, /\bdelete the card\b/,
      /\bdelete cut\b/, /\bdelete my cut\b/, /\bdelete the cut\b/,
      /\bdelete kart\b/, /\bdelete my kart\b/, /\bdelete the kart\b/,
      /\bdelete cot\b/, /\bdelete my cot\b/, /\bdelete the cot\b/,
      /\bdelete caught\b/, /\bdelete my caught\b/, /\bdelete the caught\b/,
      /\bdelete cat\b/, /\bdelete my cat\b/, /\bdelete the cat\b/,
      /\bdelete court\b/, /\bdelete my court\b/, /\bdelete the court\b/,
      /\bdelete all\b/, /\bdelete items\b/, /\bdelete my items\b/, /\bdelete the items\b/, /\bdelete all items\b/, /\bdelete everything\b/,
      // Clean/Reset/Cancel variations - ALL voice mistakes
      /\bclean cart\b/, /\bclean my cart\b/, /\bclean card\b/, /\bclean my card\b/,
      /\bclean cut\b/, /\bclean my cut\b/, /\bclean kart\b/, /\bclean my kart\b/,
      /\bclean items\b/, /\bclean my items\b/, /\bclean the items\b/,
      /\breset cart\b/, /\breset my cart\b/, /\breset card\b/, /\breset my card\b/,
      /\breset cut\b/, /\breset my cut\b/, /\breset kart\b/, /\breset my kart\b/,
      /\breset items\b/, /\breset my items\b/, /\breset the items\b/,
      // Cancel variations - ALL voice mistakes
      /\bcancel cart\b/, /\bcancel my cart\b/, /\bcancel the cart\b/,
      /\bcancel card\b/, /\bcancel my card\b/, /\bcancel the card\b/,
      /\bcancel cut\b/, /\bcancel my cut\b/, /\bcancel the cut\b/,
      /\bcancel kart\b/, /\bcancel my kart\b/, /\bcancel the kart\b/,
      /\bcancel cot\b/, /\bcancel my cot\b/, /\bcancel caught\b/, /\bcancel my caught\b/,
      /\bcancel cat\b/, /\bcancel my cat\b/, /\bcancel court\b/, /\bcancel my court\b/,
      /\bcancel items\b/, /\bcancel my items\b/, /\bcancel the items\b/, /\bcancel all items\b/, /\bcancel all\b/,
      // Other English patterns
      /\bclear basket\b/, /\bempty basket\b/, /\bremove basket\b/, /\bdelete basket\b/,
      /\bclear all\b/, /\bclear items\b/, /\bclear my items\b/, /\bclear the items\b/, /\bclear all items\b/,
      /\bstart fresh\b/, /\bstart over\b/, /\bfresh start\b/,
      // ========== HINDI ==========
      // Cart variations with voice mistakes
      /\bcart khali karo\b/, /\bcart saaf karo\b/, /\bcart clear karo\b/, /\bcart hatao\b/,
      /\bcard khali karo\b/, /\bcard saaf karo\b/, /\bcard clear karo\b/, /\bcard hatao\b/,
      /\bcut khali karo\b/, /\bcut saaf karo\b/, /\bkart khali karo\b/, /\bkart saaf karo\b/,
      // Items variations
      /\bitems hatao\b/, /\bitems clear karo\b/, /\bitems delete karo\b/, /\bitems remove karo\b/,
      /\bsab items hatao\b/, /\bsab items clear karo\b/, /\bsab items delete karo\b/,
      /\bsab hatao\b/, /\bsab remove karo\b/, /\bsab delete karo\b/, /\bsab clear karo\b/,
      /\bsaman hatao\b/, /\bsaman clear karo\b/, /\bsab saman hatao\b/,
      // Hindi script
      /\bकार्ट खाली करो\b/, /\bकार्ट साफ करो\b/, /\bकार्ट क्लियर\b/, /\bकार्ट हटाओ\b/,
      /\bसब हटाओ\b/, /\bसब कुछ हटाओ\b/, /\bसब क्लियर करो\b/, /\bसब डिलीट करो\b/,
      /\bआइटम हटाओ\b/, /\bआइटम्स हटाओ\b/, /\bसब आइटम हटाओ\b/, /\bआइटम्स क्लियर\b/,
      /\bसामान हटाओ\b/, /\bसब सामान हटाओ\b/, /\bसामान क्लियर करो\b/,
      // ========== TELUGU ==========
      // Cart variations with voice mistakes
      /\bcart clear cheyyi\b/, /\bcart khali cheyyi\b/, /\bcart teeseyyi\b/, /\bcart delete cheyyi\b/,
      /\bcard clear cheyyi\b/, /\bcard khali cheyyi\b/, /\bcard teeseyyi\b/, /\bcard delete cheyyi\b/,
      /\bcut clear cheyyi\b/, /\bkart clear cheyyi\b/, /\bkart khali cheyyi\b/,
      // Items variations
      /\bitems teeseyyi\b/, /\bitems clear cheyyi\b/, /\bitems delete cheyyi\b/, /\bitems remove cheyyi\b/,
      /\banni items teeseyyi\b/, /\banni items clear cheyyi\b/,
      /\banni teeseyyi\b/, /\banni clear cheyyi\b/, /\banni delete cheyyi\b/,
      /\bsamanlu teeseyyi\b/, /\bsamanlu clear cheyyi\b/, /\banni samanlu teeseyyi\b/,
      // Telugu script
      /\bకార్ట్ క్లియర్\b/, /\bకార్ట్ ఖాళీ చేయి\b/, /\bకార్ట్ తీసేయి\b/, /\bకార్ట్ డిలీట్\b/,
      /\bఅన్నీ తీసేయి\b/, /\bఅన్నీ క్లియర్\b/, /\bఅన్నీ డిలీట్\b/,
      /\bఐటమ్స్ తీసేయి\b/, /\bఐటమ్స్ క్లియర్\b/, /\bఐటమ్స్ డిలీట్\b/, /\bఅన్ని ఐటమ్స్ తీసేయి\b/,
      /\bసామాన్లు తీసేయి\b/, /\bసామాన్లు క్లియర్\b/, /\bఅన్ని సామాన్లు తీసేయి\b/,
      // ========== TAMIL ==========
      // Cart variations with voice mistakes
      /\bcart clear pannu\b/, /\bcart kaali pannu\b/, /\bcart neekku\b/, /\bcart delete pannu\b/,
      /\bcard clear pannu\b/, /\bcard kaali pannu\b/, /\bcard neekku\b/, /\bcard delete pannu\b/,
      /\bcut clear pannu\b/, /\bkart clear pannu\b/, /\bkart kaali pannu\b/,
      // Items variations
      /\bitems neekku\b/, /\bitems clear pannu\b/, /\bitems delete pannu\b/, /\bitems remove pannu\b/,
      /\bella items neekku\b/, /\bella items clear pannu\b/,
      /\bellam eduthudu\b/, /\bellam neekku\b/, /\bellam clear pannu\b/, /\bellam delete pannu\b/,
      /\bporulgal neekku\b/, /\bporulgal clear pannu\b/, /\bella porulgal neekku\b/,
      // Tamil script
      /\bகார்ட் கிளியர்\b/, /\bகார்ட் காலி\b/, /\bகார்ட் நீக்கு\b/, /\bகார்ட் டெலிட்\b/,
      /\bஎல்லாம் எடுத்துடு\b/, /\bஎல்லாம் நீக்கு\b/, /\bஎல்லாம் கிளியர்\b/,
      /\bஐட்டம்ஸ் நீக்கு\b/, /\bஐட்டம்ஸ் கிளியர்\b/, /\bஐட்டம்ஸ் டெலிட்\b/, /\bஎல்லா ஐட்டம்ஸ் நீக்கு\b/,
      /\bபொருட்கள் நீக்கு\b/, /\bபொருட்கள் கிளியர்\b/, /\bஎல்லா பொருட்கள் நீக்கு\b/,
      // ========== KANNADA ==========
      // Cart variations with voice mistakes
      /\bcart clear maadi\b/, /\bcart khali maadi\b/, /\bcart tegedu\b/, /\bcart delete maadi\b/,
      /\bcard clear maadi\b/, /\bcard khali maadi\b/, /\bcard tegedu\b/, /\bcard delete maadi\b/,
      /\bcut clear maadi\b/, /\bkart clear maadi\b/, /\bkart khali maadi\b/,
      // Items variations
      /\bitems tegedu\b/, /\bitems clear maadi\b/, /\bitems delete maadi\b/, /\bitems remove maadi\b/,
      /\bella items tegedu\b/, /\bella items clear maadi\b/,
      /\bella tegedu\b/, /\bella clear maadi\b/, /\bella delete maadi\b/,
      /\bsamanu tegedu\b/, /\bsamanu clear maadi\b/, /\bella samanu tegedu\b/,
      // Kannada script
      /\bಕಾರ್ಟ್ ಕ್ಲಿಯರ್\b/, /\bಕಾರ್ಟ್ ಖಾಲಿ\b/, /\bಕಾರ್ಟ್ ತೆಗೆದು\b/, /\bಕಾರ್ಟ್ ಡಿಲೀಟ್\b/,
      /\bಎಲ್ಲಾ ತೆಗೆದು\b/, /\bಎಲ್ಲಾ ಕ್ಲಿಯರ್\b/, /\bಎಲ್ಲಾ ಡಿಲೀಟ್\b/,
      /\bಐಟಮ್ಸ್ ತೆಗೆದು\b/, /\bಐಟಮ್ಸ್ ಕ್ಲಿಯರ್\b/, /\bಐಟಮ್ಸ್ ಡಿಲೀಟ್\b/, /\bಎಲ್ಲಾ ಐಟಮ್ಸ್ ತೆಗೆದು\b/,
      /\bಸಾಮಾನು ತೆಗೆದು\b/, /\bಸಾಮಾನು ಕ್ಲಿಯರ್\b/, /\bಎಲ್ಲಾ ಸಾಮಾನು ತೆಗೆದು\b/,
      // ========== MALAYALAM ==========
      // Cart variations with voice mistakes
      /\bcart clear cheyyuka\b/, /\bcart kaali aakkuka\b/, /\bcart maarruka\b/, /\bcart delete cheyyuka\b/,
      /\bcard clear cheyyuka\b/, /\bcard kaali aakkuka\b/, /\bcard maarruka\b/, /\bcard delete cheyyuka\b/,
      /\bcut clear cheyyuka\b/, /\bkart clear cheyyuka\b/, /\bkart kaali aakkuka\b/,
      // Items variations
      /\bitems maarruka\b/, /\bitems clear cheyyuka\b/, /\bitems delete cheyyuka\b/, /\bitems remove cheyyuka\b/,
      /\bellam items maarruka\b/, /\bellam items clear cheyyuka\b/,
      /\bellam maarruka\b/, /\bellam clear cheyyuka\b/, /\bellam delete cheyyuka\b/,
      /\bsadhanangal maarruka\b/, /\bsadhanangal clear cheyyuka\b/, /\bellam sadhanangal maarruka\b/,
      // Malayalam script
      /\bകാർട്ട് ക്ലിയർ\b/, /\bകാർട്ട് കാലി\b/, /\bകാർട്ട് മാറ്റുക\b/, /\bകാർട്ട് ഡിലീറ്റ്\b/,
      /\bഎല്ലാം മാറ്റുക\b/, /\bഎല്ലാം ക്ലിയർ\b/, /\bഎല്ലാം ഡിലീറ്റ്\b/,
      /\bഐറ്റംസ് മാറ്റുക\b/, /\bഐറ്റംസ് ക്ലിയർ\b/, /\bഐറ്റംസ് ഡിലീറ്റ്\b/, /\bഎല്ലാ ഐറ്റംസ് മാറ്റുക\b/,
      /\bസാധനങ്ങൾ മാറ്റുക\b/, /\bസാധനങ്ങൾ ക്ലിയർ\b/, /\bഎല്ലാ സാധനങ്ങൾ മാറ്റുക\b/,
      // ========== BENGALI ==========
      // Cart variations with voice mistakes
      /\bcart clear koro\b/, /\bcart khali koro\b/, /\bcart soriyo\b/, /\bcart delete koro\b/,
      /\bcard clear koro\b/, /\bcard khali koro\b/, /\bcard soriyo\b/, /\bcard delete koro\b/,
      /\bcut clear koro\b/, /\bkart clear koro\b/, /\bkart khali koro\b/,
      // Items variations
      /\bitems soriyo\b/, /\bitems clear koro\b/, /\bitems delete koro\b/, /\bitems remove koro\b/,
      /\bsob items soriyo\b/, /\bsob items clear koro\b/,
      /\bsob soriyo\b/, /\bsob clear koro\b/, /\bsob delete koro\b/,
      /\bjinis soriyo\b/, /\bjinis clear koro\b/, /\bsob jinis soriyo\b/,
      // Bengali script
      /\bকার্ট ক্লিয়ার\b/, /\bকার্ট খালি করো\b/, /\bকার্ট সরিয়ে দাও\b/, /\bকার্ট ডিলিট\b/,
      /\bসব সরিয়ে দাও\b/, /\bসব ক্লিয়ার করো\b/, /\bসব ডিলিট করো\b/,
      /\bআইটেম সরিয়ে দাও\b/, /\bআইটেম ক্লিয়ার\b/, /\bআইটেম ডিলিট\b/, /\bসব আইটেম সরিয়ে দাও\b/,
      /\bজিনিস সরিয়ে দাও\b/, /\bজিনিস ক্লিয়ার\b/, /\bসব জিনিস সরিয়ে দাও\b/,
      // ========== MARATHI ==========
      // Cart variations with voice mistakes
      /\bcart clear kara\b/, /\bcart khali kara\b/, /\bcart kadhun taka\b/, /\bcart delete kara\b/,
      /\bcard clear kara\b/, /\bcard khali kara\b/, /\bcard kadhun taka\b/, /\bcard delete kara\b/,
      /\bcut clear kara\b/, /\bkart clear kara\b/, /\bkart khali kara\b/,
      // Items variations
      /\bitems kadhun taka\b/, /\bitems clear kara\b/, /\bitems delete kara\b/, /\bitems remove kara\b/,
      /\bsagla items kadhun taka\b/, /\bsagla items clear kara\b/,
      /\bsagla kadhun taka\b/, /\bsagla clear kara\b/, /\bsagla delete kara\b/,
      /\bsaman kadhun taka\b/, /\bsaman clear kara\b/, /\bsagla saman kadhun taka\b/,
      // Marathi script
      /\bकार्ट क्लियर करा\b/, /\bकार्ट खाली करा\b/, /\bकार्ट काढून टाका\b/, /\bकार्ट डिलीट करा\b/,
      /\bसगळं काढून टाका\b/, /\bसगळं क्लियर करा\b/, /\bसगळं डिलीट करा\b/,
      /\bआइटम काढून टाका\b/, /\bआइटम क्लियर करा\b/, /\bआइटम डिलीट करा\b/, /\bसगळे आइटम काढून टाका\b/,
      /\bसामान काढून टाका\b/, /\bसामान क्लियर करा\b/, /\bसगळं सामान काढून टाका\b/,
      // ========== GUJARATI ==========
      // Cart variations with voice mistakes
      /\bcart clear karo\b/, /\bcart khali karo\b/, /\bcart kaadhi nakho\b/, /\bcart delete karo\b/,
      /\bcard clear karo\b/, /\bcard khali karo\b/, /\bcard kaadhi nakho\b/, /\bcard delete karo\b/,
      /\bcut clear karo\b/, /\bkart clear karo\b/, /\bkart khali karo\b/,
      // Items variations
      /\bitems kaadhi nakho\b/, /\bitems clear karo\b/, /\bitems delete karo\b/, /\bitems remove karo\b/,
      /\bbadha items kaadhi nakho\b/, /\bbadha items clear karo\b/,
      /\bbadhu kaadhi nakho\b/, /\bbadhu clear karo\b/, /\bbadhu delete karo\b/,
      /\bsaman kaadhi nakho\b/, /\bsaman clear karo\b/, /\bbadhu saman kaadhi nakho\b/,
      // Gujarati script
      /\bકાર્ટ ક્લિયર\b/, /\bકાર્ટ ખાલી કરો\b/, /\bકાર્ટ કાઢી નાખો\b/, /\bકાર્ટ ડિલીટ\b/,
      /\bબધું કાઢી નાખો\b/, /\bબધું ક્લિયર કરો\b/, /\bબધું ડિલીટ કરો\b/,
      /\bઆઇટમ્સ કાઢી નાખો\b/, /\bઆઇટમ્સ ક્લિયર\b/, /\bઆઇટમ્સ ડિલીટ\b/, /\bબધા આઇટમ્સ કાઢી નાખો\b/,
      /\bસામાન કાઢી નાખો\b/, /\bસામાન ક્લિયર\b/, /\bબધું સામાન કાઢી નાખો\b/,
      
      // ========== MIXED LANGUAGE PATTERNS (Hinglish/Tanglish/etc.) ==========
      // "items remove chai" style - action word at end (Hindi style in English)
      /\bitems remove chai\b/, /\bitems delete chai\b/, /\bitems clear chai\b/, /\bitems hatao chai\b/,
      /\bcart remove chai\b/, /\bcart delete chai\b/, /\bcart clear chai\b/, /\bcart hatao chai\b/,
      /\bcard remove chai\b/, /\bcard delete chai\b/, /\bcard clear chai\b/,
      /\bsab remove chai\b/, /\bsab delete chai\b/, /\bsab clear chai\b/,
      // "chai" variations (chahiye/chaiye - want to)
      /\bitems remove chahiye\b/, /\bitems delete chahiye\b/, /\bitems clear chahiye\b/,
      /\bcart remove chahiye\b/, /\bcart delete chahiye\b/, /\bcart clear chahiye\b/,
      /\bcart empty chahiye\b/, /\bcart khali chahiye\b/, /\bcard khali chahiye\b/,
      // "karna hai" / "karna" style (want to do)
      /\bitems remove karna\b/, /\bitems delete karna\b/, /\bitems clear karna\b/,
      /\bcart remove karna\b/, /\bcart delete karna\b/, /\bcart clear karna\b/, /\bcart empty karna\b/,
      /\bitems remove karna hai\b/, /\bitems delete karna hai\b/, /\bcart clear karna hai\b/,
      /\bcart khali karna\b/, /\bcart khali karna hai\b/, /\bcard khali karna\b/,
      // "do" / "kar do" / "de do" style (please do)
      /\bitems remove kar do\b/, /\bitems delete kar do\b/, /\bitems clear kar do\b/,
      /\bcart remove kar do\b/, /\bcart delete kar do\b/, /\bcart clear kar do\b/,
      /\bcart khali kar do\b/, /\bcard khali kar do\b/, /\bcart empty kar do\b/,
      /\bitems hata do\b/, /\bcart hata do\b/, /\bsab hata do\b/,
      // "please" mixed patterns
      /\bplease clear cart\b/, /\bplease remove cart\b/, /\bplease delete cart\b/,
      /\bplease clear items\b/, /\bplease remove items\b/, /\bplease delete items\b/,
      /\bcart clear please\b/, /\bitems clear please\b/, /\bcart remove please\b/,
      // Telugu mixed (cheyyi/cheyyandi at end)
      /\bitems remove cheyyi\b/, /\bitems delete cheyyi\b/, /\bcart remove cheyyi\b/,
      /\bitems clear cheyyandi\b/, /\bcart clear cheyyandi\b/, /\bcart remove cheyyandi\b/,
      // Tamil mixed (pannu/pannunga at end)
      /\bitems remove pannu\b/, /\bitems delete pannu\b/, /\bcart remove pannu\b/,
      /\bitems clear pannunga\b/, /\bcart clear pannunga\b/, /\bcart remove pannunga\b/,
      // Kannada mixed (maadi at end)
      /\bitems remove maadi\b/, /\bitems delete maadi\b/, /\bcart remove maadi\b/,
      /\bitems clear maadi\b/, /\bcart clear maadiri\b/,
      // Bengali mixed (koro at end)
      /\bitems remove koro\b/, /\bitems delete koro\b/, /\bcart remove koro\b/,
      // Marathi mixed (kara at end)
      /\bitems remove kara\b/, /\bitems delete kara\b/, /\bcart remove kara\b/,
      // Gujarati mixed (karo at end)
      /\bitems remove karo\b/, /\bitems delete karo\b/, /\bcart remove karo\b/,
      // "mujhe" / "mera" / "mere" style (my/mine)
      /\bmujhe cart clear\b/, /\bmujhe items clear\b/, /\bmujhe cart remove\b/,
      /\bmera cart clear\b/, /\bmera cart remove\b/, /\bmera cart delete\b/,
      /\bmere items clear\b/, /\bmere items remove\b/, /\bmere items delete\b/,
      // "nahi chahiye" / "nahi chaiye" (don't want)
      /\bcart nahi chahiye\b/, /\bitems nahi chahiye\b/, /\bsab nahi chahiye\b/,
      /\bcart nahi chaiye\b/, /\bitems nahi chaiye\b/,
      // Short forms and typos
      /\bclr cart\b/, /\bclr card\b/, /\bclr items\b/, /\brmv cart\b/, /\brmv items\b/,
      /\bdel cart\b/, /\bdel card\b/, /\bdel items\b/,
      // "want to" patterns
      /\bwant to clear cart\b/, /\bwant to remove cart\b/, /\bwant to delete cart\b/,
      /\bwant to clear items\b/, /\bwant to remove items\b/, /\bwant to delete items\b/,
      /\bi want clear cart\b/, /\bi want remove items\b/, /\bi want delete cart\b/
    ];
    return clearCartPatterns.some(pattern => pattern.test(lowerText));
  },

  // Helper to detect "add to cart" intent from text/voice
  // Returns: { itemName: string } or null
  // Supports: English, Hindi, Telugu, Tamil, Kannada, Malayalam, Bengali, Marathi, Gujarati
  isAddToCartIntent(text) {
    if (!text) return null;
    const lowerText = text.toLowerCase().trim();
    
    // Patterns to extract item name from "add X to cart" style messages
    const addPatterns = [
      // English
      /add\s+(.+?)\s+to\s+(?:cart|card|kart)/i,
      /add\s+(.+?)\s+(?:to\s+)?(?:my\s+)?(?:cart|card|kart)/i,
      /(?:i\s+)?want\s+(?:to\s+)?add\s+(.+?)\s+(?:to\s+)?(?:cart|card)/i,
      /put\s+(.+?)\s+in\s+(?:cart|card|kart)/i,
      /(.+?)\s+add\s+(?:to\s+)?(?:cart|card|kart)/i,
      /(.+?)\s+(?:cart|card)\s+(?:me|mein|mai)\s+(?:add|daal|dal)/i,
      // Hindi
      /(.+?)\s+(?:cart|card)\s+(?:me|mein|mai)\s+(?:daalo|dalo|add\s+karo)/i,
      /(.+?)\s+(?:add|daal|dal)\s+(?:karo|do|kar\s+do)/i,
      /(.+?)\s+(?:कार्ट|कार्ड)\s+(?:में|मे)\s+(?:डालो|ऐड\s+करो)/i,
      // Telugu
      /(.+?)\s+(?:cart|card)\s+(?:lo|ki)\s+(?:add|pettandi|pettu)/i,
      /(.+?)\s+(?:కార్ట్|కార్డ్)\s+(?:లో|కి)\s+(?:పెట్టు|యాడ్)/i,
      // Tamil
      /(.+?)\s+(?:cart|card)\s+(?:la|le)\s+(?:add|podungal|podu)/i,
      /(.+?)\s+(?:கார்ட்|கார்ட்)\s+(?:ல|லே)\s+(?:போடு|ஆட்)/i,
      // Simple patterns - just item name followed by "add"
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

  // Helper to detect show menu/items intent from text/voice
  // Returns: { showMenu: true, foodType: 'veg'|'nonveg'|'both'|null, searchTerm: string|null }
  // Supports: English, Hindi, Telugu, Tamil, Kannada, Malayalam, Bengali, Marathi, Gujarati
  isShowMenuIntent(text) {
    if (!text) return null;
    const lowerText = ' ' + text.toLowerCase() + ' ';
    
    // Patterns for showing menu/items
    const menuPatterns = [
      // English - "all menu", "all items", "full menu", etc.
      /\bshow\s+(?:me\s+)?(?:the\s+)?menu\b/, /\bshow\s+(?:me\s+)?(?:all\s+)?items\b/,
      /\bshow\s+(?:me\s+)?(?:the\s+)?food\b/, /\bwhat\s+(?:do\s+you\s+have|items|food)\b/,
      /\blist\s+(?:all\s+)?(?:items|menu|food)\b/, /\bdisplay\s+(?:menu|items)\b/,
      /\bsee\s+(?:the\s+)?(?:menu|items|food)\b/, /\bview\s+(?:all\s+)?(?:items|food)\b/,
      /\ball\s+items\b/, /\bfull\s+menu\b/, /\bentire\s+menu\b/,
      /\ball\s+menu\b/, /\bshow\s+all\s+menu\b/, /\bview\s+all\s+menu\b/, /\bsee\s+all\s+menu\b/,
      /\bcomplete\s+menu\b/, /\bwhole\s+menu\b/, /\btotal\s+menu\b/,
      /\ball\s+food\b/, /\bshow\s+all\s+food\b/, /\bfull\s+items\b/,
      // Browse menu patterns
      /\bbrowse\s+(?:the\s+)?menu\b/, /\bbrowse\s+(?:the\s+)?items\b/, /\bbrowse\s+(?:the\s+)?food\b/,
      /\bbrowse\s+(?:our\s+)?menu\b/, /\bbrowse\s+(?:your\s+)?menu\b/,
      /\bexplore\s+(?:the\s+)?menu\b/, /\bexplore\s+(?:the\s+)?items\b/, /\bexplore\s+(?:the\s+)?food\b/,
      /\bcheck\s+(?:the\s+)?menu\b/, /\bcheck\s+(?:out\s+)?(?:the\s+)?menu\b/,
      /\bopen\s+(?:the\s+)?menu\b/, /\bopen\s+menu\b/,
      /\bview\s+(?:the\s+)?menu\b/, /\bview\s+menu\b/,
      // Hindi - "sab menu", "pura menu", "all menu dikhao"
      /\bmenu\s+dikhao\b/, /\bsab\s+items\s+dikhao\b/, /\bkhana\s+dikhao\b/,
      /\bमेन्यू\s+दिखाओ\b/, /\bसब\s+आइटम\b/, /\bखाना\s+दिखाओ\b/, /\bक्या\s+है\b/,
      /\bsab\s+menu\b/, /\bsab\s+menu\s+dikhao\b/, /\bpura\s+menu\b/, /\bpura\s+menu\s+dikhao\b/,
      /\ball\s+menu\s+dikhao\b/, /\bfull\s+menu\s+dikhao\b/, /\bsara\s+menu\b/,
      /\bसब\s+मेन्यू\b/, /\bपूरा\s+मेन्यू\b/, /\bसारा\s+मेन्यू\b/, /\bपूरा\s+मेन्यू\s+दिखाओ\b/,
      // Telugu - "antha menu", "motham menu", "all menu chupinchu"
      /\bmenu\s+chupinchu\b/, /\banni\s+items\s+chupinchu\b/, /\bమెనూ\s+చూపించు\b/,
      /\bఅన్ని\s+ఐటమ్స్\b/, /\bఏమి\s+ఉంది\b/,
      /\bantha\s+menu\b/, /\bmotham\s+menu\b/, /\ball\s+menu\s+chupinchu\b/, /\bfull\s+menu\s+chupinchu\b/,
      /\banni\s+menu\b/, /\banni\s+menu\s+chupinchu\b/,
      /\bఅంతా\s+మెనూ\b/, /\bమొత్తం\s+మెనూ\b/, /\bఅన్ని\s+మెనూ\b/,
      // Tamil - "ella menu", "muzhu menu", "all menu kaattu"
      /\bmenu\s+kaattu\b/, /\bella\s+items\s+kaattu\b/, /\bமெனு\s+காட்டு\b/,
      /\bஎல்லா\s+ஐட்டம்ஸ்\b/, /\bஎன்ன\s+இருக்கு\b/,
      /\bella\s+menu\b/, /\bmuzhu\s+menu\b/, /\ball\s+menu\s+kaattu\b/, /\bfull\s+menu\s+kaattu\b/,
      /\bella\s+menu\s+kaattu\b/,
      /\bஎல்லா\s+மெனு\b/, /\bமுழு\s+மெனு\b/,
      // Kannada - "ella menu", "puri menu", "all menu toorisu"
      /\bmenu\s+toorisu\b/, /\bella\s+items\s+toorisu\b/, /\bಮೆನು\s+ತೋರಿಸು\b/,
      /\bಎಲ್ಲಾ\s+ಐಟಮ್ಸ್\b/, /\bಏನು\s+ಇದೆ\b/,
      /\bella\s+menu\b/, /\bella\s+menu\s+toorisu\b/, /\bpuri\s+menu\b/, /\ball\s+menu\s+toorisu\b/,
      /\bಎಲ್ಲಾ\s+ಮೆನು\b/, /\bಪೂರ್ಣ\s+ಮೆನು\b/,
      // Malayalam - "ellam menu", "muzhuvan menu", "all menu kaanikkuka"
      /\bmenu\s+kaanikkuka\b/, /\bellam\s+kaanikkuka\b/, /\bമെനു\s+കാണിക്കുക\b/,
      /\bഎല്ലാം\s+കാണിക്കുക\b/, /\bഎന്താണ്\s+ഉള്ളത്\b/,
      /\bellam\s+menu\b/, /\bmuzhuvan\s+menu\b/, /\ball\s+menu\s+kaanikkuka\b/, /\bfull\s+menu\s+kaanikkuka\b/,
      /\bഎല്ലാം\s+മെനു\b/, /\bമുഴുവൻ\s+മെനു\b/,
      // Bengali - "sob menu", "puro menu", "all menu dekho"
      /\bmenu\s+dekho\b/, /\bsob\s+items\s+dekho\b/, /\bমেনু\s+দেখো\b/,
      /\bসব\s+আইটেম\b/, /\bকি\s+আছে\b/,
      /\bsob\s+menu\b/, /\bpuro\s+menu\b/, /\ball\s+menu\s+dekho\b/, /\bfull\s+menu\s+dekho\b/,
      /\bসব\s+মেনু\b/, /\bপুরো\s+মেনু\b/,
      // Marathi - "sagla menu", "purn menu", "all menu dakhva"
      /\bmenu\s+dakhva\b/, /\bsagla\s+dakhva\b/, /\bमेन्यू\s+दाखवा\b/,
      /\bसगळे\s+आइटम\b/, /\bकाय\s+आहे\b/,
      /\bsagla\s+menu\b/, /\bpurn\s+menu\b/, /\ball\s+menu\s+dakhva\b/, /\bfull\s+menu\s+dakhva\b/,
      /\bसगळा\s+मेन्यू\b/, /\bपूर्ण\s+मेन्यू\b/,
      // Gujarati - "badhu menu", "puru menu", "all menu batavo"
      /\bmenu\s+batavo\b/, /\bbadha\s+items\s+batavo\b/, /\bમેનુ\s+બતાવો\b/,
      /\bબધા\s+આઇટમ્સ\b/, /\bશું\s+છે\b/,
      /\bbadhu\s+menu\b/, /\bbadha\s+menu\b/, /\bpuru\s+menu\b/, /\ball\s+menu\s+batavo\b/, /\bfull\s+menu\s+batavo\b/,
      /\bબધું\s+મેનુ\b/, /\bબધા\s+મેનુ\b/, /\bપૂરું\s+મેનુ\b/
    ];
    
    // Patterns specifically for veg items - compound patterns only (standalone handled separately)
    const vegPatterns = [
      // English - compound patterns only
      /\bveg\s+(?:items?|menu|food|dishes?)\b/, /\bvegetarian\s+(?:items?|menu|food|dishes?)\b/,
      /\bshow\s+(?:me\s+)?veg\b/, /\bonly\s+veg\b/, /\bpure\s+veg\b/,
      /\bveggie\s+(?:items?|menu|food)\b/,
      // Hindi
      /\bveg\s+(?:items?|khana)\s+dikhao\b/, /\bवेज\s+आइटम\b/,
      /\bवेज\s+खाना\b/, /\bसिर्फ\s+वेज\b/,
      // Telugu
      /\bveg\s+items\s+chupinchu\b/, /\bవెజ్\s+ఐటమ్స్\b/,
      // Tamil
      /\bveg\s+items\s+kaattu\b/, /\bவெஜ்\s+ஐட்டம்ஸ்\b/,
      // Kannada
      /\bveg\s+items\s+toorisu\b/, /\bವೆಜ್\s+ಐಟಮ್ಸ್\b/,
      // Malayalam
      /\bveg\s+items\s+kaanikkuka\b/, /\bവെജ്\s+ഐറ്റംസ്\b/,
      // Bengali
      /\bveg\s+items\s+dekho\b/, /\bভেজ\s+আইটেম\b/,
      // Marathi
      /\bveg\s+items\s+dakhva\b/, /\bवेज\s+आइटम\b/,
      // Gujarati
      /\bveg\s+items\s+batavo\b/, /\bવેજ\s+આઇટમ્સ\b/
    ];
    
    // Patterns specifically for egg items - compound patterns only (standalone handled separately)
    const eggPatterns = [
      // English - compound patterns only
      /\begg\s+(?:items?|menu|food|dishes?)\b/,
      /\bshow\s+(?:me\s+)?egg\b/, /\bonly\s+egg\b/
    ];
    
    // Patterns specifically for non-veg items - compound patterns only (standalone handled separately)
    const nonvegPatterns = [
      // English - compound patterns only
      /\bnon[\s-]?veg\s+(?:items?|menu|food|dishes?)\b/, /\bnonveg\s+(?:items?|menu|food|dishes?)\b/,
      /\bshow\s+(?:me\s+)?non[\s-]?veg\b/, /\bonly\s+non[\s-]?veg\b/,
      /\bmeat\s+(?:items?|menu|dishes?)\b/,
      // Hindi
      /\bnon[\s-]?veg\s+(?:items?|khana)\s+dikhao\b/, /\bनॉन\s*वेज\s+आइटम\b/,
      /\bनॉन\s*वेज\s+खाना\b/, /\bसिर्फ\s+नॉन\s*वेज\b/,
      // Telugu
      /\bnon[\s-]?veg\s+items\s+chupinchu\b/, /\bనాన్\s*వెజ్\s+ఐటమ్స్\b/,
      // Tamil
      /\bnon[\s-]?veg\s+items\s+kaattu\b/, /\bநான்\s*வெஜ்\s+ஐட்டம்ஸ்\b/,
      // Kannada
      /\bnon[\s-]?veg\s+items\s+toorisu\b/, /\bನಾನ್\s*ವೆಜ್\s+ಐಟಮ್ಸ್\b/,
      // Malayalam
      /\bnon[\s-]?veg\s+items\s+kaanikkuka\b/, /\bനോൺ\s*വെജ്\s+ഐറ്റംസ്\b/,
      // Bengali
      /\bnon[\s-]?veg\s+items\s+dekho\b/, /\bনন\s*ভেজ\s+আইটেম\b/,
      // Marathi
      /\bnon[\s-]?veg\s+items\s+dakhva\b/, /\bनॉन\s*वेज\s+आइटम\b/,
      // Gujarati
      /\bnon[\s-]?veg\s+items\s+batavo\b/, /\bનોન\s*વેજ\s+આઇટમ્સ\b/
    ];
    
    // Helper to check if text is ONLY the food type keyword (standalone)
    // This prevents "egg curry" from matching as egg menu intent
    const trimmedText = text.toLowerCase().trim();
    const words = trimmedText.split(/\s+/).filter(w => w.length > 0);
    const menuWords = ['menu', 'items', 'item', 'food', 'dishes', 'dish', 'dikhao', 'show', 'batavo', 'dakhva', 'dekho', 'me', 'the', 'all', 'only'];
    
    const isStandaloneKeyword = (keywords) => {
      // Check if all words are either the keyword or menu-related words
      const nonMenuWords = words.filter(w => !keywords.includes(w) && !menuWords.includes(w));
      return nonMenuWords.length === 0 && words.some(w => keywords.includes(w));
    };
    
    // Standalone keywords for each food type
    const standaloneEggKeywords = ['egg', 'eggs', 'anda', 'अंडा', 'अंडे', 'గుడ్డు', 'కోడిగుడ్డు', 'முட்டை', 'ಮೊಟ್ಟೆ', 'മുട്ട', 'ডিম', 'ઈંડા'];
    const standaloneVegKeywords = ['veg', 'vegetarian', 'veggie', 'वेज', 'శాకాహారం', 'వెజ్', 'சைவம்', 'வெஜ்', 'ಸಸ್ಯಾಹಾರ', 'ವೆಜ್', 'സസ്യാഹാരം', 'വെജ്', 'নিরামিষ', 'ভেজ', 'शाकाहारी', 'શાકાહારી'];
    const standaloneNonvegKeywords = ['nonveg', 'non-veg', 'मांसाहारी', 'नॉनवेज', 'మాంసాహారం', 'నాన్వెజ్', 'அசைவம்', 'நான்வெஜ்', 'ಮಾಂಸಾಹಾರ', 'നാന്വെജ്', 'മാംസാഹാരം', 'আমিষ', 'নন ভেজ', 'માંસાહારી'];
    
    // Check for egg-specific intent - only if standalone or with menu words
    // Compound patterns like "egg items" or "show egg" are fine
    const isEggCompound = eggPatterns.some(pattern => pattern.test(lowerText) && pattern.source.includes('\\s+'));
    const isEggStandalone = isStandaloneKeyword(standaloneEggKeywords);
    if (isEggCompound || isEggStandalone) {
      return { showMenu: true, foodType: 'egg', searchTerm: null };
    }
    
    // Check for non-veg-specific intent (before veg, since "non veg" contains "veg")
    // But first verify the text actually contains "non" to avoid false matches
    const hasNonPrefix = /\bnon[\s-]?veg/i.test(lowerText) || /\bnonveg/i.test(lowerText);
    const isNonvegCompound = hasNonPrefix && nonvegPatterns.some(pattern => pattern.test(lowerText));
    const isNonvegStandalone = isStandaloneKeyword(standaloneNonvegKeywords) || (hasNonPrefix && words.filter(w => !menuWords.includes(w) && w !== 'non' && w !== 'veg' && w !== 'nonveg' && w !== 'non-veg').length === 0);
    if (isNonvegCompound || isNonvegStandalone) {
      return { showMenu: true, foodType: 'nonveg', searchTerm: null };
    }
    
    // Check for veg-specific intent (only if not non-veg) - only standalone or compound
    const isVegCompound = vegPatterns.some(pattern => pattern.test(lowerText) && pattern.source.includes('\\s+'));
    const isVegStandalone = !hasNonPrefix && isStandaloneKeyword(standaloneVegKeywords);
    if (isVegCompound || isVegStandalone) {
      return { showMenu: true, foodType: 'veg', searchTerm: null };
    }
    
    // Check for general menu intent
    const isMenuIntent = menuPatterns.some(pattern => pattern.test(lowerText));
    if (isMenuIntent) {
      return { showMenu: true, foodType: 'both', searchTerm: null };
    }
    
    // Check for standalone menu keywords (trimmed text without added spaces)
    const trimmedLower = text.toLowerCase().trim();
    const standaloneMenuPatterns = [
      /^menu$/, /^browse menu$/, /^view menu$/, /^show menu$/, /^see menu$/,
      /^check menu$/, /^open menu$/, /^explore menu$/, /^the menu$/,
      /^browse the menu$/, /^view the menu$/, /^show the menu$/, /^see the menu$/,
      /^check the menu$/, /^open the menu$/, /^explore the menu$/,
      /^food menu$/, /^our menu$/, /^your menu$/
    ];
    const isStandaloneMenu = standaloneMenuPatterns.some(pattern => pattern.test(trimmedLower));
    if (isStandaloneMenu) {
      return { showMenu: true, foodType: 'both', searchTerm: null };
    }
    
    return null;
  },

  // Helper to detect track order intent from text/voice
  isTrackIntent(text) {
    if (!text) return false;
    const lowerText = ' ' + text.toLowerCase() + ' ';
    const trackPatterns = [
      // English
      /\btrack\b/, /\btrack order\b/, /\btrack my order\b/, /\btracking\b/,
      /\bwhere is my order\b/, /\bwhere'?s my order\b/, /\border location\b/,
      /\bdelivery status\b/, /\bwhen will.+arrive\b/, /\bwhere is.+order\b/,
      // Hindi
      /\bkahan hai\b/, /\bkab aayega\b/, /\border kahan\b/, /\btrack karo\b/,
      /\bट्रैक\b/, /\bकहां है\b/, /\bऑर्डर कहां है\b/, /\bकब आएगा\b/, /\bमेरा ऑर्डर कहां\b/,
      // Telugu
      /\bekkada undi\b/, /\border ekkada\b/, /\beppudu vastundi\b/, /\btrack cheyyi\b/,
      /\bట్రాక్\b/, /\bఎక్కడ ఉంది\b/, /\bనా ఆర్డర్ ఎక్కడ\b/, /\bఎప్పుడు వస్తుంది\b/,
      // Tamil
      /\benga irukku\b/, /\border enga\b/, /\bepppo varum\b/, /\btrack pannu\b/,
      /\bட்ராக்\b/, /\bஎங்கே இருக்கு\b/, /\bஆர்டர் எங்கே\b/, /\bஎப்போ வரும்\b/,
      // Kannada
      /\belli ide\b/, /\border elli\b/, /\byavaga baratte\b/, /\btrack maadi\b/,
      /\bಟ್ರ್ಯಾಕ್\b/, /\bಎಲ್ಲಿ ಇದೆ\b/, /\bಆರ್ಡರ್ ಎಲ್ಲಿ\b/,
      // Malayalam
      /\bevide und\b/, /\border evide\b/, /\beppol varum\b/, /\btrack cheyyuka\b/,
      /\bട്രാക്ക്\b/, /\bഎവിടെ ഉണ്ട്\b/, /\bഓർഡർ എവിടെ\b/,
      // Bengali
      /\bkothay ache\b/, /\border kothay\b/, /\bkokhon ashbe\b/, /\btrack koro\b/,
      /\bট্র্যাক\b/, /\bকোথায় আছে\b/, /\bঅর্ডার কোথায়\b/,
      // Marathi
      /\bkuthe aahe\b/, /\border kuthe\b/, /\bkevha yeil\b/, /\btrack kara\b/,
      /\bट्रॅक\b/, /\bकुठे आहे\b/, /\bऑर्डर कुठे\b/,
      // Gujarati
      /\bkya che\b/, /\border kya\b/, /\bkyare avshe\b/, /\btrack karo\b/,
      /\bટ્રેક\b/, /\bક્યાં છે\b/, /\bઓર્ડર ક્યાં\b/
    ];
    return trackPatterns.some(pattern => pattern.test(lowerText));
  },

  // Helper to detect order status intent from text/voice
  isOrderStatusIntent(text) {
    if (!text) return false;
    const lowerText = ' ' + text.toLowerCase() + ' ';
    
    // First check if it's actually a cancel/track intent - those take priority
    if (this.isCancelIntent(text) || this.isTrackIntent(text)) {
      return false;
    }
    
    const statusPatterns = [
      // English - singular and plural
      /\border status\b/, /\bcheck order\b/, /\border history\b/, /\bprevious order\b/,
      /\bpast order\b/, /\bshow order\b/, /\bview order\b/, /\border details\b/,
      /\bmy orders\b/, /\bmy order\b/, /\bstatus\b/,
      // Voice recognition variations for "my order" / "my orders"
      /\bmai order\b/, /\bmai orders\b/, /\bmay order\b/, /\bmay orders\b/,
      /\bmy oder\b/, /\bmy oders\b/, /\bmy orda\b/, /\bmy ordas\b/,
      // "order" standalone and variations
      /^order$/, /^orders$/, /^oder$/, /^oders$/, /^orda$/, /^ordas$/,
      // Hindi
      /\bmera order\b/, /\bmere order\b/, /\bmere orders\b/, /\bmera orders\b/,
      /\border kya hua\b/, /\border status kya hai\b/, /\border ka status\b/,
      /\border dikhao\b/, /\border batao\b/, /\bमेरा ऑर्डर\b/, /\bमेरे ऑर्डर\b/,
      /\bऑर्डर स्टेटस\b/, /\bऑर्डर क्या हुआ\b/, /\bस्टेटस\b/, /\bऑर्डर दिखाओ\b/,
      // Telugu
      /\bnaa order\b/, /\bnaa orders\b/, /\border chupinchu\b/, /\border chudu\b/,
      /\border status enti\b/, /\border em aindi\b/, /\bనా ఆర్డర్\b/, /\bఆర్డర్ చూపించు\b/,
      /\bఆర్డర్ స్టేటస్\b/, /\bస్టేటస్\b/,
      // Tamil
      /\ben order\b/, /\ben orders\b/, /\border kaattu\b/, /\border paaru\b/,
      /\border status enna\b/, /\border enna achu\b/, /\bஎன் ஆர்டர்\b/, /\bஆர்டர் காட்டு\b/,
      /\bஆர்டர் ஸ்டேட்டஸ்\b/, /\bஸ்டேட்டஸ்\b/,
      // Kannada
      /\bnanna order\b/, /\bnanna orders\b/, /\border toorisu\b/, /\border nodu\b/,
      /\border status enu\b/, /\border enu aaytu\b/, /\bನನ್ನ ಆರ್ಡರ್\b/, /\bಆರ್ಡರ್ ತೋರಿಸು\b/,
      /\bಆರ್ಡರ್ ಸ್ಟೇಟಸ್\b/, /\bಸ್ಟೇಟಸ್\b/,
      // Malayalam
      /\bente order\b/, /\bente orders\b/, /\border kaanikkuka\b/, /\border kaanu\b/,
      /\border status enthaanu\b/, /\border entha\b/, /\bഎന്റെ ഓർഡർ\b/, /\bഓർഡർ കാണിക്കുക\b/,
      /\bഓർഡർ സ്റ്റാറ്റസ്\b/, /\bസ്റ്റാറ്റസ്\b/,
      // Bengali
      /\bamar order\b/, /\bamar orders\b/, /\border dekho\b/, /\border dekhao\b/,
      /\border status ki\b/, /\border ki holo\b/, /\bআমার অর্ডার\b/, /\bঅর্ডার দেখো\b/,
      /\bঅর্ডার স্ট্যাটাস\b/, /\bস্ট্যাটাস\b/,
      // Marathi
      /\bmaza order\b/, /\bmaza orders\b/, /\border dakhva\b/, /\border bagha\b/,
      /\border status kay\b/, /\border kay jhala\b/, /\bमाझा ऑर्डर\b/, /\bऑर्डर दाखवा\b/,
      /\bऑर्डर स्टेटस\b/, /\bस्टेटस\b/,
      // Gujarati
      /\bmaru order\b/, /\bmaru orders\b/, /\border batavo\b/, /\border juo\b/,
      /\border status shu\b/, /\border shu thyu\b/, /\bમારું ઓર્ડર\b/, /\bઓર્ડર બતાવો\b/,
      /\bઓર્ડર સ્ટેટસ\b/, /\bસ્ટેટસ\b/
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
    
    // Try fuzzy matching with typo tolerance for ANY category (lowered threshold to 0.55)
    let bestMatch = null;
    let bestScore = 0;
    
    for (const cat of categories) {
      const catLower = cat.toLowerCase();
      // Split into words and check each
      const catWords = catLower.split(/\s+/);
      const searchWords = lowerText.split(/\s+/);
      
      for (const searchWord of searchWords) {
        if (searchWord.length < 2) continue;
        
        // Check against full category name with typo tolerance
        const fullScore = this.similarityWithTypoTolerance(searchWord, catLower);
        if (fullScore > bestScore && fullScore >= 0.55) {
          bestScore = fullScore;
          bestMatch = cat;
        }
        
        // Check against each word in category
        for (const catWord of catWords) {
          if (catWord.length < 2) continue;
          const wordScore = this.similarityWithTypoTolerance(searchWord, catWord);
          if (wordScore > bestScore && wordScore >= 0.55) {
            bestScore = wordScore;
            bestMatch = cat;
          }
        }
      }
      
      // Also check full text against category
      const fullTextScore = this.similarityWithTypoTolerance(lowerText, catLower);
      if (fullTextScore > bestScore && fullTextScore >= 0.55) {
        bestScore = fullTextScore;
        bestMatch = cat;
      }
    }
    
    if (bestMatch) {
      logger.info('Category fuzzy match', { text, bestMatch, score: Math.round(bestScore * 100) });
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

  // Common phonetic equivalents for fuzzy matching
  // Handles common misspellings like "brekfast" → "breakfast", "coffe" → "coffee"
  phoneticEquivalents: {
    'f': ['ph', 'ff'],
    'ph': ['f'],
    'k': ['c', 'ck', 'ch', 'q'],
    'c': ['k', 's'],
    's': ['c', 'z', 'ss'],
    'z': ['s', 'zz'],
    'i': ['y', 'ee', 'e'],
    'y': ['i', 'ie', 'ey'],
    'ee': ['i', 'ea', 'e'],
    'ea': ['ee', 'e'],
    'a': ['e', 'ah'],
    'e': ['a', 'i'],
    'o': ['u', 'oo'],
    'u': ['o', 'oo'],
    'oo': ['u', 'o'],
    'th': ['t', 'd'],
    'ch': ['c', 'tch'],
    'sh': ['s', 'sch'],
    'ge': ['j'],
    'j': ['g', 'dg'],
    'x': ['ks', 'cks'],
    'tion': ['sion', 'shun'],
    'sion': ['tion', 'shun'],
  },

  // Common food-related typos and their corrections
  // Helps match "brekfast" → "breakfast", "coffe" → "coffee", etc.
  commonFoodTypos: {
    // Breakfast variations
    'brekfast': 'breakfast', 'breakfst': 'breakfast', 'brekfst': 'breakfast',
    'breakast': 'breakfast', 'brakfast': 'breakfast', 'breaksfast': 'breakfast',
    'beakfast': 'breakfast', 'brekfest': 'breakfast', 'breakfeast': 'breakfast',
    'beak fasr': 'breakfast', 'beak fast': 'breakfast', 'break fast': 'breakfast',
    // Coffee/Tea
    'coffe': 'coffee', 'cofee': 'coffee', 'cofe': 'coffee', 'coffie': 'coffee',
    'caffe': 'coffee', 'koffee': 'coffee', 'coffy': 'coffee',
    'tee': 'tea', 'tae': 'tea', 'chai': 'tea',
    // Common foods - Biryani variations (very common typos)
    'biryni': 'biryani', 'biriyani': 'biryani', 'birani': 'biryani', 'bryani': 'biryani',
    'briyani': 'biryani', 'biriani': 'biryani', 'biriany': 'biryani',
    'biyani': 'biryani', 'biyrani': 'biryani', 'byrani': 'biryani', 'byriani': 'biryani',
    'birynai': 'biryani', 'biryain': 'biryani', 'biryanai': 'biryani', 'beryani': 'biryani',
    'beriyani': 'biryani', 'briynai': 'biryani', 'biryan': 'biryani', 'biryanii': 'biryani',
    'biriyanai': 'biryani', 'biriyni': 'biryani', 'briani': 'biryani', 'birni': 'biryani',
    'dosa': 'dosa', 'dosai': 'dosa', 'dhosa': 'dosa', 'thosai': 'dosa',
    'idli': 'idly', 'idly': 'idli', 'iddly': 'idli', 'idlee': 'idli',
    'samosa': 'samosa', 'samsa': 'samosa', 'samossa': 'samosa',
    'paratha': 'paratha', 'paratta': 'paratha', 'pratha': 'paratha', 'parantha': 'paratha',
    'chapathi': 'chapati', 'chapti': 'chapati', 'chapatti': 'chapati', 'roti': 'chapati',
    'puri': 'poori', 'poori': 'puri', 'pooris': 'puri',
    'naan': 'naan', 'nan': 'naan', 'naaan': 'naan',
    'pulao': 'pulav', 'pulav': 'pulao', 'pilaf': 'pulao', 'pilau': 'pulao',
    'paneer': 'paneer', 'panner': 'paneer', 'pannir': 'paneer', 'panir': 'paneer',
    'chicken': 'chicken', 'chiken': 'chicken', 'chickan': 'chicken', 'chikken': 'chicken',
    'mutton': 'mutton', 'muton': 'mutton', 'mutan': 'mutton',
    'manchurian': 'manchurian', 'manchuri': 'manchurian', 'manchuryan': 'manchurian',
    'manchuriyan': 'manchurian', 'manchuya': 'manchurian', 'manchuria': 'manchurian',
    'noodles': 'noodles', 'noodels': 'noodles', 'noodle': 'noodles', 'nudels': 'noodles',
    'pasta': 'pasta', 'psta': 'pasta', 'paasta': 'pasta',
    'pizza': 'pizza', 'piza': 'pizza', 'pizzza': 'pizza', 'pieza': 'pizza',
    'burger': 'burger', 'burgar': 'burger', 'burgur': 'burger', 'berger': 'burger',
    'sandwich': 'sandwich', 'sandwhich': 'sandwich', 'sandwitch': 'sandwich', 'sanwich': 'sandwich',
    'fries': 'fries', 'frys': 'fries', 'friez': 'fries', 'french fries': 'fries',
    'shake': 'shake', 'shaek': 'shake', 'milkshake': 'shake',
    'juice': 'juice', 'juce': 'juice', 'jucie': 'juice', 'jus': 'juice',
    'smoothie': 'smoothie', 'smoothe': 'smoothie', 'smoothy': 'smoothie',
    'curry': 'curry', 'curri': 'curry', 'kurry': 'curry', 'currie': 'curry',
    'gravy': 'gravy', 'gravey': 'gravy', 'gravi': 'gravy',
    'masala': 'masala', 'masla': 'masala', 'massala': 'masala', 'msala': 'masala',
    'tikka': 'tikka', 'tika': 'tikka', 'tikah': 'tikka',
    'kebab': 'kebab', 'kabab': 'kebab', 'kebap': 'kebab', 'kabob': 'kebab',
    'tandoori': 'tandoori', 'tandori': 'tandoori', 'thandoori': 'tandoori',
    'dessert': 'dessert', 'desert': 'dessert', 'desrt': 'dessert', 'dessrt': 'dessert',
    'icecream': 'ice cream', 'ice creem': 'ice cream', 'icecrem': 'ice cream',
    'sweets': 'sweets', 'sweet': 'sweets', 'swets': 'sweets',
    'beverages': 'beverages', 'beverges': 'beverages', 'beverage': 'beverages', 'bevrages': 'beverages',
    'snacks': 'snacks', 'snaks': 'snacks', 'snack': 'snacks', 'snax': 'snacks',
    'starter': 'starters', 'starters': 'starters', 'strters': 'starters',
    'appetizer': 'appetizer', 'apetizer': 'appetizer', 'appetiser': 'appetizer',
    'lunch': 'lunch', 'luch': 'lunch', 'lanch': 'lunch',
    'dinner': 'dinner', 'diner': 'dinner', 'dinnar': 'dinner',
    'thali': 'thali', 'thaali': 'thali', 'thaly': 'thali',
    'combo': 'combo', 'combi': 'combo', 'cumbo': 'combo',
    'meal': 'meals', 'meals': 'meals', 'mealz': 'meals',
    'special': 'special', 'spacial': 'special', 'speshal': 'special',
    'veg': 'veg', 'vege': 'veg', 'veggie': 'veg',
    'nonveg': 'nonveg', 'non veg': 'nonveg', 'non-veg': 'nonveg',
    // South Indian - Curd/Thayir variations (common typos)
    'thayir': 'curd', 'thaiyr': 'curd', 'tayir': 'curd', 'thair': 'curd', 
    'thayr': 'curd', 'thyir': 'curd', 'thayri': 'curd', 'thayeer': 'curd',
    'thaiir': 'curd', 'thaiyir': 'curd', 'thaiyar': 'curd', 'tayeer': 'curd',
    'perugu': 'curd', 'peruug': 'curd', 'perugu': 'curd', 'perguu': 'curd',
    'mosaru': 'curd', 'mosuru': 'curd', 'mosru': 'curd',
    'dahi': 'curd', 'dhahi': 'curd', 'dahee': 'curd',
    'curd': 'curd', 'curd rice': 'curd rice', 'curds': 'curd',
    'thayir sadam': 'curd rice', 'thaiyr sadam': 'curd rice', 'tayir sadam': 'curd rice',
    'thayir rice': 'curd rice', 'perugu annam': 'curd rice', 'mosaru anna': 'curd rice',
    'dahi chawal': 'curd rice', 'dahi rice': 'curd rice',
    // South Indian - Other items
    'uttapam': 'uttapam', 'utapam': 'uttapam', 'uthappam': 'uttapam', 'utappam': 'uttapam',
    'vada': 'vada', 'vadai': 'vada', 'wada': 'vada', 'bada': 'vada', 'vadaa': 'vada',
    'upma': 'upma', 'uppma': 'upma', 'upuma': 'upma', 'uppuma': 'upma', 'uppit': 'upma',
    'pongal': 'pongal', 'pongel': 'pongal', 'pongl': 'pongal', 'pongali': 'pongal',
    'rasam': 'rasam', 'rasaam': 'rasam', 'russam': 'rasam', 'rasamu': 'rasam',
    'sambar': 'sambar', 'sambhar': 'sambar', 'samber': 'sambar', 'saambar': 'sambar',
    'chutney': 'chutney', 'chatni': 'chutney', 'chutnee': 'chutney', 'chatney': 'chutney',
    'pesarattu': 'pesarattu', 'pesarat': 'pesarattu', 'pesaratu': 'pesarattu', 'pesarathu': 'pesarattu',
    'pulihora': 'tamarind rice', 'pulihoura': 'tamarind rice', 'pulihara': 'tamarind rice',
    'gongura': 'gongura', 'gongora': 'gongura', 'gangura': 'gongura', 'gonguru': 'gongura',
    // Rice varieties
    'sadam': 'rice', 'annam': 'rice', 'anna': 'rice', 'chawal': 'rice', 'rice': 'rice',
    'lemon rice': 'lemon rice', 'nimbu rice': 'lemon rice', 'nimmakaya annam': 'lemon rice',
    'tomato rice': 'tomato rice', 'tomato annam': 'tomato rice',
    'coconut rice': 'coconut rice', 'kobbari annam': 'coconut rice',
    // North Indian
    'roti': 'roti', 'rotis': 'roti', 'rooti': 'roti', 'rotti': 'roti',
    'dal': 'dal', 'daal': 'dal', 'dhal': 'dal', 'dhall': 'dal',
    'rajma': 'rajma', 'rajmah': 'rajma', 'razma': 'rajma', 'rajmaa': 'rajma',
    'chole': 'chole', 'choley': 'chole', 'chhole': 'chole', 'chana': 'chole', 'chholey': 'chole',
    'aloo': 'aloo', 'alu': 'aloo', 'aaloo': 'aloo', 'allu': 'aloo',
    'gobi': 'gobi', 'gobhi': 'gobi', 'ghobi': 'gobi', 'gobhee': 'gobi',
    'palak': 'palak', 'paalak': 'palak', 'spinach': 'palak', 'paalak': 'palak',
    // Chinese
    'fried rice': 'fried rice', 'friedrice': 'fried rice', 'fry rice': 'fried rice', 'fryrice': 'fried rice',
    'chowmein': 'chow mein', 'chowmin': 'chow mein', 'chawmein': 'chow mein', 'chowmine': 'chow mein',
    'hakka': 'hakka', 'haka': 'hakka', 'hakaa': 'hakka', 'hakka noodles': 'hakka noodles',
    'schezwan': 'schezwan', 'szechuan': 'schezwan', 'schewan': 'schezwan', 'sichuan': 'schezwan', 'schezuan': 'schezwan',
  },

  // Get corrected food term if it's a common typo
  correctFoodTypo(text) {
    const lowerText = text.toLowerCase().trim();
    return this.commonFoodTypos[lowerText] || text;
  },

  // Keyboard adjacent keys for typo tolerance
  keyboardAdjacent: {
    'q': ['w', 'a'], 'w': ['q', 'e', 's', 'a'], 'e': ['w', 'r', 'd', 's'],
    'r': ['e', 't', 'f', 'd'], 't': ['r', 'y', 'g', 'f'], 'y': ['t', 'u', 'h', 'g'],
    'u': ['y', 'i', 'j', 'h'], 'i': ['u', 'o', 'k', 'j'], 'o': ['i', 'p', 'l', 'k'],
    'p': ['o', 'l'], 'a': ['q', 'w', 's', 'z'], 's': ['a', 'w', 'e', 'd', 'x', 'z'],
    'd': ['s', 'e', 'r', 'f', 'c', 'x'], 'f': ['d', 'r', 't', 'g', 'v', 'c'],
    'g': ['f', 't', 'y', 'h', 'b', 'v'], 'h': ['g', 'y', 'u', 'j', 'n', 'b'],
    'j': ['h', 'u', 'i', 'k', 'm', 'n'], 'k': ['j', 'i', 'o', 'l', 'm'],
    'l': ['k', 'o', 'p'], 'z': ['a', 's', 'x'], 'x': ['z', 's', 'd', 'c'],
    'c': ['x', 'd', 'f', 'v'], 'v': ['c', 'f', 'g', 'b'], 'b': ['v', 'g', 'h', 'n'],
    'n': ['b', 'h', 'j', 'm'], 'm': ['n', 'j', 'k']
  },

  // Check if two characters are keyboard-adjacent (common typo)
  isKeyboardAdjacent(char1, char2) {
    const c1 = char1.toLowerCase();
    const c2 = char2.toLowerCase();
    return this.keyboardAdjacent[c1]?.includes(c2) || this.keyboardAdjacent[c2]?.includes(c1);
  },

  // Calculate similarity with keyboard typo tolerance
  // Gives partial credit for keyboard-adjacent character substitutions
  // Also handles common typo patterns: missing letters, swapped letters, extra letters
  similarityWithTypoTolerance(str1, str2) {
    const s1 = str1.toLowerCase();
    const s2 = str2.toLowerCase();
    
    // Exact match
    if (s1 === s2) return 1;
    
    // One is prefix of other (e.g., "biryan" vs "biryani")
    if (s1.startsWith(s2) || s2.startsWith(s1)) {
      const shorter = Math.min(s1.length, s2.length);
      const longer = Math.max(s1.length, s2.length);
      // High score if only 1-2 chars difference
      if (longer - shorter <= 2) {
        return 0.85 + (shorter / longer) * 0.1;
      }
    }
    
    // Standard Levenshtein for base score
    const baseScore = this.similarityRatio(s1, s2);
    
    // Calculate bonus for keyboard-adjacent typos
    let typoBonus = 0;
    const minLen = Math.min(s1.length, s2.length);
    const maxLen = Math.max(s1.length, s2.length);
    
    // Only give bonus if lengths are similar (within 2 chars)
    if (Math.abs(s1.length - s2.length) <= 2) {
      let adjacentTypos = 0;
      let swappedChars = 0;
      
      for (let i = 0; i < minLen; i++) {
        if (s1[i] !== s2[i]) {
          // Check for keyboard-adjacent typos
          if (this.isKeyboardAdjacent(s1[i], s2[i])) {
            adjacentTypos++;
          }
          // Check for swapped adjacent characters (e.g., "teh" vs "the")
          if (i < minLen - 1 && s1[i] === s2[i + 1] && s1[i + 1] === s2[i]) {
            swappedChars++;
          }
        }
      }
      // Each keyboard-adjacent typo adds a small bonus (max 0.15 bonus)
      typoBonus = Math.min(0.20, adjacentTypos * 0.05 + swappedChars * 0.08);
    }
    
    // Check for single missing vowel (common typo: "biyani" vs "biryani")
    const vowelBonus = this.checkMissingVowelSimilarity(s1, s2);
    
    return Math.min(1, baseScore + typoBonus + vowelBonus);
  },

  // Check if strings are similar with a single missing/extra vowel
  checkMissingVowelSimilarity(s1, s2) {
    const vowels = 'aeiou';
    const lenDiff = Math.abs(s1.length - s2.length);
    
    // Only check if exactly 1 character difference
    if (lenDiff !== 1) return 0;
    
    const longer = s1.length > s2.length ? s1 : s2;
    const shorter = s1.length > s2.length ? s2 : s1;
    
    // Try removing each character from longer and check if it matches shorter
    for (let i = 0; i < longer.length; i++) {
      const charRemoved = longer.slice(0, i) + longer.slice(i + 1);
      if (charRemoved === shorter) {
        // Extra bonus if the missing char is a vowel (common typo)
        if (vowels.includes(longer[i])) {
          return 0.12;
        }
        return 0.08;
      }
    }
    
    return 0;
  },

  // Normalize common typos and phonetic variations
  normalizeTypos(text) {
    let normalized = text.toLowerCase();
    
    // Common typo patterns: doubled letters → single, missing letters
    const typoPatterns = [
      [/(.)(\1)+/g, '$1'],  // Remove repeated letters: "cofffee" → "cofee"
      [/([aeiou])\1/g, '$1'], // Reduce doubled vowels: "breead" → "bread"
      [/ck/g, 'k'],  // "breakckfast" → "breakast"
      [/kk/g, 'k'],  // "breakkfast" → "breakfast"
      [/ff/g, 'f'],  // "cofffee" → "cofee"
      [/ss/g, 's'],  // "classs" → "class"
    ];
    
    for (const [pattern, replacement] of typoPatterns) {
      normalized = normalized.replace(pattern, replacement);
    }
    
    return normalized;
  },

  // Generate phonetic variations of a word for matching
  generatePhoneticVariations(word) {
    const variations = [word];
    const wordLower = word.toLowerCase();
    
    // Add normalized typo version
    const normalized = this.normalizeTypos(wordLower);
    if (normalized !== wordLower) variations.push(normalized);
    
    // Generate phonetic variations
    for (const [sound, equivalents] of Object.entries(this.phoneticEquivalents)) {
      if (wordLower.includes(sound)) {
        for (const equiv of equivalents) {
          const variant = wordLower.replace(sound, equiv);
          if (variant !== wordLower) variations.push(variant);
        }
      }
    }
    
    return [...new Set(variations)];
  },

  // Dynamic typo correction - finds best matching item/tag for any search term
  // Works for ANY menu item, not just hardcoded ones
  // IMPORTANT: Only corrects if search term doesn't already match something in menu
  findBestMatchingTerm(searchTerm, menuItems) {
    if (!searchTerm || searchTerm.length < 2) return null;
    
    const searchLower = searchTerm.toLowerCase().trim();
    let bestMatch = null;
    let bestScore = 0;
    // Dynamic threshold based on word length - shorter words need higher similarity
    // "dal" (3 chars) needs 60%+, "biryani" (7 chars) needs 50%+
    const threshold = searchLower.length <= 3 ? 0.60 : 
                      searchLower.length <= 5 ? 0.50 : 0.45;
    
    // Collect all possible targets from menu items
    const targets = new Set();
    
    for (const item of menuItems) {
      // Add item name and its words
      targets.add(item.name.toLowerCase());
      item.name.toLowerCase().split(/\s+/).forEach(w => w.length >= 3 && targets.add(w));
      
      // Add all tags and their words
      if (item.tags) {
        item.tags.forEach(tag => {
          targets.add(tag.toLowerCase());
          tag.toLowerCase().split(/\s+/).forEach(w => w.length >= 3 && targets.add(w));
        });
      }
      
      // Add categories
      const cats = Array.isArray(item.category) ? item.category : [item.category];
      cats.forEach(cat => cat && targets.add(cat.toLowerCase()));
    }
    
    // ========== CHECK IF SEARCH TERM ALREADY MATCHES SOMETHING ==========
    // Don't "correct" valid search terms that already exist in the menu
    // e.g., "sapota" should NOT be corrected to "apple" if "sapota" exists as a tag
    const searchWords = searchLower.split(/\s+/).filter(w => w.length >= 2);
    for (const word of searchWords) {
      for (const target of targets) {
        // Check if any search word exactly matches a target, or target contains the word
        if (target === word || target.includes(word) || word.includes(target)) {
          logger.info('Search term already matches', { term: word });
          return null; // Don't correct, the term is valid
        }
      }
    }
    
    // Find the best matching target for the search term
    for (const target of targets) {
      // Skip very short targets
      if (target.length < 2) continue;
      
      // Calculate similarity with typo tolerance
      const score = this.similarityWithTypoTolerance(searchLower, target);
      
      // Also try with normalized versions
      const normalizedSearch = this.normalizeTypos(searchLower);
      const normalizedTarget = this.normalizeTypos(target);
      const normalizedScore = this.similarityWithTypoTolerance(normalizedSearch, normalizedTarget);
      
      const finalScore = Math.max(score, normalizedScore);
      
      if (finalScore > bestScore && finalScore >= threshold) {
        bestScore = finalScore;
        bestMatch = target;
      }
    }
    
    // If we found a match better than the original, return it
    if (bestMatch && bestMatch !== searchLower && bestScore >= threshold) {
      logger.info('Dynamic typo match', { searchTerm, bestMatch });
      return bestMatch;
    }
    
    return null;
  },

  // Get corrected food term - checks both hardcoded dictionary AND dynamic menu matching
  correctFoodTypoDynamic(text, menuItems) {
    const lowerText = text.toLowerCase().trim();
    
    // First check hardcoded common typos (fast lookup)
    const hardcodedCorrection = this.commonFoodTypos[lowerText];
    if (hardcodedCorrection && hardcodedCorrection !== lowerText) {
      return hardcodedCorrection;
    }
    
    // Then try dynamic matching against actual menu items
    if (menuItems && menuItems.length > 0) {
      const dynamicMatch = this.findBestMatchingTerm(lowerText, menuItems);
      if (dynamicMatch) {
        return dynamicMatch;
      }
    }
    
    return text;
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
  // Returns items where name or tags have similarity >= threshold (default 0.45 = 45% similar)
  // Enhanced with: keyboard typo tolerance, phonetic matching, word reordering, dynamic menu matching
  // Works for ANY menu item - not just hardcoded foods
  fuzzySearchItems(searchTerm, menuItems, threshold = 0.45) {
    if (!searchTerm || searchTerm.length < 2) return [];
    
    // Skip fuzzy search for gibberish queries
    if (this.isGibberishSearch(searchTerm)) {
      logger.info('Gibberish search detected', { searchTerm });
      return [];
    }
    
    const searchLower = searchTerm.toLowerCase().trim();
    
    // First check hardcoded typos, then try dynamic matching
    let correctedSearch = this.correctFoodTypo(searchLower);
    if (correctedSearch === searchLower) {
      // No hardcoded match, try dynamic matching
      const dynamicMatch = this.findBestMatchingTerm(searchLower, menuItems);
      if (dynamicMatch) {
        correctedSearch = dynamicMatch;
      }
    }
    
    const searchTerms = correctedSearch !== searchLower 
      ? [correctedSearch, searchLower]  // Search with both corrected and original
      : [searchLower];
    
    // Also check individual words for typos (e.g., "beak fasr" → check "beak" and "fasr")
    const searchWords = searchLower.split(/\s+/).filter(w => w.length >= 2);
    for (const word of searchWords) {
      // Check hardcoded first
      let correctedWord = this.correctFoodTypo(word);
      // Then try dynamic matching
      if (correctedWord === word) {
        const dynamicWordMatch = this.findBestMatchingTerm(word, menuItems);
        if (dynamicWordMatch) {
          correctedWord = dynamicWordMatch;
        }
      }
      if (correctedWord !== word && !searchTerms.includes(correctedWord)) {
        searchTerms.push(correctedWord);
      }
    }
    
    // Combined words check (e.g., "break fast" → "breakfast")
    if (searchWords.length >= 2) {
      const combined = searchWords.join('');
      const correctedCombined = this.correctFoodTypo(combined);
      if (!searchTerms.includes(combined)) searchTerms.push(combined);
      if (correctedCombined !== combined && !searchTerms.includes(correctedCombined)) {
        searchTerms.push(correctedCombined);
      }
    }
    
    const searchNormalized = this.normalizeTypos(searchLower);
    const searchPhoneticVariants = this.generatePhoneticVariations(searchLower);
    // Add corrected terms to phonetic variants
    for (const term of searchTerms) {
      searchPhoneticVariants.push(...this.generatePhoneticVariations(term));
    }
    
    const fuzzyMatches = [];
    
    for (const item of menuItems) {
      let bestScore = 0;
      let matchedOn = null;
      
      // Helper to check all variations of search against a target
      const checkAllVariations = (target) => {
        const targetLower = target.toLowerCase();
        const targetNormalized = this.normalizeTypos(targetLower);
        let maxScore = 0;
        
        // Check corrected search terms (including common food typo corrections)
        for (const term of searchTerms) {
          maxScore = Math.max(maxScore, this.similarityWithTypoTolerance(term, targetLower));
          maxScore = Math.max(maxScore, this.similarityRatio(term, targetLower));
        }
        
        // Check direct similarity with typo tolerance
        maxScore = Math.max(maxScore, this.similarityWithTypoTolerance(searchLower, targetLower));
        maxScore = Math.max(maxScore, this.similarityWithTypoTolerance(searchNormalized, targetNormalized));
        
        // Check phonetic variations
        for (const variant of searchPhoneticVariants) {
          maxScore = Math.max(maxScore, this.similarityRatio(variant, targetLower));
        }
        
        // Check if search words match parts of target (handles word reordering)
        if (searchWords.length > 1) {
          const targetWords = targetLower.split(/\s+/);
          let matchedWords = 0;
          for (const sw of searchWords) {
            // Check both original and corrected word
            const correctedSw = this.correctFoodTypo(sw);
            for (const tw of targetWords) {
              if (this.similarityWithTypoTolerance(sw, tw) >= 0.65 || 
                  this.similarityWithTypoTolerance(correctedSw, tw) >= 0.65) {
                matchedWords++;
                break;
              }
            }
          }
          const wordMatchRatio = matchedWords / searchWords.length;
          maxScore = Math.max(maxScore, wordMatchRatio);
        }
        
        // Check individual search words against target
        for (const word of searchWords) {
          if (word.length >= 2) {
            const correctedWord = this.correctFoodTypo(word);
            maxScore = Math.max(maxScore, this.similarityWithTypoTolerance(word, targetLower));
            maxScore = Math.max(maxScore, this.similarityWithTypoTolerance(correctedWord, targetLower));
            // Check against target words
            const targetWords = targetLower.split(/\s+/);
            for (const tw of targetWords) {
              if (tw.length >= 2) {
                maxScore = Math.max(maxScore, this.similarityWithTypoTolerance(word, tw));
                maxScore = Math.max(maxScore, this.similarityWithTypoTolerance(correctedWord, tw));
              }
            }
          }
        }
        
        return maxScore;
      };
      
      // Check item name
      const nameScore = checkAllVariations(item.name);
      if (nameScore > bestScore) {
        bestScore = nameScore;
        matchedOn = 'name';
      }
      
      // Check individual words in name
      const nameWords = item.name.toLowerCase().split(/\s+/);
      for (const word of nameWords) {
        if (word.length >= 3) {
          const wordScore = checkAllVariations(word);
          if (wordScore > bestScore) {
            bestScore = wordScore;
            matchedOn = 'name';
          }
        }
      }
      
      // Check tags
      if (item.tags && item.tags.length > 0) {
        for (const tag of item.tags) {
          const tagScore = checkAllVariations(tag);
          if (tagScore > bestScore) {
            bestScore = tagScore;
            matchedOn = 'tag';
          }
          
          // Check individual words in tag
          const tagWords = tag.toLowerCase().split(/\s+/);
          for (const word of tagWords) {
            if (word.length >= 3) {
              const wordScore = checkAllVariations(word);
              if (wordScore > bestScore) {
                bestScore = wordScore;
                matchedOn = 'tag';
              }
            }
          }
        }
      }
      
      // Check categories
      const categories = Array.isArray(item.category) ? item.category : [item.category];
      for (const cat of categories) {
        if (cat) {
          const catScore = checkAllVariations(cat);
          if (catScore > bestScore) {
            bestScore = catScore;
            matchedOn = 'category';
          }
        }
      }
      
      // Check variant labels (variant names like "Chicken Biryani", "Mutton Biryani")
      if (item.variants && item.variants.length > 0) {
        for (const variant of item.variants) {
          if (variant.label) {
            const variantLabelScore = checkAllVariations(variant.label);
            if (variantLabelScore > bestScore) {
              bestScore = variantLabelScore;
              matchedOn = 'variant';
            }
            // Check individual words in variant label
            const variantWords = variant.label.toLowerCase().split(/\s+/);
            for (const word of variantWords) {
              if (word.length >= 3) {
                const wordScore = checkAllVariations(word);
                if (wordScore > bestScore) {
                  bestScore = wordScore;
                  matchedOn = 'variant';
                }
              }
            }
          }
          // Check variant tags
          if (variant.tags && variant.tags.length > 0) {
            for (const tag of variant.tags) {
              const vTagScore = checkAllVariations(tag);
              if (vTagScore > bestScore) {
                bestScore = vTagScore;
                matchedOn = 'variant_tag';
              }
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

  // Helper to find item by name (with dynamic fuzzy fallback - works for ANY item)
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
    
    // Try dynamic typo correction first
    const corrected = this.findBestMatchingTerm(lowerText, menuItems);
    if (corrected && corrected !== lowerText) {
      const correctedMatch = menuItems.find(item => 
        this.smartIncludes(corrected, item.name) || 
        item.name.toLowerCase() === corrected
      );
      if (correctedMatch) return correctedMatch;
    }
    
    // Fuzzy fallback for typos (lowered threshold to 0.55)
    if (lowerText.length >= 2) {
      for (const item of menuItems) {
        const nameLower = item.name.toLowerCase();
        // Check full name similarity
        if (this.similarityWithTypoTolerance(lowerText, nameLower) >= 0.55) {
          return item;
        }
        // Check each word in name
        const nameWords = nameLower.split(/\s+/);
        for (const word of nameWords) {
          if (word.length >= 2 && this.similarityWithTypoTolerance(lowerText, word) >= 0.6) {
            return item;
          }
        }
      }
    }
    
    return null;
  },

  // Helper to find items by tag keyword (with dynamic fuzzy matching - works for ANY tag)
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
    
    // Try dynamic typo correction
    if (matchingItems.length === 0) {
      const corrected = this.findBestMatchingTerm(lowerText, menuItems);
      if (corrected && corrected !== lowerText) {
        matchingItems = menuItems.filter(item => 
          item.tags?.some(tag => 
            tag.toLowerCase().includes(corrected) || 
            corrected.includes(tag.toLowerCase())
          )
        );
      }
    }
    
    // Fuzzy fallback if no exact matches (lowered threshold to 0.5)
    if (matchingItems.length === 0 && lowerText.length >= 2) {
      matchingItems = menuItems.filter(item => {
        return item.tags?.some(tag => {
          const tagLower = tag.toLowerCase();
          // Check tag similarity
          if (this.similarityWithTypoTolerance(lowerText, tagLower) >= 0.5) return true;
          // Check tag words
          const tagWords = tagLower.split(/\s+/);
          return tagWords.some(word => 
            word.length >= 2 && this.similarityWithTypoTolerance(lowerText, word) >= 0.55
          );
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

  // Food synonyms - regional/local names mapped to common English equivalents
  // Used to expand search terms for better matching
  foodSynonyms: {
    // ========== MEAL TIME SYNONYMS ==========
    // Breakfast/Morning/Tiffin - all should match each other (including spelling variations)
    'breakfast': ['breakfast', 'tiffin', 'tiffins', 'tifin', 'tifins', 'morning', 'nashta', 'naashta', 'subah'],
    'tiffin': ['tiffin', 'tiffins', 'tifin', 'tifins', 'breakfast', 'morning', 'nashta', 'naashta'],
    'tiffins': ['tiffins', 'tiffin', 'tifin', 'tifins', 'breakfast', 'morning'],
    'tifin': ['tifin', 'tifins', 'tiffin', 'tiffins', 'breakfast', 'morning', 'nashta'],
    'tifins': ['tifins', 'tifin', 'tiffin', 'tiffins', 'breakfast', 'morning'],
    'morning': ['morning', 'breakfast', 'tiffin', 'tiffins', 'tifin', 'tifins', 'nashta', 'subah'],
    'nashta': ['nashta', 'naashta', 'breakfast', 'tiffin', 'tifin', 'morning'],
    'naashta': ['naashta', 'nashta', 'breakfast', 'tiffin', 'tifin', 'morning'],
    // Lunch/Dinner/Meals
    'lunch': ['lunch', 'meals', 'meal', 'thali', 'afternoon', 'bhojan', 'khana'],
    'dinner': ['dinner', 'meals', 'meal', 'thali', 'night', 'raat', 'bhojan'],
    'meals': ['meals', 'meal', 'lunch', 'dinner', 'thali', 'bhojan'],
    'meal': ['meal', 'meals', 'lunch', 'dinner', 'thali'],
    'thali': ['thali', 'meals', 'meal', 'lunch', 'dinner'],
    // Snacks/Evening
    'snacks': ['snacks', 'snack', 'starters', 'appetizer', 'evening', 'tea time', 'chat', 'chaat'],
    'starters': ['starters', 'snacks', 'appetizer', 'appetizers'],
    'evening': ['evening', 'snacks', 'tea time'],
    // ========== BREAD/ROTI SYNONYMS ==========
    // Pulka, Phulka, Chapathi, Roti - all are similar flatbreads
    'pulka': ['chapati', 'chapathi', 'roti', 'phulka', 'fulka', 'rotla', 'rotta'],
    'phulka': ['chapati', 'chapathi', 'roti', 'pulka', 'fulka', 'rotla', 'rotta'],
    'fulka': ['chapati', 'chapathi', 'roti', 'pulka', 'phulka', 'rotla', 'rotta'],
    'chapati': ['chapati', 'chapathi', 'roti', 'pulka', 'phulka', 'fulka', 'rotta'],
    'chapathi': ['chapathi', 'chapati', 'roti', 'pulka', 'phulka', 'fulka', 'rotta'],
    'roti': ['roti', 'chapati', 'chapathi', 'pulka', 'phulka', 'fulka', 'rotta'],
    'rotta': ['roti', 'chapati', 'chapathi', 'pulka', 'phulka', 'rotla'],
    'rotla': ['roti', 'chapati', 'chapathi', 'pulka', 'phulka', 'rotta'],
    // Parotta/Paratha variations
    'parotta': ['parotta', 'paratha', 'barotta', 'porotta', 'kerala parotta'],
    'paratha': ['paratha', 'parotta', 'barotta', 'prantha'],
    'barotta': ['parotta', 'paratha', 'barotta', 'porotta'],
    // Naan variations
    'naan': ['naan', 'nan', 'tandoori naan', 'butter naan'],
    'nan': ['naan', 'nan', 'tandoori naan'],
    // Poori/Puri variations
    'poori': ['poori', 'puri', 'pooree'],
    'puri': ['puri', 'poori', 'pooree'],
    // ========== FOOD TYPE SYNONYMS ==========
    // Telugu/South Indian curry terms
    'pulusu': ['curry', 'gravy', 'pulusu'],
    'kura': ['curry', 'sabji', 'vegetable'],
    'koora': ['curry', 'sabji', 'vegetable'],
    'iguru': ['fry', 'dry curry', 'roast'],
    'vepudu': ['fry', 'stir fry'],
    'perugu': ['curd', 'yogurt', 'dahi'],
    'pappu': ['dal', 'lentils'],
    'charu': ['rasam', 'soup'],
    'pachadi': ['chutney', 'raita'],
    'pulihora': ['tamarind rice', 'puliyogare'],
    'annam': ['rice', 'chawal'],
    // Tamil terms
    'kuzhambu': ['curry', 'gravy', 'kulambu'],
    'kozhi': ['chicken', 'kodi'],
    'meen': ['fish', 'chepa'],
    'kari': ['curry', 'meat curry'],
    'varuval': ['fry', 'roast'],
    'poriyal': ['stir fry', 'vegetable fry'],
    'kootu': ['curry', 'mixed vegetable'],
    'thokku': ['pickle', 'chutney'],
    // Hindi terms
    'sabzi': ['curry', 'vegetable', 'sabji'],
    'rassa': ['curry', 'gravy'],
    'bhaji': ['fry', 'vegetable fry'],
    'tarkari': ['curry', 'vegetable'],
    // Common variations
    'curry': ['curry', 'gravy', 'kura', 'pulusu', 'kuzhambu'],
    'gravy': ['curry', 'gravy', 'rassa'],
    'fry': ['fry', 'vepudu', 'varuval', 'roast'],
    'biryani': ['biryani', 'biriyani', 'briyani', 'birani', 'biriani', 'byriani', 'bryani'],
    'rice': ['rice', 'annam', 'chawal', 'bhat'],
    // Chinese/Indo-Chinese items with common misspellings
    'manchurian': ['manchurian', 'manchuriya', 'manchuria', 'manchuya', 'manchurya', 'manchuri', 'manchu', 'manchoorian'],
    'manchuriya': ['manchurian', 'manchuriya', 'manchuria', 'manchuya', 'manchurya', 'manchuri'],
    'manchuya': ['manchurian', 'manchuriya', 'manchuria', 'manchuya', 'manchurya'],
    'noodles': ['noodles', 'noodels', 'nodles', 'nudels', 'nuddles'],
    'chowmein': ['chowmein', 'chowmin', 'chow mein', 'chow min', 'chowmain', 'chawmin'],
    'momos': ['momos', 'momo', 'momu', 'mamus'],
    'schezwan': ['schezwan', 'szechuan', 'schezuan', 'shezwan', 'sezwan', 'schezwan'],
    'hakka': ['hakka', 'haka', 'hakaa'],
    'fried rice': ['fried rice', 'friedrice', 'fry rice', 'fryrice'],
    // South Indian items
    'idli': ['idli', 'idly', 'idle', 'undi'],
    'idly': ['idly', 'idli', 'idle', 'undi'],
    'undi': ['idli', 'idly', 'idle', 'undi'],
    'dosa': ['dosa', 'dosai', 'dhosha', 'dose', 'attu'],
    'dosai': ['dosai', 'dosa', 'dose', 'attu'],
    'attu': ['dosa', 'dosai', 'attu'],
    'vada': ['vada', 'vadai', 'wade', 'medu vada', 'wada', 'garelu'],
    'vadai': ['vadai', 'vada', 'wade', 'wada', 'garelu'],
    'wada': ['vada', 'vadai', 'wade', 'wada', 'garelu'],
    'garelu': ['vada', 'vadai', 'garelu', 'medu vada'],
    'upma': ['upma', 'uppuma', 'uppit', 'uppittu'],
    'uppit': ['upma', 'uppuma', 'uppit', 'uppittu'],
    'uppittu': ['upma', 'uppuma', 'uppit', 'uppittu'],
    'pongal': ['pongal', 'pongali', 'ven pongal'],
    'uttapam': ['uttapam', 'uthappam', 'utappam'],
    'pesarattu': ['pesarattu', 'pesaratu', 'pesarat', 'pesara dosa'],
    'pesarat': ['pesarattu', 'pesaratu', 'pesarat'],
    // Poha/Avalakki
    'poha': ['poha', 'pohe', 'avalakki', 'atukulu', 'chivda'],
    'avalakki': ['poha', 'avalakki', 'atukulu'],
    'atukulu': ['poha', 'avalakki', 'atukulu'],
    // Common misspellings for popular items
    'paneer': ['paneer', 'paner', 'panir', 'panner'],
    'samosa': ['samosa', 'samsa', 'samoza', 'sumosa'],
    'pakora': ['pakora', 'pakoda', 'pakodi', 'bhajji', 'bhaji'],
    'pakoda': ['pakoda', 'pakora', 'pakodi', 'bhajji', 'bhaji'],
    'chutney': ['chutney', 'chatni', 'chutni', 'chatney'],
    'korma': ['korma', 'kurma', 'qorma'],
    'kebab': ['kebab', 'kabab', 'kabob', 'kebob'],
    'tikka': ['tikka', 'tika', 'tikaa'],
    'tandoori': ['tandoori', 'tanduri', 'tandoor', 'tandori'],
    'masala': ['masala', 'masalla', 'massala'],
    'paratha': ['paratha', 'parotta', 'parantha', 'pratha', 'prantha'],
    'kulcha': ['kulcha', 'kulca', 'kulchaa'],
    'lassi': ['lassi', 'lasi', 'lasee', 'lassy'],
    'raita': ['raita', 'raitha', 'rayta'],
    'kheer': ['kheer', 'khir', 'keer', 'payasam'],
    'halwa': ['halwa', 'halva', 'halwaa', 'sheera'],
    'jalebi': ['jalebi', 'jilebi', 'jaleebi'],
    'gulab jamun': ['gulab jamun', 'gulabjamun', 'gulab jamoon', 'jamun'],
    'rasmalai': ['rasmalai', 'ras malai', 'rasmallai', 'rasmalae'],
    'burger': ['burger', 'burgar', 'berger', 'burgur'],
    'pizza': ['pizza', 'piza', 'pizzza', 'pezza'],
    'sandwich': ['sandwich', 'sandwitch', 'sandwhich', 'sanwich'],
    'shake': ['shake', 'shak', 'shaik', 'milk shake', 'milkshake'],
    'juice': ['juice', 'juce', 'joos', 'juise'],
    'coffee': ['coffee', 'coffe', 'cofee', 'koffee', 'kaafi'],
    'tea': ['tea', 'chai', 'chay', 'tee'],
    'omelette': ['omelette', 'omlet', 'omelet', 'omlette', 'omlete']
  },

  // Get synonyms for a search term
  getSynonyms(term) {
    const lowerTerm = term.toLowerCase();
    const synonyms = [lowerTerm];
    
    // Check if term has synonyms
    if (this.foodSynonyms[lowerTerm]) {
      synonyms.push(...this.foodSynonyms[lowerTerm]);
    }
    
    // Also check if term is a synonym of something else
    for (const [key, values] of Object.entries(this.foodSynonyms)) {
      if (values.includes(lowerTerm) && !synonyms.includes(key)) {
        synonyms.push(key);
      }
    }
    
    return [...new Set(synonyms)];
  },

  // Helper to transliterate regional language words to English equivalents (basic mapping)
  transliterate(text) {
    const transliterationMap = {
      // Hindi to English - Common food items
      'ब्रेड': 'bread', 'रोटी': 'roti', 'चावल': 'rice', 'दाल': 'dal',
      'सब्जी': 'sabji', 'पनीर': 'paneer', 'चिकन': 'chicken', 'मटन': 'mutton',
      'बिरयानी': 'biryani', 'पुलाव': 'pulao', 'नान': 'naan', 'पराठा': 'paratha',
      'समोसा': 'samosa', 'पकोड़ा': 'pakoda', 'चाय': 'tea', 'कॉफी': 'coffee',
      'लस्सी': 'lassi', 'जूस': 'juice', 'पानी': 'water', 'कोल्ड ड्रिंक': 'cold drink',
      'आइसक्रीम': 'ice cream', 'केक': 'cake', 'मिठाई': 'sweet', 'गुलाब जामुन': 'gulab jamun',
      'पिज़्ज़ा': 'pizza', 'बर्गर': 'burger', 'सैंडविच': 'sandwich', 'मोमो': 'momo',
      'नूडल्स': 'noodles', 'फ्राइड राइस': 'fried rice', 'मंचूरियन': 'manchurian',
      'सूप': 'soup', 'सलाद': 'salad', 'फ्राइज़': 'fries', 'चिप्स': 'chips',
      'अंडा': 'egg', 'आमलेट': 'omelette', 'मछली': 'fish', 'झींगा': 'prawn',
      'तंदूरी': 'tandoori', 'कबाब': 'kabab', 'टिक्का': 'tikka', 'कोरमा': 'korma',
      'करी': 'curry', 'मसाला': 'masala', 'फ्राइड': 'fried', 'ग्रिल्ड': 'grilled',
      'दही': 'curd', 'पेरुगु': 'curd', 'छाछ': 'buttermilk', 'खीर': 'kheer',
      'तंदूरी चिकन': 'tandoori chicken', 'चिकन टिक्का': 'chicken tikka', 'मटन करी': 'mutton curry',
      'पनीर टिक्का': 'paneer tikka', 'दाल मखनी': 'dal makhani', 'बटर चिकन': 'butter chicken',
      'चिकन बिरयानी': 'chicken biryani', 'मटन बिरयानी': 'mutton biryani', 'थाली': 'thali',
      'चिकन थाली': 'chicken thali', 'वेज थाली': 'veg thali', 'स्पेशल थाली': 'special thali',
      // Telugu to English
      'బ్రెడ్': 'bread', 'అన్నం': 'rice', 'చికెన్': 'chicken', 'మటన్': 'mutton',
      'బిర్యానీ': 'biryani', 'కేక్': 'cake', 'పిజ్జా': 'pizza', 'బర్గర్': 'burger',
      'నూడుల్స్': 'noodles', 'ఐస్ క్రీమ్': 'ice cream', 'టీ': 'tea', 'కాఫీ': 'coffee',
      'పెరుగు': 'curd', 'పెరుగు అన్నం': 'curd rice', 'సాంబార్': 'sambar', 'రసం': 'rasam',
      'పప్పు': 'dal', 'కూర': 'curry', 'పచ్చడి': 'chutney', 'అప్పడం': 'papad',
      'పూరీ': 'poori', 'ఇడ్లీ': 'idli', 'దోశ': 'dosa', 'ఉప్మా': 'upma', 'వడ': 'vada',
      'కోడి': 'chicken', 'కోడి బిర్యానీ': 'chicken biryani', 'గుడ్డు': 'egg', 'చేప': 'fish',
      'రొయ్యలు': 'prawns', 'మటన్ బిర్యానీ': 'mutton biryani', 'పులావ్': 'pulao',
      'ఫ్రైడ్ రైస్': 'fried rice', 'నూడిల్స్': 'noodles', 'మంచూరియన్': 'manchurian',
      'పులిహోర': 'pulihora', 'పులిహోర': 'tamarind rice', 'దద్దోజనం': 'curd rice',
      'చిత్రాన్నం': 'chitranna', 'లెమన్ రైస్': 'lemon rice', 'టమాటో రైస్': 'tomato rice',
      'కొబ్బరి అన్నం': 'coconut rice', 'పొంగల్': 'pongal', 'అట్టు': 'dosa',
      'పెసరట్టు': 'pesarattu', 'మసాలా దోశ': 'masala dosa', 'రవ్వ దోశ': 'rava dosa',
      'మైసూర్ బజ్జి': 'mysore bajji', 'మిర్చి బజ్జి': 'mirchi bajji', 'ఆలూ బజ్జి': 'aloo bajji',
      'గారెలు': 'garelu', 'బొబ్బట్లు': 'bobbatlu', 'పాయసం': 'payasam', 'కేసరి': 'kesari',
      // Telugu - Gongura and other Andhra dishes
      'గొంగూర': 'gongura', 'గొంగూర చికెన్': 'gongura chicken', 'గొంగూర మటన్': 'gongura mutton',
      'గొంగూర పచ్చడి': 'gongura chutney', 'గొంగూర పప్పు': 'gongura dal',
      'గుత్తి వంకాయ': 'gutti vankaya', 'వంకాయ': 'brinjal', 'బెండకాయ': 'okra',
      'ఆలూ': 'potato', 'టమాటో': 'tomato', 'ఉల్లి': 'onion', 'వెల్లుల్లి': 'garlic',
      'అల్లం': 'ginger', 'మిరపకాయ': 'chilli', 'కరివేపాకు': 'curry leaves',
      'చికెన్ కర్రీ': 'chicken curry', 'మటన్ కర్రీ': 'mutton curry', 'చేప కర్రీ': 'fish curry',
      'చికెన్ ఫ్రై': 'chicken fry', 'మటన్ ఫ్రై': 'mutton fry', 'చేప ఫ్రై': 'fish fry',
      'చికెన్ 65': 'chicken 65', 'చికెన్ లాలీపాప్': 'chicken lollipop',
      'పరోటా': 'parotta', 'కొత్తు పరోటా': 'kothu parotta', 'చిల్లీ పరోటా': 'chilli parotta',
      'చపాతీ': 'chapati', 'నాన్': 'naan', 'రొట్టె': 'roti',
      'తందూరి': 'tandoori', 'తందూరి చికెన్': 'tandoori chicken', 'కబాబ్': 'kabab',
      'పులుసు': 'pulusu', 'చేపల పులుసు': 'fish pulusu', 'రొయ్యల పులుసు': 'prawn pulusu',
      'ఆవకాయ': 'avakaya', 'మామిడికాయ': 'raw mango',
      // Tamil to English
      'பிரெட்': 'bread', 'சோறு': 'rice', 'சிக்கன்': 'chicken', 'மட்டன்': 'mutton',
      'பிரியாணி': 'biryani', 'கேக்': 'cake', 'பீட்சா': 'pizza', 'பர்கர்': 'burger',
      'தயிர்': 'curd', 'தயிர் சாதம்': 'curd rice', 'சாம்பார்': 'sambar', 'ரசம்': 'rasam',
      'இட்லி': 'idli', 'தோசை': 'dosa', 'உப்புமா': 'upma', 'வடை': 'vada', 'பூரி': 'poori',
      'கோழி': 'chicken', 'கோழி பிரியாணி': 'chicken biryani', 'முட்டை': 'egg', 'மீன்': 'fish',
      'புளியோதரை': 'puliyodharai', 'எலுமிச்சை சாதம்': 'lemon rice', 'தக்காளி சாதம்': 'tomato rice',
      'தேங்காய் சாதம்': 'coconut rice', 'பொங்கல்': 'pongal', 'மசாலா தோசை': 'masala dosa',
      'இறால்': 'prawns', 'ஆட்டு இறைச்சி': 'mutton',
      // Tamil - Gongura and other South Indian dishes
      'கொங்கூரா': 'gongura', 'கொங்கூரா சிக்கன்': 'gongura chicken', 'கொங்கூரா மட்டன்': 'gongura mutton',
      'கொங்கூரா கோழி': 'gongura chicken', 'கொங்கூரா ஆட்டு': 'gongura mutton',
      'கத்திரிக்காய்': 'brinjal', 'வெண்டைக்காய்': 'okra', 'உருளைக்கிழங்கு': 'potato',
      'தக்காளி': 'tomato', 'வெங்காயம்': 'onion', 'பூண்டு': 'garlic', 'இஞ்சி': 'ginger',
      'கறி': 'curry', 'குழம்பு': 'curry', 'கூட்டு': 'kootu', 'பொரியல்': 'poriyal',
      'அவியல்': 'avial', 'கூட்டு': 'kootu', 'வறுவல்': 'fry', 'பொடிமாஸ்': 'podimas',
      'சிக்கன் கறி': 'chicken curry', 'மட்டன் கறி': 'mutton curry', 'மீன் கறி': 'fish curry',
      'சிக்கன் வறுவல்': 'chicken fry', 'மட்டன் வறுவல்': 'mutton fry', 'மீன் வறுவல்': 'fish fry',
      'சிக்கன் 65': 'chicken 65', 'சிக்கன் லாலிபாப்': 'chicken lollipop',
      'பரோட்டா': 'parotta', 'கொத்து பரோட்டா': 'kothu parotta', 'சில்லி பரோட்டா': 'chilli parotta',
      'நூடுல்ஸ்': 'noodles', 'ஃப்ரைட் ரைஸ்': 'fried rice', 'மஞ்சூரியன்': 'manchurian',
      'பனீர்': 'paneer', 'பனீர் பட்டர் மசாலா': 'paneer butter masala',
      'சப்பாத்தி': 'chapati', 'நான்': 'naan', 'ரொட்டி': 'roti',
      'பிரியாணி சிக்கன்': 'chicken biryani', 'பிரியாணி மட்டன்': 'mutton biryani',
      'தந்தூரி': 'tandoori', 'தந்தூரி சிக்கன்': 'tandoori chicken', 'கபாப்': 'kabab',
      'சாதம்': 'rice', 'அன்னம்': 'rice', 'சாதம் சாம்பார்': 'sambar rice',
      // Kannada to English
      'ಬ್ರೆಡ್': 'bread', 'ಅನ್ನ': 'rice', 'ಚಿಕನ್': 'chicken', 'ಮಟನ್': 'mutton',
      'ಬಿರಿಯಾನಿ': 'biryani', 'ಕೇಕ್': 'cake', 'ಪಿಜ್ಜಾ': 'pizza',
      'ಮೊಸರು': 'curd', 'ಮೊಸರನ್ನ': 'curd rice', 'ಸಾಂಬಾರ್': 'sambar', 'ರಸಂ': 'rasam',
      'ಇಡ್ಲಿ': 'idli', 'ದೋಸೆ': 'dosa', 'ಉಪ್ಪಿಟ್ಟು': 'upma', 'ವಡೆ': 'vada',
      'ಕೋಳಿ': 'chicken', 'ಮೊಟ್ಟೆ': 'egg', 'ಮೀನು': 'fish',
      // Bengali to English
      'রুটি': 'bread', 'ভাত': 'rice', 'মুরগি': 'chicken', 'মাংস': 'mutton',
      'বিরিয়ানি': 'biryani', 'কেক': 'cake', 'পিৎজা': 'pizza',
      'ডিম': 'egg', 'মাছ': 'fish', 'চিংড়ি': 'prawns',
      'দই': 'curd', 'দই ভাত': 'curd rice',
      'চিকেন': 'chicken', 'চিকেন থালি': 'chicken thali', 'চিকেন বিরিয়ানি': 'chicken biryani',
      'মাটন': 'mutton', 'থালি': 'thali', 'তন্দুরি': 'tandoori', 'তন্দুরি চিকেন': 'tandoori chicken',
      // Malayalam to English
      'ബ്രെഡ്': 'bread', 'ചോറ്': 'rice', 'ചിക്കൻ': 'chicken', 'മട്ടൻ': 'mutton',
      'ബിരിയാണി': 'biryani', 'കേക്ക്': 'cake', 'പിസ്സ': 'pizza',
      'തൈര്': 'curd', 'തൈര് സാദം': 'curd rice', 'സാമ്പാർ': 'sambar', 'രസം': 'rasam',
      'താലി': 'thali', 'ചിക്കൻ താലി': 'chicken thali',
      // Common transliterations (romanized regional food names)
      'chawal': 'rice', 'roti': 'roti', 'daal': 'dal', 'sabzi': 'sabji',
      'chai': 'tea', 'doodh': 'milk', 'pani': 'water', 'anda': 'egg',
      'gosht': 'mutton', 'murgh': 'chicken', 'machli': 'fish',
      'dahi': 'curd', 'perugu': 'curd', 'thayir': 'curd', 'mosaru': 'curd',
      'tandoori': 'tandoori', 'tikka': 'tikka', 'thali': 'thali', 'korma': 'korma',
      // Telugu romanized
      'pulihora': 'tamarind rice', 'pulihoura': 'tamarind rice', 'pulihara': 'tamarind rice',
      'perugu annam': 'curd rice', 'perugu anna': 'curd rice', 'perugannam': 'curd rice',
      'daddojanam': 'curd rice', 'dadhojanam': 'curd rice',
      'pesarattu': 'pesarattu', 'pesaratu': 'pesarattu',
      'mirchi bajji': 'mirchi bajji', 'mirchi pakoda': 'mirchi bajji',
      'aloo bajji': 'aloo bajji', 'punugulu': 'punugulu',
      'garelu': 'vada', 'gaarelu': 'vada', 'medu vada': 'vada',
      'bobbatlu': 'bobbatlu', 'bobatlu': 'bobbatlu', 'puran poli': 'bobbatlu',
      'payasam': 'payasam', 'kheer': 'kheer', 'kesari': 'kesari',
      'pongal': 'pongal', 'ven pongal': 'pongal',
      'chitranna': 'lemon rice', 'chitrannam': 'lemon rice',
      'tomato rice': 'tomato rice', 'tomato bath': 'tomato rice',
      'coconut rice': 'coconut rice', 'kobbari annam': 'coconut rice',
      'lemon rice': 'lemon rice', 'nimma kaya annam': 'lemon rice',
      // Gongura and Andhra romanized
      'gongura': 'gongura', 'gongura chicken': 'gongura chicken', 'gongura mutton': 'gongura mutton',
      'gongura pachadi': 'gongura chutney', 'gongura pappu': 'gongura dal',
      'gutti vankaya': 'stuffed brinjal', 'vankaya': 'brinjal', 'bendakaya': 'okra',
      'pulusu': 'pulusu', 'chepala pulusu': 'fish pulusu', 'royyala pulusu': 'prawn pulusu',
      'avakaya': 'avakaya pickle', 'mamidikaya': 'raw mango',
      'koora': 'curry', 'kura': 'curry', 'fry': 'fry', 'iguru': 'dry curry',
      // Tamil romanized
      'puliyodharai': 'tamarind rice', 'puliyodarai': 'tamarind rice',
      'thayir sadam': 'curd rice', 'thayir sadham': 'curd rice', 'curd rice': 'curd rice',
      'sambar rice': 'sambar rice', 'sambar sadam': 'sambar rice',
      'rasam rice': 'rasam rice', 'rasam sadam': 'rasam rice',
      // Common South Indian
      'idli': 'idli', 'idly': 'idli', 'idle': 'idli',
      'dosa': 'dosa', 'dosai': 'dosa', 'dhosha': 'dosa',
      'masala dosa': 'masala dosa', 'masale dose': 'masala dosa',
      'rava dosa': 'rava dosa', 'ravva dosa': 'rava dosa',
      'uttapam': 'uttapam', 'uthappam': 'uttapam',
      'upma': 'upma', 'uppuma': 'upma', 'uppit': 'upma',
      'vada': 'vada', 'vadai': 'vada', 'wade': 'vada',
      'poori': 'poori', 'puri': 'poori', 'luchi': 'poori',
      'chapati': 'chapati', 'chapathi': 'chapati', 'roti': 'roti', 'phulka': 'roti',
      'paratha': 'paratha', 'parotta': 'paratha', 'paratha': 'paratha',
      'naan': 'naan', 'nan': 'naan',
      'biryani': 'biryani', 'biriyani': 'biryani', 'briyani': 'biryani',
      'pulao': 'pulao', 'pulav': 'pulao', 'pilaf': 'pulao',
      'fried rice': 'fried rice', 'friedrice': 'fried rice',
      'noodles': 'noodles', 'noodels': 'noodles',
      'manchurian': 'manchurian', 'manchuria': 'manchurian',
      'gobi': 'gobi', 'gobhi': 'gobi', 'cauliflower': 'gobi',
      'paneer': 'paneer', 'panner': 'paneer',
      'chicken': 'chicken', 'chiken': 'chicken', 'chikken': 'chicken',
      'mutton': 'mutton', 'muttom': 'mutton',
      'fish': 'fish', 'fis': 'fish',
      'prawns': 'prawns', 'prawn': 'prawns', 'shrimp': 'prawns',
      'egg': 'egg', 'eggs': 'egg', 'anda': 'egg'
    };
    
    let result = text;
    for (const [regional, english] of Object.entries(transliterationMap)) {
      if (text.toLowerCase().includes(regional.toLowerCase())) {
        result = result.replace(new RegExp(regional, 'gi'), english);
      }
    }
    return result;
  },

  // Translate text using Groq AI (for languages not in basic map)
  // Returns object with primary translation and all variations for better search
  async translateWithAI(text) {
    // Check translation cache first (avoids repeated Groq API calls)
    const cacheKey = text.toLowerCase().trim();
    const cached = _translationCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < TRANSLATION_CACHE_TTL) {
      return cached.result;
    }

    const _cacheAndReturn = (result) => {
      if (_translationCache.size >= TRANSLATION_CACHE_MAX) {
        const oldestKey = _translationCache.keys().next().value;
        _translationCache.delete(oldestKey);
      }
      _translationCache.set(cacheKey, { result, ts: Date.now() });
      return result;
    };

    // Check if text contains non-English characters
    const hasNonEnglish = /[^\x00-\x7F]/.test(text);
    
    if (hasNonEnglish) {
      // For non-English text, use Groq AI to get multiple translation variations
      try {
        const result = await groqAi.translateToEnglish(text);
        
        // If we got valid variations, return them
        if (result.variations && result.variations.length > 0 && !/[^\x00-\x7F]/.test(result.primary)) {
          return _cacheAndReturn(result);
        }
        
        // If AI translation failed, try word-by-word
        const words = text.split(/\s+/).filter(w => w.length > 0);
        if (words.length > 1) {
          const allVariations = [];
          const translatedWords = [];
          
          for (const word of words) {
            if (/[^\x00-\x7F]/.test(word)) {
              const wordResult = await groqAi.translateToEnglish(word);
              if (wordResult.variations && wordResult.variations.length > 0) {
                translatedWords.push(wordResult.primary);
                allVariations.push(...wordResult.variations);
              } else {
                // Fallback to basic map
                const basicWord = this.transliterate(word);
                translatedWords.push(basicWord);
                allVariations.push(basicWord);
              }
            } else {
              translatedWords.push(word);
              allVariations.push(word);
            }
          }
          
          const combinedTranslation = translatedWords.join(' ');
          allVariations.push(combinedTranslation);
          
          // Remove duplicates and non-English
          const cleanVariations = [...new Set(allVariations)].filter(v => !/[^\x00-\x7F]/.test(v));
          
          logger.info('Word-by-word translation', { text });
          return _cacheAndReturn({ primary: combinedTranslation, variations: cleanVariations });
        }
        
        // Last resort: try basic transliteration
        const basicTranslated = this.transliterate(text);
        return _cacheAndReturn({ primary: basicTranslated, variations: [basicTranslated] });
      } catch (error) {
        logger.error('AI translation failed', { error: error.message });
        const basicTranslated = this.transliterate(text);
        return _cacheAndReturn({ primary: basicTranslated, variations: [basicTranslated] });
      }
    }
    
    // For English/romanized text, first try basic transliteration
    const basicTranslated = this.transliterate(text);
    const variations = [text.toLowerCase()];
    
    // If basic translation changed the text, add it
    if (basicTranslated.toLowerCase() !== text.toLowerCase()) {
      variations.push(basicTranslated.toLowerCase());
    }
    
    // Skip AI for romanized English text - rely on tag-based matching instead
    // This reduces API calls and makes search faster
    
    // Remove duplicates
    const cleanVariations = [...new Set(variations)];
    
    return _cacheAndReturn({ primary: cleanVariations[0], variations: cleanVariations });
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
    
    // Expand search terms with synonyms (e.g., "pulusu" → ["pulusu", "curry", "gravy"])
    const expandedTerms = [];
    for (const term of searchVariations) {
      expandedTerms.push(term);
      // Also add normalized plural version (e.g., "milk shakes" → "milk shake")
      const normalizedTerm = this.normalizePlural(term);
      if (normalizedTerm !== term) {
        expandedTerms.push(normalizedTerm);
      }
      // Get synonyms for each word in the term
      const words = term.split(/\s+/).filter(w => w.length >= 2);
      for (const word of words) {
        const synonyms = this.getSynonyms(word);
        expandedTerms.push(...synonyms);
        // Also add normalized plural of each word
        const normalizedWord = this.normalizePlural(word);
        if (normalizedWord !== word) {
          expandedTerms.push(normalizedWord);
          const wordSynonyms = this.getSynonyms(normalizedWord);
          expandedTerms.push(...wordSynonyms);
        }
      }
    }
    
    // Add unique variations (including synonyms)
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
    
    logger.info('Search terms with synonyms', { text });
    
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
            await sendWithOptionalImage(phone, helpImg,
              '❌ Sorry, we couldn\'t process your cart. Please try again.',
              [
                { id: 'order_food', text: 'Order Food' },
                { id: 'home', text: 'Main Menu' }
              ]
            );
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
          await sendWithOptionalImage(phone, helpImg,
            '❌ Something went wrong processing your cart. Please try again.',
            [
              { id: 'order_food', text: 'Order Food' },
              { id: 'home', text: 'Main Menu' }
            ]
          );
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

        // ========== SPECIAL: Location shared for address saving (not order delivery) ==========
        if (state.currentStep === 'awaiting_address_location') {
          await this.handleLocationForAddress(phone, customer, locationData, state);
          customer.conversationState = state;
          await customer.save();
          return;
        }
        
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
            
            await sendWithOptionalImage(phone, outOfRangeImg, message, [
              { id: 'service_pickup', text: 'Self-Pickup' },
              { id: 'share_location', text: 'New Location' },
              { id: 'home', text: 'Main Menu' }
            ]);
            state.currentStep = 'awaiting_location';
            customer.conversationState = state;
            await customer.save();
            return;
          }
          
          // If delivery not available (outside free radius and extra charge not enabled)
          if (deliveryResult.deliveryNotAvailable) {
            const outOfRangeImg = await chatbotImagesService.getImageUrl('out_of_delivery_range');
            const message = `❌ *Delivery Not Available*\n\n${deliveryResult.message}\n\nWould you like to try a different address or opt for self-pickup?`;
            
            await sendWithOptionalImage(phone, outOfRangeImg, message, [
              { id: 'service_pickup', text: 'Self-Pickup' },
              { id: 'share_location', text: 'New Location' },
              { id: 'home', text: 'Main Menu' }
            ]);
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
          await this.sendPaymentMethodOptions(phone, customer, state);
          state.currentStep = 'select_payment_method';
        } else {
          // No cart items, just confirm location saved
          const deliveryLocationImg = await chatbotImagesService.getImageUrl('delivery_location');
          await sendWithOptionalImage(phone, deliveryLocationImg,
            `📍 Location saved!\n\n${formattedAddress}\n\nStart ordering to use this address.`,
            [
              { id: 'place_order', text: 'Start Order' },
              { id: 'home', text: 'Main Menu' }
            ]
          );
          state.currentStep = 'main_menu';
        }
      }
      // ========== FLOW REPLY: Account Form / Address Form ==========
      else if (messageType === 'flow_reply') {
        let flowData = {};
        try { flowData = typeof message === 'string' ? JSON.parse(message) : message; } catch (e) { /* ignore */ }

        if (flowData.type === 'account_form') {
          await this.handleAccountFormResponse(phone, customer, flowData);
          state.currentStep = 'main_menu';
        } else if (flowData.type === 'address_form') {
          await this.handleAddressFormResponse(phone, customer, flowData);
          state.currentStep = 'main_menu';
        } else if (flowData.type === 'address_share_location') {
          // User chose "Use Current Location" from the address flow
          await whatsapp.sendMessage(phone, '📍 *Share Your Location*\n\nPlease share your current location now:\n\n1️⃣ Tap the 📎 attachment button below\n2️⃣ Select *Location*\n3️⃣ Tap *Send Your Current Location*\n\nYour address will be automatically filled from your location.');
          state.currentStep = 'awaiting_address_location';
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
          await sendWithOptionalImage(phone, offerNotEligibleImg, ineligibleMsg, [
            { id: 'proceed_without_offer', text: 'Order Anyway' },
            { id: 'view_menu', text: 'Browse Menu' },
            { id: 'home', text: 'Main Menu' }
          ]);
          
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
            await whatsapp.sendText(phone, `🎁 *Offer Applied!*\n\nYou've saved ₹${totalDiscount} with ${eligibleOffers.map(o => o.title || o.offerType).join(', ')}!`);
          }
          await this.sendCart(phone, customer);
          state.currentStep = 'viewing_cart';
        } else {
          // No items were added
          const itemNotAvailableImg = await chatbotImagesService.getImageUrl('item_not_available');
          await sendWithOptionalImage(phone, itemNotAvailableImg, `❌ Sorry, we couldn't find the items in your order.\n\nPlease browse our menu to add items.`, [
            { id: 'view_menu', text: 'View Menu' },
            { id: 'home', text: 'Main Menu' }
          ]);
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
            await sendWithOptionalImage(phone, itemNotAvailableImageUrl, `❌ Sorry, "${websiteOrder.itemName}" is not available.\n\nPlease browse our menu!`, [
              { id: 'view_menu', text: 'View Menu' },
              { id: 'home', text: 'Main Menu' }
            ]);
            state.currentStep = 'main_menu';
          }
        } else {
          // Item ID provided but not found in menu
          logger.info('Website order item not found by ID', { itemId: websiteOrder.itemId });
          const itemNotAvailableImageUrl = await chatbotImagesService.getImageUrl('item_not_available');
          await sendWithOptionalImage(phone, itemNotAvailableImageUrl, `❌ Sorry, this item is currently not available.\n\nPlease browse our menu!`, [
            { id: 'view_menu', text: 'View Menu' },
            { id: 'home', text: 'Main Menu' }
          ]);
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
      else if (selection === 'clear_cart' || (!selectedId && this.isClearCartIntent(msg))) {
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
        
        await sendWithOptionalImage(phone, cartClearedImageUrl, message, [
          { id: 'view_menu', text: 'View Menu' },
          { id: 'home', text: 'Main Menu' }
        ]);
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
            await sendWithOptionalImage(phone, itemNotAvailableImg, `❌ Sorry, we couldn't find the items.\n\nPlease browse our menu to add items.`, [
              { id: 'view_menu', text: 'View Menu' },
              { id: 'home', text: 'Main Menu' }
            ]);
            state.currentStep = 'main_menu';
          }
        } else {
          await this.sendMainMenu(phone);
          state.currentStep = 'main_menu';
        }
      }
      // Handle simple cart keyword (just "cart") - show cart options menu
      else if (!selectedId && this.isSimpleCartKeyword(msg)) {
        await this.sendCartOptionsMenu(phone);
        state.currentStep = 'cart_options';
      }
      // Handle full cart intent ("view cart", "my cart", etc.) - show cart directly
      else if (!selectedId && this.isCartIntent(msg)) {
        await this.sendCart(phone, customer);
        state.currentStep = 'viewing_cart';
      }
      else if (selection === 'view_menu' || msg === 'menu') {
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
          await sendWithOptionalImage(phone, itemNotAvailableImg, `❌ No ${labelMap[selection]} items available right now.`, [
            { id: 'view_menu', text: 'View All Menu' },
            { id: 'home', text: 'Main Menu' }
          ]);
          state.currentStep = 'main_menu';
        }
      }
      // Handle text/voice menu intent with food type detection (only for text messages, not button clicks)
      else if (!selectedId && this.isShowMenuIntent(msg)) {
        const menuIntent = this.isShowMenuIntent(msg);
        logger.info('Menu intent detected', { data: menuIntent });
        
        if (menuIntent.foodType === 'veg') {
          state.foodTypePreference = 'veg';
          const filteredItems = this.filterByFoodType(menuItems, 'veg');
          if (filteredItems.length > 0) {
            await this.sendMenuCategoriesWithLabel(phone, filteredItems, '🌿 Veg Menu');
            state.currentStep = 'select_category';
          } else {
            const itemNotAvailableImg = await chatbotImagesService.getImageUrl('item_not_available');
            await sendWithOptionalImage(phone, itemNotAvailableImg, '🌿 No veg items available right now.', [
              { id: 'view_menu', text: 'View All Menu' },
              { id: 'home', text: 'Main Menu' }
            ]);
            state.currentStep = 'main_menu';
          }
        } else if (menuIntent.foodType === 'egg') {
          state.foodTypePreference = 'egg';
          const filteredItems = this.filterByFoodType(menuItems, 'egg');
          if (filteredItems.length > 0) {
            await this.sendMenuCategoriesWithLabel(phone, filteredItems, '🥚 Egg Menu');
            state.currentStep = 'select_category';
          } else {
            const itemNotAvailableImg = await chatbotImagesService.getImageUrl('item_not_available');
            await sendWithOptionalImage(phone, itemNotAvailableImg, '🥚 No egg items available right now.', [
              { id: 'view_menu', text: 'View All Menu' },
              { id: 'home', text: 'Main Menu' }
            ]);
            state.currentStep = 'main_menu';
          }
        } else if (menuIntent.foodType === 'nonveg') {
          state.foodTypePreference = 'nonveg';
          const filteredItems = this.filterByFoodType(menuItems, 'nonveg');
          if (filteredItems.length > 0) {
            await this.sendMenuCategoriesWithLabel(phone, filteredItems, '🍗 Non-Veg Menu');
            state.currentStep = 'select_category';
          } else {
            const itemNotAvailableImg = await chatbotImagesService.getImageUrl('item_not_available');
            await sendWithOptionalImage(phone, itemNotAvailableImg, '🍗 No non-veg items available right now.', [
              { id: 'view_menu', text: 'View All Menu' },
              { id: 'home', text: 'Main Menu' }
            ]);
            state.currentStep = 'main_menu';
          }
        } else {
          // Show food type selection (Browse Menu screen with Veg/Non-Veg/All options)
          await this.sendFoodTypeSelection(phone);
          state.currentStep = 'select_food_type';
        }
      }
      else if (selection === 'food_veg' || selection === 'food_nonveg' || selection === 'food_egg') {
        state.foodTypePreference = selection.replace('food_', '');
        logger.info('Food type selected', { data: state.foodTypePreference });
        const filteredItems = this.filterByFoodType(menuItems, state.foodTypePreference);
        
        const foodTypeLabels = {
          veg: '🌿 Veg Menu',
          nonveg: '🍗 Non-Veg Menu',
          egg: '🟡 Egg Menu'
        };
        
        // If coming from order flow OR directly from welcome flow (food type embedded), send Menu Items Flow
        if (state.currentStep === 'select_food_type_order' || state.currentStep === 'main_menu' || state.currentStep === 'awaiting_main_menu') {
          await this.sendMenuItemsFlow(phone, state.foodTypePreference);
          state.currentStep = 'select_title_order';
        } else {
          await this.sendMenuCategoriesWithLabel(phone, filteredItems, foodTypeLabels[state.foodTypePreference]);
          state.currentStep = 'select_category';
        }
      }
      else if (selection === 'place_order' || selection === 'order_now' || (!selectedId && msg === 'order')) {
        // Skip service type selection and go directly to food type selection
        await this.sendFoodTypeSelection(phone);
        state.currentStep = 'select_food_type_order';
      }
      // Check cancel/track BEFORE order status (they're more specific)
      // Only check text-based intents when there's no selectedId (button click)
      else if (selection === 'cancel_order' || (!selectedId && this.isCancelIntent(msg))) {
        await this.sendCancelOptions(phone);
        state.currentStep = 'select_cancel';
      }
      else if (selection === 'track_order' || (!selectedId && (msg === 'track' || this.isTrackIntent(msg)))) {
        await this.sendTrackingOptions(phone);
        state.currentStep = 'select_track';
      }
      else if (selection === 'order_status' || (!selectedId && (msg === 'status' || this.isOrderStatusIntent(msg)))) {
        await this.sendOrderStatus(phone);
        state.currentStep = 'main_menu';
      }
      else if (selection === 'help' || (!selectedId && msg === 'help')) {
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
      // ========== ACCOUNT DETAILS (from welcome flow) ==========
      else if (selection === 'account_details') {
        await this.sendAccountDetails(phone, customer);
        state.currentStep = 'main_menu';
      }
      // ========== DELIVERY ADDRESS (from welcome flow) ==========
      else if (selection === 'delivery_address') {
        await this.sendDeliveryAddressOptions(phone, customer);
        state.currentStep = 'awaiting_address_method';
      }
      // ========== ENTER ADDRESS MANUALLY (sends address form flow) ==========
      else if (selection === 'enter_address_manual') {
        await this.sendAddressFormFlow(phone, customer);
        state.currentStep = 'main_menu';
      }
      // ========== SHARE LOCATION FOR ADDRESS ==========
      else if (selection === 'share_location_address') {
        await whatsapp.sendMessage(phone, '📍 Please share your current location using the attachment (📎) button → Location.\n\nWe\'ll automatically fill your address from your location.');
        state.currentStep = 'awaiting_address_location';
      }
      // ========== EDIT ACCOUNT (re-open form with existing data) ==========
      else if (selection === 'edit_account') {
        await this.sendAccountFormFlow(phone, customer);
        state.currentStep = 'main_menu';
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
          await sendWithOptionalImage(phone, searchNoResultsImg, `❌ No items found matching "${addIntent.itemName}"\n\nTry browsing our menu!`, [
            { id: 'view_menu', text: 'View Menu' },
            { id: 'home', text: 'Main Menu' }
          ]);
          state.currentStep = 'main_menu';
        }
      }
      else if (selection === 'checkout' || selection === 'review_pay') {
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
          await sendWithOptionalImage(phone, cartEmptyImg, 'Your cart is empty! Please add items first.', [
            { id: 'view_menu', text: 'View Menu' },
            { id: 'home', text: 'Main Menu' }
          ]);
          state.currentStep = 'main_menu';
        } else {
          // Check if cart items are still available
          const availabilityCheck = await checkCartAvailability(customer.cart);
          
          if (!availabilityCheck.available) {
            // Some items are unavailable - notify user
            const unavailableNames = availabilityCheck.unavailableItems.map(i => i.name).join(', ');
            const itemNotAvailableImageUrl = await chatbotImagesService.getImageUrl('item_not_available');
            
            const msg = `😔 *Sorry!*\n\nSome items in your cart are currently unavailable:\n\n❌ ${unavailableNames}\n\nPlease remove these items from your cart and try again.`;
            
            await sendWithOptionalImage(phone, itemNotAvailableImageUrl, msg, [
              { id: 'view_cart', text: 'View Cart' },
              { id: 'clear_cart', text: 'Clear Cart' },
              { id: 'home', text: 'Main Menu' }
            ]);
            state.currentStep = 'viewing_cart';
          } else {
            // All items available - ask for service type (Delivery or Self-Pickup)
            await this.sendServiceTypeSelection(phone);
            state.currentStep = 'select_service_type';
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
        await this.sendPickupPaymentMethodOptions(phone, customer);
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
        await this.sendPaymentMethodOptions(phone, customer);
        state.currentStep = 'select_payment_method';
      }
      else if (selection === 'pay_upi') {
        if (!customer.cart?.length) {
          const cartEmptyImg = await chatbotImagesService.getImageUrl('cart_empty');
          await sendWithOptionalImage(phone, cartEmptyImg, '🛒 Your cart is empty!', [
            { id: 'view_menu', text: 'View Menu' }
          ]);
          state.currentStep = 'main_menu';
        } else {
          // Check if cart items are still available before payment
          const availabilityCheck = await checkCartAvailability(customer.cart);
          
          if (!availabilityCheck.available) {
            const unavailableNames = availabilityCheck.unavailableItems.map(i => i.name).join(', ');
            const itemNotAvailableImageUrl = await chatbotImagesService.getImageUrl('item_not_available');
            
            const msg = `😔 *Sorry!*\n\nSome items in your cart are currently unavailable:\n\n❌ ${unavailableNames}\n\nPlease remove these items from your cart and try again.`;
            
            await sendWithOptionalImage(phone, itemNotAvailableImageUrl, msg, [
              { id: 'view_cart', text: 'View Cart' },
              { id: 'clear_cart', text: 'Clear Cart' },
              { id: 'home', text: 'Main Menu' }
            ]);
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
          await sendWithOptionalImage(phone, cartEmptyImg, '🛒 Your cart is empty!', [
            { id: 'view_menu', text: 'View Menu' }
          ]);
          state.currentStep = 'main_menu';
        } else {
          // Check if cart items are still available before COD order
          const availabilityCheck = await checkCartAvailability(customer.cart);
          
          if (!availabilityCheck.available) {
            const unavailableNames = availabilityCheck.unavailableItems.map(i => i.name).join(', ');
            const itemNotAvailableImageUrl = await chatbotImagesService.getImageUrl('item_not_available');
            
            const msg = `😔 *Sorry!*\n\nSome items in your cart are currently unavailable:\n\n❌ ${unavailableNames}\n\nPlease remove these items from your cart and try again.`;
            
            await sendWithOptionalImage(phone, itemNotAvailableImageUrl, msg, [
              { id: 'view_cart', text: 'View Cart' },
              { id: 'clear_cart', text: 'Clear Cart' },
              { id: 'home', text: 'Main Menu' }
            ]);
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
          await sendWithOptionalImage(phone, cartEmptyImg, '🛒 Your cart is empty!', [
            { id: 'view_menu', text: 'View Menu' }
          ]);
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
          await sendWithOptionalImage(phone, cartEmptyImg, '🛒 Your cart is empty!', [
            { id: 'view_menu', text: 'View Menu' }
          ]);
          state.currentStep = 'main_menu';
        } else {
          // Check if cart items are still available before payment
          const availabilityCheck = await checkCartAvailability(customer.cart);
          
          if (!availabilityCheck.available) {
            const unavailableNames = availabilityCheck.unavailableItems.map(i => i.name).join(', ');
            const itemNotAvailableImageUrl = await chatbotImagesService.getImageUrl('item_not_available');
            
            const msg = `😔 *Sorry!*\n\nSome items in your cart are currently unavailable:\n\n❌ ${unavailableNames}\n\nPlease remove these items from your cart and try again.`;
            
            await sendWithOptionalImage(phone, itemNotAvailableImageUrl, msg, [
              { id: 'view_cart', text: 'View Cart' },
              { id: 'clear_cart', text: 'Clear Cart' },
              { id: 'home', text: 'Main Menu' }
            ]);
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
          await sendWithOptionalImage(phone, cartEmptyImg, '🛒 Your cart is empty!', [
            { id: 'view_menu', text: 'View Menu' }
          ]);
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
          await sendWithOptionalImage(phone, itemNotAvailableImg, '❌ Variant not found.', [
            { id: 'order_food', text: 'Order Food' },
            { id: 'home', text: 'Main Menu' }
          ]);
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
          await sendWithOptionalImage(phone, itemNotAvailableImg, '❌ Option not found.', [
            { id: 'order_food', text: 'Order Food' },
            { id: 'home', text: 'Main Menu' }
          ]);
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
          await sendWithOptionalImage(phone, itemNotAvailableImg,
            '⚠️ This item is no longer available. Please select another item.',
            [
              { id: 'place_order', text: 'View Menu' },
              { id: 'home', text: 'Main Menu' }
            ]
          );
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
          await sendWithOptionalImage(phone, itemNotAvailableImg,
            '⚠️ This item is no longer available. Please select another item.',
            [
              { id: 'place_order', text: 'View Menu' },
              { id: 'home', text: 'Main Menu' }
            ]
          );
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
          await sendWithOptionalImage(phone, helpImg,
            '⚠️ Something went wrong. Please select an item again.',
            [
              { id: 'place_order', text: 'Order Again' },
              { id: 'view_menu', text: 'View Menu' },
              { id: 'home', text: 'Main Menu' }
            ]
          );
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
          await sendWithOptionalImage(phone, helpImg, `❌ Invalid number. Please enter 0 for All Items or 1-${categories.length} for a category.`, [
            { id: 'home', text: 'Main Menu' }
          ]);
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
          await sendWithOptionalImage(phone, helpImg, `❌ Invalid number. Please enter a number between 1 and ${itemsList.length}.`, [
            { id: 'home', text: 'Main Menu' }
          ]);
        }
      }

      // ========== NATURAL LANGUAGE FALLBACKS ==========
      // Smart search FIRST - detects food type (veg/nonveg/egg/specific) and searches by name/tag
      // This takes priority when user specifies food type like "veg cake" or "chicken biryani"
      // Priority: search tags first, then name. If nothing matches, show menu.
      // Also translates local language searches to English using AI
      else {
        const searchResult = await this.smartSearch(msg, menuItems);
        
        if (searchResult && searchResult.items && searchResult.items.length > 0) {
          const matchingItems = searchResult.items;
          const isExactMatch = searchResult.exactMatch === true;
          
          // If NOT an exact match, show "Item Not Available" message and browse menu options
          if (!isExactMatch) {
            const itemNotAvailableImg = await chatbotImagesService.getImageUrl(options.isVoiceMessage ? 'voice_error' : 'item_not_available');
            const notFoundMessage = `❌ *Item Not Available*\n\nSorry, we couldn't find "${msg}" in our menu.\n\nWould you like to browse our menu?`;
            
            // Send "Browse Menu" message with image and buttons
            const browseMenuImg = await chatbotImagesService.getImageUrl('browse_menu');
            
            if (itemNotAvailableImg) {
              await whatsapp.sendImage(phone, itemNotAvailableImg, notFoundMessage);
            } else {
              await whatsapp.sendText(phone, notFoundMessage);
            }
            
            // Send Browse Menu options
            const browseMessage = `🍽️ *Browse Menu*\n\nExplore our delicious menu and select your favorite items.\n\nWhat would you like to see?`;
            
            await sendWithOptionalImage(phone, browseMenuImg, browseMessage, [
              { id: 'veg_only', text: 'Veg Only' },
              { id: 'nonveg_only', text: 'Non-Veg Only' },
              { id: 'show_all', text: 'Show All' }
            ]);
            
            state.currentStep = 'main_menu';
          } else {
            // Exact match found - show items
            // Use pre-built label or construct one
            const displayLabel = searchResult.label 
              ? (searchResult.searchTerm ? `${searchResult.label} "${searchResult.searchTerm}"` : searchResult.label)
              : (searchResult.searchTerm ? `"${searchResult.searchTerm}"` : 'Search Results');
            
            // If only 1 item matches, show item details directly
            if (matchingItems.length === 1) {
              const item = matchingItems[0];
              state.selectedItem = item._id.toString();
              // Pass matched variant index if available (from variant-level search)
              const matchedVariantIdx = searchResult.matchedVariants?.[item._id.toString()] ?? null;
              await this.sendItemDetails(phone, menuItems, item._id.toString(), matchedVariantIdx);
              state.currentStep = 'viewing_item_details';
            } else if (matchingItems.length <= 5) {
              // 2-5 items: show each as a rich catalog card with image, rating, price, buttons
              state.searchTag = msg.trim();
              state.tagSearchResults = matchingItems.map(i => i._id.toString());
              await this.sendSearchResultCards(phone, matchingItems, displayLabel, searchResult.matchedVariants || null);
              state.currentStep = 'viewing_tag_results';
            } else {
              // Multiple items - show list
              state.searchTag = msg.trim();
              state.tagSearchResults = matchingItems.map(i => i._id.toString());
              await this.sendItemsByTag(phone, matchingItems, displayLabel, 0, searchResult.matchedVariants || null);
              state.currentStep = 'viewing_tag_results';
            }
          }
        }
        // If user typed something with food type keyword but no search results
        // e.g., "veg xyz" where xyz doesn't match anything -> show item not found
        else if (this.detectFoodTypeFromMessage(msg)) {
          const detected = this.detectFoodTypeFromMessage(msg);
          const searchTerm = this.removeFoodTypeKeywords(msg.toLowerCase().trim());
          
          // If there's a specific search term that didn't match, show "not found" with browse option
          if (searchTerm.length >= 2) {
            // Send "Item not found" message with buttons
            const itemNotAvailableImg = await chatbotImagesService.getImageUrl(options.isVoiceMessage ? 'voice_error' : 'item_not_available');
            const notFoundMessage = `❌ *Item Not Found*\n\nSorry, we couldn't find "${searchTerm}" in our menu.\n\nTry a different search or browse our menu.`;
            
            await sendWithOptionalImage(phone, itemNotAvailableImg, notFoundMessage, [
              { id: 'view_menu', text: 'Browse Menu' },
              { id: 'home', text: 'Main Menu' }
            ]);
            state.currentStep = 'main_menu';
          } else {
            // Only food type keyword (e.g., just "veg" or "nonveg") - show that menu
            let foodType = 'both';
            let label = '🍽️ All Menu';
            
            if (detected.type === 'veg') {
              foodType = 'veg';
              label = '🌿 Veg Menu';
            } else if (detected.type === 'egg') {
              foodType = 'egg';
              label = '🥚 Egg Menu';
            } else if (detected.type === 'nonveg' || detected.type === 'specific') {
              foodType = 'nonveg';
              label = '🍗 Non-Veg Menu';
            }
            
            state.foodTypePreference = foodType;
            const filteredItems = this.filterByFoodType(menuItems, foodType);
            
            if (filteredItems.length > 0) {
              await this.sendMenuCategoriesWithLabel(phone, filteredItems, label);
              state.currentStep = 'select_category';
            } else {
              const itemNotAvailableImg = await chatbotImagesService.getImageUrl('item_not_available');
              await sendWithOptionalImage(phone, itemNotAvailableImg,
                `❌ No ${label.replace(/[🌿🥚🍗🍽️]\s*/, '')} items available right now.`,
                [
                  { id: 'view_menu', text: 'View All Menu' },
                  { id: 'home', text: 'Main Menu' }
                ]
              );
              state.currentStep = 'main_menu';
            }
          }
        }
        // Category search - only if no food type specified and matches a category
        else if (this.findCategory(msg, menuItems)) {
          const category = this.findCategory(msg, menuItems);
          const filteredItems = this.filterByFoodType(menuItems, state.foodTypePreference || 'both');
          if (state.currentStep === 'browsing_menu' || state.currentStep === 'selecting_item') {
            await this.sendItemsForOrder(phone, filteredItems, category);
            state.selectedCategory = category;
            state.currentStep = 'selecting_item';
          } else {
            await this.sendCategoryItems(phone, filteredItems, category);
            state.selectedCategory = category;
            state.currentStep = 'viewing_items';
          }
        }
        // ========== WELCOME FOR NEW/UNKNOWN STATE ==========
        else if (state.currentStep === 'welcome' || !state.currentStep) {
          await this.sendWelcome(phone);
          state.currentStep = 'main_menu';
        }
        // ========== GENERAL SEARCH FALLBACK ==========
        // If user typed something that looks like a search (2+ chars), show item not found
        // Don't show all menu - let user choose to browse if they want
        else if (msg.length >= 2 && /^[a-zA-Z\u0900-\u097F\u0C00-\u0C7F\u0B80-\u0BFF\u0C80-\u0CFF\u0D00-\u0D7F\u0980-\u09FF\u0A80-\u0AFF\s]+$/.test(msg)) {
          // Looks like a search term (letters only, including Indian languages)
          // Already tried smartSearch above (including fuzzy matching), item not found
          
          // Send "Item not found" message with buttons to browse menu
          const itemNotAvailableImg = await chatbotImagesService.getImageUrl(options.isVoiceMessage ? 'voice_error' : 'item_not_available');
          const notFoundMessage = `❌ *Item Not Found*\n\nSorry, we couldn't find "${msg}" in our menu.\n\nTry a different search or browse our menu.`;
          
          await sendWithOptionalImage(phone, itemNotAvailableImg, notFoundMessage, [
            { id: 'view_menu', text: 'Browse Menu' },
            { id: 'home', text: 'Main Menu' }
          ]);
          state.currentStep = 'main_menu';
        }
        // ========== FALLBACK ==========
        else {
          const fallbackImg = await chatbotImagesService.getImageUrl(options.isVoiceMessage ? 'voice_error' : 'help_support');
          await sendWithOptionalImage(phone, fallbackImg,
            options.isVoiceMessage
              ? `🎤 Sorry, I couldn't understand your voice message.\n\nPlease try again or select an option:`
              : `🤔 I didn't understand that.\n\nPlease select an option:`,
            [
              { id: 'home', text: 'Main Menu' },
              { id: 'view_cart', text: 'View Cart' },
              { id: 'help', text: 'Help' }
            ]
          );
        }
      }
    } catch (error) {
      logger.error('Chatbot error', { error: error.message });
      const helpImg = await chatbotImagesService.getImageUrl('help_support');
      await sendWithOptionalImage(phone, helpImg, '❌ Something went wrong. Please try again.', [
        { id: 'home', text: 'Main Menu' },
        { id: 'help', text: 'Help' }
      ]);
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
        await sendWithOptionalImage(phone, offerNotEligibleImg, '❌ This offer is no longer available.', [
          { id: 'view_menu', text: 'Browse Menu' },
          { id: 'home', text: 'Main Menu' }
        ]);
        return;
      }
      
      // Check if offer is active and valid
      const now = new Date();
      if (!offer.isActive) {
        const offerNotEligibleImg = await chatbotImagesService.getImageUrl('offer_not_eligible');
        await sendWithOptionalImage(phone, offerNotEligibleImg, '❌ This offer is no longer active.', [
          { id: 'view_menu', text: 'Browse Menu' },
          { id: 'home', text: 'Main Menu' }
        ]);
        return;
      }
      
      if (offer.validUntil && new Date(offer.validUntil) < now) {
        const offerNotEligibleImg = await chatbotImagesService.getImageUrl('offer_not_eligible');
        await sendWithOptionalImage(phone, offerNotEligibleImg, '⏰ This offer has expired.', [
          { id: 'view_menu', text: 'Browse Menu' },
          { id: 'home', text: 'Main Menu' }
        ]);
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
            await whatsapp.sendImageWithButtons(phone, notEligibleImage, message, [
              { id: 'view_menu', text: 'Browse Menu' },
              { id: 'home', text: 'Main Menu' }
            ]);
          } else {
            const offerFallbackImg = await chatbotImagesService.getImageUrl('offer_not_eligible');
            await sendWithOptionalImage(phone, offerFallbackImg, message, [
              { id: 'view_menu', text: 'Browse Menu' },
              { id: 'home', text: 'Main Menu' }
            ]);
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
        await whatsapp.sendImageWithButtons(phone, offer.image, successMessage, [
          { id: 'view_menu', text: 'Browse Menu' },
          { id: 'view_cart', text: 'View Cart' }
        ]);
      } else {
        const offerAppliedImg = await chatbotImagesService.getImageUrl('offer_applied');
        await sendWithOptionalImage(phone, offerAppliedImg, successMessage, [
          { id: 'view_menu', text: 'Browse Menu' },
          { id: 'view_cart', text: 'View Cart' }
        ]);
      }
    } catch (error) {
      logger.error('Error handling offer claim', { error: error.message });
      const helpImg = await chatbotImagesService.getImageUrl('help_support');
      await sendWithOptionalImage(phone, helpImg, '❌ Something went wrong. Please try again.', [
        { id: 'view_menu', text: 'Browse Menu' },
        { id: 'home', text: 'Main Menu' }
      ]);
    }
  },

  // ============ WELCOME & MAIN MENU ============
  async sendWelcome(phone) {
    // Step 1: Send restaurant image with welcome message
    const welcomeImageUrl = await chatbotImagesService.getImageUrl('welcome');
    const welcomeMessage = `🏨 *Perivi Hotel*\n\n` +
      `Welcome! 🙏\n\n` +
      `We're delighted to serve you delicious food. How can we help you today?`;

    // Step 2: Try sending WhatsApp Flow for service selection (single combined message)
    try {
      const flowId = catalogService.getWelcomeFlowId();
      const flowMode = catalogService.getWelcomeFlowMode();
      if (flowId && flowMode) {
        const metaCloud = require('./metaCloud');
        const flowData = await catalogService.buildWelcomeFlowData(`welcome_service_${phone}`);

        // Send single Flow message with welcome image as header + service list in body
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
        return;
      }
    } catch (flowErr) {
      logger.info('Welcome Flow fallback to buttons', { error: flowErr.message });
    }

    // Fallback: Send with quick reply buttons (original behavior)
    await sendWithOptionalImage(phone, welcomeImageUrl, welcomeMessage, [
      { id: 'order_food', text: 'Order Food' },
      { id: 'my_orders', text: 'My Orders' },
      { id: 'open_website', text: 'Website' }
    ], 'Perivi Hotel');
  },

  // ============ ORDER FOOD MENU ============
  async sendOrderFoodMenu(phone) {
    // When Order Food is selected outside the welcome flow (e.g., from reply buttons),
    // send food type selection. The welcome flow handles this inline with conditional visibility.
    await this.sendFoodTypeSelection(phone);
  },

  // ============ MENU ITEMS FLOW ============
  async sendMenuItemsFlow(phone, foodType) {
    // Try sending Menu Items Flow with items matching the food type
    try {
      const menuItemsFlowId = catalogService.getMenuItemsFlowId();
      const menuItemsFlowMode = catalogService.getMenuItemsFlowMode();
      if (menuItemsFlowId && menuItemsFlowMode) {
        const metaCloud = require('./metaCloud');
        const flowData = await catalogService.buildMenuItemsFlowData(foodType, `menu_items_${foodType}_${phone}`);

        if (!flowData.items || flowData.items.length === 0) {
          const searchNoResultsImg = await chatbotImagesService.getImageUrl('search_no_results');
          await sendWithOptionalImage(phone, searchNoResultsImg, '📋 No matching items found for this food type.', [
            { id: 'order_food', text: 'Order Food' },
            { id: 'home', text: 'Main Menu' }
          ]);
          return;
        }

        const foodTypeLabel = foodType === 'veg' ? '🟢 Veg' : foodType === 'nonveg' ? '🔴 Non-Veg' : '🟡 Egg';
        await metaCloud.sendFlowMessage(phone, {
          flowId: menuItemsFlowId,
          flowCta: 'Select Item',
          headerText: flowData.heading,
          bodyText: `${foodTypeLabel} items available. Tap below to pick a dish and see its variants.`,
          footerText: 'Perivi Hotel',
          screenName: 'MENU_ITEMS',
          screenData: flowData,
          flowToken: `menu_items_${foodType}_${phone}`,
          mode: menuItemsFlowMode
        });
        logger.info('Sent Menu Items Flow', { phone, foodType, itemCount: flowData.items.length });
        return;
      }
    } catch (flowErr) {
      logger.info('Menu Items Flow fallback to list', { error: flowErr.message });
    }

    // Fallback: use existing title list for order
    const MenuItem = require('../models/MenuItem');
    const menuItems = await MenuItem.find({ available: true, isPaused: { $ne: true } }).lean();
    const foodTypeLabels = { veg: '🌿 Veg Menu', nonveg: '🍗 Non-Veg Menu', egg: '🟡 Egg Menu' };
    await this.sendTitleListForOrder(phone, menuItems, foodType, foodTypeLabels[foodType]);
  },

  // ============ MY ORDERS MENU ============
  async sendMyOrdersMenu(phone) {
    const myOrdersImageUrl = await chatbotImagesService.getImageUrl('my_orders');
    const myOrdersMessage = `📦 *My Orders*\n\n` +
      `Check your order status, track delivery, or cancel an order:`;
    
    await sendWithOptionalImage(phone, myOrdersImageUrl, myOrdersMessage, [
      { id: 'order_status', text: 'Order Status' },
      { id: 'track_order', text: 'Track Delivery' },
      { id: 'cancel_order', text: 'Cancel Order' }
    ], 'Perivi Hotel');
  },

  // ============ MENU BROWSING ============
  async sendFoodTypeSelection(phone) {
    const browseMenuImageUrl = await chatbotImagesService.getImageUrl('browse_menu');
    await sendWithOptionalImage(phone, browseMenuImageUrl,
      '🍽️ *Browse Menu*\n\nWhat would you like to see?',
      [
        { id: 'food_veg', text: 'Veg' },
        { id: 'food_nonveg', text: 'Non-Veg' },
        { id: 'food_egg', text: 'Egg' }
      ]
    );
  },

  async sendMenuCategories(phone, menuItems, label = 'Our Menu', page = 0) {
    // Flatten category arrays and dedupe (category is an array field)
    const categories = [...new Set(menuItems.flatMap(m => Array.isArray(m.category) ? m.category : [m.category]))];
    
    if (!categories.length) {
      const browseMenuImg = await chatbotImagesService.getImageUrl('browse_menu');
      await sendWithOptionalImage(phone, browseMenuImg, '📋 No menu items available right now.', [
        { id: 'home', text: 'Main Menu' }
      ]);
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
      logger.info('Flow category fallback', { error: flowErr.message });
    }

    // ===== FALLBACK: TEXT LIST OF CATEGORY NAMES =====

    // If 9 or fewer categories (+ All Items = 10), use WhatsApp list without pagination
    if (categories.length <= 9) {
      const totalWithVariants = countItemsWithVariants(menuItems);
      const rows = [
        { rowId: 'cat_all', title: '📋 All Items', description: `${totalWithVariants} items - View everything` }
      ];
      
      categories.forEach(cat => {
        const catItems = menuItems.filter(m => Array.isArray(m.category) ? m.category.includes(cat) : m.category === cat);
        const count = countItemsWithVariants(catItems);
        const safeId = cat.replace(/[^a-zA-Z0-9_]/g, '_');
        rows.push({ rowId: `cat_${safeId}`, title: cat.substring(0, 24), description: `${count} items available` });
      });

      await whatsapp.sendList(phone, label, 'Select a category to browse items', 'View Categories',
        [{ title: 'Menu Categories', rows }], 'Fresh & Delicious!');
      return;
    }

    // More than 9 categories - use pagination with WhatsApp list
    const CATS_PER_PAGE = 9; // 9 categories + 1 "All Items" = 10 rows max
    const totalPages = Math.ceil(categories.length / CATS_PER_PAGE);
    const startIdx = page * CATS_PER_PAGE;
    const pageCats = categories.slice(startIdx, startIdx + CATS_PER_PAGE);

    // Build rows for the list
    const rows = [];
    
    // Add "All Items" option on first page only
    if (page === 0) {
      const totalWithVariants = countItemsWithVariants(menuItems);
      rows.push({ rowId: 'cat_all', title: '📋 All Items', description: `${totalWithVariants} items - View everything` });
    }
    
    pageCats.forEach(cat => {
      const catItems = menuItems.filter(m => Array.isArray(m.category) ? m.category.includes(cat) : m.category === cat);
      const count = countItemsWithVariants(catItems);
      const safeId = cat.replace(/[^a-zA-Z0-9_]/g, '_');
      rows.push({ rowId: `cat_${safeId}`, title: cat.substring(0, 24), description: `${count} items available` });
    });

    await whatsapp.sendList(
      phone,
      `📋 ${label}`,
      `Page ${page + 1}/${totalPages} • ${categories.length} categories\nTap to select a category`,
      'View Categories',
      [{ title: 'Menu Categories', rows }],
      'Select a category'
    );

    // Send navigation buttons
    const buttons = [];
    if (page > 0) buttons.push({ id: `menucat_page_${page - 1}`, text: 'Previous' });
    if (page < totalPages - 1) buttons.push({ id: `menucat_page_${page + 1}`, text: 'Next' });
    buttons.push({ id: 'home', text: 'Menu' });

    const browseMenuImg = await chatbotImagesService.getImageUrl('browse_menu');
    await sendWithOptionalImage(phone, browseMenuImg, `Page ${page + 1} of ${totalPages}`, buttons.slice(0, 3));
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
      await sendWithOptionalImage(phone, itemNotAvailableImg, `📋 No items in ${category} right now.`, [
        { id: 'view_menu', text: 'Back to Menu' },
        { id: 'home', text: 'Main Menu' }
      ]);
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
      logger.info('Catalog fallback for category items', { category, error: catalogErr.message });
    }

    // Fallback: existing list-based flow
    // Get customer's activeOffers (cached per-request — avoids redundant DB calls)
    const activeOffers = await getCachedActiveOffers(phone);

    const getFoodTypeIcon = (type) => type === 'veg' ? '🟢' : type === 'nonveg' ? '🔴' : type === 'egg' ? '🟡' : '';
    const ITEMS_PER_PAGE = 10;
    const totalPages = Math.ceil(items.length / ITEMS_PER_PAGE);
    const startIdx = page * ITEMS_PER_PAGE;
    const pageItems = items.slice(startIdx, startIdx + ITEMS_PER_PAGE);

    // Build rows for the list
    const rows = pageItems.map(item => {
      const ratingStr = item.totalRatings > 0 ? `⭐${item.avgRating}` : '☆';
      const priceDisplay = formatPriceWithActiveOffers(item, activeOffers);
      return {
        rowId: `view_${item._id}`,
        title: `${getFoodTypeIcon(item.foodType)} ${item.name}`.substring(0, 24),
        description: `${ratingStr} • ${priceDisplay} • ${item.quantity || 1} ${item.unit || 'piece'}`.substring(0, 72)
      };
    });

    // Only items in the list, no navigation rows
    const sections = [{ title: `${category} (${items.length} items)`, rows }];

    await whatsapp.sendList(
      phone,
      `📋 ${category}`,
      `Page ${page + 1}/${totalPages} • ${items.length} items total\nTap an item to view details`,
      'View Items',
      sections,
      'Select an item'
    );

    // Send navigation buttons if multiple pages
    if (totalPages > 1) {
      const safeCat = category.replace(/[^a-zA-Z0-9]/g, '_');
      const buttons = [];
      if (page > 0) buttons.push({ id: `catpage_${safeCat}_${page - 1}`, text: 'Previous' });
      if (page < totalPages - 1) buttons.push({ id: `catpage_${safeCat}_${page + 1}`, text: 'Next' });
      buttons.push({ id: 'view_menu', text: 'Menu' });
      const browseMenuImg = await chatbotImagesService.getImageUrl('browse_menu');
      await sendWithOptionalImage(phone, browseMenuImg, `Page ${page + 1} of ${totalPages}`, buttons.slice(0, 3));
    }
  },

  // Send all items (for browsing) - always use WhatsApp list with pagination
  async sendAllItems(phone, menuItems, page = 0) {
    if (!menuItems.length) {
      const browseMenuImg = await chatbotImagesService.getImageUrl('browse_menu');
      await sendWithOptionalImage(phone, browseMenuImg, '📋 No items available right now.', [
        { id: 'view_menu', text: 'Back to Menu' },
        { id: 'home', text: 'Main Menu' }
      ]);
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
      logger.info('Catalog fallback for all items', { error: catalogErr.message });
    }

    // Fallback: existing list-based flow
    // Get customer's activeOffers (cached per-request — avoids redundant DB calls)
    const activeOffers = await getCachedActiveOffers(phone);

    const getFoodTypeIcon = (type) => type === 'veg' ? '🟢' : type === 'nonveg' ? '🔴' : type === 'egg' ? '🟡' : '';
    const ITEMS_PER_PAGE = 10;
    const totalPages = Math.ceil(menuItems.length / ITEMS_PER_PAGE);
    const startIdx = page * ITEMS_PER_PAGE;
    const pageItems = menuItems.slice(startIdx, startIdx + ITEMS_PER_PAGE);

    // Build rows for the list
    const rows = pageItems.map(item => {
      const ratingStr = item.totalRatings > 0 ? `⭐${item.avgRating}` : '☆';
      const priceDisplay = formatPriceWithActiveOffers(item, activeOffers);
      return {
        rowId: `view_${item._id}`,
        title: `${getFoodTypeIcon(item.foodType)} ${item.name}`.substring(0, 24),
        description: `${ratingStr} • ${priceDisplay} • ${item.quantity || 1} ${item.unit || 'piece'}`.substring(0, 72)
      };
    });

    const sections = [{ title: `All Items (${menuItems.length})`, rows }];

    await whatsapp.sendList(
      phone,
      '📋 All Items',
      `Page ${page + 1}/${totalPages} • ${menuItems.length} items total\nTap an item to view details`,
      'View Items',
      sections,
      'Select an item'
    );

    // Send navigation buttons if multiple pages
    if (totalPages > 1) {
      const buttons = [];
      if (page > 0) buttons.push({ id: `allitems_page_${page - 1}`, text: 'Previous' });
      if (page < totalPages - 1) buttons.push({ id: `allitems_page_${page + 1}`, text: 'Next' });
      buttons.push({ id: 'view_menu', text: 'Menu' });
      const browseMenuImg = await chatbotImagesService.getImageUrl('browse_menu');
      await sendWithOptionalImage(phone, browseMenuImg, `Page ${page + 1} of ${totalPages}`, buttons.slice(0, 3));
    }
  },

  // Send items matching a tag keyword (for tag-based search)
  async sendItemsByTag(phone, items, tagKeyword, page = 0, matchedVariants = null) {
    if (!items.length) {
      const itemNotAvailableImg = await chatbotImagesService.getImageUrl('item_not_available');
      await sendWithOptionalImage(phone, itemNotAvailableImg, `🔍 No items found for "${tagKeyword}".`, [
        { id: 'view_menu', text: 'Browse Menu' },
        { id: 'home', text: 'Main Menu' }
      ]);
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
      logger.info('Catalog fallback for search results', { tagKeyword, error: catalogErr.message });
    }

    // Fallback: existing list-based flow
    // Get customer's activeOffers (cached per-request — avoids redundant DB calls)
    const activeOffers = await getCachedActiveOffers(phone);

    const getFoodTypeIcon = (type) => type === 'veg' ? '🟢' : type === 'nonveg' ? '🔴' : type === 'egg' ? '🟡' : '';
    const ITEMS_PER_PAGE = 10;
    const totalPages = Math.ceil(items.length / ITEMS_PER_PAGE);
    const startIdx = page * ITEMS_PER_PAGE;
    const pageItems = items.slice(startIdx, startIdx + ITEMS_PER_PAGE);

    // Build rows for the list - use view_ prefix so user can see details first
    const rows = pageItems.map(item => {
      const ratingStr = item.totalRatings > 0 ? `⭐${item.avgRating}` : '☆';
      const priceDisplay = formatPriceWithActiveOffers(item, activeOffers);
      // Show matched variant name in description if available
      const vi = matchedVariants?.[item._id.toString()];
      let variantInfo = '';
      if (Array.isArray(vi)) {
        const matchedLabels = vi.map(idx => item.variants?.[idx]?.label).filter(Boolean);
        if (matchedLabels.length > 0) variantInfo = `🔖 ${matchedLabels.join(', ')} • `;
      } else if (typeof vi === 'number' && item.variants?.[vi]?.label) {
        variantInfo = `🔖 ${item.variants[vi].label} • `;
      }
      return {
        rowId: `view_${item._id}`,
        title: `${getFoodTypeIcon(item.foodType)} ${item.name}`.substring(0, 24),
        description: `${variantInfo}${ratingStr} • ${priceDisplay} • ${item.quantity || 1} ${item.unit || 'piece'}`.substring(0, 72)
      };
    });

    const sections = [{ title: `"${tagKeyword}" Items (${items.length})`, rows }];

    await whatsapp.sendList(
      phone,
      `🏷️ ${tagKeyword}`,
      `Found ${items.length} items matching "${tagKeyword}"\nTap an item to view details & add to cart`,
      'View Items',
      sections,
      'Select an item'
    );

    // Send navigation buttons if multiple pages
    if (totalPages > 1) {
      const safeTag = tagKeyword.replace(/[^a-zA-Z0-9]/g, '_');
      const buttons = [];
      if (page > 0) buttons.push({ id: `tagpage_${safeTag}_${page - 1}`, text: 'Previous' });
      if (page < totalPages - 1) buttons.push({ id: `tagpage_${safeTag}_${page + 1}`, text: 'Next' });
      buttons.push({ id: 'view_menu', text: 'Menu' });
      const browseMenuImg = await chatbotImagesService.getImageUrl('browse_menu');
      await sendWithOptionalImage(phone, browseMenuImg, `Page ${page + 1} of ${totalPages}`, buttons.slice(0, 3));
    }
  },

  // Send products with images (fallback for catalog)
  async sendProductsWithImages(phone, items) {
    const getFoodTypeIcon = (type) => type === 'veg' ? '🟢' : type === 'nonveg' ? '🔴' : type === 'egg' ? '🟡' : '';
    
    await whatsapp.sendMessage(phone, '🍽️ *Our Menu*\nBrowse items below and tap to add to cart!');
    
    for (const item of items.slice(0, 5)) {
      const icon = getFoodTypeIcon(item.foodType);
      const msg = `${icon} *${item.name}*\n💰 ₹${item.price}\n\n${item.description || 'Delicious!'}`;
      
      const itemImg = (item.image && !item.image.startsWith('data:')) ? item.image : null;
      await sendWithOptionalImage(phone, itemImg, msg, [
        { id: `add_${item._id}`, text: 'Add to Cart' }
      ]);
    }
    
    const browseMenuImg = await chatbotImagesService.getImageUrl('browse_menu');
    await sendWithOptionalImage(phone, browseMenuImg, 'Want to see more items?', [
      { id: 'food_both', text: 'Full Menu' },
      { id: 'view_cart', text: 'View Cart' },
      { id: 'home', text: 'Home' }
    ]);
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
      logger.info('Catalog fallback for search result cards', { searchLabel, error: catalogErr.message });
    }

    // Fallback: individual rich cards with image + buttons
    const activeOffers = await getCachedActiveOffers(phone);
    
    // Header message
    await whatsapp.sendMessage(phone, `🔍 Found *${items.length} items* matching ${searchLabel}\n\nSwipe through the results below 👇`);
    
    // Send each item as a rich card with image + buttons
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      let msg = this.buildItemCardMessage(item, activeOffers);
      
      // Highlight matched variant in fallback card
      const vi = matchedVariants?.[item._id.toString()];
      if (Array.isArray(vi)) {
        // Show matched variant names
        const matchedLabels = vi.map(idx => item.variants?.[idx]?.label).filter(Boolean);
        if (matchedLabels.length > 0) {
          msg = `🔖 *Matched: ${matchedLabels.join(', ')}*\n\n${msg}`;
        }
      } else if (typeof vi === 'number' && item.variants?.[vi]?.label) {
        const mv = item.variants[vi];
        const mvPrice = mv.offerPrice && mv.offerPrice < mv.price ? `~₹${mv.price}~ ₹${mv.offerPrice}` : `₹${mv.price}`;
        msg = `🔖 *Matched: ${mv.label}* (${mvPrice})\n\n${msg}`;
      }
      
      const buttons = [
        { id: `confirm_add_${item._id}`, text: 'Add to Cart' },
        { id: `view_${item._id}`, text: 'View Details' }
      ];
      // Add "Review & Order" only on last card
      if (i === items.length - 1) {
        buttons.push({ id: 'review_pay', text: 'Review & Order' });
      } else {
        buttons.push({ id: 'view_menu', text: 'Back to Menu' });
      }
      
      if (item.image) {
        await whatsapp.sendImageWithButtons(phone, item.image, msg, buttons);
      } else {
        const browseImg = await chatbotImagesService.getImageUrl('browse_menu');
        await sendWithOptionalImage(phone, browseImg, msg, buttons);
      }
    }
  },

  async sendItemDetails(phone, menuItems, itemId, matchedVariantIndex = null) {
    const item = menuItems.find(m => m._id.toString() === itemId);
    if (!item) {
      const itemNotAvailableImg = await chatbotImagesService.getImageUrl('item_not_available');
      await sendWithOptionalImage(phone, itemNotAvailableImg, '❌ Item not found.', [
        { id: 'view_menu', text: 'View Menu' }
      ]);
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
      logger.info('Catalog fallback for item details', { itemId, error: catalogErr.message });
    }

    // Fallback: rich card with image + buttons
    const activeOffers = await getCachedActiveOffers(phone);
    let msg = this.buildItemCardMessage(item, activeOffers);
    // Highlight matched variant(s) in fallback card
    const singleViFallback = isSingleMatch ? matchedVariantIndex : (isArrayMatch && matchedVariantIndex.length === 1 ? matchedVariantIndex[0] : null);
    if (singleViFallback !== null && item.variants?.[singleViFallback]?.label) {
      const mv = item.variants[singleViFallback];
      if (mv.quantities && mv.quantities.length > 1) {
        const sizeLines = mv.quantities.map((q, qi) => {
          const qPrice = q.offerPrice && q.offerPrice < q.price ? `~₹${q.price}~ ₹${q.offerPrice}` : `₹${q.price}`;
          const sizeLabel = q.quantity ? `${q.quantity} ${q.unit || ''}`.trim() : `Option ${qi + 1}`;
          return `  ${qi + 1}. ${sizeLabel} - ${qPrice}`;
        });
        msg = `🔖 *${mv.label}* - ${mv.quantities.length} sizes:\n${sizeLines.join('\n')}\n\n${msg}`;
      } else {
        const mvPrice = mv.offerPrice && mv.offerPrice < mv.price ? `~₹${mv.price}~ ₹${mv.offerPrice}` : `₹${mv.price}`;
        msg = `🔖 *Matched: ${mv.label}* (${mvPrice})\n\n${msg}`;
      }
    } else if (isArrayMatch && matchedVariantIndex.length > 1) {
      // Show matched variants in fallback (show unavailable as locked)
      const variantLines = [];
      for (const vi of matchedVariantIndex) {
        const v = item.variants?.[vi];
        if (!v) continue;
        const isLocked = v.available === false;
        const lockPrefix = isLocked ? '🔒 ' : '';
        const lockSuffix = isLocked ? ' • Out of stock' : '';
        if (v.quantities && v.quantities.length > 0) {
          v.quantities.forEach((q) => {
            const qPrice = q.offerPrice && q.offerPrice < q.price ? `~₹${q.price}~ ₹${q.offerPrice}` : `₹${q.price}`;
            const label = v.label ? `${v.label} - ${q.quantity || ''} ${q.unit || ''}`.trim() : `${q.quantity} ${q.unit || ''}`;
            variantLines.push(`  ${variantLines.length + 1}. ${lockPrefix}${label.trim()} - ${qPrice}${lockSuffix}`);
          });
        } else if (v.label) {
          const vPrice = v.offerPrice && v.offerPrice < v.price ? `~₹${v.price}~ ₹${v.offerPrice}` : `₹${v.price}`;
          variantLines.push(`  ${variantLines.length + 1}. ${lockPrefix}${v.label} - ${vPrice}${lockSuffix}`);
        }
      }
      if (variantLines.length > 0) {
        msg = `🔖 *${variantLines.length} Matching Options:*\n${variantLines.join('\n')}\n\n${msg}`;
      }
    } else if (matchedVariantIndex === null && item.variants && item.variants.length > 0) {
      // Show all variants/sizes in fallback text (show unavailable as locked)
      const variantLines = [];
      item.variants.forEach((v, vi) => {
        const isLocked = v.available === false;
        const lockPrefix = isLocked ? '🔒 ' : '';
        const lockSuffix = isLocked ? ' • Out of stock' : '';
        if (v.quantities && v.quantities.length > 0) {
          // Show each quantity/size option (all locked if variant is off)
          v.quantities.forEach((q, qi) => {
            const qPrice = q.offerPrice && q.offerPrice < q.price ? `~₹${q.price}~ ₹${q.offerPrice}` : `₹${q.price}`;
            const label = v.label ? `${v.label} - ${q.label || q.quantity + ' ' + (q.unit || '')}` : (q.label || `${q.quantity} ${q.unit || ''}`);
            variantLines.push(`  ${variantLines.length + 1}. ${lockPrefix}${label.trim()} - ${qPrice}${lockSuffix}`);
          });
        } else if (v.label) {
          const vPrice = v.offerPrice && v.offerPrice < v.price ? `~₹${v.price}~ ₹${v.offerPrice}` : `₹${v.price}`;
          variantLines.push(`  ${variantLines.length + 1}. ${lockPrefix}${v.label} - ${vPrice}${lockSuffix}`);
        }
      });
      if (variantLines.length > 1) {
        msg = `🔖 *${variantLines.length} Options Available:*\n${variantLines.join('\n')}\n\n${msg}`;
      }
    }

    const buttons = [
      { id: `confirm_add_${item._id}`, text: 'Add to Cart' },
      { id: 'view_menu', text: 'Back to Menu' },
      { id: 'review_pay', text: 'Review & Order' }
    ];

    if (item.image) {
      await whatsapp.sendImageWithButtons(phone, item.image, msg, buttons);
    } else {
      const browseImg = await chatbotImagesService.getImageUrl('browse_menu');
      await sendWithOptionalImage(phone, browseImg, msg, buttons);
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
      logger.info('Catalog fallback for order item details', { itemId: item._id, error: catalogErr.message });
    }

    // Fallback: rich card with image + buttons
    const activeOffers = await getCachedActiveOffers(phone);
    const msg = this.buildItemCardMessage(item, activeOffers);

    const buttons = [
      { id: `confirm_add_${item._id}`, text: 'Add to Cart' },
      { id: 'add_more', text: 'Back to Menu' },
      { id: 'review_pay', text: 'Review & Order' }
    ];

    if (item.image) {
      await whatsapp.sendImageWithButtons(phone, item.image, msg, buttons);
    } else {
      const browseImg = await chatbotImagesService.getImageUrl('browse_menu');
      await sendWithOptionalImage(phone, browseImg, msg, buttons);
    }
  },

  // ============ ORDERING ============
  async sendServiceType(phone) {
    const checkoutImg = await chatbotImagesService.getImageUrl('checkout');
    await sendWithOptionalImage(phone, checkoutImg,
      '🛒 *Place Order*\n\nHow would you like to receive your order?',
      [
        { id: 'delivery', text: 'Delivery' },
        { id: 'pickup', text: 'Pickup' },
        { id: 'dine_in', text: 'Dine-in' }
      ]
    );
  },

  async sendMenuForOrder(phone, menuItems, label = 'Select Items', page = 0) {
    // Flatten category arrays and dedupe (category is an array field)
    const categories = [...new Set(menuItems.flatMap(m => Array.isArray(m.category) ? m.category : [m.category]))];
    
    if (!categories.length) {
      const browseMenuImg = await chatbotImagesService.getImageUrl('browse_menu');
      await sendWithOptionalImage(phone, browseMenuImg, '📋 No menu items available.', [
        { id: 'home', text: 'Main Menu' }
      ]);
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
      logger.info('Flow category fallback (order)', { error: flowErr.message });
    }

    // ===== FALLBACK: TEXT LIST OF CATEGORY NAMES =====

    // If 9 or fewer categories (+ All Items = 10), use WhatsApp list without pagination
    if (categories.length <= 9) {
      const rows = [
        { rowId: 'order_cat_all', title: '📋 All Items', description: `${menuItems.length} items - View everything` }
      ];
      
      categories.forEach(cat => {
        const count = menuItems.filter(m => Array.isArray(m.category) ? m.category.includes(cat) : m.category === cat).length;
        const safeId = cat.replace(/[^a-zA-Z0-9_]/g, '_');
        rows.push({ rowId: `order_cat_${safeId}`, title: cat.substring(0, 24), description: `${count} items` });
      });

      await whatsapp.sendList(phone, label, 'Choose a category to add items to your cart', 'View Categories',
        [{ title: 'Categories', rows }], 'Tap to browse');
      return;
    }

    // More than 9 categories - use pagination with WhatsApp list
    const CATS_PER_PAGE = 9; // 9 categories + 1 "All Items" = 10 rows max
    const totalPages = Math.ceil(categories.length / CATS_PER_PAGE);
    const startIdx = page * CATS_PER_PAGE;
    const pageCats = categories.slice(startIdx, startIdx + CATS_PER_PAGE);

    // Build rows for the list
    const rows = [];
    
    // Add "All Items" option on first page only
    if (page === 0) {
      rows.push({ rowId: 'order_cat_all', title: '📋 All Items', description: `${menuItems.length} items - View everything` });
    }
    
    pageCats.forEach(cat => {
      const count = menuItems.filter(m => Array.isArray(m.category) ? m.category.includes(cat) : m.category === cat).length;
      const safeId = cat.replace(/[^a-zA-Z0-9_]/g, '_');
      rows.push({ rowId: `order_cat_${safeId}`, title: cat.substring(0, 24), description: `${count} items` });
    });

    await whatsapp.sendList(
      phone,
      `🛒 ${label}`,
      `Page ${page + 1}/${totalPages} • ${categories.length} categories\nTap to select a category`,
      'View Categories',
      [{ title: 'Categories', rows }],
      'Select a category'
    );

    // Send navigation buttons
    const buttons = [];
    if (page > 0) buttons.push({ id: `ordercat_page_${page - 1}`, text: 'Previous' });
    if (page < totalPages - 1) buttons.push({ id: `ordercat_page_${page + 1}`, text: 'Next' });
    buttons.push({ id: 'home', text: 'Menu' });

    const browseMenuImg = await chatbotImagesService.getImageUrl('browse_menu');
    await sendWithOptionalImage(phone, browseMenuImg, `Page ${page + 1} of ${totalPages}`, buttons.slice(0, 3));
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
      await sendWithOptionalImage(phone, searchNoResultsImg, '📋 No matching items found.', [
        { id: 'order_food', text: 'Order Food' },
        { id: 'home', text: 'Main Menu' }
      ]);
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
      await sendWithOptionalImage(phone, itemNotAvailableImg, '📋 Item not found.', [
        { id: 'order_food', text: 'Order Food' },
        { id: 'home', text: 'Main Menu' }
      ]);
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
      await sendWithOptionalImage(phone, itemNotAvailableImg, `📋 No matching variants in ${menuItem.name}.`, [
        { id: 'order_food', text: 'Order Food' },
        { id: 'home', text: 'Main Menu' }
      ]);
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
      logger.info('Catalog fallback for title variants', { error: catalogErr.message });
    }

    // Only send a WhatsApp list fallback if catalog message was NOT sent.
    // When catalog is sent, users can tap products directly from the catalog card.
    if (!catalogSent) {
      const itemId = menuItem._id.toString();
      const rows = matchingVariants.slice(0, 10).map(v => {
        const icon = getFoodTypeIcon(v.foodType || menuItem.foodType);
        let price;
        if (v.quantities && v.quantities.length > 0) {
          const cheapest = Math.min(...v.quantities.map(q => q.offerPrice && q.offerPrice < q.price ? q.offerPrice : q.price));
          price = `from ₹${cheapest}`;
        } else {
          price = `₹${v.offerPrice && v.offerPrice < v.price ? v.offerPrice : v.price}`;
        }
        const sizeInfo = (v.quantity && v.unit) ? ` (${v.quantity} ${v.unit})` : '';
        return {
          rowId: `add_variant_${itemId}_${v.originalIndex}`,
          title: `${icon} ${v.label}${sizeInfo}`.substring(0, 24),
          description: price
        };
      });

      await whatsapp.sendList(
        phone,
        menuItem.name.substring(0, 24),
        `📋 *${menuItem.name}*\nSelect a variant to add to cart:`,
        'Choose Variant',
        [{ title: 'Variants', rows }],
        'Select a variant'
      );
    }
  },

  async sendItemsForOrder(phone, menuItems, category, page = 0) {
    // Filter items that include this category (category is an array field)
    const items = menuItems.filter(m => Array.isArray(m.category) ? m.category.includes(category) : m.category === category);
    
    if (!items.length) {
      const itemNotAvailableImg = await chatbotImagesService.getImageUrl('item_not_available');
      await sendWithOptionalImage(phone, itemNotAvailableImg, `📋 No items in ${category}.`, [
        { id: 'add_more', text: 'Other Categories' },
        { id: 'home', text: 'Main Menu' }
      ]);
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
      logger.info('Catalog fallback for order items', { category, error: catalogErr.message });
    }

    // Fallback: existing list-based flow
    // Get customer's activeOffers (cached per-request — avoids redundant DB calls)
    const activeOffers = await getCachedActiveOffers(phone);

    const getFoodTypeIcon = (type) => type === 'veg' ? '🟢' : type === 'nonveg' ? '🔴' : type === 'egg' ? '🟡' : '';
    const ITEMS_PER_PAGE = 10;
    const totalPages = Math.ceil(items.length / ITEMS_PER_PAGE);
    const startIdx = page * ITEMS_PER_PAGE;
    const pageItems = items.slice(startIdx, startIdx + ITEMS_PER_PAGE);

    // Build rows for the list
    const rows = pageItems.map(item => {
      const ratingStr = item.totalRatings > 0 ? `⭐${item.avgRating}` : '☆';
      const priceDisplay = formatPriceWithActiveOffers(item, activeOffers);
      return {
        rowId: `add_${item._id}`,
        title: `${getFoodTypeIcon(item.foodType)} ${item.name}`.substring(0, 24),
        description: `${ratingStr} • ${priceDisplay} • ${item.quantity || 1} ${item.unit || 'piece'}`.substring(0, 72)
      };
    });

    const sections = [{ title: `${category} (${items.length} items)`, rows }];

    await whatsapp.sendList(
      phone,
      `📋 ${category}`,
      `Page ${page + 1}/${totalPages} • ${items.length} items total\nTap an item to add to cart`,
      'View Items',
      sections,
      'Select an item'
    );

    // Send navigation buttons if multiple pages
    if (totalPages > 1) {
      const safeCat = category.replace(/[^a-zA-Z0-9]/g, '_');
      const buttons = [];
      if (page > 0) buttons.push({ id: `ordercatpage_${safeCat}_${page - 1}`, text: 'Previous' });
      if (page < totalPages - 1) buttons.push({ id: `ordercatpage_${safeCat}_${page + 1}`, text: 'Next' });
      buttons.push({ id: 'home', text: 'Menu' });
      const browseMenuImg = await chatbotImagesService.getImageUrl('browse_menu');
      await sendWithOptionalImage(phone, browseMenuImg, `Page ${page + 1} of ${totalPages}`, buttons.slice(0, 3));
    }
  },

  // Send all items for ordering with pagination
  async sendAllItemsForOrder(phone, menuItems, page = 0) {
    if (!menuItems.length) {
      const browseMenuImg = await chatbotImagesService.getImageUrl('browse_menu');
      await sendWithOptionalImage(phone, browseMenuImg, '📋 No items available.', [
        { id: 'add_more', text: 'Other Categories' },
        { id: 'home', text: 'Main Menu' }
      ]);
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
      logger.info('Catalog fallback for all order items', { error: catalogErr.message });
    }

    // Fallback: existing list-based flow
    // Get customer's activeOffers (cached per-request — avoids redundant DB calls)
    const activeOffers = await getCachedActiveOffers(phone);

    const getFoodTypeIcon = (type) => type === 'veg' ? '🟢' : type === 'nonveg' ? '🔴' : type === 'egg' ? '🟡' : '';
    const ITEMS_PER_PAGE = 10;
    const totalPages = Math.ceil(menuItems.length / ITEMS_PER_PAGE);
    const startIdx = page * ITEMS_PER_PAGE;
    const pageItems = menuItems.slice(startIdx, startIdx + ITEMS_PER_PAGE);

    // Build rows for the list
    const rows = pageItems.map(item => {
      const ratingStr = item.totalRatings > 0 ? `⭐${item.avgRating}` : '☆';
      const priceDisplay = formatPriceWithActiveOffers(item, activeOffers);
      return {
        rowId: `add_${item._id}`,
        title: `${getFoodTypeIcon(item.foodType)} ${item.name}`.substring(0, 24),
        description: `${ratingStr} • ${priceDisplay} • ${item.quantity || 1} ${item.unit || 'piece'}`.substring(0, 72)
      };
    });

    const sections = [{ title: `All Items (${menuItems.length})`, rows }];

    await whatsapp.sendList(
      phone,
      '📋 All Items',
      `Page ${page + 1}/${totalPages} • ${menuItems.length} items total\nTap an item to add to cart`,
      'View Items',
      sections,
      'Select an item'
    );

    // Send navigation buttons if multiple pages
    if (totalPages > 1) {
      const buttons = [];
      if (page > 0) buttons.push({ id: `orderitems_page_${page - 1}`, text: 'Previous' });
      if (page < totalPages - 1) buttons.push({ id: `orderitems_page_${page + 1}`, text: 'Next' });
      buttons.push({ id: 'home', text: 'Menu' });
      const browseMenuImg = await chatbotImagesService.getImageUrl('browse_menu');
      await sendWithOptionalImage(phone, browseMenuImg, `Page ${page + 1} of ${totalPages}`, buttons.slice(0, 3));
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
    
    await sendWithOptionalImage(phone, addedToCartImageUrl,
      `✅ *Added to Cart!*\n\n*${item.name}* (${unitInfo})\nQty: ${qty} × ₹${effectivePrice} = ₹${effectivePrice * qty}\n\n🛒 Cart: ${cartCount} items`,
      [
        { id: 'add_more', text: 'Add More' },
        { id: 'view_cart', text: 'View Cart' },
        { id: 'review_pay', text: 'Review & Order' }
      ]
    );
  },

  // ============ CART & CHECKOUT ============
  async sendCheckoutOptions(phone, customer) {
    // Refresh customer from database to ensure we have latest cart data
    const freshCustomer = await Customer.findOne({ phone }).populate('cart.menuItem');
    
    if (!freshCustomer?.cart?.length) {
      const cartEmptyImg = await chatbotImagesService.getImageUrl('cart_empty');
      await sendWithOptionalImage(phone, cartEmptyImg, '🛒 Your cart is empty!', [
        { id: 'view_menu', text: 'View Menu' },
        { id: 'home', text: 'Main Menu' }
      ]);
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
      await sendWithOptionalImage(phone, cartEmptyImg, '🛒 Your cart is empty!', [
        { id: 'view_menu', text: 'View Menu' },
        { id: 'home', text: 'Main Menu' }
      ]);
      return;
    }
    
    cartMsg += `━━━━━━━━━━━━━━━\n`;
    cartMsg += `*Total: ₹${total}*`;

    // Show Review & Order, Add More, Cancel buttons
    const viewCartImg = await chatbotImagesService.getImageUrl('view_cart');
    await sendWithOptionalImage(phone, viewCartImg, cartMsg, [
      { id: 'review_pay', text: 'Review & Order' },
      { id: 'add_more', text: 'Add More' },
      { id: 'clear_cart', text: 'Cancel' }
    ]);
  },

  async requestLocation(phone) {
    // Request location with action buttons
    await whatsapp.sendLocationRequest(phone,
      `📍 *Share Your Delivery Location*\n\nPlease share your location for accurate delivery.`
    );
  },

  async sendPaymentMethodOptions(phone, customer, state = {}) {
    // Refresh customer from database to ensure we have latest cart data
    const freshCustomer = await Customer.findOne({ phone }).populate('cart.menuItem');
    
    if (!freshCustomer?.cart?.length) {
      const cartEmptyImg = await chatbotImagesService.getImageUrl('cart_empty');
      await sendWithOptionalImage(phone, cartEmptyImg, '🛒 Your cart is empty!', [
        { id: 'view_menu', text: 'View Menu' },
        { id: 'home', text: 'Main Menu' }
      ]);
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
      await sendWithOptionalImage(phone, cartEmptyImg, '🛒 Your cart is empty!', [
        { id: 'view_menu', text: 'View Menu' },
        { id: 'home', text: 'Main Menu' }
      ]);
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
    await sendWithOptionalImage(phone, orderSummaryImageUrl, cartMsg, [
      { id: 'pay_upi', text: 'UPI/APP' },
      { id: 'pay_cod', text: 'COD' },
      { id: 'clear_cart', text: 'Cancel' }
    ]);
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
      await sendWithOptionalImage(phone, cartEmptyImg, '🛒 Your cart is empty!', [
        { id: 'view_menu', text: 'View Menu' },
        { id: 'home', text: 'Main Menu' }
      ]);
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
      await sendWithOptionalImage(phone, cartEmptyImg, '🛒 Your cart is empty!', [
        { id: 'view_menu', text: 'View Menu' },
        { id: 'home', text: 'Main Menu' }
      ]);
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

    let confirmMsg = `✅ *Order Confirmed!*\n\n`;
    confirmMsg += `📦 Order ID: *${orderId}*\n`;
    confirmMsg += `💵 Payment: *Cash on Delivery*\n\n`;
    confirmMsg += `━━━━━━━━━━━━━━━\n`;
    confirmMsg += `*Items:*\n`;
    items.forEach((item, i) => {
      confirmMsg += `${i + 1}. *${item.name}* (${item.unitQty} ${item.unit})\n`;
      confirmMsg += `   Qty: ${item.quantity} × ₹${item.price} = ₹${item.price * item.quantity}\n\n`;
    });
    confirmMsg += `━━━━━━━━━━━━━━━\n`;
    confirmMsg += `*Items Total:* ₹${itemsTotal}\n`;
    if (deliveryCharge > 0) {
      confirmMsg += `*Delivery Charge:* ₹${deliveryCharge}\n`;
    }
    confirmMsg += `*Grand Total:* ₹${total}\n\n`;
    confirmMsg += `🙏 Thank you for your order!\nPlease keep ₹${total} ready for payment.`;

    const confirmedImageUrl = await chatbotImagesService.getImageUrl('order_confirmed');
    
    await sendWithOptionalImage(phone, confirmedImageUrl, confirmMsg, [
      { id: 'track_order', text: 'Track Order' },
      { id: `cancel_${orderId}`, text: 'Cancel Order' },
      { id: 'home', text: 'Main Menu' }
    ]);

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
      await sendWithOptionalImage(phone, cartEmptyImg, '🛒 Your cart is empty!', [
        { id: 'view_menu', text: 'View Menu' },
        { id: 'home', text: 'Main Menu' }
      ]);
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
      await sendWithOptionalImage(phone, cartEmptyImg, '🛒 Your cart is empty!', [
        { id: 'view_menu', text: 'View Menu' },
        { id: 'home', text: 'Main Menu' }
      ]);
      return;
    }
    
    reviewMsg += `━━━━━━━━━━━━━━━\n`;
    reviewMsg += `*Total: ₹${total}*\n\n`;
    reviewMsg += `Please confirm your order to proceed with payment.`;

    const orderSummaryImg = await chatbotImagesService.getImageUrl('order_summary');
    await sendWithOptionalImage(phone, orderSummaryImg, reviewMsg, [
      { id: 'confirm_order', text: 'Confirm & Pay' },
      { id: 'add_more', text: 'Add More' },
      { id: 'clear_cart', text: 'Cancel' }
    ]);
  },

  // Send cart options menu when user types just "cart"
  async sendCartOptionsMenu(phone) {
    const cartOptionsImageUrl = await chatbotImagesService.getImageUrl('cart_options');
    const message = `🛒 *Cart Options*\n\nWhat would you like to do?`;
    
    await sendWithOptionalImage(phone, cartOptionsImageUrl, message, [
      { id: 'view_cart', text: 'My Cart' },
      { id: 'clear_cart', text: 'Clear Cart' },
      { id: 'view_menu', text: 'Menu' }
    ]);
  },

  async sendCart(phone, customer) {
    // Refresh customer from database to ensure we have latest cart data
    const freshCustomer = await Customer.findOne({ phone }).populate('cart.menuItem');
    
    if (!freshCustomer?.cart?.length) {
      const cartEmptyImg = await chatbotImagesService.getImageUrl('cart_empty');
      await sendWithOptionalImage(phone, cartEmptyImg,
        '🛒 *Your Cart is Empty*\n\nTap the 🛒 cart icon at the top right to view your WhatsApp cart, or browse our menu to add items!',
        [
          { id: 'view_menu', text: 'View Menu' },
          { id: 'order_food', text: 'Order Food' },
          { id: 'home', text: 'Main Menu' }
        ]
      );
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
      await sendWithOptionalImage(phone, cartEmptyImg,
        '🛒 *Your Cart is Empty*\n\nTap the 🛒 cart icon at the top right to view your WhatsApp cart, or browse our menu to add items!',
        [
          { id: 'view_menu', text: 'View Menu' },
          { id: 'order_food', text: 'Order Food' },
          { id: 'home', text: 'Main Menu' }
        ]
      );
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

    // Try showing cart items as WhatsApp Catalog product_list (native cart with images/prices/Place Order)
    if (catalogService.isEnabled()) {
      const validCartItems = freshCustomer.cart.filter(item => item.menuItem);

      // Build discount info for body text
      let bodyText = `${validItems} items • Total: ₹${total}`;
      if (totalDiscount > 0) {
        bodyText += ` (Save ₹${totalDiscount})`;
      }
      bodyText += '\nTap "View items" to modify quantities';

      const catalogId = catalogService.getCatalogId();
      let cartSections = await catalogService.buildCartSections(validCartItems);

      if (cartSections && cartSections.sections.length > 0) {
        try {
          await whatsapp.sendProductList(
            phone, catalogId, '🛒 Your Cart', bodyText,
            cartSections.sections, 'Perivi Hotel'
          );
          
          // After catalog succeeds, send image-based cart message
          const viewCartImageUrl = await chatbotImagesService.getImageUrl('view_cart');
          await sendWithOptionalImage(phone, viewCartImageUrl, cartMsg, [
            { id: 'review_pay', text: 'Place Order ' },
            { id: 'add_more', text: 'Add More' },
            { id: 'clear_cart', text: 'Clear Cart' }
          ]);
          return;
        } catch (sendErr) {
          // On Meta #131009 (invalid parameter), force re-sync items to Meta and retry once
          const errCode = sendErr.response?.data?.error?.code;
          if (errCode === 131009) {
            logger.info('Product list #131009 — forcing re-sync and retry', { phone });
            for (const item of validCartItems) {
              if (item.menuItem) {
                await catalogService.syncProductToMeta(item.menuItem);
              }
            }
            catalogService.clearCache();
            cartSections = await catalogService.buildCartSections(validCartItems);
            if (cartSections && cartSections.sections.length > 0) {
              try {
                await whatsapp.sendProductList(
                  phone, catalogId, '🛒 Your Cart', bodyText,
                  cartSections.sections, 'Perivi Hotel'
                );
                
                // After retry succeeds, send image-based cart message
                const viewCartImageUrl = await chatbotImagesService.getImageUrl('view_cart');
                await sendWithOptionalImage(phone, viewCartImageUrl, cartMsg, [
                  { id: 'review_pay', text: 'Place Order ' },
                  { id: 'add_more', text: 'Add More' },
                  { id: 'clear_cart', text: 'Clear Cart' }
                ]);
                return;
              } catch (retryErr) {
                logger.error('Product list retry also failed', { phone, error: retryErr.message });
              }
            }
          } else {
            logger.error('sendProductList non-131009 error', { phone, code: errCode, error: sendErr.message });
          }
        }
      }
    }

    // Fallback: text-based cart (if catalog failed or not enabled)
    const viewCartImageUrl = await chatbotImagesService.getImageUrl('view_cart');
    await sendWithOptionalImage(phone, viewCartImageUrl, cartMsg, [
      { id: 'review_pay', text: 'Place Order ' },
      { id: 'add_more', text: 'Add More' },
      { id: 'clear_cart', text: 'Clear Cart' }
    ]);
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
      await sendWithOptionalImage(phone, cartEmptyImg, '🛒 Your cart is empty!', [
        { id: 'view_menu', text: 'View Menu' },
        { id: 'home', text: 'Main Menu' }
      ]);
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
      await sendWithOptionalImage(phone, cartEmptyImg, '🛒 Your cart is empty!', [
        { id: 'view_menu', text: 'View Menu' },
        { id: 'home', text: 'Main Menu' }
      ]);
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
      paymentMethod: 'online',
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
          const orderItems = items.map(item => ({
            retailerId: retailerMap.get(item.menuItem.toString()),
            name: item.name,
            priceAmount: item.originalPrice || item.price,
            saleAmount: item.price !== item.originalPrice ? item.price : undefined,
            quantity: item.quantity
          }));

          await whatsapp.sendOrderDetails(phone, orderId, orderItems, total, {
            tax: 0,
            shipping: deliveryCharge,
            discount: totalDiscount
          });

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

    // ===== FALLBACK: CTA URL PAYMENT (Razorpay payment page) =====
    // Send admin push immediately for CTA-based payment
    await sendAdminPush();

    try {
      // Generate payment page URL (UPI app selection page)
      const frontendUrl = process.env.FRONTEND_URL || process.env.WEBSITE_URL || 'https://restarunt-bot.vercel.app';
      const paymentPageUrl = `${frontendUrl}/pay/${orderId}`;

      const orderDetailsImageUrl = await chatbotImagesService.getImageUrl('order_details');
      await whatsapp.sendOrder(phone, order, items, paymentPageUrl, orderDetailsImageUrl);
      return { success: true };
    } catch (err) {
      logger.error('Payment page error', { error: err.message });
      const paymentFailedImg = await chatbotImagesService.getImageUrl('payment_failed');
      await sendWithOptionalImage(phone, paymentFailedImg,
        `✅ *Order Created!*\n\nOrder ID: ${orderId}\nTotal: ₹${total}\n\n⚠️ Payment link unavailable.\nPlease contact us.`,
        [
          { id: 'order_status', text: 'Check Status' },
          { id: 'home', text: 'Main Menu' }
        ]
      );
      return { success: true };
    }
  },


  // ============ ORDER MANAGEMENT ============
  async sendOrderStatus(phone) {
    const orders = await Order.find({ 'customer.phone': phone }).sort({ createdAt: -1 }).limit(5);
    
    if (!orders.length) {
      const noOrdersFoundImageUrl = await chatbotImagesService.getImageUrl('no_orders_found');
      await sendWithOptionalImage(phone, noOrdersFoundImageUrl,
        '📋 *No Orders Found*\n\nYou haven\'t placed any orders yet.',
        [{ id: 'place_order', text: 'Order Now' }, { id: 'home', text: 'Main Menu' }]
      );
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
    await sendWithOptionalImage(phone, yourOrdersImageUrl, msg, [
      { id: 'track_order', text: 'Track Order' },
      { id: 'home', text: 'Main Menu' }
    ]);
  },

  async sendTrackingOptions(phone) {
    const orders = await Order.find({
      'customer.phone': phone,
      status: { $nin: ['delivered', 'cancelled'] }
    }).sort({ createdAt: -1 }).limit(5);

    if (!orders.length) {
      const noActiveOrdersImageUrl = await chatbotImagesService.getImageUrl('no_active_orders');
      await sendWithOptionalImage(phone, noActiveOrdersImageUrl,
        '📍 *No Active Orders*\n\nNo orders to track right now.',
        [{ id: 'place_order', text: 'Order Now' }, { id: 'home', text: 'Main Menu' }]
      );
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
      await sendWithOptionalImage(phone, noOrdersImg, '❌ Order not found.', [{ id: 'home', text: 'Main Menu' }]);
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
    
    await sendWithOptionalImage(phone, trackingImageUrl, msg, [
      { id: 'order_status', text: 'All Orders' },
      { id: 'home', text: 'Main Menu' }
    ]);
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
      await sendWithOptionalImage(phone, noOrdersImageUrl,
        '❌ *No Orders to Cancel*\n\nNo cancellable orders found.\n\n_Note: Only Cash on Delivery orders can be cancelled. Pickup orders can only be cancelled before confirmation._',
        [{ id: 'order_status', text: 'View Orders' }, { id: 'home', text: 'Main Menu' }]
      );
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
      await sendWithOptionalImage(phone, noOrdersImg, '❌ Order not found.', [{ id: 'home', text: 'Main Menu' }]);
      return;
    }

    // Cannot cancel delivered or already cancelled orders
    if (['delivered', 'cancelled'].includes(order.status)) {
      const orderCancelledImg = await chatbotImagesService.getImageUrl('order_cancelled');
      await sendWithOptionalImage(phone, orderCancelledImg,
        `❌ *Cannot Cancel*\n\nOrder is already ${order.status.replace('_', ' ')}.`,
        [{ id: 'order_status', text: 'View Orders' }, { id: 'home', text: 'Main Menu' }]
      );
      return;
    }

    // Pickup orders can only be cancelled if status is 'pending' (before confirmation)
    if (order.serviceType === 'pickup' && order.status !== 'pending') {
      const pickupCancelRestrictedImageUrl = await chatbotImagesService.getImageUrl('pickup_cancel_restricted');
      await sendWithOptionalImage(phone, pickupCancelRestrictedImageUrl,
        `❌ *Cannot Cancel Pickup Order*\n\nOrder ${orderId} has already been confirmed and is being prepared.\n\n🏪 Pickup orders can only be cancelled before confirmation.\n\nPlease contact the restaurant if you need assistance.`,
        [{ id: 'order_status', text: 'View Orders' }, { id: 'home', text: 'Main Menu' }]
      );
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
    
    await sendWithOptionalImage(phone, cancelledImageUrl, msg, [
      { id: 'place_order', text: 'New Order' },
      { id: 'home', text: 'Main Menu' }
    ]);
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
      await sendWithOptionalImage(phone, null, '🏷️ *No Active Offers*\n\nThere are no special offers right now.\n\nCheck back later for exciting deals!', [
        { id: 'order_food', text: 'Order Food' },
        { id: 'home', text: 'Main Menu' }
      ]);
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

    await sendWithOptionalImage(phone, null, offerMessage, [
      { id: 'order_food', text: 'Order Food' },
      { id: 'home', text: 'Main Menu' }
    ]);
  },

  // ============ SERVICE TYPE SELECTION ============
  async sendServiceTypeSelection(phone) {
    const checkoutImg = await chatbotImagesService.getImageUrl('checkout');
    await sendWithOptionalImage(phone, checkoutImg,
      '🚚 *Choose Service Type*\n\nHow would you like to receive your order?',
      [
        { id: 'service_delivery', text: 'Delivery' },
        { id: 'service_pickup', text: 'Self-Pickup' }
      ],
      'Select your preferred option'
    );
  },

  // ============ PICKUP PAYMENT METHOD ============
  async sendPickupPaymentMethodOptions(phone, customer) {
    // Refresh customer from database to ensure we have latest cart data
    const freshCustomer = await Customer.findOne({ phone }).populate('cart.menuItem');
    if (!freshCustomer || !freshCustomer.cart?.length) {
      const cartEmptyImg = await chatbotImagesService.getImageUrl('cart_empty');
      await sendWithOptionalImage(phone, cartEmptyImg, '🛒 Your cart is empty!', [
        { id: 'view_menu', text: 'View Menu' }
      ]);
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
    await sendWithOptionalImage(phone, pickupOrderSummaryImageUrl, msg, [
      { id: 'pickup_pay_hotel', text: 'Pay at Hotel' },
      { id: 'pickup_pay_upi', text: 'UPI/App' }
    ]);
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
        await sendWithOptionalImage(phone, cartEmptyImg, '🛒 Your cart is empty!', [
          { id: 'view_menu', text: 'View Menu' }
        ]);
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

      // Send confirmation message
      let msg = '✅ *Order Request Successful!*\n\n';
      msg += `📦 Order ID: *${orderId}*\n`;
      msg += `🏪 Service: *Self-Pickup*\n`;
      msg += `💰 Total: *₹${itemsTotal}*\n`;
      msg += `💳 Payment: *${state.paymentMethod === 'cod' ? 'Pay at Hotel' : 'UPI/App'}*\n\n`;
      
      // Add order items details
      msg += `━━━━━━━━━━━━━━━\n`;
      msg += `📋 *Order Details*\n`;
      msg += `━━━━━━━━━━━━━━━\n`;
      items.forEach((item, index) => {
        msg += `${index + 1}. *${item.name}*\n`;
        msg += `   Qty: ${item.quantity} × ₹${item.price} = ₹${item.price * item.quantity}\n\n`;
      });
      msg += `━━━━━━━━━━━━━━━\n\n`;
      
      if (state.paymentMethod === 'cod') {
        msg += '✨ Your order has been received!\n\n';
        msg += '📍 Please come to the restaurant to pick up your order.\n';
        msg += '💵 Payment will be collected at the hotel.\n\n';
        msg += '⏰ We will notify you when your order is ready!\n\n';
        msg += 'Thank you for your order! 🙏';
      } else {
        msg += '⏳ Waiting for payment confirmation...\n\n';
        msg += 'Please complete the payment to confirm your order.';
      }

      // Get pickup order requested image and send with buttons
      const pickupOrderRequestedImageUrl = await chatbotImagesService.getImageUrl('pickup_order_requested');
      await sendWithOptionalImage(phone, pickupOrderRequestedImageUrl, msg, [
        { id: 'track_order', text: 'Track Order' },
        { id: `cancel_${orderId}`, text: 'Cancel Order' },
        { id: 'home', text: 'Main Menu' }
      ]);

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
      await sendWithOptionalImage(phone, helpImg, '❌ Failed to process your order. Please try again.', [
        { id: 'view_cart', text: 'View Cart' },
        { id: 'home', text: 'Main Menu' }
      ]);
      return { success: false };
    }
  },

  // ==================== ACCOUNT DETAILS METHODS ====================

  /**
   * Send account details to user.
   * If profile exists → show details with Edit button.
   * If no profile → send Account Details form flow.
   */
  async sendAccountDetails(phone, customer) {
    if (customer.name) {
      // Customer has profile — show their details
      const displayPhone = phone.length > 10 ? phone.slice(-10) : phone;
      let detailsMsg = `👤 *Your Account Details*\n\n`;
      detailsMsg += `📛 *Name:* ${customer.name}\n`;
      detailsMsg += `📱 *Mobile:* ${displayPhone}\n`;
      if (customer.email) {
        detailsMsg += `📧 *Email:* ${customer.email}\n`;
      }
      detailsMsg += `\n📅 *Member since:* ${customer.createdAt ? new Date(customer.createdAt).toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' }) : 'N/A'}\n`;
      detailsMsg += `🛒 *Total Orders:* ${customer.totalOrders || 0}\n`;
      detailsMsg += `💰 *Total Spent:* ₹${customer.totalSpent || 0}\n`;

      if (customer.addresses && customer.addresses.length > 0) {
        const defaultAddr = customer.addresses.find(a => a.isDefault) || customer.addresses[0];
        detailsMsg += `\n📍 *Saved Address:* ${defaultAddr.address || ''}`;
        if (defaultAddr.landmark) detailsMsg += `, ${defaultAddr.landmark}`;
        if (defaultAddr.district) detailsMsg += `, ${defaultAddr.district}`;
        if (defaultAddr.state) detailsMsg += `, ${defaultAddr.state}`;
        if (defaultAddr.pincode) detailsMsg += ` - ${defaultAddr.pincode}`;
        detailsMsg += `\n`;
      }

      await whatsapp.sendButtons(phone, detailsMsg, [
        { id: 'edit_account', text: 'Edit Profile' },
        { id: 'delivery_address', text: 'My Address' },
        { id: 'home', text: 'Main Menu' }
      ], 'Perivi Hotel');
    } else {
      // No profile — send form flow
      await this.sendAccountFormFlow(phone, customer);
    }
  },

  /**
   * Send the Account Details form Flow to the user.
   */
  async sendAccountFormFlow(phone, customer) {
    try {
      const flowId = catalogService.getAccountFlowId();
      const flowMode = catalogService.getAccountFlowMode();

      if (flowId && flowMode) {
        const metaCloud = require('./metaCloud');
        const flowData = catalogService.buildAccountFormData(customer, phone);

        await metaCloud.sendFlowMessage(phone, {
          flowId,
          flowCta: 'Fill Details',
          headerText: 'Account Details',
          bodyText: 'Please fill in your account details. Your WhatsApp number is auto-filled.',
          footerText: 'Perivi Hotel',
          screenName: 'ACCOUNT_FORM',
          screenData: flowData,
          flowToken: `account_form_${phone}`,
          mode: flowMode
        });
        logger.info('Sent Account Details Flow', { phone, flowId });
        return;
      }
    } catch (flowErr) {
      logger.warn('Account Flow not available, fallback to text', { error: flowErr.message });
    }

    // Fallback: ask via text messages
    await whatsapp.sendMessage(phone, '📝 *Account Setup*\n\nPlease send your *full name* to create your account.');
  },

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

    await whatsapp.sendButtons(phone, confirmMsg, [
      { id: 'order_food', text: 'Order Food' },
      { id: 'home', text: 'Main Menu' }
    ], 'Perivi Hotel');
  },

  // ==================== DELIVERY ADDRESS METHODS ====================

  /**
   * Show delivery address options: Enter manually or Share location.
   * If user already has a saved address, show it with edit option.
   */
  async sendDeliveryAddressOptions(phone, customer) {
    const savedAddr = customer.addresses?.find(a => a.isDefault) || customer.addresses?.[0];

    if (savedAddr && savedAddr.address) {
      // Show existing address with options
      let addrMsg = `📍 *Your Delivery Address*\n\n`;
      addrMsg += `🏠 ${savedAddr.address}`;
      if (savedAddr.landmark) addrMsg += `\n📌 *Landmark:* ${savedAddr.landmark}`;
      if (savedAddr.district) addrMsg += `\n🏙️ *District:* ${savedAddr.district}`;
      if (savedAddr.state) addrMsg += `\n🗺️ *State:* ${savedAddr.state}`;
      if (savedAddr.pincode) addrMsg += `\n📮 *Pincode:* ${savedAddr.pincode}`;
      addrMsg += `\n\nWould you like to update your address?`;

      await whatsapp.sendButtons(phone, addrMsg, [
        { id: 'enter_address_manual', text: 'Edit Address' },
        { id: 'share_location_address', text: 'Share Location' },
        { id: 'home', text: 'Main Menu' }
      ], 'Perivi Hotel');
    } else {
      // No saved address — show options
      await whatsapp.sendButtons(phone,
        '📍 *Set Delivery Address*\n\nChoose how you\'d like to add your delivery address:',
        [
          { id: 'enter_address_manual', text: 'Enter Manually' },
          { id: 'share_location_address', text: 'Share Location' },
          { id: 'home', text: 'Main Menu' }
        ], 'Perivi Hotel');
    }
  },

  /**
   * Send the Delivery Address form Flow to the user.
   */
  async sendAddressFormFlow(phone, customer) {
    try {
      const flowId = catalogService.getAddressFlowId();
      const flowMode = catalogService.getAddressFlowMode();

      if (flowId && flowMode) {
        const metaCloud = require('./metaCloud');
        const flowData = catalogService.buildAddressFormData(customer, phone);

        await metaCloud.sendFlowMessage(phone, {
          flowId,
          flowCta: 'Fill Address',
          headerText: 'Delivery Address',
          bodyText: 'Enter your delivery address details. If you know your pincode, state and district will be auto-detected.',
          footerText: 'Perivi Hotel',
          screenName: 'ADDRESS_FORM',
          screenData: flowData,
          flowToken: `address_form_${phone}`,
          mode: flowMode
        });
        logger.info('Sent Delivery Address Flow', { phone, flowId });
        return;
      }
    } catch (flowErr) {
      logger.warn('Address Flow not available, fallback to text', { error: flowErr.message });
    }

    // Fallback: ask via text
    await whatsapp.sendMessage(phone, '📍 *Delivery Address*\n\nPlease send your full delivery address (including landmark, city, state, and pincode).');
  },

  /**
   * Handle the Address form response from the Flow.
   * Uses pincode API to validate/enrich state and district.
   */
  async handleAddressFormResponse(phone, customer, flowData) {
    const { address_line, landmark, pincode, selected_state, district } = flowData;
    const { getStateName } = require('../config/indianStates');
    const pincodeService = require('./pincodeService');

    // Resolve state name from dropdown ID
    let stateName = getStateName(selected_state) || selected_state || '';
    let districtName = district || '';

    // If pincode is provided, try to auto-detect/validate state & district
    if (pincode && /^\d{6}$/.test(pincode.trim())) {
      try {
        const pincodeResult = await pincodeService.lookupPincode(pincode.trim());
        if (pincodeResult.success) {
          // If user left state/district empty or we can enrich from pincode
          if (pincodeResult.state) stateName = pincodeResult.state;
          if (pincodeResult.district) districtName = pincodeResult.district;
          logger.info('Address enriched from pincode', { pincode, state: stateName, district: districtName });
        }
      } catch (pinErr) {
        logger.warn('Pincode lookup failed, using user-provided values', { error: pinErr.message });
      }
    }

    // Build address entry
    const newAddress = {
      label: 'Home',
      address: address_line?.trim() || '',
      landmark: landmark?.trim() || '',
      state: stateName,
      district: districtName,
      pincode: pincode?.trim() || '',
      isDefault: true
    };

    // Replace default address or add new one
    if (!customer.addresses) customer.addresses = [];

    const existingDefaultIdx = customer.addresses.findIndex(a => a.isDefault);
    if (existingDefaultIdx >= 0) {
      customer.addresses[existingDefaultIdx] = newAddress;
    } else {
      // Mark all existing as non-default
      customer.addresses.forEach(a => { a.isDefault = false; });
      customer.addresses.push(newAddress);
    }

    await customer.save();

    logger.info('Address saved from Flow', { phone, address: newAddress.address, state: stateName, district: districtName });

    // Confirm
    let confirmMsg = `✅ *Address Saved!*\n\n`;
    confirmMsg += `🏠 ${newAddress.address}\n`;
    if (newAddress.landmark) confirmMsg += `📌 *Landmark:* ${newAddress.landmark}\n`;
    if (newAddress.district) confirmMsg += `🏙️ *District:* ${newAddress.district}\n`;
    if (newAddress.state) confirmMsg += `🗺️ *State:* ${newAddress.state}\n`;
    if (newAddress.pincode) confirmMsg += `📮 *Pincode:* ${newAddress.pincode}\n`;
    confirmMsg += `\nYour delivery address has been updated.`;

    await whatsapp.sendButtons(phone, confirmMsg, [
      { id: 'order_food', text: 'Order Food' },
      { id: 'home', text: 'Main Menu' }
    ], 'Perivi Hotel');
  },

  /**
   * Handle location shared for address saving (not during order).
   * Reverse geocodes coordinate and saves as delivery address.
   */
  async handleLocationForAddress(phone, customer, locationData, state) {
    const pincodeService = require('./pincodeService');

    // Get formatted address from location
    let formattedAddress = '';
    if (locationData.address && locationData.address.trim() && locationData.address !== 'undefined') {
      formattedAddress = locationData.address.trim();
      if (locationData.name && locationData.name.trim() && locationData.name !== locationData.address) {
        formattedAddress = `${locationData.name.trim()}, ${formattedAddress}`;
      }
    }

    // Reverse geocode if no address provided
    if (!formattedAddress && locationData.latitude && locationData.longitude) {
      const geocoded = await this.reverseGeocode(locationData.latitude, locationData.longitude);
      if (geocoded) formattedAddress = geocoded;
    }

    if (!formattedAddress) {
      formattedAddress = `Location: ${locationData.latitude?.toFixed(6)}, ${locationData.longitude?.toFixed(6)}`;
    }

    // Try to extract pincode and get state/district from reverse-geocoded address
    let extractedState = '';
    let extractedDistrict = '';
    let extractedPincode = '';

    // Try pincode from formatted address
    const pincodeMatch = formattedAddress.match(/\b(\d{6})\b/);
    if (pincodeMatch) {
      extractedPincode = pincodeMatch[1];
      try {
        const pincodeResult = await pincodeService.lookupPincode(extractedPincode);
        if (pincodeResult.success) {
          extractedState = pincodeResult.state || '';
          extractedDistrict = pincodeResult.district || '';
        }
      } catch (e) { /* ignore */ }
    }

    // Build and save address
    const newAddress = {
      label: 'Home',
      address: formattedAddress,
      landmark: '',
      state: extractedState,
      district: extractedDistrict,
      pincode: extractedPincode,
      latitude: locationData.latitude,
      longitude: locationData.longitude,
      isDefault: true
    };

    if (!customer.addresses) customer.addresses = [];
    const existingDefaultIdx = customer.addresses.findIndex(a => a.isDefault);
    if (existingDefaultIdx >= 0) {
      customer.addresses[existingDefaultIdx] = newAddress;
    } else {
      customer.addresses.forEach(a => { a.isDefault = false; });
      customer.addresses.push(newAddress);
    }

    // Also update deliveryAddress for order flow compatibility
    customer.deliveryAddress = {
      latitude: locationData.latitude,
      longitude: locationData.longitude,
      address: formattedAddress,
      updatedAt: new Date()
    };

    await customer.save();

    logger.info('Address saved from location', { phone, address: formattedAddress, state: extractedState, district: extractedDistrict });

    let confirmMsg = `✅ *Address Saved from Location!*\n\n`;
    confirmMsg += `🏠 ${formattedAddress}\n`;
    if (extractedDistrict) confirmMsg += `🏙️ *District:* ${extractedDistrict}\n`;
    if (extractedState) confirmMsg += `🗺️ *State:* ${extractedState}\n`;
    if (extractedPincode) confirmMsg += `📮 *Pincode:* ${extractedPincode}\n`;
    confirmMsg += `\nYour delivery address has been updated.`;

    await whatsapp.sendButtons(phone, confirmMsg, [
      { id: 'order_food', text: 'Order Food' },
      { id: 'delivery_address', text: 'View Address' },
      { id: 'home', text: 'Main Menu' }
    ], 'Perivi Hotel');

    state.currentStep = 'main_menu';
  }
};

module.exports = chatbot;


