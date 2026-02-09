import 'react-native-gesture-handler';
import React, { useEffect, useRef, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { View, ActivityIndicator, StyleSheet, Platform } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import { NotificationProvider } from './src/context/NotificationContext';
import { DeliveryNotificationProvider } from './src/context/DeliveryNotificationContext';
import RoleSelectScreen from './src/screens/RoleSelectScreen';
import AdminLoginScreen from './src/screens/admin/AdminLoginScreen';
import DeliveryLoginScreen from './src/screens/delivery/DeliveryLoginScreen';
import AdminTabs from './src/navigation/AdminTabs';
import DeliveryTabs from './src/navigation/DeliveryTabs';
import pushNotifications from './src/services/pushNotifications';
import preloadImages from './src/utils/imagePreloader';

const Stack = createNativeStackNavigator();

function AppNavigator() {
  const { user, role, loading } = useAuth();
  const navigationRef = useRef(null);

  useEffect(() => {
    let responseSubscription = null;
    let receivedSubscription = null;
    let fcmUnsubscribe = null;

    // Only set up listeners if push notifications are supported
    if (pushNotifications.isSupported()) {
      // Handle notification tap - navigate to Notifications screen
      responseSubscription = pushNotifications.addNotificationResponseListener(response => {
        const data = response.notification.request.content.data;
        console.log('📱 Notification tapped:', data);
        
        // Navigate based on notification type
        if (navigationRef.current) {
          if (role === 'delivery') {
            navigationRef.current.navigate('DeliveryMain', {
              screen: 'Home',
              params: {
                screen: 'Notifications',
              },
            });
          } else if (role === 'admin') {
            // Route offer template notifications to Offers screen
            if (data?.type === 'offer_template_status') {
              navigationRef.current.navigate('AdminMain', {
                screen: 'Offers',
                params: { screen: 'OffersList' },
              });
            } else if (data?.screen === 'Orders' || data?.type === 'new_order' || data?.type === 'order_cancelled') {
              navigationRef.current.navigate('AdminMain', {
                screen: 'Orders',
                params: { screen: 'OrdersList' },
              });
            } else {
              navigationRef.current.navigate('AdminMain', {
                screen: 'Home',
                params: {
                  screen: 'Notifications',
                },
              });
            }
          }
        }
      });

      // Handle expo-notifications received while app is open (foreground)
      receivedSubscription = pushNotifications.addNotificationReceivedListener(notification => {
        console.log('📱 Notification received in foreground:', notification.request.content);
      });

      /**
       * FCM foreground message handler.
       * When app is in foreground, Firebase SDK intercepts the notification
       * payload and does NOT show it in the notification tray automatically.
       * We create a local notification via expo-notifications to display it,
       * using the correct channel from the data payload so the notification
       * inherits the right sound / vibration / priority settings.
       */
      try {
        const messaging = require('@react-native-firebase/messaging').default;
        fcmUnsubscribe = messaging().onMessage(async remoteMessage => {
          console.log('📱 [FCM] Foreground message:', JSON.stringify(remoteMessage));
          
          const { notification, data } = remoteMessage;
          if (notification) {
            const channelId = data?.channelId || 'default';

            // Display as local notification via expo-notifications
            const Notifications = require('expo-notifications');
            await Notifications.scheduleNotificationAsync({
              content: {
                title: notification.title || 'New Notification',
                body: notification.body || '',
                data: data || {},
                sound: 'default',
                priority: Notifications.AndroidNotificationPriority.MAX,
                ...(Platform.OS === 'android' ? { channelId } : {}),
              },
              trigger: null, // Immediate
            });

            // Update badge count
            if (data?.badgeCount) {
              try {
                await Notifications.setBadgeCountAsync(parseInt(data.badgeCount, 10));
              } catch (_) { /* non-critical */ }
            }
          }
        });
      } catch (e) {
        console.warn('⚠️ FCM onMessage not available:', e.message);
      }

      // Check if app was opened from a notification
      checkInitialNotification();
    }

    return () => {
      if (responseSubscription) {
        pushNotifications.removeNotificationListener(responseSubscription);
      }
      if (receivedSubscription) {
        pushNotifications.removeNotificationListener(receivedSubscription);
      }
      if (fcmUnsubscribe) {
        fcmUnsubscribe();
      }
    };
  }, [role]);

  // Check if app was opened from a notification tap
  const checkInitialNotification = async () => {
    // First check expo-notifications (for local notifications)
    const response = await pushNotifications.getLastNotificationResponse();
    if (response) {
      const data = response.notification.request.content.data;
      console.log('📱 App opened from expo notification:', data);
      navigateToNotifications();
      return;
    }

    // Then check Firebase initial notification (for FCM notifications when app was killed)
    try {
      const messaging = require('@react-native-firebase/messaging').default;
      const remoteMessage = await messaging().getInitialNotification();
      if (remoteMessage) {
        console.log('📱 App opened from FCM notification (killed state):', remoteMessage.data);
        navigateToNotifications();
      }
    } catch (e) {
      // Firebase not available
    }
  };

  // Navigate to notifications screen based on role
  const navigateToNotifications = () => {
    setTimeout(() => {
      if (navigationRef.current) {
        if (role === 'delivery') {
          navigationRef.current.navigate('DeliveryMain', {
            screen: 'Home',
            params: {
              screen: 'Notifications',
            },
          });
        } else if (role === 'admin') {
          navigationRef.current.navigate('AdminMain', {
            screen: 'Home',
            params: {
              screen: 'Notifications',
            },
          });
        }
      }
    }, 500);
  };

  if (loading) {
    return null;
  }

  return (
    <Stack.Navigator 
      screenOptions={{ 
        headerShown: false,
        gestureEnabled: true,
        gestureDirection: 'horizontal',
        animation: 'slide_from_right',
        fullScreenGestureEnabled: true,
      }}
    >
      {!user ? (
        <>
          <Stack.Screen name="RoleSelect" component={RoleSelectScreen} />
          <Stack.Screen name="AdminLogin" component={AdminLoginScreen} />
          <Stack.Screen name="DeliveryLogin" component={DeliveryLoginScreen} />
        </>
      ) : role === 'admin' ? (
        <Stack.Screen name="AdminMain" component={AdminTabs} />
      ) : (
        <Stack.Screen name="DeliveryMain" component={DeliveryTabs} />
      )}
    </Stack.Navigator>
  );
}

export default function App() {
  const navigationRef = useRef(null);
  const [imagesLoaded, setImagesLoaded] = useState(false);

  useEffect(() => {
    const loadAssets = async () => {
      await preloadImages();
      setImagesLoaded(true);
    };
    loadAssets();
  }, []);

  // Show loading screen while images are preloading
  if (!imagesLoaded) {
    return (
      <View style={styles.loadingContainer}>
        <StatusBar style="light" />
        <ActivityIndicator size="large" color="#FF6B35" />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AuthProvider>
        <NotificationProvider>
          <DeliveryNotificationProvider>
            <NavigationContainer ref={navigationRef}>
              <StatusBar style="light" />
              <AppNavigator />
            </NavigationContainer>
          </DeliveryNotificationProvider>
        </NotificationProvider>
      </AuthProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1a1a2e',
  },
});
