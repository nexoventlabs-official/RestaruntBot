import React, { useState } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView, ScrollView,
  TouchableOpacity, Alert, ActivityIndicator
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import api from '../../config/api';

const STATUS_COLORS = {
  pending: '#f59e0b', confirmed: '#3b82f6', preparing: '#8b5cf6',
  ready: '#10b981', out_for_delivery: '#06b6d4', delivered: '#22c55e',
  cancelled: '#ef4444', refunded: '#6b7280',
};

const STATUS_LABELS = {
  pending: 'Pending', confirmed: 'Confirmed', preparing: 'Preparing',
  ready: 'Ready', out_for_delivery: 'Out for Delivery', delivered: 'Delivered',
  cancelled: 'Cancelled', refunded: 'Refunded',
};

const STATUS_FLOW = ['pending', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'delivered'];

export default function OrderDetailScreen({ route, navigation }) {
  const [order, setOrder] = useState(route.params.order);
  const [loading, setLoading] = useState(false);

  const updateStatus = async (newStatus) => {
    Alert.alert(
      'Update Status',
      `Change status to "${STATUS_LABELS[newStatus]}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm',
          onPress: async () => {
            setLoading(true);
            try {
              const response = await api.put(`/orders/${order._id}/status`, { status: newStatus });
              setOrder(response.data);
              Alert.alert('Success', 'Order status updated');
            } catch (error) {
              Alert.alert('Error', error.response?.data?.error || 'Failed to update status');
            } finally {
              setLoading(false);
            }
          },
        },
      ]
    );
  };

  const cancelOrder = () => {
    Alert.alert(
      'Cancel Order',
      'Are you sure you want to cancel this order?',
      [
        { text: 'No', style: 'cancel' },
        {
          text: 'Yes, Cancel',
          style: 'destructive',
          onPress: async () => {
            setLoading(true);
            try {
              const response = await api.put(`/orders/${order._id}/status`, { status: 'cancelled' });
              setOrder(response.data);
              Alert.alert('Success', 'Order cancelled');
            } catch (error) {
              Alert.alert('Error', error.response?.data?.error || 'Failed to cancel order');
            } finally {
              setLoading(false);
            }
          },
        },
      ]
    );
  };

  const getNextStatus = () => {
    const currentIndex = STATUS_FLOW.indexOf(order.status);
    if (currentIndex >= 0 && currentIndex < STATUS_FLOW.length - 1) {
      return STATUS_FLOW[currentIndex + 1];
    }
    return null;
  };

  const nextStatus = getNextStatus();

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
          <Text style={styles.statusTime}>
            {new Date(order.createdAt).toLocaleString('en-IN')}
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Customer Details</Text>
          <View style={styles.card}>
            <View style={styles.row}>
              <Ionicons name="person-outline" size={20} color="#61636b" />
              <Text style={styles.rowText}>{order.customer?.name || 'N/A'}</Text>
            </View>
            <View style={styles.row}>
              <Ionicons name="call-outline" size={20} color="#61636b" />
              <Text style={styles.rowText}>{order.customer?.phone}</Text>
            </View>
            <View style={styles.row}>
              <Ionicons name="location-outline" size={20} color="#61636b" />
              <Text style={styles.rowText}>{order.deliveryAddress?.address || order.customer?.address || 'N/A'}</Text>
            </View>
          </View>
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
              <Text style={styles.value}>{order.paymentMethod?.toUpperCase()}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.label}>Status:</Text>
              <Text style={[styles.value, { color: order.paymentStatus === 'paid' ? '#22c55e' : '#f59e0b' }]}>
                {order.paymentStatus?.toUpperCase()}
              </Text>
            </View>
          </View>
        </View>

        {order.assignedTo && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Delivery Partner</Text>
            <View style={styles.card}>
              <View style={styles.row}>
                <Ionicons name="bicycle-outline" size={20} color="#61636b" />
                <Text style={styles.rowText}>{order.deliveryPartnerName || 'Assigned'}</Text>
              </View>
            </View>
          </View>
        )}
      </ScrollView>

      {!['delivered', 'cancelled', 'refunded'].includes(order.status) && (
        <View style={styles.footer}>
          {loading ? (
            <ActivityIndicator size="large" color="#e63946" />
          ) : (
            <>
              {nextStatus && (
                <TouchableOpacity
                  style={[styles.actionButton, { backgroundColor: STATUS_COLORS[nextStatus] }]}
                  onPress={() => updateStatus(nextStatus)}
                >
                  <Text style={styles.actionButtonText}>Mark as {STATUS_LABELS[nextStatus]}</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={styles.cancelButton} onPress={cancelOrder}>
                <Text style={styles.cancelButtonText}>Cancel Order</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      )}
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
  statusTime: { color: '#61636b', marginTop: 8 },
  section: { marginBottom: 16 },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: '#1c1d21', marginBottom: 8 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  rowText: { fontSize: 14, color: '#1c1d21', flex: 1 },
  label: { fontSize: 14, color: '#61636b' },
  value: { fontSize: 14, fontWeight: '600', color: '#1c1d21' },
  itemRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12 },
  itemBorder: { borderTopWidth: 1, borderTopColor: '#f3f4f6' },
  itemInfo: { flex: 1 },
  itemName: { fontSize: 14, color: '#1c1d21' },
  itemQty: { fontSize: 12, color: '#61636b', marginTop: 2 },
  itemPrice: { fontSize: 14, fontWeight: '600', color: '#1c1d21' },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: '#e5e7eb', paddingTop: 12, marginTop: 8 },
  totalLabel: { fontSize: 16, fontWeight: '600', color: '#1c1d21' },
  totalAmount: { fontSize: 18, fontWeight: 'bold', color: '#e63946' },
  footer: { padding: 16, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#e5e7eb', gap: 12 },
  actionButton: { height: 50, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  actionButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  cancelButton: { height: 50, borderRadius: 12, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#ef4444' },
  cancelButtonText: { color: '#ef4444', fontSize: 16, fontWeight: '600' },
});
