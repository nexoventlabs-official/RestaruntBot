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
   */
  async sendNotification(pushToken, title, body, data = {}) {
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
      channelId: 'default',
    };

    try {
      const ticket = await expo.sendPushNotificationsAsync([message]);
      console.log('📱 Push notification sent:', ticket);
      return ticket;
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
   */
  async sendMultipleNotifications(pushTokens, title, body, data = {}) {
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
        channelId: 'default',
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
    const body = `Order #${orderDetails.orderId} - ₹${orderDetails.totalAmount}\n${orderDetails.customerName} • ${orderDetails.items.length} items`;
    
    const data = {
      type: 'new_order',
      orderId: orderDetails.orderId,
      screen: 'MyOrders',
    };

    return this.sendNotification(pushToken, title, body, data);
  },
};

module.exports = pushNotification;
