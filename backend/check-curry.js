require('dotenv').config();
const mongoose = require('mongoose');

async function checkCurry() {
  await mongoose.connect(process.env.MONGODB_URI);
  const MenuItem = require('./models/MenuItem');
  
  // Find all items with "curry" in name
  const allCurry = await MenuItem.find({ name: { $regex: 'curry', $options: 'i' } })
    .select('name foodType tags');
  
  console.log('\n=== ALL ITEMS WITH "CURRY" IN NAME ===');
  allCurry.forEach(i => {
    console.log(`  ${i.name} (${i.foodType})`);
  });
  
  // Find VEG items with curry tag
  const vegCurryTag = await MenuItem.find({ 
    foodType: 'veg', 
    tags: { $regex: 'curry', $options: 'i' } 
  }).select('name foodType tags');
  
  console.log('\n=== VEG ITEMS WITH "CURRY" TAG ===');
  vegCurryTag.forEach(i => {
    console.log(`  ${i.name} (${i.foodType}) - tags: ${i.tags?.join(', ')}`);
  });
  
  await mongoose.disconnect();
}

checkCurry().catch(console.error);
