/**
 * App Entry Point
 * 
 * IMPORTANT: Background notification handler MUST be registered here
 * (outside of React components) to work when app is closed
 */

import { registerRootComponent } from 'expo';
import messaging from '@react-native-firebase/messaging';
import notifee, { AndroidImportance } from '@notifee/react-native';
import { Platform } from 'react-native';

import App from './App';

/**
 * Register background notification handler
 * This MUST be at the top level (not inside React components)
 * to receive notifications when app is closed/killed
 */
messaging().setBackgroundMessageHandler(async remoteMessage => {
  console.log('📱 [FCM] Background notification received:', remoteMessage);
  
  try {
    // Display notification using Notifee
    await notifee.displayNotification({
      title: remoteMessage.notification?.title || 'New Notification',
      body: remoteMessage.notification?.body || '',
      data: remoteMessage.data || {},
      android: {
        channelId: remoteMessage.data?.type === 'order' ? 'orders' : 'default',
        importance: AndroidImportance.HIGH,
        sound: remoteMessage.data?.type === 'order' ? 'order_notification' : 'default',
        vibrationPattern: [300, 500],
        pressAction: {
          id: 'default',
        },
        largeIcon: 'ic_launcher',
      },
      ios: {
        sound: remoteMessage.data?.type === 'order' ? 'order_notification.wav' : 'default',
        badgeCount: 1,
      },
    });
    
    console.log('✅ [FCM] Background notification displayed');
  } catch (error) {
    console.error('❌ [FCM] Background notification error:', error);
  }
});

/**
 * Create notification channels on app startup (Android)
 */
if (Platform.OS === 'android') {
  notifee.createChannel({
    id: 'default',
    name: 'Default Notifications',
    importance: AndroidImportance.HIGH,
    sound: 'default',
    vibration: true,
    badge: true,
  });

  notifee.createChannel({
    id: 'orders',
    name: 'Order Notifications',
    importance: AndroidImportance.HIGH,
    sound: 'order_notification',
    vibration: true,
    badge: true,
  });

  notifee.createChannel({
    id: 'delivery',
    name: 'Delivery Notifications',
    importance: AndroidImportance.HIGH,
    sound: 'delivery_notification',
    vibration: true,
    badge: true,
  });
}

console.log('✅ [FCM] Background handler registered');

// Register the main App component
registerRootComponent(App);
