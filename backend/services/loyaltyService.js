/**
 * loyaltyService.js — Change 5: Loyalty Points System
 *
 * Earn: 1 point per ₹10 spent (configurable via restaurantConfig.loyaltyPoints.earnRate)
 * Redeem: 1 point = ₹1 discount (configurable)
 * Idempotent: uses idempotencyService.checkOrderOperation to prevent double-award on
 *   retried webhooks. Any earn call with the same orderId is a no-op after the first.
 *
 * All public functions are non-blocking — they never throw to the caller.
 * Wrap in try/catch internally and log errors; order completion is never blocked.
 */

const Customer = require('../models/Customer');
const logger    = require('./logger');
const idempotencyService = require('./idempotencyService');

// ─── helpers ────────────────────────────────────────────────────────────────

function cfg(restaurantConfig) {
  const lp = restaurantConfig?.loyaltyPoints || {};
  return {
    enabled:          lp.enabled          ?? false,
    earnRate:         lp.earnRate          ?? 1,     // points per ₹10
    redeemRate:       lp.redeemRate        ?? 1,     // ₹1 per point
    minimumRedeem:    lp.minimumRedeem     ?? 50,
    maximumRedeemPct: lp.maximumRedeemPct  ?? 20,
    expiryDays:       lp.expiryDays        ?? 365,
  };
}

function calcEarn(amount, config) {
  // 1 point per ₹10 × earnRate
  return Math.floor((amount / 10) * config.earnRate);
}

function calcMaxRedeem(cartTotal, balance, config) {
  const maxByPct  = Math.floor((cartTotal * config.maximumRedeemPct) / 100);
  const maxByRate = Math.floor(balance * config.redeemRate);     // ₹ value of balance
  return Math.min(maxByPct, maxByRate, balance);                 // points, not ₹
}

// ─── public API ─────────────────────────────────────────────────────────────

/**
 * Award points to a customer after a completed order.
 * Idempotent per orderId — safe to call from multiple payment paths.
 *
 * @param {string} phone           - customer phone
 * @param {string} orderId         - unique order ID (used as idempotency key)
 * @param {number} orderAmount     - total order amount in ₹
 * @param {object} restaurantConfig
 * @returns {Promise<number|null>}  points awarded, or null if skipped/disabled
 */
async function awardPoints(phone, orderId, orderAmount, restaurantConfig) {
  try {
    const c = cfg(restaurantConfig);
    if (!c.enabled) return null;
    if (!phone || !orderId || !orderAmount) return null;

    // Idempotent: use atomic checkAsync so parallel webhook retries can't double-award
    const dedup = idempotencyService.checkOrderOperation(
      phone, 'loyalty_earn', { orderId }
    );
    const isDup = await dedup.checkAsync();
    if (isDup) {
      logger.info('[loyalty] earn skipped — duplicate', { phone, orderId });
      return null;
    }

    const points = calcEarn(orderAmount, c);
    if (points <= 0) return null;

    await Customer.findOneAndUpdate(
      { phone },
      {
        $inc: {
          'loyaltyPoints.balance':        points,
          'loyaltyPoints.lifetimeEarned': points,
        },
        $push: {
          'loyaltyPoints.history': {
            type:        'earned',
            points,
            orderId,
            description: `Earned on order ${orderId}`,
            timestamp:   new Date(),
          }
        }
      }
    );

    logger.info('[loyalty] points awarded', { phone, orderId, points });
    return points;
  } catch (err) {
    logger.error('[loyalty] awardPoints error', { phone, orderId, error: err.message });
    return null;
  }
}

/**
 * Redeem points at checkout.
 * Validates balance ≥ minimumRedeem and caps at maximumRedeemPct of cart total.
 *
 * @param {string} phone
 * @param {string} orderId
 * @param {number} pointsToRedeem
 * @param {object} restaurantConfig
 * @returns {Promise<{success, discount, newBalance, reason}>}
 */
