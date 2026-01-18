import React from 'react';
import { View, Platform, Text, StyleSheet } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import Animated, {
  useAnimatedStyle,
  withSpring,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

import { useTheme } from '../context/ThemeContext';
import { useDeliveryNotifications } from '../context/DeliveryNotificationContext';

// Redesigned Screens
import DeliveryHomeScreen from '../screens/delivery/DeliveryHomeScreenRedesigned';
import MyOrdersScreen from '../screens/delivery/MyOrdersScreenRedesigned';
import DeliveryHistoryScreen from '../screens/delivery/DeliveryHistoryScreenRedesigned';
import DeliveryProfileScreen from '../screens/delivery/DeliveryProfileScreenRedesigned';

// Detail / auxiliary screens (functionality preserved)
import DeliveryOrderDetailScreen from '../screens/delivery/DeliveryOrderDetailScreen';
import MapNavigationScreen from '../screens/delivery/MapNavigationScreen';
import DeliveryNotificationsScreen from '../screens/delivery/DeliveryNotificationsScreen';
import DeliveryHelpSupportScreen from '../screens/delivery/DeliveryHelpSupportScreen';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

const TabIcon = ({ name, focused, color, badgeCount }) => {
  const scale = useSharedValue(1);

  React.useEffect(() => {
    if (focused) {
      scale.value = withSequence(withTiming(1.18, { duration: 100 }), withSpring(1, { damping: 10 }));
    }
  }, [focused]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <View style={styles.iconWrap}>
      <Animated.View style={animatedStyle}>
        <Ionicons name={name} size={24} color={color} />
      </Animated.View>
      {badgeCount > 0 ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badgeCount > 99 ? '99+' : badgeCount}</Text>
        </View>
      ) : null}
    </View>
  );
};

const TabBarBackground = ({ isDark }) =>
  Platform.OS === 'ios' ? (
    <BlurView intensity={80} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
  ) : null;

function HomeStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
      <Stack.Screen name="HomeMain" component={DeliveryHomeScreen} />
      <Stack.Screen name="Notifications" component={DeliveryNotificationsScreen} />
    </Stack.Navigator>
  );
}

function MyOrdersStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
      <Stack.Screen name="MyOrdersList" component={MyOrdersScreen} />
      <Stack.Screen name="DeliveryOrderDetail" component={DeliveryOrderDetailScreen} />
      <Stack.Screen name="MapNavigation" component={MapNavigationScreen} />
    </Stack.Navigator>
  );
}

function HistoryStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
      <Stack.Screen name="HistoryList" component={DeliveryHistoryScreen} />
      <Stack.Screen name="DeliveryOrderDetail" component={DeliveryOrderDetailScreen} />
      <Stack.Screen name="MapNavigation" component={MapNavigationScreen} />
    </Stack.Navigator>
  );
}

function ProfileStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
      <Stack.Screen name="ProfileMain" component={DeliveryProfileScreen} />
      <Stack.Screen name="Notifications" component={DeliveryNotificationsScreen} />
      <Stack.Screen name="HelpSupport" component={DeliveryHelpSupportScreen} />
    </Stack.Navigator>
  );
}

export default function DeliveryTabs() {
  const { theme } = useTheme();
  const { newOrdersCount, clearNewOrdersCount } = useDeliveryNotifications();

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: theme.palette.primary[400],
        tabBarInactiveTintColor: theme.colors.text.tertiary,
        tabBarStyle: {
          position: 'absolute',
          backgroundColor: Platform.OS === 'ios' ? 'transparent' : theme.colors.surface,
          borderTopWidth: 0,
          elevation: 0,
          height: Platform.OS === 'ios' ? 88 : 68,
          paddingBottom: Platform.OS === 'ios' ? 28 : 12,
          paddingTop: 12,
          ...Platform.select({
            ios: {
              shadowColor: '#000',
              shadowOffset: { width: 0, height: -4 },
              shadowOpacity: theme.isDark ? 0.18 : 0.08,
              shadowRadius: 12,
            },
            android: {
              elevation: 12,
            },
          }),
        },
        tabBarBackground: () => <TabBarBackground isDark={theme.isDark} />,
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '700',
          marginTop: 4,
        },
        tabBarIcon: ({ focused, color }) => {
          let iconName;
          let badge = 0;

          if (route.name === 'Home') iconName = focused ? 'home' : 'home-outline';
          else if (route.name === 'MyOrders') {
            iconName = focused ? 'bicycle' : 'bicycle-outline';
            badge = newOrdersCount;
          } else if (route.name === 'History') iconName = focused ? 'time' : 'time-outline';
          else if (route.name === 'Profile') iconName = focused ? 'person' : 'person-outline';

          return <TabIcon name={iconName} focused={focused} color={color} badgeCount={badge} />;
        },
      })}
      screenListeners={({ route }) => ({
        tabPress: () => {
          Haptics.selectionAsync();
          if (route.name === 'MyOrders' && newOrdersCount > 0) {
            clearNewOrdersCount();
          }
        },
      })}
    >
      <Tab.Screen name="Home" component={HomeStack} options={{ tabBarLabel: 'Home' }} />
      <Tab.Screen name="MyOrders" component={MyOrdersStack} options={{ tabBarLabel: 'Orders' }} />
      <Tab.Screen name="History" component={HistoryStack} options={{ tabBarLabel: 'History' }} />
      <Tab.Screen name="Profile" component={ProfileStack} options={{ tabBarLabel: 'Profile' }} />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  iconWrap: {
    width: 28,
    height: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
  badge: {
    position: 'absolute',
    top: -6,
    right: -10,
    backgroundColor: '#E23744',
    borderRadius: 10,
    minWidth: 18,
    height: 18,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
    borderWidth: 2,
    borderColor: '#fff',
  },
  badgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '800',
  },
});
