import 'react-native-gesture-handler';
import React, { useEffect, useRef, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { View, ActivityIndicator, StyleSheet, AppState } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { NavigationContainer, useNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import { NotificationProvider } from './src/context/NotificationContext';
import { DeliveryNotificationProvider } from './src/context/DeliveryNotificationContext';
import { ThemeProvider, useTheme } from './src/context/ThemeContext';
import RoleSelectScreen from './src/screens/RoleSelectScreen';
import AdminLoginScreen from './src/screens/admin/AdminLoginScreen';
import DeliveryLoginScreen from './src/screens/delivery/DeliveryLoginScreenRedesigned';
import AdminTabs from './src/navigation/AdminTabs';
import DeliveryTabs from './src/navigation/DeliveryTabsRedesigned';
import pushNotifications from './src/services/pushNotifications';
import preloadImages from './src/utils/imagePreloader';

const Stack = createNativeStackNavigator();

function AppNavigator({ navigationRef }) {
  const { user, role, loading } = useAuth();
  const { isDark } = useTheme();
  const appState = useRef(AppState.currentState);

  // Check if app was opened from a notification tap
  const checkInitialNotification = async () => {
    const response = await pushNotifications.getLastNotificationResponse();
    if (response) {
      const data = response.notification.request.content.data;
      console.log('📱 App opened from notification:', data);

      if (data?.type === 'new_order' && data?.screen && role === 'delivery') {
        setTimeout(() => {
          if (navigationRef?.current) {
            navigationRef.current.navigate('DeliveryMain', {
              screen: 'MyOrders',
            });
          }
        }, 500);
      }
    }
  };

  useEffect(() => {
    let responseSubscription = null;
    let receivedSubscription = null;

    // Only set up listeners if push notifications are supported
    if (pushNotifications.isSupported()) {
      responseSubscription = pushNotifications.addNotificationResponseListener((response) => {
        const data = response.notification.request.content.data;
        console.log('📱 Notification tapped:', data);

        if (data?.type === 'new_order' && data?.screen) {
          if (navigationRef?.current && role === 'delivery') {
            navigationRef.current.navigate('DeliveryMain', {
              screen: 'MyOrders',
            });
          }
        }
      });

      receivedSubscription = pushNotifications.addNotificationReceivedListener((notification) => {
        console.log('📱 Notification received in foreground:', notification.request.content);
      });

      checkInitialNotification();
    }

    const subscription = AppState.addEventListener('change', (nextAppState) => {
      if (appState.current.match(/inactive|background/) && nextAppState === 'active') {
        console.log('📱 App came to foreground');
      }
      appState.current = nextAppState;
    });

    return () => {
      if (responseSubscription) {
        pushNotifications.removeNotificationListener(responseSubscription);
      }
      if (receivedSubscription) {
        pushNotifications.removeNotificationListener(receivedSubscription);
      }
      subscription?.remove();
    };
  }, [navigationRef, role]);

  if (loading) {
    return null;
  }

  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
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
    </>
  );
}

function RootApp() {
  const navigationRef = useNavigationContainerRef();
  const { isDark } = useTheme();
  const [imagesLoaded, setImagesLoaded] = useState(false);

  useEffect(() => {
    const loadAssets = async () => {
      await preloadImages();
      setImagesLoaded(true);
    };
    loadAssets();
  }, []);

  if (!imagesLoaded) {
    return (
      <View style={styles.loadingContainer}>
        <StatusBar style={isDark ? 'light' : 'dark'} />
        <ActivityIndicator size="large" color="#FF6B35" />
      </View>
    );
  }

  return (
    <NavigationContainer ref={navigationRef}>
      <AppNavigator navigationRef={navigationRef} />
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider>
        <AuthProvider>
          <NotificationProvider>
            <DeliveryNotificationProvider>
              <RootApp />
            </DeliveryNotificationProvider>
          </NotificationProvider>
        </AuthProvider>
      </ThemeProvider>
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
