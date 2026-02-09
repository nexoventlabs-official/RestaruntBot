/**
 * Location Domain Handler - Phase 3.4.4
 * 
 * Responsibilities:
 * - Request location from user
 * - Handle location sharing and validation
 * - Validate delivery radius
 * - Calculate delivery charges
 * - Distance calculations
 * - Location formatting
 * 
 * Domain Boundaries:
 * - Does NOT create orders (Payment Initiation Domain)
 * - Does NOT handle payment (Payment Domain)
 * - Does NOT manage cart (Cart Domain)
 * - Uses conversationState service for state management
 * 
 * NOTE: Delegates to paymentInitiation after location confirmation
 */

const Settings = require('../../models/Settings');
const conversationState = require('../conversationState');
const whatsapp = require('../whatsapp');
const { logger } = require('../correlationContext');
const axios = require('axios');

// Location validation constants
const LOCATION_VALIDATION = {
  MIN_LATITUDE: -90,
  MAX_LATITUDE: 90,
  MIN_LONGITUDE: -180,
  MAX_LONGITUDE: 180,
  EARTH_RADIUS_KM: 6371
};

/**
 * Reverse geocode coordinates to get readable address (multi-provider for reliability)
 */
async function reverseGeocode(latitude, longitude) {
  // Provider 1: BigDataCloud (free, no key needed, reliable)
  try {
    logger.info(`Reverse geocoding via BigDataCloud: ${latitude}, ${longitude}`);
    const bdcResponse = await axios.get(
      `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${latitude}&longitude=${longitude}&localityLanguage=en`,
      { timeout: 8000 }
    );
    if (bdcResponse.data) {
      const d = bdcResponse.data;
      const parts = [];
      if (d.locality) parts.push(d.locality);
      if (d.city && d.city !== d.locality) parts.push(d.city);
      if (d.principalSubdivision) parts.push(d.principalSubdivision);
      if (d.postcode) parts.push(d.postcode);
      if (parts.length > 0) {
        const address = parts.join(', ');
        logger.info(`BigDataCloud address: ${address}`);
        return address;
      }
    }
  } catch (err) {
    logger.warn('BigDataCloud geocoding failed', { error: err.message });
  }

  // Provider 2: Nominatim (OpenStreetMap)
  try {
    logger.info(`Reverse geocoding via Nominatim: ${latitude}, ${longitude}`);
    const response = await axios.get(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&addressdetails=1&zoom=18`,
      {
        headers: { 'User-Agent': 'FoodAdminBot/1.0 (restaurant ordering service)' },
        timeout: 8000
      }
    );
    if (response.data && response.data.address) {
      const addr = response.data.address;
      const parts = [];
      if (addr.building || addr.amenity) parts.push(addr.building || addr.amenity);
      if (addr.house_number) parts.push(addr.house_number);
      if (addr.road || addr.street) parts.push(addr.road || addr.street);
      if (addr.neighbourhood) parts.push(addr.neighbourhood);
      else if (addr.suburb) parts.push(addr.suburb);
      else if (addr.residential) parts.push(addr.residential);
      if (addr.city) parts.push(addr.city);
      else if (addr.town) parts.push(addr.town);
      else if (addr.village) parts.push(addr.village);
      if (addr.state) parts.push(addr.state);
      if (addr.postcode) parts.push(addr.postcode);
      const address = parts.length > 0 ? parts.join(', ') : response.data.display_name || null;
      if (address) {
        logger.info(`Nominatim address: ${address}`);
        return address;
      }
    }
    if (response.data?.display_name) {
      return response.data.display_name;
    }
  } catch (error) {
    logger.warn('Nominatim geocoding failed', { error: error.message });
  }

  // Final fallback: return coordinates with Google Maps link
  logger.warn('All geocoding providers failed, using coordinates fallback');
  return `📍 ${Number(latitude).toFixed(6)}, ${Number(longitude).toFixed(6)} (maps.google.com/?q=${latitude},${longitude})`;
}

/**
 * Request location from user
 */
async function requestLocation(customer, phone) {
  const message = `📍 *Share Your Location*\n\n` +
    `Please share your delivery location so we can:\n` +
    `• Calculate delivery charges\n` +
    `• Estimate delivery time\n` +
    `• Ensure we deliver to your area\n\n` +
    `Tap the 📎 button and select Location`;
  
  await whatsapp.sendButtons(phone, message, [
    { id: 'view_cart', text: '🛒 Back to Cart' },
    { id: 'service_pickup', text: '🏪 Switch to Pickup' }
  ]);
  
  conversationState.transitionTo(customer, 'awaiting_location');
  await customer.save();
}

/**
 * Handle location sharing
 */
async function handleLocation(customer, phone, params) {
  const { locationData } = params;
  
  const { latitude, longitude, name, address } = locationData;
  
  // Validate coordinates
  if (!latitude || !longitude) {
    await whatsapp.sendMessage(phone, '❌ Invalid location. Please share your location again.');
    return requestLocation(customer, phone);
  }
  
  // Check delivery radius and calculate charges
  const deliveryResult = await calculateDeliveryCharge(latitude, longitude);
  
  // Beyond max radius
  if (deliveryResult.beyondMaxRadius) {
    await whatsapp.sendButtons(phone, 
      `❌ *Delivery Not Available*\n\n${deliveryResult.message}\n\n` +
      `Would you like to try a different address or opt for self-pickup?`,
      [
        { id: 'service_pickup', text: '🏪 Self-Pickup' },
        { id: 'share_location', text: '📍 New Location' },
        { id: 'home', text: '🏠 Main Menu' }
      ]
    );
    return;
  }
  
  // Outside free radius and delivery not available
  if (deliveryResult.deliveryNotAvailable) {
    await whatsapp.sendButtons(phone,
      `❌ *Delivery Not Available*\n\n${deliveryResult.message}\n\n` +
      `Would you like to try a different address or opt for self-pickup?`,
      [
        { id: 'service_pickup', text: '🏪 Self-Pickup' },
        { id: 'share_location', text: '📍 New Location' },
        { id: 'home', text: '🏠 Main Menu' }
      ]
    );
    return;
  }
  
  // Get formatted address - prefer WhatsApp's address, fallback to reverse geocoding
  let formattedAddress = 'Location shared';
  
  if (address && address.trim() && address !== 'undefined') {
    formattedAddress = address.trim();
    if (name && name.trim() && name !== address && name !== 'undefined') {
      formattedAddress = `${name.trim()}, ${formattedAddress}`;
    }
  } else if (name && name.trim() && name !== 'undefined') {
    formattedAddress = name.trim();
  }
  
  // If no address from WhatsApp, try reverse geocoding from coordinates
  if (formattedAddress === 'Location shared' && latitude && longitude) {
    logger.info('No address from WhatsApp, trying reverse geocoding...');
    const geocodedAddress = await reverseGeocode(latitude, longitude);
    if (geocodedAddress && geocodedAddress !== 'Location shared') {
      formattedAddress = geocodedAddress;
      logger.info('Got address from reverse geocoding', { address: formattedAddress });
    }
  }
  
  // Save location to customer
  customer.deliveryAddress = {
    latitude,
    longitude,
    address: formattedAddress,
    updatedAt: new Date()
  };
  
  // Store delivery charge in context for order creation
  conversationState.setContext(customer, 'deliveryCharge', deliveryResult.charge || 0);
  conversationState.setContext(customer, 'deliveryDistance', deliveryResult.distance);
  
  await customer.save();
  
  // Confirm location and show delivery charge if applicable
  let confirmMessage = `✅ *Location Confirmed*\n\n📍 ${formattedAddress}\n\n`;
  
  if (deliveryResult.charge > 0) {
    confirmMessage += `🚚 Delivery Charge: ₹${deliveryResult.charge}\n`;
    confirmMessage += `📏 Distance: ${deliveryResult.distance?.toFixed(1)} km\n\n`;
  } else {
    confirmMessage += `🎉 Free Delivery!\n\n`;
  }
  
  confirmMessage += `Proceeding to payment...`;
  
  await whatsapp.sendMessage(phone, confirmMessage);
  
  // Redirect to payment initiation
  return { redirect: 'paymentInitiation', action: 'showPaymentOptions', params: {} };
}

/**
 * Calculate delivery charge based on location
 */
async function calculateDeliveryCharge(customerLat, customerLon) {
  try {
    const restaurantLocation = await Settings.getValue('restaurantLocation');
    const deliverySettings = await Settings.getValue('deliverySettings');
    
    if (!restaurantLocation?.latitude || !restaurantLocation?.longitude) {
      return { charge: 0, distance: null, withinFreeRadius: true, message: null };
    }
    
    if (!deliverySettings) {
      return { charge: 0, distance: null, withinFreeRadius: true, message: null };
    }
    
    // Calculate straight-line distance
    const distance = calculateStraightLineDistance(
      restaurantLocation.latitude,
      restaurantLocation.longitude,
      customerLat,
      customerLon
    );
    
    if (distance === null) {
      return { charge: 0, distance: null, withinFreeRadius: true, message: null };
    }
    
    const noFreeDelivery = deliverySettings.noFreeDelivery || false;
    const baseDeliveryCharge = deliverySettings.baseDeliveryCharge || 0;
    const freeRadius = deliverySettings.freeDeliveryRadius || 5;
    const maxRadius = deliverySettings.maxDeliveryRadius;
    const extraChargeEnabled = deliverySettings.enableExtraDeliveryCharge;
    const extraCharge = deliverySettings.extraDeliveryCharge || 0;
    
    // Check max radius
    if (maxRadius && distance > maxRadius) {
      return {
        charge: null,
        distance,
        withinFreeRadius: false,
        beyondMaxRadius: true,
        maxRadius,
        message: `Sorry, we don't deliver beyond ${maxRadius} km. Your location is ${distance.toFixed(1)} km away.`
      };
    }
    
    // No free delivery mode
    if (noFreeDelivery) {
      if (distance > freeRadius && extraChargeEnabled && extraCharge > 0) {
        const totalCharge = baseDeliveryCharge + extraCharge;
        return {
          charge: totalCharge,
          distance,
          withinFreeRadius: false,
          message: `Delivery charge: ₹${totalCharge} (₹${baseDeliveryCharge} base + ₹${extraCharge} extra)`
        };
      }
      return {
        charge: baseDeliveryCharge,
        distance,
        withinFreeRadius: true,
        message: `Delivery charge: ₹${baseDeliveryCharge}`
      };
    }
    
    // Within free radius
    if (distance <= freeRadius) {
      return {
        charge: 0,
        distance,
        withinFreeRadius: true,
        message: null
      };
    }
    
    // Outside free radius
    if (extraChargeEnabled && extraCharge > 0) {
      return {
        charge: extraCharge,
        distance,
        withinFreeRadius: false,
        message: `Delivery charge: ₹${extraCharge} (beyond ${freeRadius} km)`
      };
    }
    
    // Extra charge not enabled - reject
    return {
      charge: null,
      distance,
      withinFreeRadius: false,
      deliveryNotAvailable: true,
      freeRadius,
      message: `Sorry, delivery is only available within ${freeRadius} km. Your location is ${distance.toFixed(1)} km away.`
    };
    
  } catch (error) {
    console.error('Error calculating delivery charge:', error);
    return { charge: 0, distance: null, withinFreeRadius: true, message: null };
  }
}

