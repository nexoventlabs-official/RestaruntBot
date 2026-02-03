const { Expo } = require('expo-server-sdk');

// Create a new Expo SDK client
const expo = new Expo();

const pushNotification = {
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

    const message = {
      to: pushToken,
      sound: 'default',
      title,
      body,
      data,
      priority: 'high',
      channelId: channelId,
      // CRITICAL: These settings ensure delivery when app is killed/background
      _displayInForeground: true,
      // TTL of 1 week to ensure delivery
      ttl: 604800,
      // Android specific - high priority for immediate delivery
      android: {
        priority: 'high',
        channelId: channelId,
        sound: true,
        vibrate: [0, 500, 250, 500],
      },
      // iOS specific
      badge: 1,
      mutableContent: true,
      categoryId: channelId === 'new-orders' ? 'new-orders' : undefined,
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

      messages.push({
        to: pushToken,
        sound: 'default',
        title,
        body,
        data,
        priority: 'high',
        channelId: channelId,
        _displayInForeground: true,
        ttl: 604800,
        android: {
          priority: 'high',
          channelId: channelId,
          sound: true,
          vibrate: [0, 500, 250, 500],
        },
        badge: 1,
        categoryId: channelId === 'new-orders' ? 'new-orders' : undefined,
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
};

module.exports = pushNotification;
