import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, SectionList,
  RefreshControl, TouchableOpacity, Animated, Platform, StatusBar
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import api from '../../config/api';
import { colors, spacing, radius, typography, shadows } from '../../theme';

const DELIVERY_GREEN = '#267E3E';
const DELIVERY_DARK_GREEN = '#1B5E2E';

const SummaryCard = ({ orders }) => {
  const totalEarnings = orders.reduce((sum, order) => sum + (order.totalAmount || 0), 0);
  const todayOrders = orders.filter(order => {
    const orderDate = new Date(order.deliveredAt);
    const today = new Date();
    return orderDate.toDateString() === today.toDateString();
  });

  return (
    <View style={styles.summaryCardBg}>
      <LinearGradient colors={[DELIVERY_GREEN + 'F2', DELIVERY_DARK_GREEN + 'F2']} style={styles.summaryCard}>
        <View style={styles.summaryHeader}>
          <Text style={styles.summaryTitle}>This Week</Text>
          <View style={styles.summaryBadge}>
            <Ionicons name="trending-up" size={14} color="#22C55E" />
            <Text style={styles.summaryBadgeText}>+12%</Text>
          </View>
        </View>

        <View style={styles.summaryStats}>
          <View style={styles.summaryStat}>
            <Text style={styles.summaryValue}>₹{totalEarnings.toLocaleString()}</Text>
            <Text style={styles.summaryLabel}>Total Earned</Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryStat}>
            <Text style={styles.summaryValue}>{orders.length}</Text>
            <Text style={styles.summaryLabel}>Deliveries</Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryStat}>
            <Text style={styles.summaryValue}>{todayOrders.length}</Text>
            <Text style={styles.summaryLabel}>Today</Text>
          </View>
        </View>
      </LinearGradient>
    </View>
  );
};

const SectionHeader = ({ title }) => (
  <View style={styles.sectionHeader}>
    <View style={styles.sectionDot} />
    <Text style={styles.sectionTitle}>{title}</Text>
  </View>
);

