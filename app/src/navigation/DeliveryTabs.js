import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';

import DeliveryHomeScreen from '../screens/delivery/DeliveryHomeScreen';
import MyOrdersScreen from '../screens/delivery/MyOrdersScreen';
import DeliveryHistoryScreen from '../screens/delivery/DeliveryHistoryScreen';
import DeliveryProfileScreen from '../screens/delivery/DeliveryProfileScreen';
import DeliveryOrderDetailScreen from '../screens/delivery/DeliveryOrderDetailScreen';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

function MyOrdersStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="MyOrdersList" component={MyOrdersScreen} />
      <Stack.Screen name="DeliveryOrderDetail" component={DeliveryOrderDetailScreen} />
    </Stack.Navigator>
  );
}

function HistoryStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="HistoryList" component={DeliveryHistoryScreen} />
      <Stack.Screen name="DeliveryOrderDetail" component={DeliveryOrderDetailScreen} />
    </Stack.Navigator>
  );
}

export default function DeliveryTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: '#2a9d8f',
        tabBarInactiveTintColor: '#61636b',
        tabBarStyle: {
          backgroundColor: '#fff',
          borderTopWidth: 1,
          borderTopColor: '#e5e7eb',
          paddingBottom: 8,
          paddingTop: 8,
          height: 60,
        },
        tabBarIcon: ({ focused, color, size }) => {
          let iconName;
          if (route.name === 'Home') iconName = focused ? 'home' : 'home-outline';
          else if (route.name === 'MyOrders') iconName = focused ? 'bicycle' : 'bicycle-outline';
          else if (route.name === 'History') iconName = focused ? 'time' : 'time-outline';
          else if (route.name === 'Profile') iconName = focused ? 'person' : 'person-outline';
          return <Ionicons name={iconName} size={size} color={color} />;
        },
      })}
    >
      <Tab.Screen name="Home" component={DeliveryHomeScreen} />
      <Tab.Screen name="MyOrders" component={MyOrdersStack} options={{ title: 'My Orders' }} />
      <Tab.Screen name="History" component={HistoryStack} />
      <Tab.Screen name="Profile" component={DeliveryProfileScreen} />
    </Tab.Navigator>
  );
}
