import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import api from '../config/api';

// Configure notification handler
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export const pushNotifications = {
  /**
   * Register for push notifications and get the Expo push token
   * @returns {Promise<string|null>} Expo push token or null if failed
   */
  async registerForPushNotifications() {
    let token = null;

    // Check if it's a physical device
    if (!Device.isDevice) {
      console.log('Push notifications require a physical device');
      return null;
    }

    // Check existing permissions
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    // Request permissions if not granted
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      console.log('Push notification permission not granted');
      return null;
    }

    // Get the Expo push token
    try {
      const tokenData = await Notifications.getExpoPushTokenAsync({
        projectId: 'your-project-id', // Replace with your Expo project ID if needed
      });
      token = tokenData.data;
      console.log('📱 Expo Push Token:', token);
    } catch (error) {
      console.error('Error getting push token:', error);
      return null;
    }

    // Configure Android notification channel
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Default',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#267E3E',
        sound: 'default',
      });

      // Create a channel for new orders
      await Notifications.setNotificationChannelAsync('new-orders', {
        name: 'New Orders',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 500, 250, 500],
        lightColor: '#267E3E',
        sound: 'default',
      });
    }

    return token;
  },

  /**
   * Send push token to backend for delivery partner
   * @param {string} pushToken - Expo push token
   */
  async updatePushToken(pushToken) {
    try {
      await api.post('/delivery/push-token', { pushToken });
      console.log('📱 Push token sent to server');
      return true;
    } catch (error) {
      console.error('Error updating push token:', error);
      return false;
    }
  },

  /**
   * Add notification received listener
   * @param {Function} callback - Callback function when notification is received
   * @returns {Object} Subscription object
   */
  addNotificationReceivedListener(callback) {
    return Notifications.addNotificationReceivedListener(callback);
  },

  /**
   * Add notification response listener (when user taps notification)
   * @param {Function} callback - Callback function when notification is tapped
   * @returns {Object} Subscription object
   */
  addNotificationResponseListener(callback) {
    return Notifications.addNotificationResponseReceivedListener(callback);
  },

  /**
   * Remove notification listener
   * @param {Object} subscription - Subscription object to remove
   */
  removeNotificationListener(subscription) {
    Notifications.removeNotificationSubscription(subscription);
  },

  /**
   * Get badge count
   */
  async getBadgeCount() {
    return await Notifications.getBadgeCountAsync();
  },

  /**
   * Set badge count
   * @param {number} count - Badge count
   */
  async setBadgeCount(count) {
    await Notifications.setBadgeCountAsync(count);
  },

  /**
   * Clear all notifications
   */
  async clearAllNotifications() {
    await Notifications.dismissAllNotificationsAsync();
    await this.setBadgeCount(0);
  },
};

export default pushNotifications;
