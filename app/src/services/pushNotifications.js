import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform, AppState, Alert, Linking } from 'react-native';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import api from '../config/api';

// Check if running in Expo Go
const isExpoGo = Constants.appOwnership === 'expo';

// Storage keys
const PUSH_TOKEN_KEY = 'push_token_cached';
const BADGE_COUNT_KEY = 'notification_badge_count';
const TOKEN_ROLE_KEY = 'push_token_role'; // track which role registered the token

// Max retries for getting FCM token (network can be flaky at cold start)
const GET_TOKEN_MAX_RETRIES = 3;
const GET_TOKEN_RETRY_DELAY = 1500; // ms

/**
 * Get native FCM device token from @react-native-firebase/messaging.
 * Lazily initialised and cached.
 */
let _firebaseMessaging = null;
function getFirebaseMessaging() {
  if (!_firebaseMessaging && !isExpoGo) {
    try {
      _firebaseMessaging = require('@react-native-firebase/messaging').default;
    } catch (e) {
      console.warn('⚠️ @react-native-firebase/messaging not available:', e.message);
    }
  }
  return _firebaseMessaging;
}

/** Simple sleep helper */
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

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

// Initialize notification channels immediately on module load for Android
// This is CRITICAL - channels must exist BEFORE any notification arrives
const initializeNotificationChannels = async () => {
  if (Platform.OS === 'android' && !isExpoGo) {
    try {
      const channelDefaults = {
        importance: Notifications.AndroidImportance.MAX,
        sound: 'default',
        enableVibrate: true,
        enableLights: true,
        showBadge: true,
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      };

      // Default channel
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Default',
        ...channelDefaults,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#267E3E',
      });

      // New orders channel - highest priority
      await Notifications.setNotificationChannelAsync('new-orders', {
        name: 'New Orders',
        description: 'Notifications for new order assignments',
        ...channelDefaults,
        vibrationPattern: [0, 500, 250, 500],
        lightColor: '#FF0000',
        bypassDnd: true,
      });

      // Order updates channel
      await Notifications.setNotificationChannelAsync('order-updates', {
        name: 'Order Updates',
        description: 'Notifications for order status changes',
        ...channelDefaults,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#267E3E',
        bypassDnd: true,
      });

      // General orders channel
      await Notifications.setNotificationChannelAsync('orders', {
        name: 'Order Notifications',
        ...channelDefaults,
        vibrationPattern: [0, 500, 250, 500],
        lightColor: '#FF0000',
        bypassDnd: true,
      });

      // Delivery channel
      await Notifications.setNotificationChannelAsync('delivery', {
        name: 'Delivery Notifications',
        ...channelDefaults,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#267E3E',
      });

      console.log('📱 Notification channels initialized');
    } catch (error) {
      console.error('Error initializing notification channels:', error);
    }
  }

  // Set notification category for actionable notifications
  if (Platform.OS === 'android' && !isExpoGo) {
    try {
      await Notifications.setNotificationCategoryAsync('new-orders', [
        {
          identifier: 'view',
          buttonTitle: 'View Order',
          options: {
            opensAppToForeground: true,
          },
        },
      ]);
    } catch (error) {
      console.error('Error setting notification category:', error);
    }
  }
};

