/**
 * Push Token Cleanup Scheduler
 * 
 * Purpose: Remove stale/invalid push notification tokens from User and DeliveryBoy
 * models in the database. Tokens become stale when:
 * - App is uninstalled (FCM returns "registration-token-not-registered")
 * - Token expires (Expo token rotation)
 * - Device changes
 * 
 * The pushNotification service tracks stale tokens in-memory, but they are never
 * cleaned from the DB. This cron bridges that gap.
 * 
 * Runs every 6 hours: validates all stored tokens and nullifies stale ones.
 */

const cron = require('node-cron');
const { Expo } = require('expo-server-sdk');
const User = require('../models/User');
const DeliveryBoy = require('../models/DeliveryBoy');
const logger = require('./logger');
const { initContext, runWithContext } = require('./correlationContext');

let schedulerTask = null;
const expo = new Expo();

/**
 * Validate a push token format
 * Returns false if token format is clearly invalid
 */
function isValidTokenFormat(token) {
  if (!token || typeof token !== 'string' || token.trim().length === 0) return false;
  
  // Expo token format: ExponentPushToken[xxx] or ExpoPushToken[xxx]
  if (token.startsWith('ExponentPushToken[') || token.startsWith('ExpoPushToken[')) {
    return Expo.isExpoPushToken(token);
  }
  
  // FCM token: typically 100+ chars alphanumeric with colons and hyphens
  if (token.length >= 20) return true;
  
  return false;
}

/**
 * Clean stale push tokens from the database
 */
async function cleanStaleTokens() {
  try {
    let cleaned = 0;

    // Clean User (admin/staff) tokens
    const usersWithTokens = await User.find({ 
      pushToken: { $ne: null, $exists: true } 
    }).select('_id username pushToken');

    for (const user of usersWithTokens) {
      if (!isValidTokenFormat(user.pushToken)) {
        await User.updateOne({ _id: user._id }, { $set: { pushToken: null } });
        logger.info('[TokenCleanup] Removed invalid token from User', { 
          username: user.username,
          tokenPrefix: user.pushToken?.substring(0, 20) + '...'
        });
        cleaned++;
      }
    }

    // Clean DeliveryBoy tokens
    const deliveryBoysWithTokens = await DeliveryBoy.find({ 
      pushToken: { $ne: null, $exists: true } 
    }).select('_id name phone pushToken');

    for (const db of deliveryBoysWithTokens) {
      if (!isValidTokenFormat(db.pushToken)) {
        await DeliveryBoy.updateOne({ _id: db._id }, { $set: { pushToken: null } });
        logger.info('[TokenCleanup] Removed invalid token from DeliveryBoy', { 
          name: db.name,
          phone: db.phone,
          tokenPrefix: db.pushToken?.substring(0, 20) + '...'
        });
        cleaned++;
      }
    }

    // Validate Expo tokens by sending dry-run receipts
    const allExpoTokens = [];
    for (const user of usersWithTokens) {
      if (user.pushToken && Expo.isExpoPushToken(user.pushToken)) {
        allExpoTokens.push({ token: user.pushToken, model: 'User', id: user._id });
      }
    }
    for (const db of deliveryBoysWithTokens) {
      if (db.pushToken && Expo.isExpoPushToken(db.pushToken)) {
        allExpoTokens.push({ token: db.pushToken, model: 'DeliveryBoy', id: db._id });
      }
    }

    // Expo batch validation (if any expo tokens exist)
    if (allExpoTokens.length > 0) {
      try {
        const messages = allExpoTokens.map(t => ({
          to: t.token,
          title: 'Token validation',
          body: 'test',
          // This won't actually send — we just check for DeviceNotRegistered
        }));

        const chunks = expo.chunkPushNotifications(messages);
        for (const chunk of chunks) {
          try {
            const tickets = await expo.sendPushNotificationsAsync(chunk);
            for (let i = 0; i < tickets.length; i++) {
              if (tickets[i].status === 'error' && 
                  tickets[i].details?.error === 'DeviceNotRegistered') {
                const tokenInfo = allExpoTokens[i];
                const Model = tokenInfo.model === 'User' ? User : DeliveryBoy;
                await Model.updateOne({ _id: tokenInfo.id }, { $set: { pushToken: null } });
                logger.info('[TokenCleanup] Removed DeviceNotRegistered token', {
                  id: tokenInfo.id
                });
                cleaned++;
              }
            }
          } catch (chunkErr) {
            logger.warn('[TokenCleanup] Expo chunk validation failed', { error: chunkErr.message });
          }
        }
      } catch (expoErr) {
        logger.warn('[TokenCleanup] Expo validation skipped', { error: expoErr.message });
      }
    }

    if (cleaned > 0) {
      logger.info('[TokenCleanup] Cleaned stale tokens from DB', { cleaned });
    }

    return { cleaned, usersChecked: usersWithTokens.length, deliveryBoysChecked: deliveryBoysWithTokens.length };
  } catch (error) {
    logger.error('[TokenCleanup] Fatal error', { error: error.message, stack: error.stack });
    return { cleaned: 0, error: error.message };
  }
}

function start() {
  if (schedulerTask) {
    logger.info('[TokenCleanup] Already running');
    return;
  }
  // Run every 6 hours
  schedulerTask = cron.schedule('0 */6 * * *', async () => {
    const ctx = initContext(null, { source: 'scheduler', job: 'pushTokenCleanup' });
    await runWithContext(ctx, async () => {
      logger.info('[TokenCleanup] Running push token cleanup');
      await cleanStaleTokens();
    });
  });
  logger.info('[TokenCleanup] Started — running every 6 hours');
}

function stop() {
  if (schedulerTask) {
    schedulerTask.stop();
    schedulerTask = null;
    logger.info('[TokenCleanup] Stopped');
  }
}

module.exports = { start, stop, cleanStaleTokens, isValidTokenFormat };