/**
 * Calculate straight-line distance (Haversine formula)
 */
function calculateStraightLineDistance(lat1, lon1, lat2, lon2) {
  if (!lat1 || !lon1 || !lat2 || !lon2) return null;
  
  const R = LOCATION_VALIDATION.EARTH_RADIUS_KM;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;
  
  return Math.round(distance * 100) / 100;
}

/**
 * Validate coordinates
 */
function validateCoordinates(latitude, longitude) {
  if (typeof latitude !== 'number' || typeof longitude !== 'number') {
    return { valid: false, error: 'Coordinates must be numbers' };
  }
  
  if (latitude < LOCATION_VALIDATION.MIN_LATITUDE || latitude > LOCATION_VALIDATION.MAX_LATITUDE) {
    return { valid: false, error: 'Invalid latitude' };
  }
  
  if (longitude < LOCATION_VALIDATION.MIN_LONGITUDE || longitude > LOCATION_VALIDATION.MAX_LONGITUDE) {
    return { valid: false, error: 'Invalid longitude' };
  }
  
  return { valid: true };
}

/**
 * Format location for display
 */
function formatLocation(locationData) {
  const { latitude, longitude, address, name } = locationData;
  
  let formatted = '';
  
  if (address) {
    formatted = address;
  } else if (name) {
    formatted = name;
  } else {
    formatted = `${latitude}, ${longitude}`;
  }
  
  return formatted;
}

