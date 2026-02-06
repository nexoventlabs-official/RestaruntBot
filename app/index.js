/**
 * App Entry Point
 * 
 * IMPORTANT: Background notification handler MUST be registered here
 * (outside of React components) to work when app is closed/killed.
 * 
 * FCM delivers notifications with a `notification` payload directly
 * to Android OS, which displays them even when the app is killed.
 * The background handler here processes the `data` payload for
 * side-effects like updating the badge count.
 */

import { registerRootComponent } from 'expo';
import { Platform } from 'react-native';

import App from './App';

// ---------------------------------------------------------------------------
// 1. Register FCM background message handler (must be top-level)
// ---------------------------------------------------------------------------
try {
  const messaging = require('@react-native-firebase/messaging').default;

  messaging().setBackgroundMessageHandler(async remoteMessage => {
    console.log('📱 [FCM] Background message:', JSON.stringify(remoteMessage));

    const data = remoteMessage.data;
    if (data?.badgeCount) {
      try {
        const Notifications = require('expo-notifications');
        const badgeNum = parseInt(data.badgeCount, 10);
        await Notifications.setBadgeCountAsync(badgeNum);

        // Also persist to SecureStore so the app can read it on next cold start
        const SecureStore = require('expo-secure-store');
        await SecureStore.setItemAsync('notification_badge_count', String(badgeNum));
      } catch (_) {
        // Non-critical — badge just won't update this one time
      }
    }
  });

  console.log('✅ [FCM] Background handler registered');
} catch (error) {
  console.warn('⚠️ [FCM] Could not register background handler:', error.message);
}

// ---------------------------------------------------------------------------
// 2. Create Android notification channels on startup
//    These MUST exist before the first FCM message targets them.
//    The pushNotifications.js service also creates these channels when
//    the module loads — this is a safety-net for the very first install
//    where a notification can arrive before the JS bundle fully executes.
// ---------------------------------------------------------------------------
if (Platform.OS === 'android') {
  try {
    const Notifications = require('expo-notifications');

    const channelDefaults = {
      importance: Notifications.AndroidImportance.MAX,
      sound: 'default',
      enableVibrate: true,
      enableLights: true,
      showBadge: true,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    };

    Notifications.setNotificationChannelAsync('default', {
      name: 'Default Notifications',
      ...channelDefaults,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#267E3E',
    });

    Notifications.setNotificationChannelAsync('new-orders', {
      name: 'New Orders',
      description: 'High priority notifications for new order assignments',
      ...channelDefaults,
      vibrationPattern: [0, 500, 250, 500],
      lightColor: '#FF0000',
      bypassDnd: true,
    });

    Notifications.setNotificationChannelAsync('order-updates', {
      name: 'Order Updates',
      description: 'Notifications for order status changes',
      ...channelDefaults,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#267E3E',
      bypassDnd: true,
    });

    Notifications.setNotificationChannelAsync('orders', {
      name: 'Order Notifications',
      ...channelDefaults,
      vibrationPattern: [0, 500, 250, 500],
      lightColor: '#FF0000',
      bypassDnd: true,
    });

    Notifications.setNotificationChannelAsync('delivery', {
      name: 'Delivery Notifications',
      ...channelDefaults,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#267E3E',
    });

    console.log('✅ Notification channels created');
  } catch (error) {
    console.warn('⚠️ Could not create notification channels:', error.message);
  }
}

// ---------------------------------------------------------------------------
// 3. Register the main App component
// ---------------------------------------------------------------------------
