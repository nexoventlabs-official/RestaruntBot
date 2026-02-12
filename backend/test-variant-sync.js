/**
 * One-time test: Verify variant products sync correctly to Meta catalog.
 * Usage: node test-variant-sync.js
 * DELETE THIS FILE AFTER TESTING.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const MenuItem = require('./models/MenuItem');
const catalogService = require('./services/catalogService');

(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ MongoDB connected');

    // Find a menu item that has variants
    const item = await MenuItem.findOne({ 'variants.0': { $exists: true } });

    if (!item) {
      console.log('❌ No menu item with variants found in DB.');
      console.log('   Add variants to an item first via admin app, then re-run.');
      process.exit(0);
    }

    console.log(`\n📦 Found item: "${item.name}" (${item._id})`);
    console.log(`   Variants (${item.variants.length}):`);
    item.variants.forEach((v, i) => {
      console.log(`   [${i}] ${v.label} | type=${v.variantType} | ₹${v.price}${v.offerPrice ? ` (offer ₹${v.offerPrice})` : ''} | img=${v.image ? 'yes' : 'no'}`);
    });

    console.log('\n🔄 Syncing to Meta catalog...');
    const result = await catalogService.syncProductToMeta(item);

    if (result) {
      console.log('\n✅ Sync SUCCESS! Meta response:');
      console.log(JSON.stringify(result, null, 2));

      // Verify mapping was created
      const CatalogProduct = require('./models/CatalogProduct');
      const mapping = await CatalogProduct.findOne({ menuItem: item._id }).lean();
      console.log('\n📋 Local CatalogProduct mapping:');
      console.log(`   retailerId: ${mapping?.retailerId}`);
      console.log(`   isActive: ${mapping?.isActive}`);
      console.log(`   lastSyncedAt: ${mapping?.lastSyncedAt}`);
    } else {
      console.log('\n⚠️  Sync returned null — catalog may not be enabled.');
      console.log('   Check META_CATALOG_ID env var is set.');
    }

  } catch (err) {
    console.error('\n❌ Error:', err.message);
    if (err.response?.data) {
      console.error('   Meta API error:', JSON.stringify(err.response.data, null, 2));
    }
  } finally {
    await mongoose.disconnect();
    console.log('\n🔌 Disconnected from MongoDB');
  }
})();
