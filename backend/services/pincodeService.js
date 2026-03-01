/**
 * Pincode Lookup Service
 * Uses the free India Post API (api.postalpincode.in) to look up
 * state and district from a given 6-digit Indian pincode.
 */

const axios = require('axios');
const logger = require('./logger') || console;

// Simple in-memory cache for pincode lookups (avoids repeated API calls)
const pincodeCache = new Map();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Look up location details from an Indian pincode.
 * Uses api.postalpincode.in (free, no API key needed).
 *
 * @param {string} pincode - 6-digit Indian pincode
 * @returns {Promise<{success: boolean, state?: string, district?: string, postOffice?: string, error?: string}>}
 */
async function lookupPincode(pincode) {
  if (!pincode || !/^\d{6}$/.test(pincode.toString().trim())) {
    return { success: false, error: 'Invalid pincode. Must be 6 digits.' };
  }

  const pin = pincode.toString().trim();

  // Check cache
  const cached = pincodeCache.get(pin);
  if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
    return cached.data;
  }

  try {
    const response = await axios.get(`https://api.postalpincode.in/pincode/${pin}`, {
      timeout: 8000,
      headers: { 'Accept': 'application/json' }
    });

    const result = response.data;

    if (!result || !Array.isArray(result) || result.length === 0) {
      return { success: false, error: 'No data returned for this pincode' };
    }

    const entry = result[0];

    if (entry.Status !== 'Success' || !entry.PostOffice || entry.PostOffice.length === 0) {
      return { success: false, error: entry.Message || 'Pincode not found' };
    }

    // Use the first post office entry for state/district
    const postOffice = entry.PostOffice[0];
    const data = {
      success: true,
      state: postOffice.State || '',
      district: postOffice.District || '',
      postOffice: postOffice.Name || '',
      block: postOffice.Block || '',
      region: postOffice.Region || '',
      country: postOffice.Country || 'India',
      allPostOffices: entry.PostOffice.map(po => ({
        name: po.Name,
        type: po.BranchType,
        deliveryStatus: po.DeliveryStatus,
        district: po.District,
        state: po.State
      }))
    };

    // Cache the result
    pincodeCache.set(pin, { data, timestamp: Date.now() });

    return data;
  } catch (error) {
    if (logger.error) {
      logger.error('Pincode lookup failed', { pincode: pin, error: error.message });
    }

    // Try fallback: Indian postal API sometimes has different format
    return { success: false, error: `Pincode lookup failed: ${error.message}` };
  }
}

/**
 * Validate and enrich an address using pincode.
 * If pincode is valid, auto-fills state and district.
 *
 * @param {object} address - { address, landmark, pincode, state, district }
 * @returns {Promise<object>} Enriched address with state/district filled from pincode
 */
async function enrichAddressFromPincode(address) {
  if (!address || !address.pincode) return address;

  const lookup = await lookupPincode(address.pincode);
  if (!lookup.success) return address;

  return {
    ...address,
    state: lookup.state || address.state,
    district: lookup.district || address.district,
    postOffice: lookup.postOffice || ''
  };
}

/**
 * Clear the pincode cache (useful for testing).
 */
function clearCache() {
  pincodeCache.clear();
}

module.exports = {
  lookupPincode,
  enrichAddressFromPincode,
  clearCache
};
