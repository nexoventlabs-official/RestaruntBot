import React, { useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity, Linking, Animated, Platform, StatusBar
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, typography, shadows } from '../../theme';

// Delivery Theme Colors
const DELIVERY_GREEN = '#267E3E';
const DELIVERY_DARK_GREEN = '#1B5E2E';

const STATUS_CONFIG = {
  ready: { color: '#10B981', bg: '#D1FAE5', label: 'Ready for Pickup', icon: 'checkmark-circle' },
  out_for_delivery: { color: '#06B6D4', bg: '#CFFAFE', label: 'Out for Delivery', icon: 'bicycle' },
  delivered: { color: '#22C55E', bg: '#DCFCE7', label: 'Delivered', icon: 'checkmark-done-circle' },
};

export default function DeliveryOrderDetailScreen({ route, navigation }) {
  const { order } = route.params;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;

  const statusConfig = STATUS_CONFIG[order.status] || STATUS_CONFIG.ready;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 400, useNativeDriver: true }),
    ]).start();
  }, []);

  const openMapNavigation = () => {
    const address = order.deliveryAddress?.address || order.customer?.address;
    const lat = order.deliveryAddress?.latitude;
    const lng = order.deliveryAddress?.longitude;

    if (lat && lng) {
      navigation.navigate('MapNavigation', {
        destination: { latitude: lat, longitude: lng },
        destinationAddress: address,
        customerName: order.customer?.name,
      });
    } else if (address) {
      // If no coordinates, open in external OSM
      Linking.openURL(`https://www.openstreetmap.org/search?query=${encodeURIComponent(address)}`);
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />
      {/* Premium Header */}
      <Animated.View style={{ opacity: fadeAnim }}>
        <View style={styles.headerBg}>
          <LinearGradient
            colors={[DELIVERY_GREEN + 'E6', DELIVERY_DARK_GREEN + 'F2']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.header}
          >
            <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
              <Ionicons name="arrow-back" size={24} color="#fff" />
            </TouchableOpacity>
            <View style={styles.headerCenter}>
              <Text style={styles.headerTitle}>Order #{order.orderId}</Text>
              <View style={[styles.statusBadgeSmall, { backgroundColor: 'rgba(255,255,255,0.2)' }]}>
                <Ionicons name={statusConfig.icon} size={14} color="#fff" />
                <Text style={styles.statusBadgeSmallText}>{statusConfig.label}</Text>
              </View>
            </View>
            <View style={{ width: 44 }} />
          </LinearGradient>
        </View>
      </Animated.View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>
          {/* Status Card */}
          <View style={styles.statusCard}>
            <View style={[styles.statusIconContainer, { backgroundColor: statusConfig.bg }]}>
              <Ionicons name={statusConfig.icon} size={32} color={statusConfig.color} />
            </View>
            <Text style={[styles.statusText, { color: statusConfig.color }]}>{statusConfig.label}</Text>
            {order.deliveredAt && (
              <Text style={styles.deliveredTime}>
                Delivered on {new Date(order.deliveredAt).toLocaleString('en-IN')}
              </Text>
            )}
          </View>

          {/* Customer Details */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Ionicons name="person" size={18} color={DELIVERY_GREEN} />
              <Text style={styles.sectionTitle}>Customer Details</Text>
            </View>
            <View style={styles.cardBg}>
              <View style={styles.card}>
                <View style={styles.customerRow}>
                  <View style={styles.customerAvatar}>
                    <Ionicons name="person" size={24} color="#fff" />
                  </View>
                  <View style={styles.customerInfo}>
                    <Text style={styles.customerName}>{order.customer?.name || 'Customer'}</Text>
                    <TouchableOpacity
                      style={styles.phoneButton}
                      onPress={() => Linking.openURL(`tel:${order.customer?.phone}`)}
                    >
                      <Ionicons name="call" size={16} color={DELIVERY_GREEN} />
                      <Text style={styles.phoneText}>{order.customer?.phone}</Text>
                    </TouchableOpacity>
                  </View>
                  <TouchableOpacity
                    style={styles.callButton}
                    onPress={() => Linking.openURL(`tel:${order.customer?.phone}`)}
                  >
                    <Ionicons name="call" size={20} color="#fff" />
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </View>

          {/* Delivery Address */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Ionicons name="location" size={18} color={DELIVERY_GREEN} />
              <Text style={styles.sectionTitle}>Delivery Address</Text>
            </View>
            <View style={styles.cardBg}>
              <TouchableOpacity style={styles.addressCard} onPress={openMapNavigation} activeOpacity={0.8}>
                <View style={styles.addressContent}>
                  <View style={styles.addressIconContainer}>
                    <Ionicons name="location" size={24} color={DELIVERY_GREEN} />
                  </View>
                  <Text style={styles.addressText}>
                    {order.deliveryAddress?.address || order.customer?.address || 'N/A'}
                  </Text>
                </View>
                <LinearGradient
                  colors={[DELIVERY_GREEN, DELIVERY_DARK_GREEN]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.navigateButton}
                >
                  <Ionicons name="navigate" size={20} color="#fff" />
                  <Text style={styles.navigateButtonText}>Navigate</Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </View>

          {/* Order Items */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Ionicons name="receipt" size={18} color={DELIVERY_GREEN} />
              <Text style={styles.sectionTitle}>Order Items</Text>
              <View style={styles.itemCountBadge}>
                <Text style={styles.itemCountText}>{order.items?.length || 0}</Text>
              </View>
            </View>
            <View style={styles.cardBg}>
              <View style={styles.card}>
                {order.items?.map((item, index) => (
                  <View key={index} style={[styles.itemRow, index > 0 && styles.itemBorder]}>
                    <View style={styles.itemInfo}>
                      <Text style={styles.itemName}>{item.name}</Text>
                      <Text style={styles.itemQty}>Qty: {item.quantity}</Text>
                    </View>
                    <Text style={styles.itemPrice}>₹{item.price * item.quantity}</Text>
                  </View>
                ))}
                <View style={styles.totalRow}>
                  <Text style={styles.totalLabel}>Total Amount</Text>
                  <Text style={styles.totalAmount}>₹{order.totalAmount}</Text>
                </View>
              </View>
            </View>
          </View>

          {/* Payment Info */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Ionicons name="card" size={18} color={DELIVERY_GREEN} />
              <Text style={styles.sectionTitle}>Payment Info</Text>
            </View>
            <View style={styles.cardBg}>
              <View style={styles.card}>
                <View style={styles.paymentRow}>
                  <Text style={styles.paymentLabel}>Method</Text>
                  <View style={styles.paymentMethodBadge}>
                    <Ionicons
                      name={order.paymentMethod === 'cod' ? 'cash' : 'phone-portrait'}
                      size={16}
                      color={order.paymentMethod === 'cod' ? '#F59E0B' : '#8B5CF6'}
                    />
                    <Text style={[styles.paymentMethodText, { color: order.paymentMethod === 'cod' ? '#F59E0B' : '#8B5CF6' }]}>
                      {order.paymentMethod === 'cod' ? 'Cash on Delivery' : 'UPI (Prepaid)'}
                    </Text>
                  </View>
                </View>
                <View style={styles.paymentRow}>
                  <Text style={styles.paymentLabel}>Status</Text>
                  <View style={[styles.paymentStatusBadge, { backgroundColor: order.paymentStatus === 'paid' ? '#DCFCE7' : '#FEF3C7' }]}>
                    <Text style={[styles.paymentStatusText, { color: order.paymentStatus === 'paid' ? '#16A34A' : '#D97706' }]}>
                      {order.paymentStatus?.toUpperCase()}
                    </Text>
                  </View>
                </View>
                {order.actualPaymentMethod && (
                  <View style={styles.paymentRow}>
                    <Text style={styles.paymentLabel}>Collected via</Text>
                    <Text style={styles.paymentValue}>{order.actualPaymentMethod.toUpperCase()}</Text>
                  </View>
                )}
              </View>
            </View>
          </View>

          {/* Timeline */}
          {order.trackingUpdates?.length > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Ionicons name="time" size={18} color={DELIVERY_GREEN} />
                <Text style={styles.sectionTitle}>Timeline</Text>
              </View>
              <View style={styles.card}>
                {order.trackingUpdates.map((update, index) => (
                  <View key={index} style={styles.timelineItem}>
                    <View style={styles.timelineLeft}>
                      <View style={[styles.timelineDot, index === 0 && styles.timelineDotActive]} />
                      {index < order.trackingUpdates.length - 1 && <View style={styles.timelineLine} />}
                    </View>
                    <View style={styles.timelineContent}>
                      <Text style={styles.timelineMessage}>{update.message}</Text>
                      <Text style={styles.timelineTime}>
                        {new Date(update.timestamp).toLocaleString('en-IN')}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            </View>
          )}
        </Animated.View>
        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}


const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F8F8' },

  // Header
  headerBg: { borderBottomLeftRadius: 28, borderBottomRightRadius: 28, overflow: 'hidden' },
  header: {
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight + 20 : 60,
    paddingBottom: 20,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backButton: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center', alignItems: 'center',
  },
  headerCenter: { alignItems: 'center' },
  headerTitle: { fontSize: 20, fontWeight: '700', color: '#fff' },
  statusBadgeSmall: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, marginTop: 6,
  },
  statusBadgeSmallText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  content: { flex: 1, padding: 16 },

  // Status Card
  statusCard: {
    backgroundColor: '#fff', borderRadius: 20, padding: 24, alignItems: 'center', marginBottom: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.06, shadowRadius: 12, elevation: 4,
  },
  statusIconContainer: { width: 72, height: 72, borderRadius: 36, justifyContent: 'center', alignItems: 'center', marginBottom: 12 },
  statusText: { fontSize: 18, fontWeight: '800' },
  deliveredTime: { color: '#696969', marginTop: 8, fontSize: 13 },

  // Section
  section: { marginBottom: 16 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#1C1C1C' },
  itemCountBadge: {
    backgroundColor: DELIVERY_GREEN, width: 24, height: 24, borderRadius: 12,
    justifyContent: 'center', alignItems: 'center', marginLeft: 'auto',
  },
  itemCountText: { color: '#fff', fontSize: 12, fontWeight: '700' },

  // Card
  cardBg: { borderRadius: 16, overflow: 'hidden', ...shadows.card, backgroundColor: '#fff' },
  card: { padding: 16, backgroundColor: colors.light.surface },

  // Customer
  customerRow: { flexDirection: 'row', alignItems: 'center' },
  customerAvatar: {
    width: 52, height: 52, borderRadius: 26, backgroundColor: DELIVERY_GREEN,
    justifyContent: 'center', alignItems: 'center',
  },
  customerInfo: { flex: 1, marginLeft: 14 },
  customerName: { fontSize: 16, fontWeight: '700', color: '#1C1C1C' },
  phoneButton: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  phoneText: { fontSize: 14, color: DELIVERY_GREEN, fontWeight: '600' },
  callButton: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: DELIVERY_GREEN,
    justifyContent: 'center', alignItems: 'center',
    shadowColor: DELIVERY_GREEN, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 4,
  },

  // Address
  addressCard: { padding: 16, backgroundColor: colors.light.surface },
  addressContent: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 16 },
  addressIconContainer: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: '#E8F5E9',
    justifyContent: 'center', alignItems: 'center',
  },
  addressText: { flex: 1, fontSize: 14, color: '#1C1C1C', lineHeight: 22, fontWeight: '500' },
  navigateButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 14, borderRadius: 14,
  },
  navigateButtonText: { color: '#fff', fontSize: 16, fontWeight: '700' },

  // Items
  itemRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14 },
  itemBorder: { borderTopWidth: 1, borderTopColor: '#F5F5F5' },
  itemInfo: { flex: 1 },
  itemName: { fontSize: 15, fontWeight: '600', color: '#1C1C1C' },
  itemQty: { fontSize: 13, color: '#696969', marginTop: 2 },
  itemPrice: { fontSize: 15, fontWeight: '700', color: '#1C1C1C' },
  totalRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    borderTopWidth: 2, borderTopColor: '#F0F0F0', paddingTop: 14, marginTop: 8,
  },
  totalLabel: { fontSize: 16, fontWeight: '700', color: '#1C1C1C' },
  totalAmount: { fontSize: 20, fontWeight: '800', color: DELIVERY_GREEN },

  // Payment
  paymentRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10 },
  paymentLabel: { fontSize: 14, color: '#696969', fontWeight: '500' },
  paymentValue: { fontSize: 14, fontWeight: '700', color: '#1C1C1C' },
  paymentMethodBadge: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  paymentMethodText: { fontSize: 14, fontWeight: '600' },
  paymentStatusBadge: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  paymentStatusText: { fontSize: 12, fontWeight: '700' },

  // Timeline
  timelineItem: { flexDirection: 'row', minHeight: 60 },
  timelineLeft: { alignItems: 'center', width: 24 },
  timelineDot: {
    width: 12, height: 12, borderRadius: 6, backgroundColor: '#D1D5DB', marginTop: 4,
  },
  timelineDotActive: { backgroundColor: DELIVERY_GREEN },
  timelineLine: {
    width: 2, flex: 1, backgroundColor: '#E5E7EB', marginVertical: 4,
  },
  timelineContent: { flex: 1, paddingLeft: 12, paddingBottom: 16 },
  timelineMessage: { fontSize: 14, fontWeight: '600', color: '#1C1C1C' },
  timelineTime: { fontSize: 12, color: '#9CA3AF', marginTop: 4 },
});
