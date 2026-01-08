import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView, FlatList,
  RefreshControl, TouchableOpacity, Alert, ActivityIndicator
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import api from '../../config/api';

export default function AvailableOrdersScreen({ navigation }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [claiming, setClaiming] = useState(null);

  const fetchOrders = async () => {
    try {
      const response = await api.get('/delivery/orders/available');
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
    const interval = setInterval(fetchOrders, 30000); // Refresh every 30 seconds
    return () => clearInterval(interval);
  }, []);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchOrders();
  }, []);

  const claimOrder = async (orderId) => {
    Alert.alert(
      'Claim Order',
      'Do you want to claim this order? It will be marked as Ready.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Claim',
          onPress: async () => {
            setClaiming(orderId);
            try {
              await api.post(`/delivery/orders/${orderId}/claim`);
              Alert.alert('Success', 'Order claimed successfully!');
              fetchOrders();
            } catch (error) {
              Alert.alert('Error', error.response?.data?.error || 'Failed to claim order');
            } finally {
              setClaiming(null);
            }
          },
        },
      ]
    );
  };

  const renderOrder = ({ item }) => (
    <View style={styles.orderCard}>
      <View style={styles.orderHeader}>
        <Text style={styles.orderId}>#{item.orderId}</Text>
        <View style={styles.statusBadge}>
          <Text style={styles.statusText}>Preparing</Text>
        </View>
      </View>

      <View style={styles.orderInfo}>
        <View style={styles.infoRow}>
          <Ionicons name="person-outline" size={16} color="#61636b" />
          <Text style={styles.infoText}>{item.customer?.name || item.customer?.phone}</Text>
        </View>
        <View style={styles.infoRow}>
          <Ionicons name="location-outline" size={16} color="#61636b" />
          <Text style={styles.infoText} numberOfLines={2}>
            {item.deliveryAddress?.address || item.customer?.address || 'N/A'}
          </Text>
        </View>
        <View style={styles.infoRow}>
          <Ionicons name="cart-outline" size={16} color="#61636b" />
          <Text style={styles.infoText}>{item.items?.length || 0} items</Text>
        </View>
      </View>

      <View style={styles.orderFooter}>
        <View>
          <Text style={styles.amount}>₹{item.totalAmount}</Text>
          <Text style={styles.paymentMethod}>
            {item.paymentMethod === 'cod' ? 'Cash on Delivery' : 'Prepaid'}
          </Text>
        </View>
        
        <TouchableOpacity
          style={[styles.claimButton, claiming === item.orderId && styles.claimButtonDisabled]}
          onPress={() => claimOrder(item.orderId)}
          disabled={claiming === item.orderId}
        >
          {claiming === item.orderId ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <>
              <Ionicons name="hand-left-outline" size={18} color="#fff" />
              <Text style={styles.claimButtonText}>Claim</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Available Orders</Text>
        <Text style={styles.subtitle}>{orders.length} orders waiting</Text>
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
              <Ionicons name="receipt-outline" size={64} color="#d1d5db" />
              <Text style={styles.emptyText}>No available orders</Text>
              <Text style={styles.emptySubtext}>Pull down to refresh</Text>
            </View>
          }
        />
      )}
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
  statusBadge: { backgroundColor: '#fef3c7', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  statusText: { fontSize: 12, fontWeight: '600', color: '#f59e0b' },
  orderInfo: { gap: 8, marginBottom: 12 },
  infoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  infoText: { fontSize: 14, color: '#61636b', flex: 1 },
  orderFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, borderTopColor: '#f3f4f6', paddingTop: 12 },
  amount: { fontSize: 18, fontWeight: 'bold', color: '#1c1d21' },
  paymentMethod: { fontSize: 12, color: '#61636b', marginTop: 2 },
  claimButton: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#2a9d8f', paddingHorizontal: 20, paddingVertical: 12, borderRadius: 8,
  },
  claimButtonDisabled: { opacity: 0.7 },
  claimButtonText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 100 },
  emptyText: { fontSize: 16, color: '#9ca3af', marginTop: 16 },
  emptySubtext: { fontSize: 14, color: '#d1d5db', marginTop: 4 },
});