export default function DeliveryHistoryScreen({ navigation }) {
  const [orders, setOrders] = useState([]);
  const [sections, setSections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }).start();
  }, []);

  const fetchHistory = async () => {
    try {
      const response = await api.get('/delivery/orders/history');
      setOrders(response.data);

      const grouped = response.data.reduce((acc, order) => {
        const date = new Date(order.deliveredAt);
        const today = new Date();
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);

        let dateKey;
        if (date.toDateString() === today.toDateString()) dateKey = 'Today';
        else if (date.toDateString() === yesterday.toDateString()) dateKey = 'Yesterday';
        else dateKey = date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

        if (!acc[dateKey]) acc[dateKey] = [];
        acc[dateKey].push(order);
        return acc;
      }, {});

      setSections(Object.entries(grouped).map(([title, data]) => ({ title, data })));
    } catch (error) { console.error('Error fetching history:', error); }
    finally { setLoading(false); setRefreshing(false); }
  };

  useEffect(() => { fetchHistory(); }, []);
  const onRefresh = useCallback(() => { setRefreshing(true); fetchHistory(); }, []);

  const renderOrder = ({ item }) => (
    <Animated.View style={{ opacity: fadeAnim }}>
      <TouchableOpacity onPress={() => navigation.navigate('DeliveryOrderDetail', { order: item })} activeOpacity={0.8}>
        <View style={styles.orderCardBg}>
          <View style={styles.orderCard}>
            <View style={styles.orderHeader}>
              <View style={styles.orderIdContainer}>
                <View style={styles.checkIcon}><Ionicons name="checkmark" size={12} color="#fff" /></View>
                <Text style={styles.orderId}>#{item.orderId}</Text>
              </View>
              <Text style={styles.orderAmount}>₹{item.totalAmount}</Text>
            </View>

            <View style={styles.orderDetails}>
              <View style={styles.orderDetail}>
                <Ionicons name="person-outline" size={14} color={colors.light.text.tertiary} />
                <Text style={styles.orderDetailText}>{item.customer?.name || item.customer?.phone}</Text>
              </View>
              <View style={styles.orderDetail}>
                <Ionicons name="location-outline" size={14} color={colors.light.text.tertiary} />
                <Text style={styles.orderDetailText} numberOfLines={1}>{item.deliveryAddress?.address || item.customer?.address || 'N/A'}</Text>
              </View>
            </View>

            <View style={styles.orderFooter}>
              <View style={styles.orderTime}>
                <Ionicons name="time-outline" size={14} color={colors.light.text.tertiary} />
                <Text style={styles.orderTimeText}>{item.deliveredAt ? new Date(item.deliveredAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : 'N/A'}</Text>
              </View>
              <View style={styles.itemsCount}><Text style={styles.itemsCountText}>{item.items?.length || 0} items</Text></View>
            </View>
          </View>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

      <View style={styles.headerBg}>
        <LinearGradient colors={[DELIVERY_GREEN + 'E6', DELIVERY_DARK_GREEN + 'F2']} style={styles.header}>
          <View style={styles.headerContent}>
            <View>
              <Text style={styles.title}>Delivery History</Text>
              <Text style={styles.subtitle}>{orders.length} deliveries completed</Text>
            </View>
            <TouchableOpacity style={styles.filterButton}><Ionicons name="filter" size={20} color="#fff" /></TouchableOpacity>
          </View>
        </LinearGradient>
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <View style={styles.skeletonSummary} />
          <View style={styles.skeletonCard} />
          <View style={styles.skeletonCard} />
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item._id}
          renderItem={renderOrder}
          renderSectionHeader={({ section: { title } }) => <SectionHeader title={title} />}
          ListHeaderComponent={<SummaryCard orders={orders} />}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <View style={styles.emptyIconContainer}><Ionicons name="time-outline" size={48} color={colors.light.text.tertiary} /></View>
              <Text style={styles.emptyTitle}>No Delivery History</Text>
              <Text style={styles.emptyText}>Completed deliveries will appear here</Text>
            </View>
          }
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          stickySectionHeadersEnabled={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[DELIVERY_GREEN]} />}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.light.background },
  headerBg: { borderBottomLeftRadius: 24, borderBottomRightRadius: 24, overflow: 'hidden' },
  header: { paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight + 20 : 60, paddingBottom: spacing.lg, paddingHorizontal: spacing.screenHorizontal },
  headerContent: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: typography.display.small.fontSize, fontWeight: '700', color: '#fff' },
  subtitle: { fontSize: typography.body.medium.fontSize, color: 'rgba(255,255,255,0.8)', marginTop: 2 },
  filterButton: { width: 44, height: 44, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.15)', justifyContent: 'center', alignItems: 'center' },
  listContent: { padding: spacing.screenHorizontal, paddingBottom: 100, paddingTop: spacing.md },
  loadingContainer: { padding: spacing.screenHorizontal },
  skeletonSummary: { height: 180, backgroundColor: colors.light.border, borderRadius: radius.xl, marginBottom: spacing.lg },
  skeletonCard: { height: 120, backgroundColor: colors.light.border, borderRadius: radius.xl, marginBottom: spacing.md },
  summaryCardBg: { marginBottom: spacing.lg, borderRadius: radius.xl, overflow: 'hidden', ...shadows.md, backgroundColor: colors.light.surface },
  summaryCard: { padding: spacing.lg },
  summaryHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md },
  summaryTitle: { fontSize: typography.title.large.fontSize, fontWeight: '600', color: '#fff' },
  summaryBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(255,255,255,0.2)', paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.sm },
  summaryBadgeText: { fontSize: typography.label.small.fontSize, fontWeight: '600', color: '#fff' },
  summaryStats: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.lg },
  summaryStat: { flex: 1, alignItems: 'center' },
  summaryValue: { fontSize: typography.headline.medium.fontSize, fontWeight: '700', color: '#fff' },
  summaryLabel: { fontSize: typography.label.small.fontSize, color: 'rgba(255,255,255,0.8)', marginTop: 2 },
  summaryDivider: { width: 1, height: 30, backgroundColor: 'rgba(255,255,255,0.2)' },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.md, marginBottom: spacing.sm },
  sectionDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: DELIVERY_GREEN, marginRight: spacing.sm },
  sectionTitle: { fontSize: typography.title.medium.fontSize, fontWeight: '600', color: colors.light.text.secondary },
  orderCardBg: { marginBottom: spacing.md, borderRadius: radius.xl, ...shadows.card, backgroundColor: colors.light.surface },
  orderCard: { padding: spacing.base, borderRadius: radius.xl },
  orderHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md },
  orderIdContainer: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  checkIcon: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#22C55E', justifyContent: 'center', alignItems: 'center' },
  orderId: { fontSize: typography.title.large.fontSize, fontWeight: '700', color: colors.light.text.primary },
  orderAmount: { fontSize: typography.headline.small.fontSize, fontWeight: '700', color: DELIVERY_GREEN },
  orderDetails: { gap: spacing.sm, marginBottom: spacing.md },
  orderDetail: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  orderDetailText: { flex: 1, fontSize: typography.body.medium.fontSize, color: colors.light.text.secondary },
  orderFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.light.borderLight },
  orderTime: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  orderTimeText: { fontSize: typography.body.small.fontSize, color: colors.light.text.tertiary },
  itemsCount: { backgroundColor: colors.light.surfaceSecondary, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.sm },
  itemsCountText: { fontSize: typography.label.small.fontSize, color: colors.light.text.secondary },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 60 },
  emptyIconContainer: { width: 80, height: 80, borderRadius: 40, backgroundColor: colors.light.surfaceSecondary, justifyContent: 'center', alignItems: 'center', marginBottom: spacing.base },
  emptyTitle: { fontSize: typography.headline.small.fontSize, fontWeight: '600', color: colors.light.text.secondary },
  emptyText: { fontSize: typography.body.medium.fontSize, color: colors.light.text.tertiary, marginTop: spacing.xs },
});