/**
 * Get delivery settings
 */
async function getDeliverySettings() {
  try {
    const settings = await Settings.getValue('deliverySettings');
    return settings || {
      noFreeDelivery: false,
      baseDeliveryCharge: 0,
      freeDeliveryRadius: 5,
      maxDeliveryRadius: null,
      enableExtraDeliveryCharge: false,
      extraDeliveryCharge: 0
    };
  } catch (error) {
    logger.error('Failed to get delivery settings', { error: error.message });
    return {
      noFreeDelivery: false,
      baseDeliveryCharge: 0,
      freeDeliveryRadius: 5,
      maxDeliveryRadius: null,
      enableExtraDeliveryCharge: false,
      extraDeliveryCharge: 0
    };
  }
}

/**
 * Get restaurant location
 */
async function getRestaurantLocation() {
  try {
    const location = await Settings.getValue('restaurantLocation');
    return location || null;
  } catch (error) {
    logger.error('Failed to get restaurant location', { error: error.message });
    return null;
  }
}

/**
 * Check if location is within delivery radius
 */
async function isWithinDeliveryRadius(latitude, longitude) {
  const restaurantLocation = await getRestaurantLocation();
  const deliverySettings = await getDeliverySettings();
  
  if (!restaurantLocation?.latitude || !restaurantLocation?.longitude) {
    return { within: true, distance: null };
  }
  
  const distance = calculateStraightLineDistance(
    restaurantLocation.latitude,
    restaurantLocation.longitude,
    latitude,
    longitude
  );
  
  if (distance === null) {
    return { within: true, distance: null };
  }
  
  const maxRadius = deliverySettings.maxDeliveryRadius;
  
  if (maxRadius && distance > maxRadius) {
    return { within: false, distance, maxRadius };
  }
  
  return { within: true, distance };
}

