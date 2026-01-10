import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, FlatList,
  RefreshControl, TouchableOpacity, Alert, ActivityIndicator, Linking,
  Modal, Image, Animated, Platform, StatusBar
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import api from '../../config/api';
import { colors, spacing, radius, typography, shadows } from '../../theme';

const DELIVERY_GREEN = '#267E3E';
const DELIVERY_DARK_GREEN = '#1B5E2E';

const ProgressSteps = ({ status }) => {
  const steps = ['preparing', 'ready', 'out_for_delivery', 'delivered'];
  const currentIndex = steps.indexOf(status);
  return (
    <View style={styles.progressContainer}>
      {steps.map((step, index) => (
        <React.Fragment key={step}>
          <View style={[styles.progressDot, index <= currentIndex && styles.progressDotActive]}>
            {index < currentIndex && <Ionicons name="checkmark" size={10} color="#fff" />}
          </View>
          {index < steps.length - 1 && <View style={[styles.progressLine, index < currentIndex && styles.progressLineActive]} />}
        </React.Fragment>
      ))}
    </View>
  );
};

const STATUS_CONFIG = {
  preparing: { label: 'Preparing', color: '#8B5CF6', bg: '#EDE9FE' },
  ready: { label: 'Ready', color: '#10B981', bg: '#D1FAE5' },
  out_for_delivery: { label: 'Out for Delivery', color: '#06B6D4', bg: '#CFFAFE' },
};

