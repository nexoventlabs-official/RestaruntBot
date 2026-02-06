/**
 * App Entry Point
 * 
 * IMPORTANT: Background notification handler MUST be registered here
 * (outside of React components) to work when app is closed
 */

import { registerRootComponent } from 'expo';
import { Platform } from 'react-native';

import App from './App';

/**
 * Register background notification handler using Firebase Messaging
 * Wrapped in try-catch to prevent app crash if native modules aren't ready
 */
try {
  const messaging = require('@react-native-firebase/messaging').default;
  
  messaging().setBackgroundMessageHandler(async remoteMessage => {
    console.log('📱 [FCM] Background notification received:', remoteMessage);
    // expo-notifications will handle displaying the notification
    // via enableBackgroundRemoteNotifications in app.json
  });
  
  console.log('✅ [FCM] Background handler registered');
} catch (error) {
  console.warn('⚠️ [FCM] Could not register background handler:', error.message);
  // App will still work - expo-notifications handles foreground notifications
}

/**
 * Create notification channels on app startup (Android)
 * Uses expo-notifications which is always available
 */
if (Platform.OS === 'android') {
  try {
    const Notifications = require('expo-notifications');
    
    Notifications.setNotificationChannelAsync('default', {
      name: 'Default Notifications',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#267E3E',
      sound: 'default',
    });

    Notifications.setNotificationChannelAsync('orders', {
      name: 'Order Notifications',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 500, 250, 500],
      lightColor: '#FF0000',
      sound: 'default',
    });

    Notifications.setNotificationChannelAsync('delivery', {
      name: 'Delivery Notifications',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#267E3E',
      sound: 'default',
    });

    console.log('✅ Notification channels created');
  } catch (error) {
    console.warn('⚠️ Could not create notification channels:', error.message);
  }
}

// Register the main App component
registerRootComponent(App);
