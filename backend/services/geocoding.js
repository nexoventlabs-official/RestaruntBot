/**
 * Shared Reverse Geocoding Service
 * 
 * Converts latitude/longitude coordinates into readable addresses.
 * Uses multiple providers with aggressive retry logic.
 * NEVER returns a URL/link — always returns a readable address string.
 * 
 * Provider priority:
 * 1. Nominatim (OpenStreetMap) — most reliable, returns full address with pin code
 * 2. BigDataCloud — free server-side API, good locality data
 * 3. geocode.maps.co — Nominatim mirror (needs API key via GEOCODE_MAPS_API_KEY env)
 * 4. Google Maps Geocoding — if GOOGLE_MAPS_API_KEY is set (most reliable, paid)
 */

const axios = require('axios');

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Try Nominatim (OpenStreetMap) reverse geocoding
 * Returns a clean formatted address with pin code
 */
async function tryNominatim(lat, lon, timeout = 12000) {
  const response = await axios.get(
    'https://nominatim.openstreetmap.org/reverse', {
      params: {
        format: 'jsonv2',
        lat,
        lon,
        addressdetails: 1,
        zoom: 18
      },
      headers: {
        'User-Agent': 'RestaurantWhatsAppBot/2.0 (https://github.com/restaurant-bot)',
        'Accept-Language': 'en',
        'Accept': 'application/json'
      },
      timeout
    }
  );
  if (response.data) {
    // Prefer display_name — it already has the full address with pin code
    // e.g. "MG Road, Indira Nagar, Bangalore, Karnataka, 560038, India"
    if (response.data.display_name) {
      // Remove country suffix for cleaner display
      let addr = response.data.display_name;
      addr = addr.replace(/,\s*India$/i, '').trim();
      if (addr) return addr;
    }
    // Fallback: build from structured address fields
    const addr = response.data.address;
    if (addr) {
      const parts = [];
      // Building/house details
      if (addr.building || addr.house_number) parts.push(addr.building || addr.house_number);
      if (addr.road) parts.push(addr.road);
      const area = addr.suburb || addr.neighbourhood || addr.village || addr.hamlet || addr.residential;
      if (area) parts.push(area);
      const city = addr.city || addr.town || addr.county || addr.state_district;
      if (city) parts.push(city);
      if (addr.state) parts.push(addr.state);
      if (addr.postcode) parts.push(addr.postcode);
      if (parts.length > 0) return parts.join(', ');
    }
  }
  return null;
}

/**
 * Try BigDataCloud reverse geocoding (free, works server-side)
 */
async function tryBigDataCloud(lat, lon, timeout = 10000) {
  const bdcResponse = await axios.get(
    `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`,
    {
      timeout,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'RestaurantWhatsAppBot/2.0'
      }
    }
  );
  if (bdcResponse.data) {
    const d = bdcResponse.data;
    const parts = [];

    // Try to build a detailed address from all available fields
    // neighbourhood / street-level detail
    if (d.localityInfo?.administrative) {
      const adminAreas = d.localityInfo.administrative
        .filter(a => a.name && a.order >= 4)
        .sort((a, b) => b.order - a.order)
        .map(a => a.name);
      if (adminAreas.length > 0) parts.push(...adminAreas.slice(0, 4));
    }

    // Fallback to top-level locality/city fields
    if (parts.length === 0) {
      if (d.locality) parts.push(d.locality);
      if (d.city && d.city !== d.locality) parts.push(d.city);
      if (d.principalSubdivision) parts.push(d.principalSubdivision);
    } else {
      // Still add state if not already included
      if (d.principalSubdivision && !parts.includes(d.principalSubdivision)) {
        parts.push(d.principalSubdivision);
      }
    }

    if (d.postcode) parts.push(d.postcode);

    if (parts.length > 0) {
      return parts.join(', ');
    }
  }
  return null;
}

/**
 * Try geocode.maps.co reverse geocoding (Nominatim mirror)
 * Supports optional API key via GEOCODE_MAPS_API_KEY env var
 */
