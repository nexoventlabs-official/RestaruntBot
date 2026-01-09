import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView, FlatList,
  RefreshControl, TouchableOpacity, ActivityIndicator, Animated, Platform, StatusBar
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import api from '../../config/api';
import { colors, spacing, radius, typography, shadows } from '../../theme';

const STATUS_CONFIG = {
  pending: { color: '#F59E0B', bg: '#FEF3C7', icon: 'time-outline', label: 'Pending' },
  confirmed: { color: '#3B82F6', bg: '#DBEAFE', icon: 'checkmark-circle-outline', label: 'Confirmed' },
  preparing: { color: '#8B5CF6', bg: '#EDE9FE', icon: 'restaurant-outline', label: 'Preparing' },
  ready: { color: '#10B981', bg: '#D1FAE5', icon: 'checkmark-done-outline', label: 'Ready' },
  out_for_delivery: { color: '#06B6D4', bg: '#CFFAFE', icon: 'bicycle-outline', label: 'Out for Delivery' },
  delivered: { color: '#22C55E', bg: '#DCFCE7', icon: 'checkmark-circle', label: 'Delivered' },
  cancelled: { color: '#EF4444', bg: '#FEE2E2', icon: 'close-circle-outline', label: 'Cancelled' },
  refunded: { color: '#6B7280', bg: '#F3F4F6', icon: 'refresh-outline', label: 'Refunded' },
};

