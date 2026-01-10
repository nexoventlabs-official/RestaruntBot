import React, { useEffect, useRef } from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import RoleSelectScreen from './src/screens/RoleSelectScreen';
import AdminLoginScreen from './src/screens/admin/AdminLoginScreen';
import DeliveryLoginScreen from './src/screens/delivery/DeliveryLoginScreen';
import AdminTabs from './src/navigation/AdminTabs';
import DeliveryTabs from './src/navigation/DeliveryTabs';
import pushNotifications from './src/services/pushNotifications';

const Stack = createNativeStackNavigator();

function AppNavigator() {
  const { user, role, loading } = useAuth();
  const navigationRef = useRef(null);

  useEffect(() => {
    let responseSubscription = null;
    let receivedSubscription = null;

    // Only set up listeners if push notifications are supported
    if (pushNotifications.isSupported()) {
      // Handle notification tap - navigate to appropriate screen
      responseSubscription = pushNotifications.addNotificationResponseListener(response => {
        const data = response.notification.request.content.data;
        
        if (data?.type === 'new_order' && data?.screen) {
          // Navigate to MyOrders screen when notification is tapped
          if (navigationRef.current && role === 'delivery') {
            navigationRef.current.navigate('DeliveryMain', {
              screen: 'MyOrders',
            });
          }
        }
      });

      // Handle notification received while app is open
      receivedSubscription = pushNotifications.addNotificationReceivedListener(notification => {
        console.log('📱 Notification received:', notification);
      });
    }

    return () => {
      if (responseSubscription) {
        pushNotifications.removeNotificationListener(responseSubscription);
      }
      if (receivedSubscription) {
        pushNotifications.removeNotificationListener(receivedSubscription);
      }
    };
  }, [role]);

  if (loading) {
    return null;
  }

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
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

  return (
    <AuthProvider>
      <NavigationContainer ref={navigationRef}>
        <StatusBar style="light" />
        <AppNavigator />
      </NavigationContainer>
    </AuthProvider>
  );
}
