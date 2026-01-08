import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView, FlatList,
  RefreshControl, TouchableOpacity, ActivityIndicator
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import api from '../../config/api';

const STATUS_COLORS = {
  pending: '#f59e0b',
  confirmed: '#3b82f6',
  preparing: '#8b5cf6',
  ready: '#10b981',
  out_for_delivery: '#06b6d4',
  delivered: '#22c55e',
  cancelled: '#ef4444',
  refunded: '#6b7280',
};

const STATUS_LABELS = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  preparing: 'Preparing',
  ready: 'Ready',
  out_for_delivery: 'Out for Delivery',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
};

export default function AdminOrdersScreen({ navigation }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState('all');

  const fetchOrders = async () => {
    try {
      const params = filter !== 'all' ? { status: filter } : {};
      const response = await api.get('/orders', { params });
      setOrders(response.data.orders || []);
    } catch (error) {
      console.error('Error fetching orders:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchOrders();
  }, [filter]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchOrders();
  }, [filter]);

  const FilterButton = ({ status, label }) => (
    <TouchableOpacity
      style={[styles.filterButton, filter === status && styles.filterButtonActive]}
      onPress={() => setFilter(status)}
    >
      <Text style={[styles.filterText, filter === status && styles.filterTextActive]}>{label}</Text>
    </TouchableOpacity>
  );

  const renderOrder = ({ item }) => (
    <TouchableOpacity
      style={styles.orderCard}
      onPress={() => navigation.navigate('OrderDetail', { order: item })}
    >
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
          <Text style={styles.infoText}>{item.customer?.name || item.customer?.phone}</Text>
        </View>
        <View style={styles.infoRow}>
          <Ionicons name="location-outline" size={16} color="#61636b" />
          <Text style={styles.infoText} numberOfLines={1}>
            {item.deliveryAddress?.address || item.customer?.address || 'N/A'}
          </Text>
        </View>
      </View>

      <View style={styles.orderFooter}>
        <Text style={styles.amount}>₹{item.totalAmount}</Text>
        <Text style={styles.time}>
          {new Date(item.createdAt).toLocaleString('en-IN', { 
            day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' 
          })}
        </Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Orders</Text>
      </View>

      <View style={styles.filterContainer}>
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={[
            { status: 'all', label: 'All' },
            { status: 'pending', label: 'Pending' },
            { status: 'preparing', label: 'Preparing' },
            { status: 'ready', label: 'Ready' },
            { status: 'out_for_delivery', label: 'Delivery' },
            { status: 'delivered', label: 'Delivered' },
          ]}
          renderItem={({ item }) => <FilterButton status={item.status} label={item.label} />}
          keyExtractor={(item) => item.status}
          contentContainerStyle={styles.filterList}
        />
      </View>

      {loading ? (
        <ActivityIndicator size="large" color="#e63946" style={{ flex: 1 }} />
      ) : (
        <FlatList
          data={orders}
          renderItem={renderOrder}
          keyExtractor={(item) => item._id}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#e63946']} />}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="receipt-outline" size={64} color="#d1d5db" />
              <Text style={styles.emptyText}>No orders found</Text>
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
  filterContainer: { backgroundColor: '#fff', paddingVertical: 12 },
  filterList: { paddingHorizontal: 16, gap: 8 },
  filterButton: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, backgroundColor: '#f3f4f6', marginRight: 8 },
  filterButtonActive: { backgroundColor: '#e63946' },
  filterText: { fontSize: 14, color: '#61636b' },
  filterTextActive: { color: '#fff', fontWeight: '600' },
  listContent: { padding: 16 },
  orderCard: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 12 },
  orderHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  orderId: { fontSize: 16, fontWeight: 'bold', color: '#1c1d21' },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  statusText: { fontSize: 12, fontWeight: '600' },
  orderInfo: { gap: 8, marginBottom: 12 },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  infoText: { fontSize: 14, color: '#61636b', flex: 1 },
  orderFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, borderTopColor: '#f3f4f6', paddingTop: 12 },
  amount: { fontSize: 18, fontWeight: 'bold', color: '#1c1d21' },
  time: { fontSize: 12, color: '#9ca3af' },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 100 },
  emptyText: { fontSize: 16, color: '#9ca3af', marginTop: 16 },
});
