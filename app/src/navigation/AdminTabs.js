import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { View, StyleSheet } from 'react-native';

import AdminHomeScreen from '../screens/admin/AdminHomeScreen';
import AdminOrdersScreen from '../screens/admin/AdminOrdersScreen';
import AdminMenuScreen from '../screens/admin/AdminMenuScreen';
import AdminReportsScreen from '../screens/admin/AdminReportsScreen';
import AdminDeliveryScreen from '../screens/admin/AdminDeliveryScreen';
import OrderDetailScreen from '../screens/admin/OrderDetailScreen';
import MenuItemFormScreen from '../screens/admin/MenuItemFormScreen';
import DeliveryFormScreen from '../screens/admin/DeliveryFormScreen';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

// Admin primary color
const ADMIN_PRIMARY = '#e63946';

function OrdersStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="OrdersList" component={AdminOrdersScreen} />
      <Stack.Screen name="OrderDetail" component={OrderDetailScreen} />
    </Stack.Navigator>
  );
}

function MenuStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="MenuList" component={AdminMenuScreen} />
      <Stack.Screen name="MenuItemForm" component={MenuItemFormScreen} />
    </Stack.Navigator>
  );
}

function DeliveryStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="DeliveryList" component={AdminDeliveryScreen} />
      <Stack.Screen name="DeliveryForm" component={DeliveryFormScreen} />
    </Stack.Navigator>
  );
}

export default function AdminTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: ADMIN_PRIMARY,
        tabBarInactiveTintColor: '#9ca3af',
        tabBarStyle: {
          backgroundColor: '#fff',
          borderTopWidth: 0,
          paddingBottom: 24,
          paddingTop: 12,
          height: 80,
          elevation: 20,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: -4 },
          shadowOpacity: 0.1,
          shadowRadius: 12,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
          marginTop: 4,
        },
        tabBarIcon: ({ focused, color, size }) => {
          let iconName;
          if (route.name === 'Home') iconName = focused ? 'home' : 'home-outline';
          else if (route.name === 'Orders') iconName = focused ? 'receipt' : 'receipt-outline';
          else if (route.name === 'Menu') iconName = focused ? 'restaurant' : 'restaurant-outline';
          else if (route.name === 'Reports') iconName = focused ? 'bar-chart' : 'bar-chart-outline';
          else if (route.name === 'Delivery') iconName = focused ? 'bicycle' : 'bicycle-outline';
          
          return (
            <View style={[styles.iconContainer, focused && styles.iconContainerActive]}>
              <Ionicons name={iconName} size={22} color={color} />
            </View>
          );
        },
      })}
    >
      <Tab.Screen name="Home" component={AdminHomeScreen} />
      <Tab.Screen name="Orders" component={OrdersStack} />
      <Tab.Screen name="Menu" component={MenuStack} />
      <Tab.Screen name="Reports" component={AdminReportsScreen} />
      <Tab.Screen name="Delivery" component={DeliveryStack} />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  iconContainer: {
    width: 40,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconContainerActive: {
    backgroundColor: '#fef2f2',
  },
});
