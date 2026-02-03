const { Expo } = require('expo-server-sdk');

// Create a new Expo SDK client
const expo = new Expo();

// Store badge counts per user (in production, use Redis or database)
const badgeCounts = new Map();

const pushNotification = {
  /**
   * Get and increment badge count for a user
   * @param {string} pushToken - User's push token
   * @returns {number} New badge count
   */
  getBadgeCount(pushToken) {
    const current = badgeCounts.get(pushToken) || 0;
    const newCount = current + 1;
    badgeCounts.set(pushToken, newCount);
    return newCount;
  },

  /**
   * Reset badge count for a user
   * @param {string} pushToken - User's push token
   */
  resetBadgeCount(pushToken) {
    badgeCounts.set(pushToken, 0);
  },

  /**
   * Send push notification to a single device
   * @param {string} pushToken - Expo push token
   * @param {string} title - Notification title
   * @param {string} body - Notification body
   * @param {object} data - Additional data to send
   * @param {string} channelId - Android notification channel
   */
  async sendNotification(pushToken, title, body, data = {}, channelId = 'default') {
    if (!Expo.isExpoPushToken(pushToken)) {
      console.error(`Push token ${pushToken} is not a valid Expo push token`);
      return false;
    }

    // Get incremented badge count
    const badgeCount = this.getBadgeCount(pushToken);

    // CRITICAL: Correct Expo push notification format for FCM background delivery
    const message = {
      to: pushToken,
      // These are REQUIRED for the notification to show when app is killed
      title: title,
      body: body,
      // Sound settings
      sound: 'default',
      // Data payload - app can read this
      data: {
        ...data,
        badgeCount,
        // Add these for Android to handle properly
        title: title,
        body: body,
        channelId: channelId,
      },
      // Priority - 'high' ensures immediate delivery
      priority: 'high',
      // Android notification channel
      channelId: channelId,
      // Badge count for app icon (iOS mainly, Android uses notification count)
      badge: badgeCount,
      // TTL - time to live in seconds (1 week)
      expiration: Math.floor(Date.now() / 1000) + 604800,
      // Subtitle for iOS
      subtitle: undefined,
      // For iOS - allows notification service extension
      mutableContent: true,
    };

    try {
      const tickets = await expo.sendPushNotificationsAsync([message]);
      console.log('📱 Push notification sent:', tickets);
      
      // Check for errors in tickets
      for (const ticket of tickets) {
        if (ticket.status === 'error') {
          console.error(`Push notification error: ${ticket.message}`);
          if (ticket.details && ticket.details.error) {
            console.error(`Error code: ${ticket.details.error}`);
          }
        }
      }
      
      return tickets;
    } catch (error) {
      console.error('Push notification error:', error.message);
      return false;
    }
  },

  /**
   * Send push notification to multiple devices
   * @param {string[]} pushTokens - Array of Expo push tokens
   * @param {string} title - Notification title
   * @param {string} body - Notification body
   * @param {object} data - Additional data to send
   * @param {string} channelId - Android notification channel
   */
  async sendMultipleNotifications(pushTokens, title, body, data = {}, channelId = 'default') {
    const messages = [];
    
    for (const pushToken of pushTokens) {
      if (!Expo.isExpoPushToken(pushToken)) {
        console.error(`Push token ${pushToken} is not a valid Expo push token`);
        continue;
      }

      // Get incremented badge count for each user
      const badgeCount = this.getBadgeCount(pushToken);

      // CRITICAL: Correct Expo push notification format for FCM background delivery
      messages.push({
        to: pushToken,
        title: title,
        body: body,
        sound: 'default',
        data: {
          ...data,
          badgeCount,
          title: title,
          body: body,
          channelId: channelId,
        },
        priority: 'high',
        channelId: channelId,
        badge: badgeCount,
        expiration: Math.floor(Date.now() / 1000) + 604800,
        mutableContent: true,
      });
    }

    if (messages.length === 0) {
      console.log('No valid push tokens to send notifications');
      return [];
    }

    // Chunk messages to avoid rate limits
    const chunks = expo.chunkPushNotifications(messages);
    const tickets = [];

    for (const chunk of chunks) {
      try {
        const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
        tickets.push(...ticketChunk);
      } catch (error) {
        console.error('Push notification chunk error:', error.message);
      }
    }

    console.log(`📱 Sent ${tickets.length} push notifications`);
    return tickets;
  },

  /**
   * Send new order notification to delivery partner
   * @param {string} pushToken - Delivery partner's push token
   * @param {object} orderDetails - Order details
   */
  async sendNewOrderNotification(pushToken, orderDetails) {
    const title = '🛵 New Order Assigned!';
    const body = `Order #${orderDetails.orderId} - ₹${orderDetails.totalAmount}\n📍 ${orderDetails.deliveryAddress || 'Delivery'}`;
    
    const data = {
      type: 'new_order',
      orderId: orderDetails.orderId,
      screen: 'MyOrders',
      amount: orderDetails.totalAmount,
      customerName: orderDetails.customerName,
    };

    // Use new-orders channel for high priority
    return this.sendNotification(pushToken, title, body, data, 'new-orders');
  },

  /**
   * Send order cancelled notification to delivery partner
   * @param {string} pushToken - Delivery partner's push token
   * @param {object} orderDetails - Order details
   */
  async sendOrderCancelledNotification(pushToken, orderDetails) {
    const title = '❌ Order Cancelled';
    const body = `Order #${orderDetails.orderId} has been cancelled`;
    
    const data = {
      type: 'order_cancelled',
      orderId: orderDetails.orderId,
      screen: 'MyOrders',
    };

    return this.sendNotification(pushToken, title, body, data, 'order-updates');
  },

  /**
   * Send notification to all active delivery partners
   * @param {Array} deliveryPartners - Array of delivery partner objects with pushToken
   * @param {string} title - Notification title
   * @param {string} body - Notification body
   * @param {object} data - Additional data
   */
  async notifyAllDeliveryPartners(deliveryPartners, title, body, data = {}) {
    const tokens = deliveryPartners
      .filter(dp => dp.pushToken && dp.isActive && dp.isOnline)
      .map(dp => dp.pushToken);
    
    if (tokens.length === 0) {
      console.log('No online delivery partners with push tokens');
      return [];
    }

    return this.sendMultipleNotifications(tokens, title, body, data, 'new-orders');
  },

  /**
   * Send new order notification to admin (for new customer orders)
   * @param {string} pushToken - Admin's push token
   * @param {object} orderDetails - Order details
   */
  async sendAdminNewOrderNotification(pushToken, orderDetails) {
    const title = '🎉 New Order Received!';
    const body = `Order #${orderDetails.orderId} - ₹${orderDetails.totalAmount}\n${orderDetails.customerName} • ${orderDetails.items?.length || 0} items`;
    
    const data = {
      type: 'new_order',
      orderId: orderDetails.orderId,
      screen: 'Orders',
    };

    return this.sendNotification(pushToken, title, body, data, 'new-orders');
  },

  /**
   * Send a test notification (for debugging)
   * @param {string} pushToken - Expo push token
   */
  async sendTestNotification(pushToken) {
    console.log('📱 Sending test notification to:', pushToken);
    
    if (!Expo.isExpoPushToken(pushToken)) {
      console.error('Invalid push token:', pushToken);
      return { error: 'Invalid token' };
    }

    const message = {
      to: pushToken,
      title: '🔔 Test Notification',
      body: 'This is a test notification from FoodAdmin. If you see this, notifications are working!',
      sound: 'default',
      data: {
        type: 'test',
        timestamp: new Date().toISOString(),
      },
      priority: 'high',
      channelId: 'default',
      badge: 1,
    };

    try {
      const tickets = await expo.sendPushNotificationsAsync([message]);
      console.log('📱 Test notification tickets:', JSON.stringify(tickets, null, 2));
      
      // Check ticket status
      for (const ticket of tickets) {
        if (ticket.status === 'error') {
          console.error('Ticket error:', ticket.message);
          if (ticket.details) {
            console.error('Error details:', ticket.details);
          }
          return { error: ticket.message, details: ticket.details };
        }
      }
      
      return { success: true, tickets };
    } catch (error) {
      console.error('Test notification error:', error);
      return { error: error.message };
    }
  },

  /**
   * Check push notification receipts (for debugging delivery issues)
   * @param {string[]} ticketIds - Array of ticket IDs from sendPushNotificationsAsync
   */
  async checkReceipts(ticketIds) {
    if (!ticketIds || ticketIds.length === 0) return [];
    
    try {
      const receiptIdChunks = expo.chunkPushNotificationReceiptIds(ticketIds);
      const receipts = [];
      
      for (const chunk of receiptIdChunks) {
        const receiptChunk = await expo.getPushNotificationReceiptsAsync(chunk);
        receipts.push(receiptChunk);
        
        // Log any errors
        for (const [receiptId, receipt] of Object.entries(receiptChunk)) {
          if (receipt.status === 'error') {
            console.error(`Receipt ${receiptId} error:`, receipt.message);
            if (receipt.details) {
              console.error('Details:', receipt.details);
            }
          }
        }
      }
      
      return receipts;
    } catch (error) {
      console.error('Error checking receipts:', error);
      return [];
    }
  },
};

module.exports = pushNotification;
