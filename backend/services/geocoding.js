/**
 * Shared Reverse Geocoding Service
 * 
 * Converts latitude/longitude coordinates into readable addresses.
 * Uses multiple providers with aggressive retry logic.
 * NEVER returns a URL/link — always returns a readable address string.
 */

const axios = require('axios');

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Try BigDataCloud reverse geocoding (free, no API key needed)
 */
async function tryBigDataCloud(lat, lon, timeout = 15000) {
  const bdcResponse = await axios.get(
    `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`,
    {
      timeout,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (compatible; FoodAdminBot/1.0)'
      }
    }
  );
  if (bdcResponse.data) {
    const d = bdcResponse.data;
    const parts = [];
    // Try to get local-level administrative areas (order >= 6 = locality level)
    if (d.localityInfo?.administrative) {
      const adminAreas = d.localityInfo.administrative
        .filter(a => a.name && a.order >= 6)
        .sort((a, b) => b.order - a.order)
        .map(a => a.name);
      if (adminAreas.length > 0) parts.push(...adminAreas.slice(0, 3));
    }
    // Fallback to locality/city fields
    if (parts.length === 0) {
      if (d.locality) parts.push(d.locality);
      if (d.city && d.city !== d.locality) parts.push(d.city);
    }
    if (d.principalSubdivision && !parts.includes(d.principalSubdivision)) parts.push(d.principalSubdivision);
    if (d.postcode) parts.push(d.postcode);
    if (parts.length > 0) {
      return parts.join(', ');
    }
  }
  return null;
}

/**
 * Try Nominatim (OpenStreetMap) reverse geocoding
 * Builds a clean short address from structured address data
 */
async function tryNominatim(lat, lon, timeout = 15000) {
  const response = await axios.get(
    'https://nominatim.openstreetmap.org/reverse', {
      params: {
        format: 'json',
        lat,
        lon,
        addressdetails: 1,
        zoom: 18,
        email: 'foodadminbot@restaurant.service'
      },
      headers: {
        'User-Agent': 'FoodAdminBot/1.0 (foodadminbot@restaurant.service)',
        'Accept-Language': 'en'
      },
      timeout
    }
  );
  if (response.data) {
    const addr = response.data.address;
    if (addr) {
      const parts = [];
      if (addr.road) parts.push(addr.road);
      const area = addr.suburb || addr.neighbourhood || addr.village || addr.hamlet;
      if (area) parts.push(area);
      const city = addr.city || addr.town || addr.county || addr.state_district;
      if (city) parts.push(city);
      if (addr.state) parts.push(addr.state);
      if (addr.postcode) parts.push(addr.postcode);
      if (parts.length > 0) return parts.join(', ');
    }
    if (response.data.display_name) {
      return response.data.display_name;
    }
  }
  return null;
}

/**
 * Try geocode.maps.co reverse geocoding (Nominatim mirror)
 */
async function tryGeocodeMaps(lat, lon, timeout = 12000) {
  const mapsCoResponse = await axios.get(
    `https://geocode.maps.co/reverse?lat=${lat}&lon=${lon}&format=json`,
    { timeout }
  );
  if (mapsCoResponse.data?.display_name) {
    return mapsCoResponse.data.display_name;
  }
  return null;
}

/**
 * Reverse geocode coordinates to a human-readable address.
 * 
 * Uses multiple providers with retry logic:
 * - Round 1: BigDataCloud → (wait) → Nominatim → (wait) → geocode.maps.co
 * - Round 2: (wait 3s) → BigDataCloud → (wait 2s) → Nominatim
 * - Round 3: (wait 5s) → Nominatim with longer timeout
 * 
 * NEVER returns a URL/link. If all providers fail after retries,
 * returns coordinate-based text like "Location (12.9913, 80.1184)".
 * 
 * @param {number} latitude
 * @param {number} longitude
 * @param {object} [log] - Optional logger (defaults to console)
 * @returns {Promise<string>} Readable address string
 */
async function reverseGeocode(latitude, longitude, log) {
  const logger = log || console;
  const info = (msg, meta) => (logger.info || logger.log)?.call(logger, msg, meta);
  const warn = (msg, meta) => (logger.warn || logger.log)?.call(logger, msg, meta);

  const lat = Number(latitude);
  const lon = Number(longitude);

  if (isNaN(lat) || isNaN(lon)) {
    return `Location (${latitude}, ${longitude})`;
  }

  // ── Round 1: Try all 3 providers ──────────────────────────
  // BigDataCloud
  try {
    info(`[Geocode Round 1] BigDataCloud: ${lat}, ${lon}`);
    const addr = await tryBigDataCloud(lat, lon);
    if (addr) { info(`BigDataCloud resolved: ${addr}`); return addr; }
  } catch (err) {
    warn(`BigDataCloud failed (round 1): ${err.message}`);
  }

  await delay(1500); // Respect rate limits before hitting Nominatim

  // Nominatim
  try {
    info(`[Geocode Round 1] Nominatim: ${lat}, ${lon}`);
    const addr = await tryNominatim(lat, lon);
    if (addr) { info(`Nominatim resolved: ${addr}`); return addr; }
  } catch (err) {
    warn(`Nominatim failed (round 1): ${err.message}`);
  }

  await delay(1500);

  // geocode.maps.co
  try {
    info(`[Geocode Round 1] geocode.maps.co: ${lat}, ${lon}`);
    const addr = await tryGeocodeMaps(lat, lon);
    if (addr) { info(`geocode.maps.co resolved: ${addr}`); return addr; }
  } catch (err) {
    warn(`geocode.maps.co failed (round 1): ${err.message}`);
  }

  // ── Round 2: Retry with longer delays ─────────────────────
  info(`[Geocode] All providers failed in round 1, retrying after delay...`);
  await delay(3000);

  // BigDataCloud retry
  try {
    info(`[Geocode Round 2] BigDataCloud: ${lat}, ${lon}`);
    const addr = await tryBigDataCloud(lat, lon, 20000);
    if (addr) { info(`BigDataCloud resolved (round 2): ${addr}`); return addr; }
  } catch (err) {
    warn(`BigDataCloud failed (round 2): ${err.message}`);
  }

  await delay(2000);

  // Nominatim retry
  try {
    info(`[Geocode Round 2] Nominatim: ${lat}, ${lon}`);
    const addr = await tryNominatim(lat, lon, 20000);
    if (addr) { info(`Nominatim resolved (round 2): ${addr}`); return addr; }
  } catch (err) {
    warn(`Nominatim failed (round 2): ${err.message}`);
  }

  // ── Round 3: Final attempt with maximum patience ──────────
  info(`[Geocode] Round 2 failed, final attempt after longer delay...`);
  await delay(5000);

  // Nominatim final try with very long timeout
  try {
    info(`[Geocode Round 3] Nominatim final attempt: ${lat}, ${lon}`);
    const addr = await tryNominatim(lat, lon, 30000);
    if (addr) { info(`Nominatim resolved (round 3): ${addr}`); return addr; }
  } catch (err) {
    warn(`Nominatim failed (round 3): ${err.message}`);
  }

  // ── Final fallback: coordinate text (NEVER a link) ────────
  warn(`All geocoding providers failed after 3 rounds for ${lat}, ${lon}`);
  return `Location (${lat.toFixed(4)}, ${lon.toFixed(4)})`;
}

module.exports = { reverseGeocode, tryBigDataCloud, tryNominatim, tryGeocodeMaps };
