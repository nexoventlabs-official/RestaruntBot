import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView, FlatList,
  RefreshControl, TouchableOpacity, Alert, ActivityIndicator, Linking,
  Modal, Image
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import api from '../../config/api';

const STATUS_COLORS = {
  preparing: '#f97316',
  ready: '#10b981',
  out_for_delivery: '#06b6d4',
};

const STATUS_LABELS = {
  preparing: 'Preparing',
  ready: 'Ready for Pickup',
  out_for_delivery: 'Out for Delivery',
};

export default function MyOrdersScreen({ navigation }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionLoading, setActionLoading] = useState(null);
  const [qrModal, setQrModal] = useState({ visible: false, qrUrl: null, paymentUrl: null, orderId: null, amount: 0, paymentLinkId: null });
  const [checkingPayment, setCheckingPayment] = useState(false);

  const fetchOrders = async () => {
    try {
      const response = await api.get('/delivery/orders/my');
      setOrders(response.data);
    } catch (error) {
      console.error('Error fetching orders:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchOrders();
    const unsubscribe = navigation.addListener('focus', fetchOrders);
    return unsubscribe;
  }, [navigation]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchOrders();
  }, []);

  const openGoogleMaps = async (order) => {
    const address = order.deliveryAddress?.address || order.customer?.address;
    const lat = order.deliveryAddress?.latitude;
    const lng = order.deliveryAddress?.longitude;

    try {
      // Get current location
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Denied', 'Location permission is required for navigation');
        return;
      }

      const location = await Location.getCurrentPositionAsync({});
      const currentLat = location.coords.latitude;
      const currentLng = location.coords.longitude;

      let url;
      if (lat && lng) {
        // Use coordinates if available
        url = `https://www.google.com/maps/dir/?api=1&origin=${currentLat},${currentLng}&destination=${lat},${lng}&travelmode=driving`;
      } else if (address) {
        // Use address as fallback
        url = `https://www.google.com/maps/dir/?api=1&origin=${currentLat},${currentLng}&destination=${encodeURIComponent(address)}&travelmode=driving`;
      } else {
        Alert.alert('Error', 'No delivery address available');
        return;
      }

      const supported = await Linking.canOpenURL(url);
      if (supported) {
        await Linking.openURL(url);
      } else {
        Alert.alert('Error', 'Cannot open Google Maps');
      }
    } catch (error) {
      console.error('Error opening maps:', error);
      Alert.alert('Error', 'Failed to open navigation');
    }
  };

  const startDelivery = async (orderId) => {
    setActionLoading(orderId);
    try {
      await api.post(`/delivery/orders/${orderId}/out-for-delivery`);
      Alert.alert('Success', 'Order marked as Out for Delivery');
      fetchOrders();
    } catch (error) {
      Alert.alert('Error', error.response?.data?.error || 'Failed to update order');
    } finally {
      setActionLoading(null);
    }
  };

  const markReady = async (orderId) => {
    setActionLoading(orderId);
    try {
      await api.post(`/delivery/orders/${orderId}/mark-ready`);
      Alert.alert('Success', 'Order marked as Ready');
      fetchOrders();
    } catch (error) {
      Alert.alert('Error', error.response?.data?.error || 'Failed to mark order as ready');
    } finally {
      setActionLoading(null);
    }
  };

  const markDelivered = async (order) => {
    if (order.paymentMethod === 'cod') {
      Alert.alert(
        'Payment Collection',
        `Collect ₹${order.totalAmount} from customer.\n\nHow was the payment collected?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Cash',
            onPress: () => completeDelivery(order.orderId, 'cash'),
          },
          {
            text: 'UPI (Show QR)',
            onPress: () => generateQRCode(order),
          },
        ]
      );
    } else {
      Alert.alert(
        'Confirm Delivery',
        'Mark this order as delivered?',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Confirm',
            onPress: () => completeDelivery(order.orderId, null),
          },
        ]
      );
    }
  };

  const generateQRCode = async (order) => {
    setActionLoading(order.orderId);
    try {
      const response = await api.post(`/delivery/orders/${order.orderId}/generate-qr`);
      const { qrUrl, paymentUrl, paymentLinkId, amount, orderId } = response.data;
      
      setQrModal({
        visible: true,
        qrUrl,
        paymentUrl,
        orderId,
        amount,
        paymentLinkId,
      });
    } catch (error) {
      Alert.alert('Error', error.response?.data?.error || 'Failed to generate QR code');
    } finally {
      setActionLoading(null);
    }
  };

  const checkPaymentStatus = async () => {
    if (!qrModal.orderId || !qrModal.paymentLinkId) return;
    
    setCheckingPayment(true);
    try {
      const response = await api.get(`/delivery/orders/${qrModal.orderId}/check-payment`, {
        params: { paymentLinkId: qrModal.paymentLinkId }
      });
      
      if (response.data.status === 'paid') {
        Alert.alert('Success', 'Payment received! Order marked as delivered.');
        setQrModal({ visible: false, qrUrl: null, paymentUrl: null, orderId: null, amount: 0, paymentLinkId: null });
        fetchOrders();
      } else {
        Alert.alert('Payment Pending', response.data.message || 'Payment not yet received. Please wait for customer to complete payment.');
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to check payment status');
    } finally {
      setCheckingPayment(false);
    }
  };

  const closeQrAndMarkCash = () => {
    Alert.alert(
      'Mark as Cash Payment?',
      'Customer paid in cash instead?',
      [
        { text: 'No, Keep QR Open', style: 'cancel' },
        {
          text: 'Yes, Cash Received',
          onPress: () => {
            const orderId = qrModal.orderId;
            setQrModal({ visible: false, qrUrl: null, paymentUrl: null, orderId: null, amount: 0, paymentLinkId: null });
            completeDelivery(orderId, 'cash');
          },
        },
      ]
    );
  };

  const completeDelivery = async (orderId, collectionMethod) => {
    setActionLoading(orderId);
    try {
      await api.post(`/delivery/orders/${orderId}/delivered`, { collectionMethod });
      Alert.alert('Success', 'Order delivered successfully!');
      fetchOrders();
    } catch (error) {
      Alert.alert('Error', error.response?.data?.error || 'Failed to complete delivery');
    } finally {
      setActionLoading(null);
    }
  };

  const renderOrder = ({ item }) => (
    <View style={styles.orderCard}>
      <View style={styles.orderHeader}>
        <Text style={styles.orderId}>#{item.orderId}</Text>
        <View style={[styles.statusBadge, { backgroundColor: STATUS_COLORS[item.status] + '20' }]}>
          <Text style={[styles.statusText, { color: STATUS_COLORS[item.status] }]}>
            {STATUS_LABELS[item.status]}
          </Text>
        </View>
      </View>

      <View style={styles.orderInfo}>
        <View style={styles.infoRow}>
          <Ionicons name="person-outline" size={16} color="#61636b" />
          <Text style={styles.infoText}>{item.customer?.name || 'Customer'}</Text>
        </View>
        <View style={styles.infoRow}>
          <Ionicons name="call-outline" size={16} color="#61636b" />
          <TouchableOpacity onPress={() => Linking.openURL(`tel:${item.customer?.phone}`)}>
            <Text style={[styles.infoText, styles.linkText]}>{item.customer?.phone}</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity style={styles.addressRow} onPress={() => openGoogleMaps(item)}>
          <Ionicons name="navigate-outline" size={16} color="#2a9d8f" />
          <Text style={[styles.infoText, styles.addressText]} numberOfLines={2}>
            {item.deliveryAddress?.address || item.customer?.address || 'N/A'}
          </Text>
          <Ionicons name="open-outline" size={16} color="#2a9d8f" />
        </TouchableOpacity>
      </View>

      <View style={styles.itemsSection}>
        <Text style={styles.itemsTitle}>Items ({item.items?.length || 0})</Text>
        {item.items?.slice(0, 3).map((orderItem, index) => (
          <Text key={index} style={styles.itemText}>
            • {orderItem.name} x{orderItem.quantity}
          </Text>
        ))}
        {item.items?.length > 3 && (
          <Text style={styles.moreItems}>+{item.items.length - 3} more items</Text>
        )}
      </View>

      <View style={styles.orderFooter}>
        <View>
          <Text style={styles.amount}>₹{item.totalAmount}</Text>
          <Text style={[styles.paymentMethod, item.paymentMethod === 'cod' && styles.codBadge]}>
            {item.paymentMethod === 'cod' ? '💵 COD - Collect Cash' : '✅ Prepaid'}
          </Text>
        </View>
        
        {actionLoading === item.orderId ? (
          <ActivityIndicator color="#2a9d8f" />
        ) : item.status === 'preparing' ? (
          <TouchableOpacity style={[styles.actionButton, styles.preparingButton]} onPress={() => markReady(item.orderId)}>
            <Ionicons name="checkmark-done-outline" size={18} color="#fff" />
            <Text style={styles.actionButtonText}>Mark Ready</Text>
          </TouchableOpacity>
        ) : item.status === 'ready' ? (
          <TouchableOpacity style={styles.actionButton} onPress={() => startDelivery(item.orderId)}>
            <Ionicons name="bicycle-outline" size={18} color="#fff" />
            <Text style={styles.actionButtonText}>Start Delivery</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.actionButton, styles.deliveredButton]}
            onPress={() => markDelivered(item)}
          >
            <Ionicons name="checkmark-circle-outline" size={18} color="#fff" />
            <Text style={styles.actionButtonText}>Delivered</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>My Orders</Text>
        <Text style={styles.subtitle}>{orders.length} active orders</Text>
      </View>

      {loading ? (
        <ActivityIndicator size="large" color="#2a9d8f" style={{ flex: 1 }} />
      ) : (
        <FlatList
          data={orders}
          renderItem={renderOrder}
          keyExtractor={(item) => item._id}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#2a9d8f']} />}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="bicycle-outline" size={64} color="#d1d5db" />
              <Text style={styles.emptyText}>No active orders</Text>
              <Text style={styles.emptySubtext}>Orders assigned by admin will appear here</Text>
            </View>
          }
        />
      )}

      {/* QR Code Modal */}
      <Modal
        visible={qrModal.visible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setQrModal({ ...qrModal, visible: false })}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Scan to Pay</Text>
              <TouchableOpacity onPress={() => setQrModal({ ...qrModal, visible: false })}>
                <Ionicons name="close" size={28} color="#1c1d21" />
              </TouchableOpacity>
            </View>

            <Text style={styles.modalOrderId}>Order #{qrModal.orderId}</Text>
            <Text style={styles.modalAmount}>₹{qrModal.amount}</Text>

            {qrModal.qrUrl && (
              <Image
                source={{ uri: qrModal.qrUrl }}
                style={styles.qrImage}
                resizeMode="contain"
              />
            )}

            <Text style={styles.qrInstructions}>
              Ask customer to scan this QR code with any UPI app
            </Text>

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.checkPaymentButton, checkingPayment && styles.buttonDisabled]}
                onPress={checkPaymentStatus}
                disabled={checkingPayment}
              >
                {checkingPayment ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <>
                    <Ionicons name="refresh" size={20} color="#fff" />
                    <Text style={styles.checkPaymentText}>Check Payment</Text>
                  </>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.openLinkButton}
                onPress={() => qrModal.paymentUrl && Linking.openURL(qrModal.paymentUrl)}
              >
                <Ionicons name="open-outline" size={20} color="#2a9d8f" />
                <Text style={styles.openLinkText}>Open Payment Link</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.cashButton} onPress={closeQrAndMarkCash}>
                <Ionicons name="cash-outline" size={20} color="#f59e0b" />
                <Text style={styles.cashButtonText}>Paid in Cash Instead</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8f9fb' },
  header: { padding: 20, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#e5e7eb' },
  title: { fontSize: 24, fontWeight: 'bold', color: '#1c1d21' },
  subtitle: { fontSize: 14, color: '#61636b', marginTop: 4 },
  listContent: { padding: 16 },
  orderCard: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 12 },
  orderHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  orderId: { fontSize: 16, fontWeight: 'bold', color: '#1c1d21' },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  statusText: { fontSize: 12, fontWeight: '600' },
  orderInfo: { gap: 8, marginBottom: 12 },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  infoText: { fontSize: 14, color: '#61636b' },
  linkText: { color: '#2a9d8f', textDecorationLine: 'underline' },
  addressRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: '#e6f7f5', padding: 12, borderRadius: 8, marginTop: 4,
  },
  addressText: { flex: 1, color: '#2a9d8f', fontWeight: '500' },
  itemsSection: { backgroundColor: '#f9fafb', padding: 12, borderRadius: 8, marginBottom: 12 },
  itemsTitle: { fontSize: 14, fontWeight: '600', color: '#1c1d21', marginBottom: 8 },
  itemText: { fontSize: 13, color: '#61636b', marginTop: 4 },
  moreItems: { fontSize: 12, color: '#9ca3af', marginTop: 4, fontStyle: 'italic' },
  orderFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, borderTopColor: '#f3f4f6', paddingTop: 12 },
  amount: { fontSize: 18, fontWeight: 'bold', color: '#1c1d21' },
  paymentMethod: { fontSize: 12, color: '#61636b', marginTop: 2 },
  codBadge: { color: '#f59e0b', fontWeight: '600' },
  actionButton: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#2a9d8f', paddingHorizontal: 16, paddingVertical: 12, borderRadius: 8,
  },
  preparingButton: { backgroundColor: '#f97316' },
  deliveredButton: { backgroundColor: '#22c55e' },
  actionButtonText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 100 },
  emptyText: { fontSize: 16, color: '#9ca3af', marginTop: 16 },
  emptySubtext: { fontSize: 14, color: '#d1d5db', marginTop: 4 },
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 400,
    alignItems: 'center',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    marginBottom: 16,
  },
  modalTitle: { fontSize: 20, fontWeight: 'bold', color: '#1c1d21' },
  modalOrderId: { fontSize: 14, color: '#61636b', marginBottom: 4 },
  modalAmount: { fontSize: 32, fontWeight: 'bold', color: '#2a9d8f', marginBottom: 16 },
  qrImage: { width: 250, height: 250, marginBottom: 16 },
  qrInstructions: { fontSize: 14, color: '#61636b', textAlign: 'center', marginBottom: 20 },
  modalButtons: { width: '100%', gap: 12 },
  checkPaymentButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#2a9d8f',
    paddingVertical: 14,
    borderRadius: 10,
  },
  buttonDisabled: { opacity: 0.7 },
  checkPaymentText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  openLinkButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#e6f7f5',
    paddingVertical: 14,
    borderRadius: 10,
  },
  openLinkText: { color: '#2a9d8f', fontSize: 16, fontWeight: '600' },
  cashButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#fef3c7',
    paddingVertical: 14,
    borderRadius: 10,
  },
  cashButtonText: { color: '#f59e0b', fontSize: 16, fontWeight: '600' },
});