export default function AdminOrdersScreen({ navigation }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState('all');
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }).start();
  }, []);

  const fetchOrders = useCallback(async () => {
    try {
      const params = filter !== 'all' ? { status: filter } : {};
      const response = await api.get('/orders', { params });
      setOrders(response.data.orders || []);
    } catch (error) { console.error('Error fetching orders:', error); }
    finally { setLoading(false); setRefreshing(false); }
  }, [filter]);

  useEffect(() => { fetchOrders(); }, [fetchOrders]);
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => fetchOrders());
    return unsubscribe;
  }, [navigation, fetchOrders]);

  const onRefresh = useCallback(() => { setRefreshing(true); fetchOrders(); }, [filter]);

  const FilterChip = ({ status, label, icon }) => {
    const isActive = filter === status;
    return (
      <TouchableOpacity
        style={[styles.filterChip, isActive && styles.filterChipActive]}
        onPress={() => setFilter(status)}
        activeOpacity={0.7}
      >
        {icon && <Ionicons name={icon} size={14} color={isActive ? '#fff' : colors.light.text.secondary} />}
        <Text style={[styles.filterText, isActive && styles.filterTextActive]}>{label}</Text>
      </TouchableOpacity>
    );
  };

  const renderOrder = ({ item }) => {
    const statusConfig = STATUS_CONFIG[item.status] || STATUS_CONFIG.pending;
    return (
      <Animated.View style={{ opacity: fadeAnim }}>
        <TouchableOpacity style={styles.orderCard} onPress={() => navigation.navigate('OrderDetail', { order: item })} activeOpacity={0.8}>
          <View style={styles.orderHeader}>
            <View style={styles.orderIdContainer}>
              <Text style={styles.orderId}>#{item.orderId}</Text>
              <View style={[styles.statusBadge, { backgroundColor: statusConfig.bg }]}>
                <Ionicons name={statusConfig.icon} size={12} color={statusConfig.color} />
                <Text style={[styles.statusText, { color: statusConfig.color }]}>{statusConfig.label}</Text>
              </View>
            </View>
            <View style={styles.orderArrow}>
              <Ionicons name="chevron-forward" size={18} color={colors.light.text.tertiary} />
            </View>
          </View>

          <View style={styles.customerSection}>
            <View style={styles.customerAvatar}>
              <Ionicons name="person" size={16} color={colors.light.text.secondary} />
            </View>
            <View style={styles.customerInfo}>
              <Text style={styles.customerName}>{item.customer?.name || item.customer?.phone || 'Customer'}</Text>
              <View style={styles.addressRow}>
                <Ionicons name="location-outline" size={14} color={colors.light.text.tertiary} />
                <Text style={styles.addressText} numberOfLines={1}>{item.deliveryAddress?.address || item.customer?.address || 'N/A'}</Text>
              </View>
            </View>
          </View>

          <View style={styles.orderFooter}>
            <View style={styles.amountContainer}>
              <Text style={styles.amountLabel}>Total</Text>
              <Text style={styles.amount}>₹{item.totalAmount}</Text>
            </View>
            <View style={styles.itemsCount}>
              <Text style={styles.itemsCountText}>{item.items?.length || 0} items</Text>
            </View>
            <View style={styles.timeContainer}>
              <Ionicons name="time-outline" size={14} color={colors.light.text.tertiary} />
              <Text style={styles.time}>{new Date(item.createdAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</Text>
            </View>
          </View>
        </TouchableOpacity>
      </Animated.View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={colors.zomato.red} />
      
      <LinearGradient colors={[colors.zomato.red, colors.zomato.darkRed]} style={styles.header}>
        <View style={styles.headerContent}>
          <View>
            <Text style={styles.title}>Orders</Text>
            <Text style={styles.subtitle}>{orders.length} total orders</Text>
          </View>
          <TouchableOpacity style={styles.searchButton}>
            <Ionicons name="search" size={22} color="#fff" />
          </TouchableOpacity>
        </View>
      </LinearGradient>

      <View style={styles.filterContainer}>
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={[
            { status: 'all', label: 'All', icon: 'apps-outline' },
            { status: 'pending', label: 'Pending', icon: 'time-outline' },
            { status: 'preparing', label: 'Preparing', icon: 'restaurant-outline' },
            { status: 'ready', label: 'Ready', icon: 'checkmark-done-outline' },
            { status: 'out_for_delivery', label: 'Delivery', icon: 'bicycle-outline' },
            { status: 'delivered', label: 'Done', icon: 'checkmark-circle-outline' },
          ]}
          renderItem={({ item }) => <FilterChip status={item.status} label={item.label} icon={item.icon} />}
          keyExtractor={(item) => item.status}
          contentContainerStyle={styles.filterList}
        />
      </View>

      {loading ? (
        <ActivityIndicator size="large" color={colors.zomato.red} style={{ flex: 1 }} />
      ) : (
        <FlatList
          data={orders}
          renderItem={renderOrder}
          keyExtractor={(item) => item._id}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.zomato.red]} />}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <View style={styles.emptyIconContainer}>
                <Ionicons name="receipt-outline" size={48} color={colors.light.text.tertiary} />
              </View>
              <Text style={styles.emptyTitle}>No orders found</Text>
              <Text style={styles.emptyText}>{filter !== 'all' ? 'Try changing the filter' : 'Orders will appear here'}</Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.light.background },
  header: { paddingTop: Platform.OS === 'android' ? 50 : 16, paddingBottom: spacing.lg, paddingHorizontal: spacing.screenHorizontal, borderBottomLeftRadius: 24, borderBottomRightRadius: 24 },
  headerContent: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: typography.display.small.fontSize, fontWeight: '700', color: '#fff' },
  subtitle: { fontSize: typography.body.medium.fontSize, color: 'rgba(255,255,255,0.8)', marginTop: 2 },
  searchButton: { width: 44, height: 44, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.15)', justifyContent: 'center', alignItems: 'center' },
  filterContainer: { backgroundColor: colors.light.surface, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.light.borderLight },
  filterList: { paddingHorizontal: spacing.screenHorizontal, gap: spacing.sm },
  filterChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.full, backgroundColor: colors.light.surfaceSecondary, marginRight: spacing.sm },
  filterChipActive: { backgroundColor: colors.zomato.red },
  filterText: { fontSize: typography.label.medium.fontSize, color: colors.light.text.secondary, fontWeight: '500' },
  filterTextActive: { color: '#fff', fontWeight: '600' },
  listContent: { padding: spacing.screenHorizontal, paddingBottom: 100 },
  orderCard: { backgroundColor: colors.light.surface, borderRadius: radius.xl, padding: spacing.base, marginBottom: spacing.md, ...shadows.card },
  orderHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md },
  orderIdContainer: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  orderId: { fontSize: typography.headline.small.fontSize, fontWeight: '700', color: colors.light.text.primary },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.full },
  statusText: { fontSize: typography.label.small.fontSize, fontWeight: '600' },
  orderArrow: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.light.surfaceSecondary, justifyContent: 'center', alignItems: 'center' },
  customerSection: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md, borderTopWidth: 1, borderTopColor: colors.light.borderLight, borderBottomWidth: 1, borderBottomColor: colors.light.borderLight },
  customerAvatar: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.light.surfaceSecondary, justifyContent: 'center', alignItems: 'center' },
  customerInfo: { flex: 1, marginLeft: spacing.md },
  customerName: { fontSize: typography.title.medium.fontSize, fontWeight: '600', color: colors.light.text.primary },
  addressRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  addressText: { fontSize: typography.body.small.fontSize, color: colors.light.text.tertiary, flex: 1 },
  orderFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: spacing.md },
  amountContainer: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.xs },
  amountLabel: { fontSize: typography.label.small.fontSize, color: colors.light.text.tertiary },
  amount: { fontSize: typography.headline.small.fontSize, fontWeight: '700', color: colors.zomato.red },
  itemsCount: { backgroundColor: colors.light.surfaceSecondary, paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.sm },
  itemsCountText: { fontSize: typography.label.small.fontSize, color: colors.light.text.secondary, fontWeight: '500' },
  timeContainer: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  time: { fontSize: typography.label.small.fontSize, color: colors.light.text.tertiary },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 80 },
  emptyIconContainer: { width: 80, height: 80, borderRadius: 40, backgroundColor: colors.light.surfaceSecondary, justifyContent: 'center', alignItems: 'center', marginBottom: spacing.base },
  emptyTitle: { fontSize: typography.headline.small.fontSize, fontWeight: '600', color: colors.light.text.secondary },
  emptyText: { fontSize: typography.body.medium.fontSize, color: colors.light.text.tertiary, marginTop: spacing.xs },
});
