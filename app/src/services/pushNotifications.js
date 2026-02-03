import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform, AppState, Alert, Linking } from 'react-native';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import api from '../config/api';

// Check if running in Expo Go
const isExpoGo = Constants.appOwnership === 'expo';

// Key for storing permission prompt state
const PERMISSION_PROMPTED_KEY = 'notification_permission_prompted';
const PUSH_TOKEN_KEY = 'push_token_cached';

// Configure notification handler - THIS IS CRITICAL for showing notifications
// when app is in foreground AND background
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    priority: Notifications.AndroidNotificationPriority.MAX,
  }),
});

// Set background notification handler for when app is killed
if (Platform.OS === 'android') {
  Notifications.setNotificationCategoryAsync('new-orders', [
    {
      identifier: 'view',
      buttonTitle: 'View Order',
      options: {
        opensAppToForeground: true,
      },
    },
  ]);
}

export const pushNotifications = {
  /**
   * Check if notification permission is granted
   * @returns {Promise<boolean>}
   */
  async hasNotificationPermission() {
    if (isExpoGo || !Device.isDevice) return false;
    const { status } = await Notifications.getPermissionsAsync();
    return status === 'granted';
  },

  /**
   * Show permission prompt with option to go to settings
   * @returns {Promise<boolean>} - true if permission granted
   */
  async showPermissionPrompt() {
    return new Promise((resolve) => {
      Alert.alert(
        '🔔 Enable Notifications',
        'To receive order updates and important alerts in real-time (even when app is closed), please enable notifications.',
        [
          { 
            text: 'Not Now', 
            style: 'cancel',
            onPress: () => resolve(false)
          },
          { 
            text: 'Enable', 
            onPress: async () => {
              // First try to request permission
              const { status } = await Notifications.requestPermissionsAsync({
                ios: {
                  allowAlert: true,
                  allowBadge: true,
                  allowSound: true,
                  allowAnnouncements: true,
                },
                android: {
                  allowAlert: true,
                  allowBadge: true,
                  allowSound: true,
                },
              });
              
              if (status === 'granted') {
                resolve(true);
              } else {
                // Permission still not granted, offer to open settings
                Alert.alert(
                  'Permission Required',
                  'Notifications are disabled. Please enable them in app settings to receive order updates.',
                  [
                    { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
                    { 
                      text: 'Open Settings', 
                      onPress: () => {
                        if (Platform.OS === 'ios') {
                          Linking.openURL('app-settings:');
                        } else {
                          Linking.openSettings();
                        }
                        resolve(false);
                      }
                    }
                  ]
                );
              }
            }
          }
        ],
        { cancelable: false }
      );
    });
  },

  /**
   * Register for push notifications and get the Expo push token
   * @param {boolean} showAlert - Whether to show alert if permission denied
   * @param {boolean} forcePrompt - Whether to force showing the permission prompt
   * @returns {Promise<{token: string|null, permissionDenied: boolean}>}
   */
  async registerForPushNotifications(showAlert = false, forcePrompt = false) {
    // Push notifications don't work in Expo Go for SDK 53+
    if (isExpoGo) {
      console.log('⚠️ Push notifications are not supported in Expo Go. Use a development build.');
      return { token: null, permissionDenied: false };
    }

    let token = null;

    // Check if it's a physical device
    if (!Device.isDevice) {
      console.log('Push notifications require a physical device');
      return { token: null, permissionDenied: false };
    }

    // Check existing permissions
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    // Request permissions if not granted
    if (existingStatus !== 'granted') {
      if (forcePrompt) {
        // Show custom prompt first
        const userAccepted = await this.showPermissionPrompt();
        if (!userAccepted) {
          return { token: null, permissionDenied: true };
        }
        // Check again after prompt
        const { status: newStatus } = await Notifications.getPermissionsAsync();
        finalStatus = newStatus;
      } else {
        const { status } = await Notifications.requestPermissionsAsync({
          ios: {
            allowAlert: true,
            allowBadge: true,
            allowSound: true,
            allowAnnouncements: true,
          },
          android: {
            allowAlert: true,
            allowBadge: true,
            allowSound: true,
          },
        });
        finalStatus = status;
      }
    }

    if (finalStatus !== 'granted') {
      console.log('Push notification permission not granted');
      return { token: null, permissionDenied: true };
    }

    // Get the Expo push token
    try {
      const projectId = Constants.expoConfig?.extra?.eas?.projectId;
      const tokenData = await Notifications.getExpoPushTokenAsync({
        projectId: projectId,
      });
      token = tokenData.data;
      console.log('📱 Expo Push Token:', token);
      
      // Cache the token for re-registration when app comes to foreground
      await SecureStore.setItemAsync(PUSH_TOKEN_KEY, token);
    } catch (error) {
      console.error('Error getting push token:', error);
      return { token: null, permissionDenied: false };
    }

    // Configure Android notification channels
    if (Platform.OS === 'android') {
      // Default channel
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Default',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#267E3E',
        sound: 'default',
        enableVibrate: true,
        enableLights: true,
        showBadge: true,
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      });

      // New orders channel - high priority with bypassing DND
      await Notifications.setNotificationChannelAsync('new-orders', {
        name: 'New Orders',
        description: 'Notifications for new order assignments',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 500, 250, 500],
        lightColor: '#267E3E',
        sound: 'default',
        enableVibrate: true,
        enableLights: true,
        showBadge: true,
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
        bypassDnd: true, // Bypass Do Not Disturb
      });

      // Order updates channel
      await Notifications.setNotificationChannelAsync('order-updates', {
        name: 'Order Updates',
        description: 'Notifications for order status changes',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#267E3E',
        sound: 'default',
        enableVibrate: true,
        showBadge: true,
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
        bypassDnd: true,
      });
    }

    return { token, permissionDenied: false };
  },
  
  /**
   * Get cached push token
   * @returns {Promise<string|null>}
   */
  async getCachedToken() {
    try {
      return await SecureStore.getItemAsync(PUSH_TOKEN_KEY);
    } catch (error) {
      return null;
    }
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
   * Add notification received listener (when app is in foreground)
   * @param {Function} callback - Callback function when notification is received
   * @returns {Object} Subscription object
   */
  addNotificationReceivedListener(callback) {
    if (isExpoGo) return { remove: () => {} };
    return Notifications.addNotificationReceivedListener(callback);
  },

  /**
   * Add notification response listener (when user taps notification)
   * @param {Function} callback - Callback function when notification is tapped
   * @returns {Object} Subscription object
   */
  addNotificationResponseListener(callback) {
    if (isExpoGo) return { remove: () => {} };
    return Notifications.addNotificationResponseReceivedListener(callback);
  },

  /**
   * Remove notification listener
   * @param {Object} subscription - Subscription object to remove
   */
  removeNotificationListener(subscription) {
    if (subscription && subscription.remove) {
      subscription.remove();
    }
  },

  /**
   * Get badge count
   */
  async getBadgeCount() {
    if (isExpoGo) return 0;
    return await Notifications.getBadgeCountAsync();
  },

  /**
   * Set badge count
   * @param {number} count - Badge count
   */
  async setBadgeCount(count) {
    if (isExpoGo) return;
    await Notifications.setBadgeCountAsync(count);
  },

  /**
   * Clear all notifications
   */
  async clearAllNotifications() {
    if (isExpoGo) return;
    await Notifications.dismissAllNotificationsAsync();
    await this.setBadgeCount(0);
  },

  /**
   * Check if push notifications are supported
   */
  isSupported() {
    return !isExpoGo && Device.isDevice;
  },

  /**
   * Schedule a local notification (for testing)
   */
  async scheduleLocalNotification(title, body, data = {}) {
    if (isExpoGo) return null;
    
    return await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        data,
        sound: 'default',
        priority: Notifications.AndroidNotificationPriority.MAX,
      },
      trigger: null, // Immediate
    });
  },

  /**
   * Get last notification response (for when app opens from notification)
   */
  async getLastNotificationResponse() {
    if (isExpoGo) return null;
    return await Notifications.getLastNotificationResponseAsync();
  },
};

export default pushNotifications;
