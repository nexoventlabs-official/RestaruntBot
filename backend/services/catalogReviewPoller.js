/**
 * Catalog Review Poller
 * 
 * Periodically checks Meta catalog product review status.
 * Sends FCM push notifications to admin when items are approved/rejected.
 * 
 * Runs every 5 minutes after server start.
 */
const axios = require('axios');
const logger = require('./logger');
const pushNotification = require('./pushNotification');
const User = require('../models/User');
const { initContext, runWithContext } = require('./correlationContext');

// In-memory cache of last-known review status per retailer_id
const _reviewStatusCache = new Map();
const MAX_REVIEW_CACHE_SIZE = 5000; // cap to prevent unbounded growth

// Poll interval: 5 minutes
const POLL_INTERVAL_MS = 5 * 60 * 1000;

const catalogReviewPoller = {
  /**
   * Fetch all products from Meta catalog with their review status
   */
  async fetchProductReviewStatus() {
    const catalogId = process.env.META_CATALOG_ID;
    const accessToken = process.env.META_ACCESS_TOKEN;

    if (!catalogId || !accessToken) {
      return [];
    }

    try {
      const response = await axios.get(
        `https://graph.facebook.com/v24.0/${catalogId}/products`,
        {
          params: {
            fields: 'id,retailer_id,name,review_status,visibility',
            limit: 200,
            access_token: accessToken
          }
        }
      );
      return response.data?.data || [];
    } catch (err) {
      logger.error('Catalog review poller: fetch error', { error: err.response?.data?.error?.message || err.message });
      return [];
    }
  },

  /**
   * Get all admin push tokens
   */
  async getAdminPushTokens() {
    try {
      const admins = await User.find({ role: 'admin', pushToken: { $ne: null } }).lean();
      return admins.map(a => a.pushToken).filter(Boolean);
    } catch (err) {
      logger.error('Catalog review poller: failed to get admin tokens', { error: err.message });
      return [];
    }
  },

  /**
   * Send push notification to all admins
   */
  async notifyAdmins(title, body, data = {}) {
    const tokens = await this.getAdminPushTokens();
    if (tokens.length === 0) {
      logger.info('Catalog review poller: no admin push tokens found');
      return;
    }

    for (const token of tokens) {
      try {
        await pushNotification.sendNotification(token, title, body, data, 'default');
      } catch (err) {
        logger.error('Catalog review poller: failed to send notification', { error: err.message });
      }
    }
  },

  /**
   * Check for review status changes and notify
   */
  async checkAndNotify() {
    try {
      const products = await this.fetchProductReviewStatus();
      if (products.length === 0) return;

      const approvedItems = [];
      const rejectedItems = [];

      for (const product of products) {
        const prevStatus = _reviewStatusCache.get(product.retailer_id);
        const currentStatus = (product.review_status || '').toLowerCase();
        const visibility = (product.visibility || '').toLowerCase();

        // Update cache
        _reviewStatusCache.set(product.retailer_id, currentStatus);

        // Evict oldest entries if cache exceeds cap
        if (_reviewStatusCache.size > MAX_REVIEW_CACHE_SIZE) {
          const firstKey = _reviewStatusCache.keys().next().value;
          _reviewStatusCache.delete(firstKey);
        }

        // Skip if this is the first poll (seed the cache, don't spam)
        if (prevStatus === undefined) continue;

        // Detect changes
        if (prevStatus !== currentStatus) {
          if (currentStatus === 'approved' || currentStatus === '' && visibility === 'published') {
            approvedItems.push(product.name);
          } else if (currentStatus === 'rejected') {
            rejectedItems.push(product.name);
          }
        }
      }

      // Send batch notifications
      if (approvedItems.length > 0) {
        const count = approvedItems.length;
        const names = approvedItems.slice(0, 3).join(', ');
        const suffix = count > 3 ? ` and ${count - 3} more` : '';
        await this.notifyAdmins(
          `✅ ${count} Catalog Item${count > 1 ? 's' : ''} Approved!`,
          `${names}${suffix} ${count > 1 ? 'are' : 'is'} now live on WhatsApp catalog.`,
          { type: 'catalog_review', status: 'approved', screen: 'AdminMenu' }
        );
        logger.info('Catalog review: items approved', { count, items: approvedItems });
      }

      if (rejectedItems.length > 0) {
        const count = rejectedItems.length;
        const names = rejectedItems.slice(0, 3).join(', ');
        const suffix = count > 3 ? ` and ${count - 3} more` : '';
        await this.notifyAdmins(
          `❌ ${count} Catalog Item${count > 1 ? 's' : ''} Rejected`,
          `${names}${suffix} ${count > 1 ? 'were' : 'was'} rejected by Meta. Check Commerce Manager for details.`,
          { type: 'catalog_review', status: 'rejected', screen: 'AdminMenu' }
        );
        logger.info('Catalog review: items rejected', { count, items: rejectedItems });
      }
    } catch (err) {
      logger.error('Catalog review poller: check error', { error: err.message });
    }
  },

  /**
   * Start the poller (runs every 5 minutes)
   */
  start() {
    const catalogId = process.env.META_CATALOG_ID;
    if (!catalogId) {
      logger.info('Catalog review poller: skipped (no META_CATALOG_ID)');
      return;
    }

    logger.info('Catalog review poller started', { intervalMs: POLL_INTERVAL_MS });

    // Seed the cache on first run (no notifications for initial state)
    const ctx = initContext(null, { source: 'scheduler', job: 'catalogReviewPoller' });
    runWithContext(ctx, () => this.checkAndNotify());

    // Then poll every 5 minutes
    setInterval(() => {
      const ctx = initContext(null, { source: 'scheduler', job: 'catalogReviewPoller' });
      runWithContext(ctx, () => this.checkAndNotify());
    }, POLL_INTERVAL_MS);
  }
};

module.exports = catalogReviewPoller;
