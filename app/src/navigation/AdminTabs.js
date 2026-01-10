import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { View, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import AdminHomeScreen from '../screens/admin/AdminHomeScreen';
import AdminOrdersScreen from '../screens/admin/AdminOrdersScreen';
import AdminMenuScreen from '../screens/admin/AdminMenuScreen';
import AdminReportsScreen from '../screens/admin/AdminReportsScreen';
import AdminDeliveryScreen from '../screens/admin/AdminDeliveryScreen';
import OrderDetailScreen from '../screens/admin/OrderDetailScreen';
import MenuItemFormScreen from '../screens/admin/MenuItemFormScreen';
import DeliveryFormScreen from '../screens/admin/DeliveryFormScreen';
import AdminOffersScreen from '../screens/admin/AdminOffersScreen';
import OfferFormScreen from '../screens/admin/OfferFormScreen';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

// Admin primary colors
const ADMIN_PRIMARY = '#E23744';
const ADMIN_DARK = '#CB1A27';

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

function OffersStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="OffersList" component={AdminOffersScreen} />
      <Stack.Screen name="OfferForm" component={OfferFormScreen} />
    </Stack.Navigator>
  );
}

// Custom center button component
const CenterTabButton = ({ children, onPress }) => (
  <TouchableOpacity
    style={styles.centerButtonContainer}
    onPress={onPress}
    activeOpacity={0.9}
  >
    <LinearGradient
      colors={[ADMIN_PRIMARY, ADMIN_DARK]}
      style={styles.centerButton}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
    >
      {children}
    </LinearGradient>
  </TouchableOpacity>
);

// Custom Tab Bar Component
const CustomTabBar = ({ state, descriptors, navigation }) => {
  return (
    <View style={styles.tabBarWrapper}>
      <View style={styles.tabBarContainer}>
        {state.routes.map((route, index) => {
          const { options } = descriptors[route.key];
          const isFocused = state.index === index;
          const isCenter = index === 2; // Menu is the center tab

          const onPress = () => {
            const event = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });

            if (!isFocused && !event.defaultPrevented) {
              navigation.navigate(route.name);
            }
          };

          let iconName;
          if (route.name === 'Home') iconName = isFocused ? 'home' : 'home-outline';
          else if (route.name === 'Orders') iconName = isFocused ? 'receipt' : 'receipt-outline';
          else if (route.name === 'Menu') iconName = 'restaurant';
          else if (route.name === 'Offers') iconName = isFocused ? 'pricetag' : 'pricetag-outline';
          else if (route.name === 'Delivery') iconName = isFocused ? 'bicycle' : 'bicycle-outline';

          if (isCenter) {
            return (
              <CenterTabButton key={route.key} onPress={onPress}>
                <Ionicons name={iconName} size={26} color="#fff" />
              </CenterTabButton>
            );
          }

          return (
            <TouchableOpacity
              key={route.key}
              onPress={onPress}
              style={styles.tabButton}
              activeOpacity={0.7}
            >
              <View style={[styles.iconWrapper, isFocused && styles.iconWrapperActive]}>
                <Ionicons
                  name={iconName}
                  size={22}
                  color={isFocused ? ADMIN_PRIMARY : '#9CA3AF'}
                />
              </View>
              <View style={[styles.labelContainer, isFocused && styles.labelContainerActive]}>
                <View style={styles.labelDot} />
              </View>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
};

export default function AdminTabs() {
  return (
    <Tab.Navigator
      tabBar={(props) => <CustomTabBar {...props} />}
      screenOptions={{
        headerShown: false,
      }}
    >
      <Tab.Screen name="Home" component={AdminHomeScreen} />
      <Tab.Screen name="Orders" component={OrdersStack} />
      <Tab.Screen name="Menu" component={MenuStack} />
      <Tab.Screen name="Offers" component={OffersStack} />
      <Tab.Screen name="Delivery" component={DeliveryStack} />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  tabBarWrapper: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: Platform.OS === 'ios' ? 28 : 16,
  },
  tabBarContainer: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 28,
    height: 70,
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: 8,
    width: '100%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 20,
  },
  tabButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
  },
  iconWrapper: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconWrapperActive: {
    backgroundColor: '#FEF2F2',
  },
  labelContainer: {
    marginTop: 4,
    opacity: 0,
  },
  labelContainerActive: {
    opacity: 1,
  },
  labelDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: ADMIN_PRIMARY,
  },
  centerButtonContainer: {
    top: -20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  centerButton: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: ADMIN_PRIMARY,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 12,
  },
});
