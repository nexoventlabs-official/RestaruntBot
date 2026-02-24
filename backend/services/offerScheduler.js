const Offer = require('../models/Offer');
const logger = require('./logger');

let intervalId = null;
const CHECK_INTERVAL = 60 * 1000; // Check every 60 seconds

/**
 * Offer Scheduler
 * - Auto-activates offers when their validFrom time arrives
 * - Auto-deactivates offers when their validUntil time passes
 */
async function checkOfferSchedules() {
  try {
    const now = new Date();

    // 1. Activate scheduled offers whose validFrom has arrived
    const toActivate = await Offer.find({
      isActive: false,
      validFrom: { $lte: now },
      $or: [
        { validUntil: null },
        { validUntil: { $gt: now } }
      ]
    });

    for (const offer of toActivate) {
      offer.isActive = true;
      await offer.save();
      logger.info('Offer auto-activated by schedule', { 
        offerId: offer._id, 
        offerType: offer.offerType,
        validFrom: offer.validFrom 
      });
    }

    // 2. Deactivate expired offers whose validUntil has passed
    const toDeactivate = await Offer.find({
      isActive: true,
      validUntil: { $ne: null, $lte: now }
    });

    for (const offer of toDeactivate) {
      offer.isActive = false;
      await offer.save();
      logger.info('Offer auto-deactivated (expired)', { 
        offerId: offer._id, 
        offerType: offer.offerType,
        validUntil: offer.validUntil 
      });
    }

    if (toActivate.length > 0 || toDeactivate.length > 0) {
      logger.info('Offer schedule check complete', { 
        activated: toActivate.length, 
        deactivated: toDeactivate.length 
      });
    }
  } catch (err) {
    logger.error('Offer scheduler error', { error: err.message });
  }
}

function start() {
  if (intervalId) return;
  logger.info('Offer scheduler started (checking every 60s)');
  // Run immediately on start, then every interval
  checkOfferSchedules();
  intervalId = setInterval(checkOfferSchedules, CHECK_INTERVAL);
}

function stop() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    logger.info('Offer scheduler stopped');
  }
}

module.exports = { start, stop };
