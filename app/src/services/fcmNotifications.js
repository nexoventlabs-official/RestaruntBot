/**
 * FCM Push Notifications Service - Phase 6.10
 * 
 * Purpose: Handle Firebase Cloud Messaging notifications
 * 
 * Features:
 * - FCM token management
 * - Notification permissions
 * - Background notifications
 * - Notification badge
 * - Notification sound
 * - Deep linking
 */

import messaging from '@react-native-firebase/messaging';
import notifee, { AndroidImportance, AndroidStyle } from '@notifee/react-native';
import { Platform, PermissionsAndroid, Alert } from 'react-native';
import * as Sentry from '@sentry/react-native';
import { saveFCMToken, incrementNotificationBadge, clearNotificationBadge } from './offlineStorage';
import API_URL from '../config/api';

/**
 * Request notification permissions
 */
export async function requestNotificationPermission() {
  try {
    if (Platform.OS === 'android') {
      if (Platform.Version >= 33) {
        // Android 13+ requires explicit permission
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS
        );
        
        if (granted === PermissionsAndroid.RESULTS.GRANTED) {
          console.log('✅ [FCM] Notification permission granted');
          return true;
        } else {
          console.log('❌ [FCM] Notification permission denied');
          return false;
        }
      } else {
        // Android 12 and below - notifications enabled by default
        return true;
      }
    } else {
      // iOS
      const authStatus = await messaging().requestPermission();
      const enabled =
        authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
        authStatus === messaging.AuthorizationStatus.PROVISIONAL;

      if (enabled) {
        console.log('✅ [FCM] iOS notification permission granted');
        return true;
      } else {
        console.log('❌ [FCM] iOS notification permission denied');
        return false;
      }
    }
  } catch (error) {
    console.error('❌ [FCM] Permission request error:', error);
    Sentry.captureException(error);
    return false;
  }
}

/**
 * Get FCM token
 */
export async function getFCMToken() {
  try {
    const token = await messaging().getToken();
    console.log('✅ [FCM] Token:', token);
    
    // Save token to storage
    await saveFCMToken(token);
    
    return token;
  } catch (error) {
    console.error('❌ [FCM] Get token error:', error);
    Sentry.captureException(error);
    return null;
  }
}

/**
 * Register FCM token with backend
 */