export default function MyOrdersScreen({ navigation }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionLoading, setActionLoading] = useState(null);
  const [qrModal, setQrModal] = useState({ visible: false, qrUrl: null, orderId: null, amount: 0 });
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }).start();
  }, []);

  const fetchOrders = async () => {
    try {
      const response = await api.get('/delivery/orders/my');
      setOrders(response.data);
    } catch (error) { console.error('Error fetching orders:', error); }
    finally { setLoading(false); setRefreshing(false); }
  };

  useEffect(() => {
    fetchOrders();
    const unsubscribe = navigation.addListener('focus', fetchOrders);
    return unsubscribe;
  }, [navigation]);

  const onRefresh = useCallback(() => { setRefreshing(true); fetchOrders(); }, []);

  const openMapNavigation = (order) => {
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
      // If no coordinates, show alert - geocoding would require additional API
      Alert.alert(
        'No Coordinates',
        'This address does not have GPS coordinates. Would you like to open in external maps?',
        [
          { text: 'Cancel', style: 'cancel' },
          { 
            text: 'Open Maps', 
            onPress: () => Linking.openURL(`https://www.openstreetmap.org/search?query=${encodeURIComponent(address)}`)
          },
        ]
      );
    } else {
      Alert.alert('Error', 'No delivery address available');
    }
  };

  const markReady = async (orderId) => {
    setActionLoading(orderId);
    try { await api.post(`/delivery/orders/${orderId}/mark-ready`); Alert.alert('Success', 'Order marked as Ready'); fetchOrders(); }
    catch (error) { Alert.alert('Error', error.response?.data?.error || 'Failed to mark order as ready'); }
    finally { setActionLoading(null); }
  };

  const startDelivery = async (orderId) => {
    setActionLoading(orderId);
    try { await api.post(`/delivery/orders/${orderId}/out-for-delivery`); Alert.alert('Success', 'Order marked as Out for Delivery'); fetchOrders(); }
    catch (error) { Alert.alert('Error', error.response?.data?.error || 'Failed to update order'); }
    finally { setActionLoading(null); }
  };

  const markDelivered = async (order) => {
    if (order.paymentMethod === 'cod') {
      Alert.alert('Collect Payment', `Amount: ₹${order.totalAmount}\n\nHow was payment collected?`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Cash', onPress: () => completeDelivery(order.orderId, 'cash') },
        { text: 'UPI (QR)', onPress: () => generateQRCode(order) },
      ]);
    } else {
      Alert.alert('Confirm Delivery', 'Mark this order as delivered?', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Confirm', onPress: () => completeDelivery(order.orderId, null) },
      ]);
    }
  };

  const generateQRCode = async (order) => {
    setActionLoading(order.orderId);
    try {
      const response = await api.post(`/delivery/orders/${order.orderId}/generate-qr`);
      setQrModal({ visible: true, qrUrl: response.data.qrUrl, orderId: response.data.orderId, amount: response.data.amount });
    } catch (error) { Alert.alert('Error', error.response?.data?.error || 'Failed to generate QR code'); }
    finally { setActionLoading(null); }
  };

  const completeDelivery = async (orderId, collectionMethod) => {
    setActionLoading(orderId);
    try { await api.post(`/delivery/orders/${orderId}/delivered`, { collectionMethod }); Alert.alert('Success', 'Order delivered successfully!'); fetchOrders(); }
    catch (error) { Alert.alert('Error', error.response?.data?.error || 'Failed to complete delivery'); }
    finally { setActionLoading(null); }
  };

  const renderOrder = ({ item }) => {
    const statusConfig = STATUS_CONFIG[item.status] || STATUS_CONFIG.preparing;
    return (
      <Animated.View style={{ opacity: fadeAnim }}>
        <View style={styles.orderCard}>
          <ProgressSteps status={item.status} />

          <View style={styles.orderHeader}>
            <View>
              <Text style={styles.orderId}>#{item.orderId}</Text>
              <Text style={styles.orderTime}>{new Date(item.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</Text>
            </View>
            <View style={[styles.statusBadge, { backgroundColor: statusConfig.bg }]}>
              <Text style={[styles.statusText, { color: statusConfig.color }]}>{statusConfig.label}</Text>
            </View>
          </View>

          <View style={styles.customerCard}>
            <View style={styles.customerAvatar}><Ionicons name="person" size={18} color={DELIVERY_GREEN} /></View>
            <View style={styles.customerInfo}>
              <Text style={styles.customerName}>{item.customer?.name || 'Customer'}</Text>
              <TouchableOpacity onPress={() => Linking.openURL(`tel:${item.customer?.phone}`)} style={styles.phoneButton}>
                <Ionicons name="call" size={12} color={DELIVERY_GREEN} />
                <Text style={styles.phoneText}>{item.customer?.phone}</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity style={styles.callButton} onPress={() => Linking.openURL(`tel:${item.customer?.phone}`)}>
              <Ionicons name="call" size={18} color="#fff" />
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={styles.addressCard} onPress={() => openMapNavigation(item)} activeOpacity={0.8}>
            <View style={styles.addressIcon}><Ionicons name="location" size={18} color={DELIVERY_GREEN} /></View>
            <Text style={styles.addressText} numberOfLines={2}>{item.deliveryAddress?.address || item.customer?.address || 'N/A'}</Text>
            <View style={styles.navigateIcon}><Ionicons name="navigate" size={16} color={DELIVERY_GREEN} /></View>
          </TouchableOpacity>

          <View style={styles.itemsSection}>
            <View style={styles.itemsHeader}>
              <Ionicons name="receipt-outline" size={14} color={colors.light.text.secondary} />
              <Text style={styles.itemsTitle}>{item.items?.length || 0} items</Text>
            </View>
            <View style={styles.itemsList}>
              {item.items?.slice(0, 2).map((orderItem, idx) => (
                <Text key={idx} style={styles.itemText}>{orderItem.name} × {orderItem.quantity}</Text>
              ))}
              {item.items?.length > 2 && <Text style={styles.moreItems}>+{item.items.length - 2} more</Text>}
            </View>
          </View>

          <View style={styles.orderFooter}>
            <View>
              <Text style={styles.amount}>₹{item.totalAmount}</Text>
              <View style={[styles.paymentBadge, item.paymentMethod === 'cod' ? styles.codBadge : styles.prepaidBadge]}>
                <Ionicons name={item.paymentMethod === 'cod' ? 'cash-outline' : 'checkmark-circle'} size={12} color={item.paymentMethod === 'cod' ? '#D97706' : '#16A34A'} />
                <Text style={[styles.paymentText, item.paymentMethod === 'cod' ? styles.codText : styles.prepaidText]}>{item.paymentMethod === 'cod' ? 'COD' : 'Prepaid'}</Text>
              </View>
            </View>

            <TouchableOpacity
              style={[styles.actionButton, item.status === 'out_for_delivery' && styles.actionButtonSuccess]}
              onPress={() => {
                if (item.status === 'preparing') markReady(item.orderId);
                else if (item.status === 'ready') startDelivery(item.orderId);
                else markDelivered(item);
              }}
              disabled={actionLoading === item.orderId}
              activeOpacity={0.8}
            >
              <LinearGradient
                colors={actionLoading === item.orderId ? ['#9CA3AF', '#9CA3AF'] : item.status === 'out_for_delivery' ? ['#22C55E', '#16A34A'] : [DELIVERY_GREEN, DELIVERY_DARK_GREEN]}
                style={styles.actionButtonGradient}
              >
                {actionLoading === item.orderId ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <>
                    <Ionicons name={item.status === 'preparing' ? 'checkmark-done' : item.status === 'ready' ? 'bicycle' : 'checkmark-circle'} size={18} color="#fff" />
                    <Text style={styles.actionButtonText}>
                      {item.status === 'preparing' ? 'Mark Ready' : item.status === 'ready' ? 'Start Delivery' : 'Delivered'}
                    </Text>
                  </>
                )}
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </View>
      </Animated.View>
    );
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

      <LinearGradient colors={[DELIVERY_GREEN + 'E6', DELIVERY_DARK_GREEN + 'F2']} style={styles.header}>
        <View style={styles.headerContent}>
          <View>
            <Text style={styles.title}>My Orders</Text>
            <Text style={styles.subtitle}>{orders.length} active deliveries</Text>
          </View>
          <View style={styles.headerBadge}><Ionicons name="bicycle" size={20} color={DELIVERY_GREEN} /></View>
        </View>
      </LinearGradient>

      {loading ? (
        <ActivityIndicator size="large" color={DELIVERY_GREEN} style={{ flex: 1 }} />
      ) : (
        <FlatList
          data={orders}
          renderItem={renderOrder}
          keyExtractor={(item) => item._id}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[DELIVERY_GREEN]} />}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <View style={styles.emptyIconContainer}><Ionicons name="bicycle-outline" size={48} color={colors.light.text.tertiary} /></View>
              <Text style={styles.emptyTitle}>No Active Orders</Text>
              <Text style={styles.emptyText}>Orders assigned to you will appear here</Text>
            </View>
          }
        />
      )}

      <Modal visible={qrModal.visible} animationType="slide" transparent={true} onRequestClose={() => setQrModal({ visible: false, qrUrl: null, orderId: null, amount: 0 })}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Collect Payment</Text>
              <TouchableOpacity onPress={() => setQrModal({ visible: false, qrUrl: null, orderId: null, amount: 0 })}>
                <Ionicons name="close-circle" size={32} color={colors.light.text.tertiary} />
              </TouchableOpacity>
            </View>
            <Text style={styles.modalOrderId}>Order #{qrModal.orderId}</Text>
            <Text style={styles.modalAmount}>₹{qrModal.amount}</Text>
            <View style={styles.qrContainer}>
              {qrModal.qrUrl && <Image source={{ uri: qrModal.qrUrl }} style={styles.qrImage} resizeMode="contain" />}
              <Text style={styles.scanText}>Ask customer to scan & pay</Text>
            </View>
            <TouchableOpacity style={styles.modalButton} onPress={() => { setQrModal({ visible: false, qrUrl: null, orderId: null, amount: 0 }); completeDelivery(qrModal.orderId, 'upi'); }} activeOpacity={0.8}>
              <LinearGradient colors={['#22C55E', '#16A34A']} style={styles.modalButtonGradient}>
                <Ionicons name="checkmark-circle" size={20} color="#fff" />
                <Text style={styles.modalButtonText}>Payment Received - Mark Delivered</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.light.background },
  header: {
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight + 20 : 60,
    paddingBottom: spacing.lg,
    paddingHorizontal: spacing.screenHorizontal,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  headerContent: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: typography.display.small.fontSize, fontWeight: '700', color: '#fff' },
  subtitle: { fontSize: typography.body.medium.fontSize, color: 'rgba(255,255,255,0.8)', marginTop: 2 },
  headerBadge: { width: 44, height: 44, borderRadius: 14, backgroundColor: '#fff', justifyContent: 'center', alignItems: 'center' },
  listContent: { padding: spacing.screenHorizontal, paddingBottom: 100, paddingTop: spacing.md },
  orderCard: {
    padding: spacing.base,
    backgroundColor: colors.light.surface, // Solid background
    borderRadius: radius.xl,
    marginBottom: spacing.md,
    ...shadows.card
  },
  progressContainer: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md },
  progressDot: { width: 18, height: 18, borderRadius: 9, backgroundColor: colors.light.border, justifyContent: 'center', alignItems: 'center' },
  progressDotActive: { backgroundColor: DELIVERY_GREEN },
  progressLine: { flex: 1, height: 3, backgroundColor: colors.light.border, marginHorizontal: 4 },
  progressLineActive: { backgroundColor: DELIVERY_GREEN },
  orderHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: spacing.md },
  orderId: { fontSize: typography.headline.small.fontSize, fontWeight: '700', color: colors.light.text.primary },
  orderTime: { fontSize: typography.body.small.fontSize, color: colors.light.text.tertiary, marginTop: 2 },
  statusBadge: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.full },
  statusText: { fontSize: typography.label.medium.fontSize, fontWeight: '600' },
  customerCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.light.surfaceSecondary, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.sm },
  customerAvatar: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#E8F5E9', justifyContent: 'center', alignItems: 'center' },
  customerInfo: { flex: 1, marginLeft: spacing.md },
  customerName: { fontSize: typography.title.medium.fontSize, fontWeight: '600', color: colors.light.text.primary },
  phoneButton: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  phoneText: { fontSize: typography.body.small.fontSize, color: DELIVERY_GREEN },
  callButton: { width: 40, height: 40, borderRadius: 12, backgroundColor: DELIVERY_GREEN, justifyContent: 'center', alignItems: 'center' },
  addressCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#E8F5E9', borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.sm },
  addressIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: '#fff', justifyContent: 'center', alignItems: 'center' },
  addressText: { flex: 1, fontSize: typography.body.medium.fontSize, color: DELIVERY_DARK_GREEN, marginHorizontal: spacing.md, lineHeight: 20 },
  navigateIcon: { width: 32, height: 32, borderRadius: 10, backgroundColor: '#fff', justifyContent: 'center', alignItems: 'center' },
  itemsSection: { backgroundColor: colors.light.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md },
  itemsHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.sm },
  itemsTitle: { fontSize: typography.title.small.fontSize, fontWeight: '600', color: colors.light.text.secondary },
  itemsList: { gap: 4 },
  itemText: { fontSize: typography.body.small.fontSize, color: colors.light.text.primary },
  moreItems: { fontSize: typography.body.small.fontSize, color: colors.light.text.tertiary, fontStyle: 'italic' },
  orderFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.light.borderLight },
  amount: { fontSize: typography.headline.medium.fontSize, fontWeight: '700', color: colors.light.text.primary },
  paymentBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.sm, marginTop: spacing.xs },
  codBadge: { backgroundColor: '#FEF3C7' },
  prepaidBadge: { backgroundColor: '#DCFCE7' },
  paymentText: { fontSize: typography.label.small.fontSize, fontWeight: '600' },
  codText: { color: '#D97706' },
  prepaidText: { color: '#16A34A' },
  actionButton: { borderRadius: radius.lg, overflow: 'hidden' },
  actionButtonSuccess: {},
  actionButtonGradient: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  actionButtonText: { color: '#fff', fontSize: typography.title.medium.fontSize, fontWeight: '600' },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 100 },
  emptyIconContainer: { width: 80, height: 80, borderRadius: 40, backgroundColor: colors.light.surfaceSecondary, justifyContent: 'center', alignItems: 'center', marginBottom: spacing.base },
  emptyTitle: { fontSize: typography.headline.small.fontSize, fontWeight: '600', color: colors.light.text.secondary },
  emptyText: { fontSize: typography.body.medium.fontSize, color: colors.light.text.tertiary, marginTop: spacing.xs },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: colors.light.surface, borderTopLeftRadius: radius.bottomSheet, borderTopRightRadius: radius.bottomSheet, padding: spacing.xl, paddingBottom: spacing['3xl'] },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.lg },
  modalTitle: { fontSize: typography.headline.large.fontSize, fontWeight: '700', color: colors.light.text.primary },
  modalOrderId: { fontSize: typography.body.medium.fontSize, color: colors.light.text.secondary, textAlign: 'center' },
  modalAmount: { fontSize: 40, fontWeight: '700', color: DELIVERY_GREEN, textAlign: 'center', marginVertical: spacing.md },
  qrContainer: { alignItems: 'center', backgroundColor: colors.light.surfaceSecondary, borderRadius: radius.xl, padding: spacing.lg, marginBottom: spacing.xl },
  qrImage: { width: 200, height: 200, marginBottom: spacing.md },
  scanText: { fontSize: typography.body.medium.fontSize, color: colors.light.text.secondary },
  modalButton: { borderRadius: radius.lg, overflow: 'hidden' },
  modalButtonGradient: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingVertical: spacing.base },
  modalButtonText: { color: '#fff', fontSize: typography.title.medium.fontSize, fontWeight: '600' },
});
