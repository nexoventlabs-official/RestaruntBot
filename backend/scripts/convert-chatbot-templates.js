/**
 * Convert template literal logger calls in chatbot.js to structured objects.
 * Run: node scripts/convert-chatbot-templates.js
 */
const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'services', 'chatbot.js');
let content = fs.readFileSync(filePath, 'utf8');
let count = 0;

// Conversions map: [regex, replacement]
const conversions = [
  // ─── Distance calculation ───
  [
    /logger\.info\(`========== DISTANCE CALCULATION`\)/g,
    `logger.info('Distance calculation started')`
  ],
  [
    /logger\.info\(`Restaurant: \$\{lat1\}, \$\{lon1\}`\)/g,
    `logger.info('Distance calculation params', { restaurantLat: lat1, restaurantLon: lon1 })`
  ],
  [
    /logger\.info\(`Customer: \$\{lat2\}, \$\{lon2\}`\)/g,
    `logger.info('Distance calculation params', { customerLat: lat2, customerLon: lon2 })`
  ],
  [
    /logger\.info\(`Straight-line distance: \$\{straightLineDistance\} KM`\)/g,
    `logger.info('Straight-line distance', { distanceKm: straightLineDistance })`
  ],
  [
    /logger\.info\(`FALLBACK: Using straight-line × 1\.6 = \$\{approximateRoadDistance\.toFixed\(2\)\} KM`\)/g,
    `logger.info('Distance fallback to straight-line', { distanceKm: approximateRoadDistance.toFixed(2), multiplier: 1.6 })`
  ],
  // Empty logger calls used as decoration
  [
    /logger\.info\(''\);/g,
    `// (removed decoration log)`
  ],
  
  // ─── Radius / Delivery Charge ───
  [
    /logger\.info\(`========== RADIUS CHECK`\)/g,
    `logger.info('Radius check started')`
  ],
  [
    /logger\.info\(`Restaurant: \$\{restaurantLocation\.latitude\}[^`]*`\)/g,
    `logger.info('Radius check params', { restaurantLat: restaurantLocation.latitude, restaurantLon: restaurantLocation.longitude })`
  ],
  [
    /logger\.info\(`Customer: \$\{customerLat\}, \$\{customerLon\}`\)/g,
    `logger.info('Radius check params', { customerLat, customerLon })`
  ],
  [
    /logger\.info\(`Radius distance: \$\{distance\} KM`\)/g,
    `logger.info('Radius distance calculated', { distanceKm: distance })`
  ],
  [
    /logger\.info\(`Distance from restaurant: \$\{distance\} KM`\)/g,
    `logger.info('Distance from restaurant', { distanceKm: distance })`
  ],
  [
    /logger\.info\(`Beyond max delivery radius \(\$\{maxRadius\} KM\)`\)/g,
    `logger.info('Beyond max delivery radius', { distanceKm: distance, maxRadiusKm: maxRadius })`
  ],
  [
    /logger\.info\(`No free delivery - base charge: ₹\$\{baseDeliveryCharge\}`\)/g,
    `logger.info('No free delivery zone', { baseDeliveryCharge })`
  ],
  [
    /logger\.info\(`Beyond \$\{freeRadius\} KM - total charge: ₹\$\{totalCharge\}`\)/g,
    `logger.info('Delivery charge calculated', { freeRadiusKm: freeRadius, totalCharge })`
  ],
  [
    /logger\.info\(`Within free delivery radius \(\$\{freeRadius\} KM\)`\)/g,
    `logger.info('Within free delivery radius', { freeRadiusKm: freeRadius })`
  ],
  [
    /logger\.info\(`Outside free radius - adding delivery charge: ₹\$\{extraCharge\}`\)/g,
    `logger.info('Extra delivery charge added', { extraCharge })`
  ],
  [
    /logger\.info\(`Outside free radius - delivery not available`\)/g,
    `logger.info('Delivery not available - outside radius')`
  ],

  // ─── Search / Fuzzy Match ───
  [
    /logger\.info\(`Category fuzzy match: "\$\{text\}" → "\$\{bestMatch\}" \(\$\{Math\.round\(bestScore \* 100\)\}%\)`\)/g,
    `logger.info('Category fuzzy match', { text, bestMatch, score: Math.round(bestScore * 100) })`
  ],
  [
    /logger\.info\(`Search term "\$\{word\}" already matches[^`]*`\)/g,
    `logger.info('Search term already matches', { term: word })`
  ],
  [
    /logger\.info\(`Dynamic typo match: "\$\{searchTerm\}" → "\$\{bestMatch\}"[^`]*`\)/g,
    `logger.info('Dynamic typo match', { searchTerm, bestMatch })`
  ],
  [
    /logger\.info\(`Gibberish search detected: "\$\{searchTerm\}"[^`]*`\)/g,
    `logger.info('Gibberish search detected', { searchTerm })`
  ],
  [
    /logger\.info\(`Multi-keyword AND match: "\$\{text\}" → \$\{andMatches\.length\} items`\)/g,
    `logger.info('Multi-keyword AND match', { text, matchCount: andMatches.length })`
  ],
  [
    /logger\.info\(`Multi-keyword OR match: "\$\{text\}" → \$\{matchingItems\.length\}[^`]*`\)/g,
    `logger.info('Multi-keyword OR match', { text, matchCount: matchingItems.length })`
  ],
  [
    /logger\.info\(`Full text match: "\$\{text\}" → \$\{fullTextMatch\.length\}[^`]*`\)/g,
    `logger.info('Full text match', { text, matchCount: fullTextMatch.length })`
  ],
  [
    /logger\.info\(`Word-by-word translation: "\$\{text\}" → \[([^\]]*)\]`\)/g,
    `logger.info('Word-by-word translation', { text })`
  ],

  // ─── Smart Search ───
  [
    /logger\.info\(`\$\{'='\.repeat\(60\)\}`\)/g,
    `// (removed decoration log)`
  ],
  [
    /logger\.info\(`SMART SEARCH CALLED: "\$\{text\}"`\)/g,
    `logger.info('Smart search called', { text })`
  ],
  [
    /logger\.info\(`Gibberish search detected: "\$\{text\}"[^`]*`\)/g,
    `logger.info('Gibberish search detected', { text })`
  ],
  [
    /logger\.info\(`ORIGINAL food type detection: [^`]*`\)/g,
    `logger.info('Food type detection', { text })`
  ],
  [
    /logger\.info\(`After removing food type keywords[^`]*`\)/g,
    `logger.info('Food type keywords removed', { text })`
  ],
  [
    /logger\.info\(`AI added tags: \[\$\{aiMatchedTags\.join\(', '\)\}\]`\)/g,
    `logger.info('AI tags added', { tags: aiMatchedTags })`
  ],
  [
    /logger\.info\(`Search terms with synonyms: \[[^\]]*\]`\)/g,
    `logger.info('Search terms with synonyms', { text })`
  ],
  [
    /logger\.info\(`Total menu items: \$\{menuItems\.length\}`\)/g,
    `logger.info('Menu items count', { count: menuItems.length })`
  ],
  [
    /logger\.info\(`FILTERED TO VEG ITEMS: [^`]*`\)/g,
    `logger.info('Filtered to veg items', { count: menuItems.length })`
  ],
  [
    /logger\.info\(`VEG item names: [^`]*`\)/g,
    `logger.info('Veg items listed')`
  ],
  [
    /logger\.info\(`FILTERED TO EGG ITEMS: [^`]*`\)/g,
    `logger.info('Filtered to egg items', { count: menuItems.length })`
  ],
  [
    /logger\.info\(`FILTERED TO NON-VEG ITEMS: [^`]*`\)/g,
    `logger.info('Filtered to non-veg items', { count: menuItems.length })`
  ],
  [
    /logger\.info\(`FILTERED BY INGREDIENT "\$\{ingredient\}": [^`]*`\)/g,
    `logger.info('Filtered by ingredient', { ingredient, count: menuItems.length })`
  ],
  [
    /logger\.info\(`NO FOOD TYPE DETECTED - searching all items`\)/g,
    `logger.info('No food type detected, searching all items')`
  ],
  [
    /logger\.info\(`VARIANT MATCH: \$\{resultItems\.length\}[^`]*`\)/g,
    `logger.info('Variant match results', { count: resultItems.length })`
  ],
  [
    /logger\.info\(`  → \$\{item\.name\}: \$\{matches\.length\} variant\(s\)[^`]*`\)/g,
    `logger.info('Variant match detail', { item: item.name, variantCount: matches.length })`
  ],
  [
    /matches\.forEach\(m => logger\.info\(`    variant\[\$\{m\.vi\}\][^`]*`\)\)/g,
    `// Variant detail logging moved to debug level`
  ],
  [
    /logger\.info\(`Exact name match found: "\$\{searchTerm\}"[^`]*`\)/g,
    `logger.info('Exact name match found', { searchTerm })`
  ],
  [
    /logger\.info\(`All keywords tag\/category match: [^`]*`\)/g,
    `logger.info('All keywords tag/category match', { text })`
  ],
  [
    /logger\.info\(`Any keyword tag match: [^`]*`\)/g,
    `logger.info('Any keyword tag match', { text })`
  ],
  [
    /logger\.info\(`Tag search - Primary keywords: [^`]*`\)/g,
    `logger.info('Tag search started', { text })`
  ],
  [
    /logger\.info\(`PRIORITY 1 - ALL keywords match: [^`]*`\)/g,
    `logger.info('Priority 1 all keywords match', { text })`
  ],
  [
    /logger\.info\(`PRIORITY 2 - Partial tag matches[^`]*`\)/g,
    `logger.info('Priority 2 partial tag matches', { text })`
  ],
  [
    /logger\.info\(`Searching with variations: \[[^\]]*\]`\)/g,
    `logger.info('Searching with variations', { text })`
  ],
  [
    /logger\.info\(`No food type detected, falling back[^`]*`\)/g,
    `logger.info('No food type, falling back to keyword search')`
  ],
  [
    /logger\.info\(`Fallback: finding items matching ANY keyword[^`]*`\)/g,
    `logger.info('Fallback to any keyword match')`
  ],
  [
    /logger\.info\(`No food type detected, trying all items[^`]*`\)/g,
    `logger.info('No food type, trying all items')`
  ],
  [
    /logger\.info\(`No matching items found for "\$\{text\}"[^`]*`\)/g,
    `logger.info('No matching items found', { text })`
  ],
  // Smart search result summary block
  [
    /logger\.info\(`SMART SEARCH RESULT[^`]*`\)/g,
    `logger.info('Smart search result', { text })`
  ],
  [
    /logger\.info\(`  Results: \$\{resultItems\.length\} items`\)/g,
    `logger.info('Smart search result count', { resultCount: resultItems.length })`
  ],
  [
    /logger\.info\(`  Items: \$\{resultItems\.map[^`]*`\)/g,
    `logger.info('Smart search result items', { count: resultItems.length })`
  ],
  [
    /logger\.info\(`  Source: [^`]*`\)/g,
    `// (removed verbose search source log)`
  ],
  [
    /logger\.info\(`  Diet filter: [^`]*`\)/g,
    `// (removed verbose diet filter log)`
  ],
  
  // ─── Menu / Category / Holiday ───
  [
    /logger\.info\(`Holiday mode is ON - sending holiday message to \$\{phone\}`\)/g,
    `logger.info('Holiday mode active', { phone })`
  ],
  [
    /logger\.info\(`Scheduled ACTIVE: \[[^\]]*\]`\)/g,
    `logger.info('Scheduled categories active')`
  ],
  [
    /logger\.info\(`Scheduled LOCKED: \[[^\]]*\]`\)/g,
    `logger.info('Scheduled categories locked')`
  ],
  [
    /logger\.info\(`⏸ Manually LOCKED: \[[^\]]*\]`\)/g,
    `logger.info('Manually locked categories')`
  ],
  [
    /logger\.info\(`Items: \$\{allMenuItems\.length\} total → [^`]*`\)/g,
    `logger.info('Menu items filtered', { total: allMenuItems.length })`
  ],
  [
    /logger\.info\(`Filtered out: \[[^\]]*\]`\)/g,
    `logger.info('Categories filtered out')`
  ],

  // ─── Offers / Cart ───
  [
    /logger\.info\(`Offer not found: \$\{offerId\}`\)/g,
    `logger.info('Offer not found', { offerId })`
  ],
  [
    /logger\.info\(`Offer expired\/inactive: \$\{offerId\}`\)/g,
    `logger.info('Offer expired or inactive', { offerId })`
  ],
  [
    /logger\.info\(`Customer not eligible for offer: \$\{offerId\}`\)/g,
    `logger.info('Customer not eligible for offer', { offerId })`
  ],
  [
    /logger\.info\(`Customer eligible for offer: [^`]*`\)/g,
    `logger.info('Customer eligible for offer', { offerId })`
  ],
  [
    /logger\.info\(`Applied offer \$\{offer\.title\} to \$\{menuItem\.name\}[^`]*`\)/g,
    `logger.info('Offer applied', { offerTitle: offer.title, menuItem: menuItem.name })`
  ],
  [
    /logger\.info\(`Added to cart: \$\{menuItem\.name\} x\$\{cartItem\.quantity\}[^`]*`\)/g,
    `logger.info('Added to cart', { item: menuItem.name, quantity: cartItem.quantity })`
  ],
  [
    /logger\.info\(`Item not found: \$\{cartItem\.name\}`\)/g,
    `logger.info('Cart item not found', { item: cartItem.name })`
  ],
  [
    /logger\.info\(`Added \$\{item\.name\} to cart before checkout`\)/g,
    `logger.info('Item added to cart before checkout', { item: item.name })`
  ],

  // ─── Catalog / Variant Display ───
  [
    /logger\.info\(`sendItemDetails: item="\$\{item\.name\}"[^`]*`\)/g,
    `logger.info('sendItemDetails', { item: item.name })`
  ],
  [
    /logger\.info\(`  Single variant with \$\{matchedVariant\.quantities\.length\} sizes[^`]*`\)/g,
    `logger.info('Single variant with sizes', { sizeCount: matchedVariant.quantities.length })`
  ],
  [
    /logger\.info\(`  Array match: \$\{matchedVariantIndex\.length\} variants[^`]*`\)/g,
    `logger.info('Array match variants', { count: matchedVariantIndex.length })`
  ],

  // ─── Order Processing / Notifications ───
  [
    /logger\.info\(`Admin push sent for COD order \$\{orderId\}`\)/g,
    `logger.info('Admin push sent for COD order', { orderId })`
  ],
  [
    /logger\.info\(`Admin push sent for UPI order \$\{orderId\}`\)/g,
    `logger.info('Admin push sent for UPI order', { orderId })`
  ],
  [
    /logger\.info\(`Delivery partner \$\{deliveryBoy\.name\} notified of cancellation`\)/g,
    `logger.info('Delivery partner notified of cancellation', { deliveryPartner: deliveryBoy.name })`
  ],
  [
    /logger\.info\(`Pickup order created: \$\{orderId\}`\)/g,
    `logger.info('Pickup order created', { orderId })`
  ],
  [
    /logger\.info\(`Admin push sent for pickup order \$\{orderId\}`\)/g,
    `logger.info('Admin push sent for pickup order', { orderId })`
  ],
  
  // ─── Miscellaneous template literals ───
  [
    /logger\.info\(`Adding order \$\{order\.orderId\} to sheets - Address: "\$\{deliveryAddress\}"`\)/g,
    `logger.info('Adding order to sheets', { orderId: order.orderId, address: deliveryAddress })`
  ],
  [
    /logger\.error\(`Error checking offer \$\{offerId\}`/g,
    `logger.error('Error checking offer', { offerId }`
  ],
];

for (const [regex, replacement] of conversions) {
  const matches = content.match(regex);
  if (matches) {
    count += matches.length;
    content = content.replace(regex, replacement);
  }
}

fs.writeFileSync(filePath, content, 'utf8');
console.log(`Converted ${count} template literal logger calls to structured format.`);