export async function registerFCMToken(token, userType, userId) {
  try {
    const response = await fetch(`${API_URL}/api/push-notifications/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        token,
        userType, // 'admin' or 'delivery'
        userId,
        platform: Platform.OS,
        deviceInfo: {
          os: Platform.OS,
          version: Platform.Version
        }
      }),
    });

    if (response.ok) {
      console.log('✅ [FCM] Token registered with backend');
      return true;
    } else {
      console.error('❌ [FCM] Token registration failed');
      return false;
    }
  } catch (error) {
    console.error('❌ [FCM] Register token error:', error);
    Sentry.captureException(error);
    return false;
  }
}

/**
 * Create notification channel (Android)
 */
export async function createNotificationChannel() {
  if (Platform.OS === 'android') {
    try {
      await notifee.createChannel({
        id: 'default',
        name: 'Default Channel',
        importance: AndroidImportance.HIGH,
        sound: 'default',
        vibration: true,
        badge: true,
      });

      await notifee.createChannel({
        id: 'orders',
        name: 'Order Notifications',
        importance: AndroidImportance.HIGH,
        sound: 'order_notification',
        vibration: true,
        badge: true,
      });

      await notifee.createChannel({
        id: 'delivery',
        name: 'Delivery Notifications',
        importance: AndroidImportance.HIGH,
        sound: 'delivery_notification',
        vibration: true,
        badge: true,
      });

      console.log('✅ [FCM] Notification channels created');
    } catch (error) {
      console.error('❌ [FCM] Create channel error:', error);
      Sentry.captureException(error);
    }
  }
}

/**
 * Display local notification
 */
export async function displayNotification(notification) {
  try {
    const { title, body, data } = notification;
    
    // Increment badge count
    const badgeCount = await incrementNotificationBadge();
    
    await notifee.displayNotification({
      title,
      body,
      data,
      android: {
        channelId: data?.type === 'order' ? 'orders' : data?.type === 'delivery' ? 'delivery' : 'default',
        importance: AndroidImportance.HIGH,
        sound: data?.type === 'order' ? 'order_notification' : 'default',
        vibrationPattern: [300, 500],
        pressAction: {
          id: 'default',
        },
        badge: badgeCount,
        largeIcon: 'ic_launcher',
        style: {
          type: AndroidStyle.BIGTEXT,
          text: body,
        },
      },
      ios: {
        sound: data?.type === 'order' ? 'order_notification.wav' : 'default',
        badgeCount,
        categoryId: data?.type || 'default',
      },
    });

    console.log('✅ [FCM] Notification displayed');
  } catch (error) {
    console.error('❌ [FCM] Display notification error:', error);
    Sentry.captureException(error);
  }
}

/**
 * Handle foreground notifications
 */
export function setupForegroundNotificationHandler() {
  return messaging().onMessage(async remoteMessage => {
    console.log('📱 [FCM] Foreground notification:', remoteMessage);
    
    // Display notification even when app is in foreground
    await displayNotification({
      title: remoteMessage.notification?.title || 'New Notification',
      body: remoteMessage.notification?.body || '',
      data: remoteMessage.data || {},
    });
  });
}

/**
 * Handle background notifications
 */
export function setupBackgroundNotificationHandler() {
  messaging().setBackgroundMessageHandler(async remoteMessage => {
    console.log('📱 [FCM] Background notification:', remoteMessage);
    
    // Display notification
    await displayNotification({
      title: remoteMessage.notification?.title || 'New Notification',
      body: remoteMessage.notification?.body || '',
      data: remoteMessage.data || {},
    });
  });
}

/**
 * Handle notification opened (app was closed/background)
 */
export async function getInitialNotification() {
  try {
    const remoteMessage = await messaging().getInitialNotification();
    
    if (remoteMessage) {
      console.log('📱 [FCM] App opened from notification:', remoteMessage);
      return remoteMessage;
    }
    
    return null;
  } catch (error) {
    console.error('❌ [FCM] Get initial notification error:', error);
    Sentry.captureException(error);
    return null;
  }
}

/**
 * Handle notification opened (app was in background)
 */
export function setupNotificationOpenedHandler(callback) {
  return messaging().onNotificationOpenedApp(remoteMessage => {
    console.log('📱 [FCM] Notification opened app:', remoteMessage);
    
    if (callback) {
      callback(remoteMessage);
    }
  });
}

/**
 * Handle token refresh
 */
export function setupTokenRefreshHandler(callback) {
  return messaging().onTokenRefresh(async token => {
    console.log('🔄 [FCM] Token refreshed:', token);
    
    // Save new token
    await saveFCMToken(token);
    
    if (callback) {
      callback(token);
    }
  });
}

/**
 * Clear notification badge
 */
export async function clearBadge() {
  try {
    await notifee.setBadgeCount(0);
    await clearNotificationBadge();
    console.log('✅ [FCM] Badge cleared');
  } catch (error) {
    console.error('❌ [FCM] Clear badge error:', error);
    Sentry.captureException(error);
  }
}

/**
 * Set notification badge count
 */
export async function setBadgeCount(count) {
  try {
    await notifee.setBadgeCount(count);
    console.log(`✅ [FCM] Badge set to ${count}`);
  } catch (error) {
    console.error('❌ [FCM] Set badge error:', error);
    Sentry.captureException(error);
  }
}

/**
 * Cancel all notifications
 */
export async function cancelAllNotifications() {
  try {
    await notifee.cancelAllNotifications();
    await clearBadge();
    console.log('✅ [FCM] All notifications cancelled');
  } catch (error) {
    console.error('❌ [FCM] Cancel notifications error:', error);
    Sentry.captureException(error);
  }
}

/**
 * Initialize FCM
 */
export async function initializeFCM(userType, userId) {
  try {
    console.log('🔄 [FCM] Initializing...');
    
    // Request permission
    const hasPermission = await requestNotificationPermission();
    if (!hasPermission) {
      Alert.alert(
        'Notifications Disabled',
        'Please enable notifications in settings to receive order updates.',
        [{ text: 'OK' }]
      );
      return false;
    }
    
    // Create notification channels (Android)
    await createNotificationChannel();
    
    // Get FCM token
    const token = await getFCMToken();
    if (!token) {
      console.error('❌ [FCM] Failed to get token');
      return false;
    }
    
    // Register token with backend
    await registerFCMToken(token, userType, userId);
    
    // Setup handlers
    setupForegroundNotificationHandler();
    setupBackgroundNotificationHandler();
    
    console.log('✅ [FCM] Initialized successfully');
    return true;
  } catch (error) {
    console.error('❌ [FCM] Initialization error:', error);
    Sentry.captureException(error);
    return false;
  }
}

/**
 * Check if notifications are enabled
 */
export async function areNotificationsEnabled() {
  try {
    if (Platform.OS === 'android') {
      if (Platform.Version >= 33) {
        const granted = await PermissionsAndroid.check(
          PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS
        );
        return granted;
      }
      return true;
    } else {
      const authStatus = await messaging().hasPermission();
      return (
        authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
        authStatus === messaging.AuthorizationStatus.PROVISIONAL
      );
    }
  } catch (error) {
    console.error('❌ [FCM] Check permission error:', error);
    return false;
  }
}

export default {
  requestNotificationPermission,
  getFCMToken,
  registerFCMToken,
  createNotificationChannel,
  displayNotification,
  setupForegroundNotificationHandler,
  setupBackgroundNotificationHandler,
  getInitialNotification,
  setupNotificationOpenedHandler,
  setupTokenRefreshHandler,
  clearBadge,
  setBadgeCount,
  cancelAllNotifications,
  initializeFCM,
  areNotificationsEnabled,
};