async function tryGeocodeMaps(lat, lon, timeout = 10000) {
  const apiKey = process.env.GEOCODE_MAPS_API_KEY;
  const url = apiKey
    ? `https://geocode.maps.co/reverse?lat=${lat}&lon=${lon}&format=json&api_key=${apiKey}`
    : `https://geocode.maps.co/reverse?lat=${lat}&lon=${lon}&format=json`;

  const mapsCoResponse = await axios.get(url, {
    timeout,
    headers: {
      'User-Agent': 'RestaurantWhatsAppBot/2.0',
      'Accept': 'application/json'
    }
  });
  if (mapsCoResponse.data?.display_name) {
    let addr = mapsCoResponse.data.display_name;
    addr = addr.replace(/,\s*India$/i, '').trim();
    return addr || null;
  }
  return null;
}

/**
 * Try Google Maps Geocoding API (requires GOOGLE_MAPS_API_KEY env var)
 * Most reliable but costs money after free tier
 */
async function tryGoogleMaps(lat, lon, timeout = 8000) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return null;

  const response = await axios.get(
    'https://maps.googleapis.com/maps/api/geocode/json', {
      params: {
        latlng: `${lat},${lon}`,
        key: apiKey,
        language: 'en',
        result_type: 'street_address|sublocality|locality'
      },
      timeout
    }
  );
  if (response.data?.status === 'OK' && response.data.results?.length > 0) {
    const result = response.data.results[0];
    let addr = result.formatted_address;
    if (addr) {
      addr = addr.replace(/,\s*India$/i, '').trim();
      return addr;
    }
  }
  return null;
}

/**
 * Reverse geocode coordinates to a human-readable address.
 * 
 * Strategy:
 * - Round 1: Nominatim → BigDataCloud → geocode.maps.co → Google (if key set)
 * - Round 2: (short delay) → Nominatim retry → BigDataCloud retry
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

  // ── Round 1: Try all providers ────────────────────────────
  // Nominatim first — most reliable for India, returns full address with pin code
  try {
    info(`[Geocode Round 1] Nominatim: ${lat}, ${lon}`);
    const addr = await tryNominatim(lat, lon);
    if (addr) { info(`Nominatim resolved: ${addr}`); return addr; }
  } catch (err) {
    warn(`Nominatim failed (round 1): ${err.message}`);
  }

  // BigDataCloud — no delay needed (different provider)
  try {
    info(`[Geocode Round 1] BigDataCloud: ${lat}, ${lon}`);
    const addr = await tryBigDataCloud(lat, lon);
    if (addr) { info(`BigDataCloud resolved: ${addr}`); return addr; }
  } catch (err) {
    warn(`BigDataCloud failed (round 1): ${err.message}`);
  }

  // geocode.maps.co
  try {
    info(`[Geocode Round 1] geocode.maps.co: ${lat}, ${lon}`);
    const addr = await tryGeocodeMaps(lat, lon);
    if (addr) { info(`geocode.maps.co resolved: ${addr}`); return addr; }
  } catch (err) {
    warn(`geocode.maps.co failed (round 1): ${err.message}`);
  }

  // Google Maps (only if API key is configured)
  try {
    const addr = await tryGoogleMaps(lat, lon);
    if (addr) { info(`Google Maps resolved: ${addr}`); return addr; }
  } catch (err) {
    warn(`Google Maps failed: ${err.message}`);
  }

  // ── Round 2: Retry primary providers after short delay ────
  info(`[Geocode] All providers failed in round 1, retrying...`);
  await delay(2000);

  // Nominatim retry with longer timeout
  try {
    info(`[Geocode Round 2] Nominatim retry: ${lat}, ${lon}`);
    const addr = await tryNominatim(lat, lon, 20000);
    if (addr) { info(`Nominatim resolved (round 2): ${addr}`); return addr; }
  } catch (err) {
    warn(`Nominatim failed (round 2): ${err.message}`);
  }

  await delay(1000);

  // BigDataCloud retry
  try {
    info(`[Geocode Round 2] BigDataCloud retry: ${lat}, ${lon}`);
    const addr = await tryBigDataCloud(lat, lon, 15000);
    if (addr) { info(`BigDataCloud resolved (round 2): ${addr}`); return addr; }
  } catch (err) {
    warn(`BigDataCloud failed (round 2): ${err.message}`);
  }

  // ── Final fallback: coordinate text (NEVER a link) ────────
  warn(`All geocoding providers failed after 2 rounds for ${lat}, ${lon}`);
  return `Location (${lat.toFixed(4)}, ${lon.toFixed(4)})`;
}

module.exports = { reverseGeocode, tryBigDataCloud, tryNominatim, tryGeocodeMaps, tryGoogleMaps };
