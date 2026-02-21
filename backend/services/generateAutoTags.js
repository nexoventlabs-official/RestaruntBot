/**
 * Generate Auto Tags
 * 
 * Generates search tags for menu items based on their properties.
 * Extracted from routes/menu.js to eliminate triple duplication (M5).
 * 
 * @param {string} itemName - Menu item name
 * @param {string} itemFoodType - Food type ('veg', 'nonveg', 'egg', 'none')
 * @param {string} itemUnit - Unit of measurement (e.g., 'piece', 'gram')
 * @param {number} itemQuantity - Quantity value
 * @param {string[]} itemCategories - Array of category names
 * @returns {string[]} Generated tags array
 */
function generateAutoTags(itemName, itemFoodType, itemUnit, itemQuantity, itemCategories) {
  const autoTags = [];

  // Add food type tag
  if (itemFoodType === 'veg') {
    autoTags.push('veg', 'vegetarian');
  } else if (itemFoodType === 'nonveg') {
    autoTags.push('nonveg', 'non-veg', 'non veg');
  } else if (itemFoodType === 'egg') {
    autoTags.push('egg', 'eggetarian');
  }

  // Add quantity and unit tag (e.g., "5 piece", "250 gram")
  if (itemQuantity && itemUnit) {
    autoTags.push(`${itemQuantity} ${itemUnit}`);
    if (itemQuantity > 1) {
      autoTags.push(`${itemQuantity} ${itemUnit}s`);
    }
  }

  // Add category tags
  if (itemCategories && itemCategories.length > 0) {
    autoTags.push(...itemCategories.map(c => c.toLowerCase()));
  }

  // Extract words from item name as tags (split by space, filter short words)
  const nameWords = itemName.toLowerCase().split(/\s+/).filter(w => w.length >= 3);
  autoTags.push(...nameWords);

  return autoTags;
}

module.exports = generateAutoTags;
