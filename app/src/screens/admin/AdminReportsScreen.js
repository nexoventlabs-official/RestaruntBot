import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView, ScrollView,
  RefreshControl, TouchableOpacity, ActivityIndicator, Animated, Platform, StatusBar, Alert
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import AsyncStorage from '@react-native-async-storage/async-storage';
import api, { API_BASE_URL } from '../../config/api';
import { colors, spacing, radius, typography, shadows } from '../../theme';

const REPORT_TYPES = [
  { id: 'today', label: 'Today', icon: 'today-outline' },
  { id: 'weekly', label: 'Week', icon: 'calendar-outline' },
  { id: 'monthly', label: 'Month', icon: 'calendar' },
  { id: 'yearly', label: 'Year', icon: 'calendar-number-outline' },
];

const StatCard = ({ icon, title, value, color, bgColor, delay = 0 }) => {
  const scaleAnim = useRef(new Animated.Value(0.9)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacityAnim, { toValue: 1, duration: 400, delay, useNativeDriver: true }),
      Animated.spring(scaleAnim, { toValue: 1, friction: 8, tension: 40, delay, useNativeDriver: true }),
    ]).start();
  }, [value]);

  return (
    <Animated.View style={[styles.statCard, { opacity: opacityAnim, transform: [{ scale: scaleAnim }] }]}>
      <View style={[styles.statIconContainer, { backgroundColor: bgColor }]}>
        <Ionicons name={icon} size={22} color={color} />
      </View>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statTitle}>{title}</Text>
    </Animated.View>
  );
};

const SmallStatCard = ({ icon, title, value, color, bgColor }) => (
  <View style={styles.smallStatCard}>
    <View style={[styles.smallIconContainer, { backgroundColor: bgColor }]}>
      <Ionicons name={icon} size={16} color={color} />
    </View>
    <View style={styles.smallStatInfo}>
      <Text style={styles.smallStatValue}>{value}</Text>
      <Text style={styles.smallStatTitle}>{title}</Text>
    </View>
  </View>
);

