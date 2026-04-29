/**
 * One-shot cleanup: delete the 11 obsolete banner images from
 *   1) Cloudinary (using cloudinaryPublicId stored on each ChatbotImage doc)
 *   2) MongoDB (the ChatbotImage doc itself)
 *
 * Safe to re-run  it just no-ops on anything that's already gone.
 *
 *   node cleanup-obsolete-banners.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const logger = require('./services/logger');
const ChatbotImage = require('./models/ChatbotImage');
const cloudinaryService = require('./services/cloudinary');

const OBSOLETE_BANNER_KEYS = [
  'flow_website_banner',
  'flow_offers_banner',
  'flow_menu_banner',
  'flow_orders_banner',
  'flow_account_banner',
  'flow_help_banner',
  'flow_order_review_banner',
  'flow_service_type_banner',
  'flow_payment_banner',
  'flow_cart_banner',
  'flow_order_actions_banner'
];

async function main() {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!mongoUri) {
    console.error('\u274c MONGODB_URI not set in .env');
    process.exit(1);
  }

  console.log('\u2192 Connecting to MongoDB...');
  await mongoose.connect(mongoUri);
  console.log('\u2705 Connected.');

  console.log('\u2192 Looking up obsolete banner docs...');
  const docs = await ChatbotImage.find({ key: { $in: OBSOLETE_BANNER_KEYS } }).lean();
  console.log(`  Found ${docs.length} doc(s) to remove:`);
  for (const d of docs) {
    console.log(`    - ${d.key} | publicId=${d.cloudinaryPublicId || '(none)'} | url=${d.imageUrl || '(none)'}`);
  }

  let cloudinaryDeleted = 0;
  let cloudinaryFailed = 0;
  for (const d of docs) {
    if (d.cloudinaryPublicId) {
      try {
        await cloudinaryService.deleteImage(d.cloudinaryPublicId);
        cloudinaryDeleted++;
        console.log(`    \u2705 Cloudinary deleted: ${d.cloudinaryPublicId}`);
      } catch (err) {
        cloudinaryFailed++;
        console.warn(`    \u26a0\ufe0f  Cloudinary delete failed for ${d.cloudinaryPublicId}: ${err.message}`);
      }
    }
  }

  console.log('\u2192 Removing ChatbotImage docs from MongoDB...');
  const delRes = await ChatbotImage.deleteMany({ key: { $in: OBSOLETE_BANNER_KEYS } });
  console.log(`\u2705 Deleted ${delRes.deletedCount} doc(s).`);

  console.log('');
  console.log('Summary:');
  console.log(`  Docs found        : ${docs.length}`);
  console.log(`  Cloudinary OK     : ${cloudinaryDeleted}`);
  console.log(`  Cloudinary failed : ${cloudinaryFailed}`);
  console.log(`  Mongo deleted     : ${delRes.deletedCount}`);

  await mongoose.disconnect();
  console.log('Done.');
}

if (require.main === module) {
  main().catch(err => {
    logger.error('cleanup-obsolete-banners failed', { error: err.message });
    console.error('\u274c Fatal:', err);
    process.exit(1);
  });
}

module.exports = { OBSOLETE_BANNER_KEYS };
