import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView, ScrollView,
  RefreshControl, TouchableOpacity, ActivityIndicator, FlatList
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import api from '../../config/api';

const REPORT_TYPES = [
  { id: 'today', label: 'Today' },
  { id: 'weekly', label: 'This Week' },
  { id: 'monthly', label: 'This Month' },
  { id: 'yearly', label: 'This Year' },
];

export default function AdminReportsScreen() {
  const [reportType, setReportType] = useState('today');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [reportData, setReportData] = useState(null);

  const fetchReport = useCallback(async (type) => {
    try {
      const response = await api.get(`/analytics/report?type=${type}`);
      setReportData(response.data);
    } catch (error) {
      console.error('Failed to fetch report:', error);
      setReportData({
        totalRevenue: 0,
        totalOrders: 0,
        totalItemsSold: 0,
        avgOrderValue: 0,
        deliveredOrders: 0,
        cancelledOrders: 0,
        refundedOrders: 0,
        codOrders: 0,
        upiOrders: 0,
        topSellingItems: [],
        leastSellingItems: [],
      });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchReport(reportType);
  }, [reportType, fetchReport]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchReport(reportType);
  }, [reportType, fetchReport]);

  const formatCurrency = (val) => `₹${(val || 0).toLocaleString('en-IN')}`;

  const StatCard = ({ icon, title, value, color, subtitle }) => (
    <View style={[styles.statCard, { borderLeftColor: color }]}>
      <View style={[styles.iconContainer, { backgroundColor: color + '20' }]}>
        <Ionicons name={icon} size={22} color={color} />
      </View>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statTitle}>{title}</Text>
      {subtitle && <Text style={styles.statSubtitle}>{subtitle}</Text>}
    </View>
  );

  const SmallStatCard = ({ icon, title, value, color }) => (
    <View style={styles.smallStatCard}>
      <View style={[styles.smallIconContainer, { backgroundColor: color + '20' }]}>
        <Ionicons name={icon} size={16} color={color} />
      </View>
      <View style={styles.smallStatInfo}>
        <Text style={styles.smallStatValue}>{value}</Text>
        <Text style={styles.smallStatTitle}>{title}</Text>
      </View>
    </View>
  );

  const renderTopItem = ({ item, index }) => (
    <View style={styles.topItemCard}>
      <View style={styles.topItemRank}>
        <Text style={styles.topItemRankText}>{index + 1}</Text>
      </View>
      <View style={styles.topItemInfo}>
        <Text style={styles.topItemName} numberOfLines={1}>{item.name}</Text>
        <Text style={styles.topItemQty}>{item.quantity} sold</Text>
      </View>
      <Text style={styles.topItemRevenue}>{formatCurrency(item.revenue)}</Text>
    </View>
  );

  if (loading && !reportData) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Reports</Text>
        </View>
        <ActivityIndicator size="large" color="#e63946" style={{ flex: 1 }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Reports & Analytics</Text>
      </View>

      {/* Report Type Tabs */}
      <View style={styles.tabsContainer}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabsList}>
          {REPORT_TYPES.map((type) => (
            <TouchableOpacity
              key={type.id}
              style={[styles.tab, reportType === type.id && styles.tabActive]}
              onPress={() => setReportType(type.id)}
            >
              <Ionicons 
                name="calendar-outline" 
                size={16} 
                color={reportType === type.id ? '#fff' : '#61636b'} 
              />
              <Text style={[styles.tabText, reportType === type.id && styles.tabTextActive]}>
                {type.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <ScrollView
        style={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#e63946']} />}
      >
        {/* Main Stats */}
        <View style={styles.statsGrid}>
          <StatCard
            icon="cash-outline"
            title="Total Revenue"
            value={formatCurrency(reportData?.totalRevenue)}
            color="#22c55e"
          />
          <StatCard
            icon="receipt-outline"
            title="Total Orders"
            value={reportData?.totalOrders || 0}
            color="#3b82f6"
          />
        </View>

        <View style={styles.statsGrid}>
          <StatCard
            icon="cube-outline"
            title="Items Sold"
            value={reportData?.totalItemsSold || 0}
            color="#f59e0b"
          />
          <StatCard
            icon="trending-up-outline"
            title="Avg Order Value"
            value={formatCurrency(reportData?.avgOrderValue)}
            color="#8b5cf6"
          />
        </View>

        {/* Order Status Breakdown */}
        <Text style={styles.sectionTitle}>Order Status</Text>
        <View style={styles.smallStatsGrid}>
          <SmallStatCard icon="checkmark-circle" title="Delivered" value={reportData?.deliveredOrders || 0} color="#22c55e" />
          <SmallStatCard icon="close-circle" title="Cancelled" value={reportData?.cancelledOrders || 0} color="#ef4444" />
          <SmallStatCard icon="refresh-circle" title="Refunded" value={reportData?.refundedOrders || 0} color="#f59e0b" />
        </View>

        {/* Payment Breakdown */}
        <Text style={styles.sectionTitle}>Payment Methods</Text>
        <View style={styles.paymentGrid}>
          <View style={styles.paymentCard}>
            <Ionicons name="cash-outline" size={24} color="#f59e0b" />
            <Text style={styles.paymentValue}>{reportData?.codOrders || 0}</Text>
            <Text style={styles.paymentLabel}>COD Orders</Text>
          </View>
          <View style={styles.paymentCard}>
            <Ionicons name="phone-portrait-outline" size={24} color="#8b5cf6" />
            <Text style={styles.paymentValue}>{reportData?.upiOrders || 0}</Text>
            <Text style={styles.paymentLabel}>UPI Orders</Text>
          </View>
        </View>

        {/* Top Selling Items */}
        {reportData?.topSellingItems?.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>🔥 Top Selling Items</Text>
            <View style={styles.topItemsContainer}>
              {reportData.topSellingItems.slice(0, 5).map((item, index) => (
                <View key={index} style={styles.topItemCard}>
                  <View style={[styles.topItemRank, { backgroundColor: index < 3 ? '#fef3c7' : '#f3f4f6' }]}>
                    <Text style={[styles.topItemRankText, { color: index < 3 ? '#f59e0b' : '#61636b' }]}>
                      {index + 1}
                    </Text>
                  </View>
                  <View style={styles.topItemInfo}>
                    <Text style={styles.topItemName} numberOfLines={1}>{item.name}</Text>
                    <View style={styles.topItemMeta}>
                      <Text style={styles.topItemQty}>{item.quantity} sold</Text>
                      {item.avgRating > 0 && (
                        <View style={styles.ratingBadge}>
                          <Ionicons name="star" size={10} color="#f59e0b" />
                          <Text style={styles.ratingText}>{item.avgRating?.toFixed(1)}</Text>
                        </View>
                      )}
                    </View>
                  </View>
                  <Text style={styles.topItemRevenue}>{formatCurrency(item.revenue)}</Text>
                </View>
              ))}
            </View>
          </>
        )}

        {/* Least Selling Items */}
        {reportData?.leastSellingItems?.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>📉 Least Selling Items</Text>
            <View style={styles.topItemsContainer}>
              {reportData.leastSellingItems.slice(0, 5).map((item, index) => (
                <View key={index} style={styles.topItemCard}>
                  <View style={[styles.topItemRank, { backgroundColor: '#fee2e2' }]}>
                    <Text style={[styles.topItemRankText, { color: '#ef4444' }]}>
                      {index + 1}
                    </Text>
                  </View>
                  <View style={styles.topItemInfo}>
                    <Text style={styles.topItemName} numberOfLines={1}>{item.name}</Text>
                    <Text style={styles.topItemQty}>{item.quantity} sold</Text>
                  </View>
                  <Text style={styles.topItemRevenue}>{formatCurrency(item.revenue)}</Text>
                </View>
              ))}
            </View>
          </>
        )}

        {/* Empty State */}
        {!reportData?.totalOrders && (
          <View style={styles.emptyContainer}>
            <Ionicons name="bar-chart-outline" size={64} color="#d1d5db" />
            <Text style={styles.emptyText}>No data for this period</Text>
            <Text style={styles.emptySubtext}>Orders will appear in reports once placed</Text>
          </View>
        )}

        <View style={{ height: 24 }} />
      </ScrollView>
    </SafeAreaView>
  );
}


const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8f9fb' },
  header: { 
    padding: 20, 
    backgroundColor: '#fff', 
    borderBottomWidth: 1, 
    borderBottomColor: '#e5e7eb' 
  },
  title: { fontSize: 24, fontWeight: 'bold', color: '#1c1d21' },
  tabsContainer: { 
    backgroundColor: '#fff', 
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  tabsList: { paddingHorizontal: 16 },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: '#f3f4f6',
    marginRight: 8,
  },
  tabActive: {
    backgroundColor: '#e63946',
  },
  tabText: {
    fontSize: 14,
    color: '#61636b',
    fontWeight: '500',
  },
  tabTextActive: {
    color: '#fff',
    fontWeight: '600',
  },
  content: { flex: 1, padding: 16 },
  statsGrid: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    borderLeftWidth: 4,
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  statValue: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#1c1d21',
  },
  statTitle: {
    fontSize: 13,
    color: '#61636b',
    marginTop: 4,
  },
  statSubtitle: {
    fontSize: 11,
    color: '#9ca3af',
    marginTop: 2,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1c1d21',
    marginTop: 16,
    marginBottom: 12,
  },
  smallStatsGrid: {
    flexDirection: 'row',
    gap: 8,
  },
  smallStatCard: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  smallIconContainer: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  smallStatInfo: {
    flex: 1,
  },
  smallStatValue: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#1c1d21',
  },
  smallStatTitle: {
    fontSize: 11,
    color: '#61636b',
  },
  paymentGrid: {
    flexDirection: 'row',
    gap: 12,
  },
  paymentCard: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  paymentValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1c1d21',
    marginTop: 8,
  },
  paymentLabel: {
    fontSize: 12,
    color: '#61636b',
    marginTop: 4,
  },
  topItemsContainer: {
    backgroundColor: '#fff',
    borderRadius: 12,
    overflow: 'hidden',
  },
  topItemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  topItemRank: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#f3f4f6',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  topItemRankText: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#61636b',
  },
  topItemInfo: {
    flex: 1,
  },
  topItemName: {
    fontSize: 14,
    fontWeight: '500',
    color: '#1c1d21',
  },
  topItemMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 2,
  },
  topItemQty: {
    fontSize: 12,
    color: '#61636b',
  },
  ratingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  ratingText: {
    fontSize: 11,
    color: '#f59e0b',
    fontWeight: '600',
  },
  topItemRevenue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#22c55e',
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyText: {
    fontSize: 16,
    color: '#61636b',
    marginTop: 12,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#9ca3af',
    marginTop: 4,
  },
});
