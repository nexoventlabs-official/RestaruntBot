import React from 'react';
import {
  View, Text, StyleSheet, SafeAreaView, ScrollView,
  TouchableOpacity, Linking
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';

const STATUS_COLORS = {
  ready: '#10b981',
  out_for_delivery: '#06b6d4',
  delivered: '#22c55e',
};

const STATUS_LABELS = {
  ready: 'Ready for Pickup',
  out_for_delivery: 'Out for Delivery',
  delivered: 'Delivered',
};

export default function DeliveryOrderDetailScreen({ route, navigation }) {
  const { order } = route.params;

  const openGoogleMaps = async () => {
    const address = order.deliveryAddress?.address || order.customer?.address;
    const lat = order.deliveryAddress?.latitude;
    const lng = order.deliveryAddress?.longitude;

    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        // Fallback without current location
        let url;
        if (lat && lng) {
          url = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
        } else if (address) {
          url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
        }
        if (url) await Linking.openURL(url);
        return;
      }

      const location = await Location.getCurrentPositionAsync({});
      const currentLat = location.coords.latitude;
      const currentLng = location.coords.longitude;

      let url;
      if (lat && lng) {
        url = `https://www.google.com/maps/dir/?api=1&origin=${currentLat},${currentLng}&destination=${lat},${lng}&travelmode=driving`;
      } else if (address) {
        url = `https://www.google.com/maps/dir/?api=1&origin=${currentLat},${currentLng}&destination=${encodeURIComponent(address)}&travelmode=driving`;
      }

      if (url) await Linking.openURL(url);
    } catch (error) {
      console.error('Error opening maps:', error);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={24} color="#1c1d21" />
        </TouchableOpacity>
        <Text style={styles.title}>Order #{order.orderId}</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView style={styles.content}>
        <View style={styles.statusCard}>
          <View style={[styles.statusBadge, { backgroundColor: STATUS_COLORS[order.status] }]}>
            <Text style={styles.statusText}>{STATUS_LABELS[order.status]}</Text>
          </View>
          {order.deliveredAt && (
            <Text style={styles.deliveredTime}>
              Delivered on {new Date(order.deliveredAt).toLocaleString('en-IN')}
            </Text>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Customer Details</Text>
          <View style={styles.card}>
            <View style={styles.row}>
              <Ionicons name="person-outline" size={20} color="#61636b" />
              <Text style={styles.rowText}>{order.customer?.name || 'Customer'}</Text>
            </View>
            <TouchableOpacity
              style={styles.row}
              onPress={() => Linking.openURL(`tel:${order.customer?.phone}`)}
            >
              <Ionicons name="call-outline" size={20} color="#2a9d8f" />
              <Text style={[styles.rowText, styles.linkText]}>{order.customer?.phone}</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Delivery Address</Text>
          <TouchableOpacity style={styles.addressCard} onPress={openGoogleMaps}>
            <View style={styles.addressContent}>
              <Ionicons name="location-outline" size={24} color="#2a9d8f" />
              <Text style={styles.addressText}>
                {order.deliveryAddress?.address || order.customer?.address || 'N/A'}
              </Text>
            </View>
            <View style={styles.navigateButton}>
              <Ionicons name="navigate" size={20} color="#fff" />
              <Text style={styles.navigateButtonText}>Navigate</Text>
            </View>
          </TouchableOpacity>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Order Items</Text>
          <View style={styles.card}>
            {order.items?.map((item, index) => (
              <View key={index} style={[styles.itemRow, index > 0 && styles.itemBorder]}>
                <View style={styles.itemInfo}>
                  <Text style={styles.itemName}>{item.name}</Text>
                  <Text style={styles.itemQty}>x{item.quantity}</Text>
                </View>
                <Text style={styles.itemPrice}>₹{item.price * item.quantity}</Text>
              </View>
            ))}
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Total</Text>
              <Text style={styles.totalAmount}>₹{order.totalAmount}</Text>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Payment Info</Text>
          <View style={styles.card}>
            <View style={styles.row}>
              <Text style={styles.label}>Method:</Text>
              <Text style={styles.value}>
                {order.paymentMethod === 'cod' ? 'Cash on Delivery' : 'UPI (Prepaid)'}
              </Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.label}>Status:</Text>
              <Text style={[styles.value, { color: order.paymentStatus === 'paid' ? '#22c55e' : '#f59e0b' }]}>
                {order.paymentStatus?.toUpperCase()}
              </Text>
            </View>
            {order.actualPaymentMethod && (
              <View style={styles.row}>
                <Text style={styles.label}>Collected via:</Text>
                <Text style={styles.value}>{order.actualPaymentMethod.toUpperCase()}</Text>
              </View>
            )}
          </View>
        </View>

        {order.trackingUpdates?.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Timeline</Text>
            <View style={styles.card}>
              {order.trackingUpdates.map((update, index) => (
                <View key={index} style={styles.timelineItem}>
                  <View style={styles.timelineDot} />
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
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8f9fb' },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 20, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#e5e7eb',
  },
  title: { fontSize: 18, fontWeight: 'bold', color: '#1c1d21' },
  content: { flex: 1, padding: 16 },
  statusCard: { backgroundColor: '#fff', borderRadius: 12, padding: 20, alignItems: 'center', marginBottom: 16 },
  statusBadge: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 20 },
  statusText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  deliveredTime: { color: '#61636b', marginTop: 8 },
  section: { marginBottom: 16 },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: '#1c1d21', marginBottom: 8 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  rowText: { fontSize: 14, color: '#1c1d21', flex: 1 },
  linkText: { color: '#2a9d8f', textDecorationLine: 'underline' },
  label: { fontSize: 14, color: '#61636b' },
  value: { fontSize: 14, fontWeight: '600', color: '#1c1d21' },
  addressCard: { backgroundColor: '#fff', borderRadius: 12, padding: 16 },
  addressContent: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 12 },
  addressText: { flex: 1, fontSize: 14, color: '#1c1d21', lineHeight: 20 },
  navigateButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#2a9d8f', paddingVertical: 12, borderRadius: 8,
  },
  navigateButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  itemRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12 },
  itemBorder: { borderTopWidth: 1, borderTopColor: '#f3f4f6' },
  itemInfo: { flex: 1 },
  itemName: { fontSize: 14, color: '#1c1d21' },
  itemQty: { fontSize: 12, color: '#61636b', marginTop: 2 },
  itemPrice: { fontSize: 14, fontWeight: '600', color: '#1c1d21' },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: '#e5e7eb', paddingTop: 12, marginTop: 8 },
  totalLabel: { fontSize: 16, fontWeight: '600', color: '#1c1d21' },
  totalAmount: { fontSize: 18, fontWeight: 'bold', color: '#2a9d8f' },
  timelineItem: { flexDirection: 'row', paddingVertical: 8 },
  timelineDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#2a9d8f', marginTop: 4, marginRight: 12 },
  timelineContent: { flex: 1 },
  timelineMessage: { fontSize: 14, color: '#1c1d21' },
  timelineTime: { fontSize: 12, color: '#9ca3af', marginTop: 2 },
});