async function redeemPoints(phone, orderId, pointsToRedeem, restaurantConfig) {
  try {
    const c = cfg(restaurantConfig);
    if (!c.enabled) return { success: false, reason: 'Loyalty not enabled' };

    const customer = await Customer.findOne({ phone });
    if (!customer) return { success: false, reason: 'Customer not found' };

    const balance = customer.loyaltyPoints?.balance || 0;
    if (balance < c.minimumRedeem) {
      return { success: false, reason: `Need at least ${c.minimumRedeem} points to redeem` };
    }
    if (pointsToRedeem > balance) {
      return { success: false, reason: 'Not enough points' };
    }

    const discountRs = Math.floor(pointsToRedeem * c.redeemRate);

    await Customer.findOneAndUpdate(
      { phone },
      {
        $inc: {
          'loyaltyPoints.balance':          -pointsToRedeem,
          'loyaltyPoints.lifetimeRedeemed':  pointsToRedeem,
        },
        $push: {
          'loyaltyPoints.history': {
            type:        'redeemed',
            points:      pointsToRedeem,
            orderId,
            description: `Redeemed on order ${orderId}`,
            timestamp:   new Date(),
          }
        }
      }
    );

    const newBalance = balance - pointsToRedeem;
    logger.info('[loyalty] points redeemed', { phone, orderId, pointsToRedeem, discountRs });
    return { success: true, discount: discountRs, newBalance };
  } catch (err) {
    logger.error('[loyalty] redeemPoints error', { phone, orderId, error: err.message });
    return { success: false, reason: 'Internal error' };
  }
}

/**
 * Get a customer's current loyalty balance.
 * @returns {Promise<{balance, lifetimeEarned, lifetimeRedeemed}>}
 */
async function getBalance(phone) {
  try {
    const customer = await Customer.findOne({ phone }).select('loyaltyPoints').lean();
    return customer?.loyaltyPoints || { balance: 0, lifetimeEarned: 0, lifetimeRedeemed: 0 };
  } catch (err) {
    logger.error('[loyalty] getBalance error', { phone, error: err.message });
    return { balance: 0, lifetimeEarned: 0, lifetimeRedeemed: 0 };
  }
}

/**
 * Build the earn suffix for order confirmation messages.
 * Returns '' if loyalty is disabled or 0 points would be earned.
 * @returns {string}
 */
function earnSuffix(orderAmount, restaurantConfig) {
  try {
    const c = cfg(restaurantConfig);
    if (!c.enabled) return '';
    const points = calcEarn(orderAmount, c);
    if (points <= 0) return '';
    return `\n\n⭐ You'll earn *${points} points* on this order!`;
  } catch (_) { return ''; }
}

/**
 * Build the balance display message for "my points" intent.
 * @returns {Promise<string>}
 */
async function buildBalanceMessage(phone, restaurantConfig) {
  try {
    const c = cfg(restaurantConfig);
    if (!c.enabled) return '⭐ *Loyalty points are not active yet.*\n\nStay tuned!';
    const lp = await getBalance(phone);
    const rupeeValue = Math.floor((lp.balance || 0) * c.redeemRate);
    const minRedeem  = c.minimumRedeem;
    return (
      `⭐ *Your Loyalty Points*\n\n` +
      `Balance:  *${lp.balance} points* (= ₹${rupeeValue})\n` +
      `Lifetime earned:   ${lp.lifetimeEarned || 0} pts\n` +
      `Lifetime redeemed: ${lp.lifetimeRedeemed || 0} pts\n\n` +
      `Minimum to redeem: ${minRedeem} points\n` +
      (c.expiryDays ? `Points valid for: ${c.expiryDays} days\n` : 'Points never expire\n') +
      `\nEarn 1 point for every ₹10 spent. 🍛`
    );
  } catch (err) {
    logger.error('[loyalty] buildBalanceMessage error', { phone, error: err.message });
    return '⭐ Could not load points. Please try again.';
  }
}

/**
 * If balance ≥ minimumRedeem, return a redemption offer string and the max
 * redeemable points for the given cart total. Returns null if not eligible.
 */
async function buildRedeemOffer(phone, cartTotal, restaurantConfig) {
  try {
    const c = cfg(restaurantConfig);
    if (!c.enabled) return null;
    const lp = await getBalance(phone);
    const balance = lp.balance || 0;
    if (balance < c.minimumRedeem) return null;
    const maxRedeem  = calcMaxRedeem(cartTotal, balance, c);
    if (maxRedeem <= 0) return null;
    const discount   = Math.floor(maxRedeem * c.redeemRate);
    return { balance, maxRedeem, discount, newTotal: cartTotal - discount };
  } catch (err) {
    logger.error('[loyalty] buildRedeemOffer error', { phone, error: err.message });
    return null;
  }
}

module.exports = { awardPoints, redeemPoints, getBalance, earnSuffix, buildBalanceMessage, buildRedeemOffer, calcMaxRedeem };
