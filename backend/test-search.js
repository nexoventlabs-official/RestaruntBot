// Test the food type detection and search logic locally
require('dotenv').config();
const mongoose = require('mongoose');

async function testSearch() {
  await mongoose.connect(process.env.MONGODB_URI);
  const MenuItem = require('./models/MenuItem');
  
  // Get all menu items
  const menuItems = await MenuItem.find({ available: true });
  console.log(`Total menu items: ${menuItems.length}`);
  
  // Simulate detectFoodTypeFromMessage for "veg curry"
  const text = "veg curry";
  const lowerText = ' ' + text.toLowerCase() + ' ';
  
  // Check for veg
  const hasNonVegPhrase = /\bnon[\s-]?veg/.test(lowerText);
  const vegPatterns = [/\bveg\b/, /\bvegetarian\b/, /\bveggie\b/, /\bpure veg\b/, /\beggless\b/];
  const hasVeg = !hasNonVegPhrase && vegPatterns.some(pattern => pattern.test(lowerText));
  
  console.log(`\nSearch: "${text}"`);
  console.log(`Has veg pattern: ${hasVeg}`);
  console.log(`Detected type: veg`);
  
  // Filter to veg items
  const searchableItems = menuItems.filter(item => item.foodType === 'veg');
  console.log(`\nVEG items only: ${searchableItems.length}`);
  
  // Search for "curry" in veg items only
  const curryMatches = searchableItems.filter(item => {
    const inName = item.name.toLowerCase().includes('curry');
    const inTags = item.tags?.some(tag => tag.toLowerCase().includes('curry'));
    return inName || inTags;
  });
  
  console.log(`\nVEG items matching "curry":`);
  curryMatches.forEach(i => {
    console.log(`  - ${i.name} (${i.foodType})`);
  });
  
  // Check if Egg curry is in veg items
  const eggCurryInVeg = searchableItems.find(i => i.name === 'Egg curry');
  console.log(`\nIs "Egg curry" in VEG items? ${eggCurryInVeg ? 'YES (BUG!)' : 'NO (correct)'}`);
  
  await mongoose.disconnect();
}

testSearch().catch(console.error);