// Initialize channels immediately when module loads
initializeNotificationChannels();

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
   * Register for push notifications and get the FCM device token.
   * Includes retry logic for getToken (network may not be ready at cold start).
   *
   * @param {boolean} showAlert - Whether to show alert if permission denied
   * @param {boolean} forcePrompt - Whether to force showing the permission prompt
   * @param {string}  role - 'admin' | 'delivery' — determines which backend endpoint receives the token
   * @returns {Promise<{token: string|null, permissionDenied: boolean}>}
   */
  async registerForPushNotifications(showAlert = false, forcePrompt = false, role = null) {
    if (isExpoGo) {
      console.log('⚠️ Push notifications not supported in Expo Go.');
      return { token: null, permissionDenied: false };
    }
    if (!Device.isDevice) {
      console.log('Push notifications require a physical device');
      return { token: null, permissionDenied: false };
    }

    // ---- permissions ----
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      if (forcePrompt) {
        const userAccepted = await this.showPermissionPrompt();
        if (!userAccepted) return { token: null, permissionDenied: true };
        const { status: newStatus } = await Notifications.getPermissionsAsync();
        finalStatus = newStatus;
      } else {
        const { status } = await Notifications.requestPermissionsAsync({
          ios: { allowAlert: true, allowBadge: true, allowSound: true, allowAnnouncements: true },
          android: { allowAlert: true, allowBadge: true, allowSound: true },
        });
        finalStatus = status;
      }
    }

    if (finalStatus !== 'granted') {
      console.log('Push notification permission not granted');
      return { token: null, permissionDenied: true };
    }

    // Also request Firebase messaging permission (Android 13+)
    const messaging = getFirebaseMessaging();
    if (messaging) {
      try {
        const authStatus = await messaging().requestPermission();
        const enabled = authStatus === 1 || authStatus === 2;
        if (!enabled) console.log('⚠️ Firebase messaging permission not granted');
      } catch (e) {
        console.warn('⚠️ Firebase permission request failed:', e.message);
      }
    }

    // ---- get FCM token with retries ----
    let token = null;
    try {
      if (messaging) {
        for (let attempt = 1; attempt <= GET_TOKEN_MAX_RETRIES; attempt++) {
          try {
            token = await messaging().getToken();
            if (token) {
              console.log(`📱 FCM Token obtained (attempt ${attempt}):`, token.substring(0, 20) + '...');
              break;
            }
          } catch (e) {
            console.warn(`⚠️ FCM getToken attempt ${attempt} failed:`, e.message);
            if (attempt < GET_TOKEN_MAX_RETRIES) await sleep(GET_TOKEN_RETRY_DELAY);
          }
        }

        if (!token) {
          console.error('❌ Failed to get FCM token after retries');
          return { token: null, permissionDenied: false };
        }

        // Listen for token refresh — re-send to the correct backend endpoint
        messaging().onTokenRefresh(async (newToken) => {
          console.log('📱 FCM Token refreshed');
          await SecureStore.setItemAsync(PUSH_TOKEN_KEY, newToken);
          try {
            const savedRole = role || (await SecureStore.getItemAsync(TOKEN_ROLE_KEY));
            if (savedRole === 'admin') {
              await api.post('/auth/push-token', { pushToken: newToken });
            } else {
              await api.post('/delivery/push-token', { pushToken: newToken });
            }
            console.log('📱 Refreshed token sent to server');
          } catch (e) {
            console.warn('Failed to update refreshed FCM token on server:', e.message);
          }
        });
      } else {
        // Fallback: Expo push token (dev builds without Firebase)
        const projectId = Constants.expoConfig?.extra?.eas?.projectId;
        const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
        token = tokenData.data;
        console.log('📱 Expo Push Token (fallback):', token);
      }

      // Cache token + role
      if (token) {
        await SecureStore.setItemAsync(PUSH_TOKEN_KEY, token);
        if (role) await SecureStore.setItemAsync(TOKEN_ROLE_KEY, role);
      }
    } catch (error) {
      console.error('Error getting push token:', error);
      return { token: null, permissionDenied: false };
    }

    // Ensure notification channels exist
    await initializeNotificationChannels();

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
   * Send push token to backend.
   * Automatically picks the right endpoint based on cached role.
   * @param {string} pushToken - FCM device token
   * @param {string} [role] - 'admin' | 'delivery'
   */
  async updatePushToken(pushToken, role = null) {
    try {
      const savedRole = role || (await SecureStore.getItemAsync(TOKEN_ROLE_KEY)) || 'delivery';
      if (savedRole === 'admin') {
        await api.post('/auth/push-token', { pushToken });
      } else {
        await api.post('/delivery/push-token', { pushToken });
      }
      console.log(`📱 Push token sent to server (${savedRole})`);
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
    try {
      // Try to get from system first
      const systemBadge = await Notifications.getBadgeCountAsync();
      if (systemBadge > 0) return systemBadge;
      
      // Fall back to stored count
      const stored = await SecureStore.getItemAsync(BADGE_COUNT_KEY);
      return stored ? parseInt(stored, 10) : 0;
    } catch (error) {
      return 0;
    }
  },

  /**
   * Set badge count
   * @param {number} count - Badge count
   */
  async setBadgeCount(count) {
    if (isExpoGo) return;
    try {
      await Notifications.setBadgeCountAsync(count);
      await SecureStore.setItemAsync(BADGE_COUNT_KEY, String(count));
    } catch (error) {
      console.error('Error setting badge count:', error);
    }
  },

  /**
   * Increment badge count by 1
   */
  async incrementBadgeCount() {
    if (isExpoGo) return;
    try {
      const current = await this.getBadgeCount();
      await this.setBadgeCount(current + 1);
    } catch (error) {
      console.error('Error incrementing badge count:', error);
    }
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
   * Get count of pending/delivered notifications
   */
  async getPendingNotificationsCount() {
    if (isExpoGo) return 0;
    try {
      const notifications = await Notifications.getPresentedNotificationsAsync();
      return notifications.length;
    } catch (error) {
      return 0;
    }
  },

  /**
   * Check if push notifications are supported
   */
  isSupported() {
    return !isExpoGo && Device.isDevice;
  },

  /**
   * Schedule a local notification immediately.
   * Picks the notification channel from data.channelId or falls back to 'default'.
   * @param {string}  title
   * @param {string}  body
   * @param {object}  data   Extra data (readable on tap)
   * @param {string}  [channelId] Override channel id
   */
  async scheduleLocalNotification(title, body, data = {}, channelId = null) {
    if (isExpoGo) return null;

    const channel = channelId || data.channelId || 'default';

    return await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        data,
        sound: 'default',
        priority: Notifications.AndroidNotificationPriority.MAX,
        ...(Platform.OS === 'android' ? { channelId: channel } : {}),
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