/**
 * Format delivery charge message
 */
function formatDeliveryChargeMessage(deliveryResult) {
  if (deliveryResult.beyondMaxRadius) {
    return `❌ *Delivery Not Available*\n\n${deliveryResult.message}`;
  }
  
  if (deliveryResult.deliveryNotAvailable) {
    return `❌ *Delivery Not Available*\n\n${deliveryResult.message}`;
  }
  
  if (deliveryResult.charge === 0) {
    return `🎉 *Free Delivery!*\n\nYour location is within our free delivery zone.`;
  }
  
  return `🚚 *Delivery Charge: ₹${deliveryResult.charge}*\n\n${deliveryResult.message || ''}`;
}

/**
 * Save customer location
 */
async function saveCustomerLocation(customer, locationData) {
  const { latitude, longitude, address, name } = locationData;
  
  // Resolve address - prefer provided address, fallback to reverse geocoding
  let resolvedAddress = 'Location shared';
  
  if (address && address.trim() && address !== 'undefined') {
    resolvedAddress = address.trim();
    if (name && name.trim() && name !== address && name !== 'undefined') {
      resolvedAddress = `${name.trim()}, ${resolvedAddress}`;
    }
  } else if (name && name.trim() && name !== 'undefined') {
    resolvedAddress = name.trim();
  }
  
  // Reverse geocode if no address available
  if (resolvedAddress === 'Location shared' && latitude && longitude) {
    const geocodedAddress = await reverseGeocode(latitude, longitude);
    if (geocodedAddress && geocodedAddress !== 'Location shared') {
      resolvedAddress = geocodedAddress;
    }
  }
  
  customer.deliveryAddress = {
    latitude,
    longitude,
    address: resolvedAddress,
    updatedAt: new Date()
  };
  
  await customer.save();
  
  logger.info('Customer location saved', {
    customerId: customer._id,
    latitude,
    longitude,
    address: resolvedAddress
  });
}

/**
 * Clear customer location
 */
async function clearCustomerLocation(customer) {
  customer.deliveryAddress = null;
  await customer.save();
  
  logger.info('Customer location cleared', {
    customerId: customer._id
  });
}

/**
 * Get customer location
 */
function getCustomerLocation(customer) {
  return customer.deliveryAddress || null;
}

/**
 * Has customer location
 */
function hasCustomerLocation(customer) {
  return !!(customer.deliveryAddress?.latitude && customer.deliveryAddress?.longitude);
}

/**
 * Request location with custom message
 */
async function requestLocationWithMessage(customer, phone, message) {
  await whatsapp.sendButtons(phone, message, [
    { id: 'view_cart', text: '🛒 Back to Cart' },
    { id: 'service_pickup', text: '🏪 Switch to Pickup' }
  ]);
  
  conversationState.transitionTo(customer, 'awaiting_location');
  await customer.save();
}

module.exports = {
  // Core location operations
  requestLocation,
  handleLocation,
  
  // Location calculations
  calculateDeliveryCharge,
  calculateStraightLineDistance,
  isWithinDeliveryRadius,
  
  // Location validation
  validateCoordinates,
  
  // Location formatting
  formatLocation,
  formatDeliveryChargeMessage,
  
  // Settings helpers
  getDeliverySettings,
  getRestaurantLocation,
  
  // Customer location management
  saveCustomerLocation,
  clearCustomerLocation,
  getCustomerLocation,
  hasCustomerLocation,
  
  // UI helpers
  requestLocationWithMessage
};
