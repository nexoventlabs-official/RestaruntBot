import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView, ScrollView,
  RefreshControl, TouchableOpacity, ActivityIndicator, Animated, Platform,
  Dimensions, StatusBar
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../context/AuthContext';
import api from '../../config/api';
import { colors, spacing, radius, typography, shadows } from '../../theme';

const { width } = Dimensions.get('window');

const StatCard = ({ icon, title, value, color, bgColor, subtitle, delay = 0, onPress }) => {
  const scaleAnim = useRef(new Animated.Value(0.9)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacityAnim, { toValue: 1, duration: 400, delay, useNativeDriver: true }),
      Animated.spring(scaleAnim, { toValue: 1, friction: 8, tension: 40, delay, useNativeDriver: true }),
    ]).start();
  }, []);

  return (
    <Animated.View style={{ opacity: opacityAnim, transform: [{ scale: scaleAnim }] }}>
      <TouchableOpacity style={styles.statCard} activeOpacity={0.8} onPress={onPress}>
        <View style={[styles.statIconContainer, { backgroundColor: bgColor }]}>
          <Ionicons name={icon} size={22} color={color} />
        </View>
        <Text style={styles.statValue}>{value}</Text>
        <Text style={styles.statTitle}>{title}</Text>
        {subtitle && <Text style={styles.statSubtitle}>{subtitle}</Text>}
      </TouchableOpacity>
    </Animated.View>
  );
};

const QuickActionCard = ({ icon, title, subtitle, color, onPress }) => (
  <TouchableOpacity style={styles.quickActionCard} onPress={onPress} activeOpacity={0.8}>
    <View style={[styles.quickActionIcon, { backgroundColor: color + '15' }]}>
      <Ionicons name={icon} size={24} color={color} />
    </View>
    <View style={styles.quickActionContent}>
      <Text style={styles.quickActionTitle}>{title}</Text>
      <Text style={styles.quickActionSubtitle}>{subtitle}</Text>
    </View>
    <View style={styles.quickActionArrow}>
      <Ionicons name="chevron-forward" size={20} color={colors.light.text.tertiary} />
    </View>
  </TouchableOpacity>
);

