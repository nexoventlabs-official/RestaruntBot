/**
 * Catalog Rating Sync Scheduler
 * 
 * Syncs menu item ratings to Meta WhatsApp Commerce Catalog descriptions
 * daily at 2:00 AM IST. This runs at off-peak hours so the brief catalog
 * re-processing by Meta doesn't affect customers.
 * 
 * Why scheduled instead of real-time:
 * - Meta's items_batch API (CREATE/upsert) re-processes products asynchronously
 * - During processing (~2-5 minutes), products show as "removed" in WhatsApp
 * - Running at 2 AM ensures no customers are affected
 */

const cron = require('node-cron');
const mongoose = require('mongoose');
const logger = require('./logger');

let schedulerTask = null;

/**
 * Sync all menu item ratings to Meta catalog descriptions.
 * Fetches all menu items with ratings > 0 and pushes updated descriptions.
 */
async function syncAllRatingsToMeta() {
  try {
    const catalogService = require('./catalogService');
    if (!catalogService.isEnabled()) {
      logger.info('[CatalogRatingSync] Catalog not enabled, skipping');
      return;
    }

    const MenuItem = mongoose.model('MenuItem');
    
    // Find all available menu items (rated and unrated) so every product shows stars
    // Unrated items display ☆☆☆☆☆ No reviews yet
    const allItems = await MenuItem.find({ available: true }).select('_id').lean();
    
    if (allItems.length === 0) {
      logger.info('[CatalogRatingSync] No menu items to sync');
      return;
    }

    const menuItemIds = allItems.map(item => item._id.toString());
    logger.info(`[CatalogRatingSync] Starting daily rating sync for ${menuItemIds.length} items`);

    const result = await catalogService.syncRatingsToMeta(menuItemIds);
    logger.info(`[CatalogRatingSync] Daily sync complete`, {
      synced: result.synced,
      failed: result.failed,
      totalItems: menuItemIds.length
    });
  } catch (err) {
    logger.error('[CatalogRatingSync] Daily sync failed', { error: err.message });
  }
}

/**
 * Start the daily rating sync scheduler.
 * Runs at 2:00 AM IST (Indian Standard Time = UTC+5:30, so 20:30 UTC previous day).
 */
function start() {
  if (schedulerTask) {
    logger.info('[CatalogRatingSync] Scheduler already running');
    return;
  }

  // Run at 2:00 AM IST daily using Asia/Kolkata timezone
  schedulerTask = cron.schedule('0 2 * * *', async () => {
    logger.info('[CatalogRatingSync] Daily 2 AM IST rating sync triggered');
    await syncAllRatingsToMeta();
  }, {
    timezone: 'Asia/Kolkata'
  });

  logger.info('[CatalogRatingSync] Scheduler started — daily at 2:00 AM IST');
}

/**
 * Stop the scheduler.
 */
function stop() {
  if (schedulerTask) {
    schedulerTask.stop();
    schedulerTask = null;
    logger.info('[CatalogRatingSync] Scheduler stopped');
  }
}

module.exports = { start, stop, syncAllRatingsToMeta };