export default function AdminReportsScreen() {
  const [reportType, setReportType] = useState('today');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [reportData, setReportData] = useState(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const [sendingEmail, setSendingEmail] = useState(false);
  const [generatingPdf, setGeneratingPdf] = useState(false);

  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }).start();
  }, []);

  /* ═══ Send Email ═══ */
  const handleSendEmail = useCallback(() => {
    if (!reportData) return;
    Alert.alert('Send Report', 'Send this report via email?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Send', onPress: async () => {
        setSendingEmail(true);
        try {
          const res = await api.post('/analytics/report/send-email', { reportData, reportType });
          Alert.alert('Sent!', res.data.message || 'Report emailed successfully');
        } catch (err) {
          Alert.alert('Failed', err.response?.data?.error || 'Failed to send email');
        } finally { setSendingEmail(false); }
      }},
    ]);
  }, [reportData, reportType]);

  /* ═══ Download PDF ═══ */
  const handleDownloadPdf = useCallback(async () => {
    if (!reportData || generatingPdf) return;
    setGeneratingPdf(true);
    try {
      const token = await AsyncStorage.getItem('authToken');
      const resp = await fetch(`${API_BASE_URL}/api/analytics/report/download-pdf`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportData, reportType }),
      });
      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        throw new Error(errData.error || 'Server error');
      }
      const blob = await resp.blob();
      const reader = new FileReader();
      const base64 = await new Promise((resolve, reject) => {
        reader.onloadend = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      const fileUri = FileSystem.documentDirectory + `FoodAdmin_${reportType}_Report_${new Date().toISOString().split('T')[0]}.pdf`;
      await FileSystem.writeAsStringAsync(fileUri, base64, { encoding: FileSystem.EncodingType.Base64 });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(fileUri, { mimeType: 'application/pdf', dialogTitle: 'Share Report PDF' });
      } else {
        Alert.alert('Downloaded', 'PDF saved successfully');
      }
    } catch (err) {
      console.error('PDF download error:', err);
      Alert.alert('Error', err.message || 'Failed to download PDF report');
    } finally { setGeneratingPdf(false); }
  }, [reportData, reportType, generatingPdf]);

  const fetchReport = useCallback(async (type) => {
    try {
      const response = await api.get(`/analytics/report?type=${type}`);
      setReportData(response.data);
    } catch (error) {
      console.error('Failed to fetch report:', error);
      setReportData({ totalRevenue: 0, totalOrders: 0, totalItemsSold: 0, avgOrderValue: 0, deliveredOrders: 0, cancelledOrders: 0, refundedOrders: 0, codOrders: 0, upiOrders: 0, topSellingItems: [], leastSellingItems: [] });
    } finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { setLoading(true); fetchReport(reportType); }, [reportType, fetchReport]);
  const onRefresh = useCallback(() => { setRefreshing(true); fetchReport(reportType); }, [reportType, fetchReport]);
  const formatCurrency = (val) => `₹${(val || 0).toLocaleString('en-IN')}`;

  if (loading && !reportData) {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />
        <LinearGradient colors={[colors.zomato.red, colors.zomato.darkRed]} style={styles.header}>
          <Text style={styles.title}>Reports</Text>
        </LinearGradient>
        <ActivityIndicator size="large" color={colors.zomato.red} style={{ flex: 1 }} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

      <LinearGradient colors={[colors.zomato.red, colors.zomato.darkRed]} style={styles.header}>
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Reports & Analytics</Text>
            <Text style={styles.subtitle}>Track your business performance</Text>
          </View>
          <View style={styles.headerActions}>
            <TouchableOpacity style={styles.headerActionBtn} onPress={handleDownloadPdf} disabled={!reportData || generatingPdf}>
              {generatingPdf ? <ActivityIndicator size={16} color="#fff" /> : <Ionicons name="download-outline" size={20} color="#fff" />}
            </TouchableOpacity>
            <TouchableOpacity style={styles.headerActionBtn} onPress={handleSendEmail} disabled={!reportData || sendingEmail}>
              {sendingEmail ? <ActivityIndicator size={16} color="#fff" /> : <Ionicons name="mail-outline" size={20} color="#fff" />}
            </TouchableOpacity>
          </View>
        </View>
      </LinearGradient>

      <View style={styles.tabsContainer}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabsList}>
          {REPORT_TYPES.map((type) => (
            <TouchableOpacity key={type.id} style={[styles.tab, reportType === type.id && styles.tabActive]} onPress={() => setReportType(type.id)} activeOpacity={0.7}>
              <Ionicons name={type.icon} size={16} color={reportType === type.id ? '#fff' : colors.light.text.secondary} />
              <Text style={[styles.tabText, reportType === type.id && styles.tabTextActive]}>{type.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.zomato.red]} />}>
        <View style={styles.statsGrid}>
          <StatCard icon="cash-outline" title="Revenue" value={formatCurrency(reportData?.totalRevenue)} color="#22C55E" bgColor="#DCFCE7" delay={0} />
          <StatCard icon="receipt-outline" title="Orders" value={reportData?.totalOrders || 0} color="#3B82F6" bgColor="#DBEAFE" delay={100} />
        </View>

        <View style={styles.statsGrid}>
          <StatCard icon="cube-outline" title="Items Sold" value={reportData?.totalItemsSold || 0} color="#F59E0B" bgColor="#FEF3C7" delay={200} />
          <StatCard icon="trending-up-outline" title="Avg Order" value={formatCurrency(reportData?.avgOrderValue)} color="#8B5CF6" bgColor="#EDE9FE" delay={300} />
        </View>

        <Text style={styles.sectionTitle}>Order Status</Text>
        <View style={styles.smallStatsGrid}>
          <SmallStatCard icon="checkmark-circle" title="Delivered" value={reportData?.deliveredOrders || 0} color="#22C55E" bgColor="#DCFCE7" />
          <SmallStatCard icon="close-circle" title="Cancelled" value={reportData?.cancelledOrders || 0} color="#EF4444" bgColor="#FEE2E2" />
          <SmallStatCard icon="refresh-circle" title="Refunded" value={reportData?.refundedOrders || 0} color="#F59E0B" bgColor="#FEF3C7" />
        </View>

        <Text style={styles.sectionTitle}>Payment Methods</Text>
        <View style={styles.paymentGrid}>
          <View style={styles.paymentCard}>
            <View style={[styles.paymentIcon, { backgroundColor: '#FEF3C7' }]}>
              <Ionicons name="cash-outline" size={24} color="#F59E0B" />
            </View>
            <Text style={styles.paymentValue}>{reportData?.codOrders || 0}</Text>
            <Text style={styles.paymentLabel}>COD Orders</Text>
          </View>
          <View style={styles.paymentCard}>
            <View style={[styles.paymentIcon, { backgroundColor: '#EDE9FE' }]}>
              <Ionicons name="phone-portrait-outline" size={24} color="#8B5CF6" />
            </View>
            <Text style={styles.paymentValue}>{reportData?.upiOrders || 0}</Text>
            <Text style={styles.paymentLabel}>UPI Orders</Text>
          </View>
        </View>

        {reportData?.topSellingItems?.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>🔥 Top Selling</Text>
            <View style={styles.itemsContainer}>
              {reportData.topSellingItems.slice(0, 5).map((item, index) => (
                <View key={index} style={styles.itemCard}>
                  <View style={[styles.itemRank, { backgroundColor: index < 3 ? '#FEF3C7' : colors.light.surfaceSecondary }]}>
                    <Text style={[styles.itemRankText, { color: index < 3 ? '#F59E0B' : colors.light.text.secondary }]}>{index + 1}</Text>
                  </View>
                  <View style={styles.itemInfo}>
                    <Text style={styles.itemName} numberOfLines={1}>{item.name}</Text>
                    <View style={styles.itemMeta}>
                      <Text style={styles.itemQty}>{item.quantity} sold</Text>
                      {item.avgRating > 0 && (
                        <View style={styles.ratingBadge}>
                          <Ionicons name="star" size={10} color="#F59E0B" />
                          <Text style={styles.ratingText}>{item.avgRating?.toFixed(1)}</Text>
                        </View>
                      )}
                    </View>
                  </View>
                  <Text style={styles.itemRevenue}>{formatCurrency(item.revenue)}</Text>
                </View>
              ))}
            </View>
          </>
        )}

        {!reportData?.totalOrders && (
          <View style={styles.emptyContainer}>
            <View style={styles.emptyIconContainer}>
              <Ionicons name="bar-chart-outline" size={48} color={colors.light.text.tertiary} />
            </View>
            <Text style={styles.emptyTitle}>No data for this period</Text>
            <Text style={styles.emptyText}>Orders will appear in reports once placed</Text>
          </View>
        )}

        <View style={{ height: 100 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.light.background },
  header: { paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight + 20 : 60, paddingBottom: spacing.lg, paddingHorizontal: spacing.screenHorizontal, borderBottomLeftRadius: 24, borderBottomRightRadius: 24 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerActions: { flexDirection: 'row', gap: 8 },
  headerActionBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.2)', justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: typography.display.small.fontSize, fontWeight: '700', color: '#fff' },
  subtitle: { fontSize: typography.body.medium.fontSize, color: 'rgba(255,255,255,0.8)', marginTop: 2 },
  tabsContainer: { backgroundColor: colors.light.surface, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.light.borderLight },
  tabsList: { paddingHorizontal: spacing.screenHorizontal },
  tab: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.base, paddingVertical: spacing.sm, borderRadius: radius.full, backgroundColor: colors.light.surfaceSecondary, marginRight: spacing.sm },
  tabActive: { backgroundColor: colors.zomato.red },
  tabText: { fontSize: typography.label.medium.fontSize, color: colors.light.text.secondary, fontWeight: '500' },
  tabTextActive: { color: '#fff', fontWeight: '600' },
  content: { flex: 1, padding: spacing.screenHorizontal },
  statsGrid: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.md },
  statCard: { flex: 1, backgroundColor: colors.light.surface, borderRadius: radius.xl, padding: spacing.base, ...shadows.card },
  statIconContainer: { width: 44, height: 44, borderRadius: 14, justifyContent: 'center', alignItems: 'center', marginBottom: spacing.md },
  statValue: { fontSize: 22, fontWeight: '700', color: colors.light.text.primary },
  statTitle: { fontSize: typography.body.small.fontSize, color: colors.light.text.secondary, marginTop: spacing.xs },
  sectionTitle: { fontSize: typography.headline.small.fontSize, fontWeight: '600', color: colors.light.text.primary, marginTop: spacing.lg, marginBottom: spacing.md },
  smallStatsGrid: { flexDirection: 'row', gap: spacing.sm },
  smallStatCard: { flex: 1, backgroundColor: colors.light.surface, borderRadius: radius.lg, padding: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, ...shadows.sm },
  smallIconContainer: { width: 32, height: 32, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  smallStatInfo: { flex: 1 },
  smallStatValue: { fontSize: typography.title.large.fontSize, fontWeight: '700', color: colors.light.text.primary },
  smallStatTitle: { fontSize: typography.label.small.fontSize, color: colors.light.text.tertiary },
  paymentGrid: { flexDirection: 'row', gap: spacing.md },
  paymentCard: { flex: 1, backgroundColor: colors.light.surface, borderRadius: radius.xl, padding: spacing.base, alignItems: 'center', ...shadows.card },
  paymentIcon: { width: 48, height: 48, borderRadius: 14, justifyContent: 'center', alignItems: 'center' },
  paymentValue: { fontSize: 24, fontWeight: '700', color: colors.light.text.primary, marginTop: spacing.sm },
  paymentLabel: { fontSize: typography.body.small.fontSize, color: colors.light.text.secondary, marginTop: spacing.xs },
  itemsContainer: { backgroundColor: colors.light.surface, borderRadius: radius.xl, overflow: 'hidden', ...shadows.card },
  itemCard: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.light.borderLight },
  itemRank: { width: 28, height: 28, borderRadius: 8, justifyContent: 'center', alignItems: 'center', marginRight: spacing.md },
  itemRankText: { fontSize: typography.label.medium.fontSize, fontWeight: '700' },
  itemInfo: { flex: 1 },
  itemName: { fontSize: typography.title.medium.fontSize, fontWeight: '500', color: colors.light.text.primary },
  itemMeta: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 2 },
  itemQty: { fontSize: typography.body.small.fontSize, color: colors.light.text.secondary },
  ratingBadge: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  ratingText: { fontSize: typography.label.small.fontSize, color: '#F59E0B', fontWeight: '600' },
  itemRevenue: { fontSize: typography.title.medium.fontSize, fontWeight: '600', color: '#22C55E' },
  emptyContainer: { alignItems: 'center', paddingVertical: 60 },
  emptyIconContainer: { width: 80, height: 80, borderRadius: 40, backgroundColor: colors.light.surfaceSecondary, justifyContent: 'center', alignItems: 'center', marginBottom: spacing.base },
  emptyTitle: { fontSize: typography.headline.small.fontSize, fontWeight: '600', color: colors.light.text.secondary },
  emptyText: { fontSize: typography.body.medium.fontSize, color: colors.light.text.tertiary, marginTop: spacing.xs },
});