export default function AdminHomeScreen({ navigation }) {
  const { user, logout } = useAuth();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 500, useNativeDriver: true }).start();
  }, []);

  const fetchStats = async () => {
    try {
      const [ordersRes, menuRes, deliveryRes] = await Promise.all([
        api.get('/orders?limit=100'), api.get('/menu'), api.get('/delivery'),
      ]);
      const orders = ordersRes.data.orders || [];
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const todayOrders = orders.filter(o => new Date(o.createdAt) >= today);
      const pendingOrders = orders.filter(o => ['pending', 'confirmed', 'preparing'].includes(o.status));
      const deliveryOrders = orders.filter(o => ['ready', 'out_for_delivery'].includes(o.status));
      setStats({
        todayOrders: todayOrders.length, pendingOrders: pendingOrders.length,
        deliveryOrders: deliveryOrders.length, totalMenu: menuRes.data.length,
        activeDelivery: deliveryRes.data.filter(d => d.isOnline).length,
        totalDelivery: deliveryRes.data.length,
        todayRevenue: todayOrders.filter(o => o.paymentStatus === 'paid').reduce((sum, o) => sum + o.totalAmount, 0),
      });
    } catch (error) { console.error('Error fetching stats:', error); }
    finally { setLoading(false); setRefreshing(false); }
  };

  useEffect(() => { fetchStats(); }, []);
  const onRefresh = useCallback(() => { setRefreshing(true); fetchStats(); }, []);
  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good Morning';
    if (hour < 17) return 'Good Afternoon';
    return 'Good Evening';
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor={colors.zomato.red} />
        <ActivityIndicator size="large" color={colors.zomato.red} style={{ flex: 1 }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={colors.zomato.red} />
      <Animated.View style={[styles.headerWrapper, { opacity: fadeAnim }]}>
        <LinearGradient colors={[colors.zomato.red, colors.zomato.darkRed]} style={styles.header}>
          <View style={styles.headerContent}>
            <View style={styles.profileSection}>
              <View style={styles.avatarContainer}>
                <Ionicons name="person" size={22} color={colors.zomato.red} />
              </View>
              <View style={styles.profileInfo}>
                <Text style={styles.greeting}>{getGreeting()}</Text>
                <Text style={styles.username}>{user?.username || 'Admin'}</Text>
              </View>
            </View>
            <View style={styles.headerActions}>
              <TouchableOpacity style={styles.headerButton}>
                <Ionicons name="notifications-outline" size={22} color="#fff" />
                <View style={styles.notificationBadge} />
              </TouchableOpacity>
              <TouchableOpacity style={styles.headerButton} onPress={logout}>
                <Ionicons name="log-out-outline" size={22} color="#fff" />
              </TouchableOpacity>
            </View>
          </View>
          <View style={styles.revenueCard}>
            <View style={styles.revenueLeft}>
              <Text style={styles.revenueLabel}>Today's Revenue</Text>
              <Text style={styles.revenueValue}>₹{(stats?.todayRevenue || 0).toLocaleString('en-IN')}</Text>
            </View>
            <View style={styles.revenueDivider} />
            <View style={styles.revenueRight}>
              <Text style={styles.revenueLabel}>Orders</Text>
              <Text style={styles.revenueOrders}>{stats?.todayOrders || 0}</Text>
            </View>
          </View>
        </LinearGradient>
      </Animated.View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.zomato.red]} />}
        contentContainerStyle={styles.scrollContent}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Order Status</Text>
          <TouchableOpacity onPress={() => navigation.navigate('Orders')}>
            <Text style={styles.seeAllText}>See All</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.statsGrid}>
          <StatCard icon="time-outline" title="Pending" value={stats?.pendingOrders || 0}
            color={colors.warning.main} bgColor={colors.warning.light} delay={0} onPress={() => navigation.navigate('Orders')} />
          <StatCard icon="bicycle-outline" title="In Delivery" value={stats?.deliveryOrders || 0}
            color={colors.info.main} bgColor={colors.info.light} delay={100} onPress={() => navigation.navigate('Orders')} />
        </View>

        <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>Resources</Text></View>
        <View style={styles.statsGrid}>
          <StatCard icon="restaurant-outline" title="Menu Items" value={stats?.totalMenu || 0}
            color="#8B5CF6" bgColor="#EDE9FE" delay={200} onPress={() => navigation.navigate('Menu')} />
          <StatCard icon="people-outline" title="Partners" value={`${stats?.activeDelivery || 0}/${stats?.totalDelivery || 0}`}
            color={colors.success.main} bgColor={colors.success.light} subtitle="Online / Total" delay={300} onPress={() => navigation.navigate('Delivery')} />
        </View>

        <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>Quick Actions</Text></View>
        <View style={styles.quickActionsContainer}>
          <QuickActionCard icon="add-circle-outline" title="Add Menu Item" subtitle="Create new dish"
            color={colors.zomato.red} onPress={() => navigation.navigate('Menu')} />
          <QuickActionCard icon="pricetag-outline" title="Manage Offers" subtitle="Create promotions"
            color="#F59E0B" onPress={() => navigation.navigate('Offers')} />
          <QuickActionCard icon="bar-chart-outline" title="View Reports" subtitle="Analytics & insights"
            color="#8B5CF6" onPress={() => navigation.navigate('Reports')} />
        </View>

        <View style={styles.tipsCard}>
          <LinearGradient colors={[colors.primary[50], '#FFF5F5']} style={styles.tipsGradient}>
            <View style={styles.tipsIcon}><Ionicons name="bulb" size={24} color={colors.zomato.red} /></View>
            <View style={styles.tipsContent}>
              <Text style={styles.tipsTitle}>Pro Tips</Text>
              <Text style={styles.tipsText}>• Monitor pending orders regularly</Text>
              <Text style={styles.tipsText}>• Keep menu items updated with stock</Text>
              <Text style={styles.tipsText}>• Check delivery partner availability</Text>
            </View>
          </LinearGradient>
        </View>
        <View style={{ height: 100 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.light.background },
  headerWrapper: { zIndex: 100, elevation: 100 },
  header: { paddingTop: Platform.OS === 'android' ? 50 : 16, paddingBottom: spacing.xl, paddingHorizontal: spacing.screenHorizontal, borderBottomLeftRadius: 28, borderBottomRightRadius: 28 },
  headerContent: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.lg },
  profileSection: { flexDirection: 'row', alignItems: 'center' },
  avatarContainer: { width: 48, height: 48, borderRadius: 16, backgroundColor: '#fff', justifyContent: 'center', alignItems: 'center' },
  profileInfo: { marginLeft: spacing.md },
  greeting: { fontSize: typography.body.small.fontSize, color: 'rgba(255,255,255,0.8)' },
  username: { fontSize: typography.headline.small.fontSize, fontWeight: '700', color: '#fff' },
  headerActions: { flexDirection: 'row', gap: spacing.sm },
  headerButton: { width: 44, height: 44, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.15)', justifyContent: 'center', alignItems: 'center' },
  notificationBadge: { position: 'absolute', top: 10, right: 10, width: 8, height: 8, borderRadius: 4, backgroundColor: '#FFD700' },
  revenueCard: { flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: radius.xl, padding: spacing.lg, alignItems: 'center' },
  revenueLeft: { flex: 1 },
  revenueLabel: { fontSize: typography.body.small.fontSize, color: 'rgba(255,255,255,0.8)' },
  revenueValue: { fontSize: 28, fontWeight: '700', color: '#fff', marginTop: spacing.xs },
  revenueDivider: { width: 1, height: 40, backgroundColor: 'rgba(255,255,255,0.2)', marginHorizontal: spacing.lg },
  revenueRight: { alignItems: 'center' },
  revenueOrders: { fontSize: 28, fontWeight: '700', color: '#fff', marginTop: spacing.xs },
  content: { flex: 1, padding: spacing.screenHorizontal },
  scrollContent: { paddingTop: spacing.md, paddingBottom: 100 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.lg, marginBottom: spacing.md },
  sectionTitle: { fontSize: typography.headline.small.fontSize, fontWeight: '600', color: colors.light.text.primary },
  seeAllText: { fontSize: typography.label.large.fontSize, fontWeight: '600', color: colors.zomato.red },
  statsGrid: { flexDirection: 'row', gap: spacing.md },
  statCard: { flex: 1, backgroundColor: colors.light.surface, borderRadius: radius.xl, padding: spacing.base, ...shadows.card },
  statIconContainer: { width: 44, height: 44, borderRadius: 14, justifyContent: 'center', alignItems: 'center', marginBottom: spacing.md },
  statValue: { fontSize: 26, fontWeight: '700', color: colors.light.text.primary },
  statTitle: { fontSize: typography.body.medium.fontSize, color: colors.light.text.secondary, marginTop: spacing.xs },
  statSubtitle: { fontSize: typography.label.small.fontSize, color: colors.light.text.tertiary, marginTop: 2 },
  quickActionsContainer: { gap: spacing.sm },
  quickActionCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.light.surface, borderRadius: radius.lg, padding: spacing.base, ...shadows.sm },
  quickActionIcon: { width: 48, height: 48, borderRadius: 14, justifyContent: 'center', alignItems: 'center' },
  quickActionContent: { flex: 1, marginLeft: spacing.md },
  quickActionTitle: { fontSize: typography.title.medium.fontSize, fontWeight: '600', color: colors.light.text.primary },
  quickActionSubtitle: { fontSize: typography.body.small.fontSize, color: colors.light.text.secondary, marginTop: 2 },
  quickActionArrow: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.light.surfaceSecondary, justifyContent: 'center', alignItems: 'center' },
  tipsCard: { marginTop: spacing.lg, borderRadius: radius.xl, overflow: 'hidden', ...shadows.sm },
  tipsGradient: { flexDirection: 'row', padding: spacing.base },
  tipsIcon: { width: 48, height: 48, borderRadius: 14, backgroundColor: 'rgba(226, 55, 68, 0.1)', justifyContent: 'center', alignItems: 'center' },
  tipsContent: { flex: 1, marginLeft: spacing.md },
  tipsTitle: { fontSize: typography.title.medium.fontSize, fontWeight: '600', color: colors.zomato.red, marginBottom: spacing.sm },
  tipsText: { fontSize: typography.body.small.fontSize, color: colors.light.text.secondary, marginTop: spacing.xs, lineHeight: 18 },
});
