import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  RefreshControl, TouchableOpacity, ActivityIndicator, Animated, Platform,
  Dimensions, StatusBar
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../context/AuthContext';
import api from '../../config/api';
import { colors, spacing, radius, typography, shadows } from '../../theme';
import { StatCard, ActionCard, InfoCard, MetricCard, Card } from '../../components/ui';

const { width } = Dimensions.get('window');

export default function AdminHomeScreen({ navigation }) {
  const { user, logout } = useAuth();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
      Animated.spring(slideAnim, { toValue: 0, friction: 8, tension: 40, useNativeDriver: true }),
    ]).start();
  }, []);

  const fetchStats = async () => {
    try {
      const [ordersRes, menuRes, deliveryRes] = await Promise.all([
        api.get('/orders?limit=100'), api.get('/menu'), api.get('/delivery'),
      ]);
      const orders = ordersRes.data.orders || [];
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);

      const todayOrders = orders.filter(o => new Date(o.createdAt) >= today);
      const yesterdayOrders = orders.filter(o => {
        const d = new Date(o.createdAt);
        return d >= yesterday && d < today;
      });
      const pendingOrders = orders.filter(o => ['pending', 'confirmed', 'preparing'].includes(o.status));
      const deliveryOrders = orders.filter(o => ['ready', 'out_for_delivery'].includes(o.status));

      const todayRevenue = todayOrders.filter(o => o.paymentStatus === 'paid').reduce((sum, o) => sum + o.totalAmount, 0);
      const yesterdayRevenue = yesterdayOrders.filter(o => o.paymentStatus === 'paid').reduce((sum, o) => sum + o.totalAmount, 0);

      setStats({
        todayOrders: todayOrders.length,
        yesterdayOrders: yesterdayOrders.length,
        pendingOrders: pendingOrders.length,
        deliveryOrders: deliveryOrders.length,
        totalMenu: menuRes.data.length,
        activeDelivery: deliveryRes.data.filter(d => d.isOnline).length,
        totalDelivery: deliveryRes.data.length,
        todayRevenue,
        yesterdayRevenue,
        revenueTrend: todayRevenue >= yesterdayRevenue ? 'up' : 'down',
        ordersTrend: todayOrders.length >= yesterdayOrders.length ? 'up' : 'down',
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
      <View style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />
        <ActivityIndicator size="large" color={colors.zomato.red} style={{ flex: 1 }} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

      {/* Premium Header - Reverted to LinearGradient */}
      <Animated.View style={[styles.headerWrapper, { opacity: fadeAnim }]}>
        <LinearGradient
          colors={[colors.zomato.red, colors.zomato.darkRed, '#8B1A1A']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.header}
        >
          <View style={styles.headerContent}>
            <View style={styles.profileSection}>
              <View style={styles.avatarContainer}>
                <LinearGradient
                  colors={['#fff', '#f8f8f8']}
                  style={styles.avatarGradient}
                >
                  <Ionicons name="person" size={22} color={colors.zomato.red} />
                </LinearGradient>
              </View>
              <View style={styles.profileInfo}>
                <Text style={styles.greeting}>{getGreeting()}</Text>
                <Text style={styles.username}>{user?.username || 'Admin'}</Text>
              </View>
            </View>
            <View style={styles.headerActions}>
              <TouchableOpacity style={styles.headerButton}>
                <Ionicons name="notifications-outline" size={22} color="#fff" />
                <View style={styles.notificationBadge}>
                  <Text style={styles.notificationCount}>3</Text>
                </View>
              </TouchableOpacity>
              <TouchableOpacity style={styles.headerButton} onPress={logout}>
                <Ionicons name="log-out-outline" size={22} color="#fff" />
              </TouchableOpacity>
            </View>
          </View>

          {/* Premium Revenue Card - Reverted to standard look within Gradient */}
          <View style={styles.revenueCard}>
            <View style={styles.revenueGlow} />
            <View style={styles.revenueContent}>
              <View style={styles.revenueLeft}>
                <View style={styles.revenueLabelRow}>
                  <Ionicons name="wallet-outline" size={16} color="rgba(255,255,255,0.8)" />
                  <Text style={styles.revenueLabel}>Today's Revenue</Text>
                </View>
                <Text style={styles.revenueValue}>₹{(stats?.todayRevenue || 0).toLocaleString('en-IN')}</Text>
                {stats?.revenueTrend && (
                  <View style={[styles.trendBadge, { backgroundColor: stats.revenueTrend === 'up' ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)' }]}>
                    <Ionicons
                      name={stats.revenueTrend === 'up' ? 'trending-up' : 'trending-down'}
                      size={12}
                      color={stats.revenueTrend === 'up' ? '#22C55E' : '#EF4444'}
                    />
                    <Text style={[styles.trendText, { color: stats.revenueTrend === 'up' ? '#22C55E' : '#EF4444' }]}>
                      vs yesterday
                    </Text>
                  </View>
                )}
              </View>
              <View style={styles.revenueDivider} />
              <View style={styles.revenueRight}>
                <View style={styles.revenueLabelRow}>
                  <Ionicons name="receipt-outline" size={16} color="rgba(255,255,255,0.8)" />
                  <Text style={styles.revenueLabel}>Orders</Text>
                </View>
                <Text style={styles.revenueOrders}>{stats?.todayOrders || 0}</Text>
                <View style={styles.ordersBadge}>
                  <Text style={styles.ordersSubtext}>today</Text>
                </View>
              </View>
            </View>
          </View>
        </LinearGradient>
      </Animated.View>

      <ScrollView
        style={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.zomato.red]} />}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Order Status Section */}
        <Animated.View style={[styles.section, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionTitleRow}>
              <View style={styles.sectionIconContainer}>
                <Ionicons name="pulse-outline" size={18} color={colors.zomato.red} />
              </View>
              <Text style={styles.sectionTitle}>Live Status</Text>
            </View>
            <TouchableOpacity style={styles.seeAllButton} onPress={() => navigation.navigate('Orders')}>
              <Text style={styles.seeAllText}>View All</Text>
              <Ionicons name="arrow-forward" size={14} color={colors.zomato.red} />
            </TouchableOpacity>
          </View>

          <View style={styles.statsGrid}>
            <StatCard
              icon="time-outline"
              title="Pending"
              value={stats?.pendingOrders || 0}
              color={colors.warning.main}
              bgColor={colors.warning.light}
              trend={stats?.pendingOrders > 0 ? 'up' : null}
              animated={true}
              animationDelay={0}
              onPress={() => navigation.navigate('Orders')}
            />
            <StatCard
              icon="bicycle-outline"
              title="In Delivery"
              value={stats?.deliveryOrders || 0}
              color={colors.info.main}
              bgColor={colors.info.light}
              animated={true}
              animationDelay={100}
              onPress={() => navigation.navigate('Orders')}
            />
          </View>
        </Animated.View>

        {/* Resources Section */}
        <Animated.View style={[styles.section, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionTitleRow}>
              <View style={[styles.sectionIconContainer, { backgroundColor: '#8B5CF615' }]}>
                <Ionicons name="grid-outline" size={18} color="#8B5CF6" />
              </View>
              <Text style={styles.sectionTitle}>Resources</Text>
            </View>
          </View>

          <View style={styles.statsGrid}>
            <StatCard
              icon="restaurant-outline"
              title="Menu Items"
              value={stats?.totalMenu || 0}
              color="#8B5CF6"
              bgColor="#EDE9FE"
              animated={true}
              animationDelay={200}
              onPress={() => navigation.navigate('Menu')}
            />
            <StatCard
              icon="people-outline"
              title="Partners"
              value={`${stats?.activeDelivery || 0}/${stats?.totalDelivery || 0}`}
              subtitle="Online / Total"
              color={colors.success.main}
              bgColor={colors.success.light}
              animated={true}
              animationDelay={300}
              onPress={() => navigation.navigate('Delivery')}
            />
          </View>
        </Animated.View>

        {/* Quick Actions Section */}
        <Animated.View style={[styles.section, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionTitleRow}>
              <View style={[styles.sectionIconContainer, { backgroundColor: colors.zomato.red + '15' }]}>
                <Ionicons name="flash-outline" size={18} color={colors.zomato.red} />
              </View>
              <Text style={styles.sectionTitle}>Quick Actions</Text>
            </View>
          </View>

          <View style={styles.actionsContainer}>
            <ActionCard
              icon="add-circle-outline"
              title="Add Menu Item"
              subtitle="Create new dish"
              color={colors.zomato.red}
              onPress={() => navigation.navigate('Menu')}
            />
            <ActionCard
              icon="pricetag-outline"
              title="Manage Offers"
              subtitle="Create promotions"
              color="#F59E0B"
              badge="NEW"
              badgeColor="#F59E0B"
              onPress={() => navigation.navigate('Offers')}
            />
            <ActionCard
              icon="bar-chart-outline"
              title="View Reports"
              subtitle="Analytics & insights"
              color="#8B5CF6"
              onPress={() => navigation.navigate('Reports')}
            />
          </View>
        </Animated.View>

        {/* Pro Tips Card */}
        <Animated.View style={[styles.section, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
          <InfoCard
            icon="bulb"
            title="Pro Tips"
            iconColor={colors.zomato.red}
            gradientColors={[colors.primary[50], '#FFF5F5']}
          >
            <View style={styles.tipsContent}>
              <View style={styles.tipItem}>
                <View style={styles.tipDot} />
                <Text style={styles.tipText}>Monitor pending orders regularly</Text>
              </View>
              <View style={styles.tipItem}>
                <View style={styles.tipDot} />
                <Text style={styles.tipText}>Keep menu items updated with stock</Text>
              </View>
              <View style={styles.tipItem}>
                <View style={styles.tipDot} />
                <Text style={styles.tipText}>Check delivery partner availability</Text>
              </View>
            </View>
          </InfoCard>
        </Animated.View>

        <View style={{ height: 100 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.light.background,
  },
  headerWrapper: {
    zIndex: 100,
    elevation: 100,
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
    overflow: 'hidden',
  },
  header: {
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight + 20 : 60,
    paddingBottom: spacing.xl + 10,
    paddingHorizontal: spacing.screenHorizontal,
  },
  headerContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  profileSection: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarContainer: {
    width: 52,
    height: 52,
    borderRadius: 18,
    overflow: 'hidden',
    ...shadows.md,
  },
  avatarGradient: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  profileInfo: {
    marginLeft: spacing.md,
  },
  greeting: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.75)',
    fontWeight: '500',
  },
  username: {
    fontSize: 20,
    fontWeight: '700',
    color: '#fff',
    marginTop: 2,
  },
  headerActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  headerButton: {
    width: 46,
    height: 46,
    borderRadius: 15,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  notificationBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#FFD700',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  notificationCount: {
    fontSize: 10,
    fontWeight: '700',
    color: '#000',
  },

  // Premium Revenue Card
  revenueCard: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: radius.xl + 4,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    overflow: 'hidden',
  },
  revenueGlow: {
    position: 'absolute',
    top: -50,
    right: -50,
    width: 150,
    height: 150,
    borderRadius: 75,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  revenueContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  revenueLeft: {
    flex: 1,
  },
  revenueLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  revenueLabel: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.8)',
    fontWeight: '500',
  },
  revenueValue: {
    fontSize: 32,
    fontWeight: '800',
    color: '#fff',
    marginTop: spacing.sm,
    letterSpacing: -1,
  },
  trendBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.full,
    marginTop: spacing.sm,
    gap: 4,
  },
  trendText: {
    fontSize: 11,
    fontWeight: '600',
  },
  revenueDivider: {
    width: 1,
    height: 70,
    backgroundColor: 'rgba(255,255,255,0.2)',
    marginHorizontal: spacing.lg,
  },
  revenueRight: {
    alignItems: 'center',
    minWidth: 80,
  },
  revenueOrders: {
    fontSize: 32,
    fontWeight: '800',
    color: '#fff',
    marginTop: spacing.sm,
  },
  ordersBadge: {
    backgroundColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.full,
    marginTop: spacing.xs,
  },
  ordersSubtext: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.8)',
    fontWeight: '500',
  },

  // Content
  content: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.screenHorizontal,
    paddingTop: spacing.lg,
    paddingBottom: 100,
  },

  // Sections
  section: {
    marginBottom: spacing.lg,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  sectionIconContainer: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: colors.zomato.red + '15',
    justifyContent: 'center',
    alignItems: 'center',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.light.text.primary,
  },
  seeAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.zomato.red + '10',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
  },
  seeAllText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.zomato.red,
  },

  // Stats Grid
  statsGrid: {
    flexDirection: 'row',
    gap: spacing.md,
  },

  // Actions
  actionsContainer: {
    gap: spacing.sm,
  },

  // Tips
  tipsContent: {
    gap: spacing.sm,
  },
  tipItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  tipDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.zomato.red,
  },
  tipText: {
    fontSize: 13,
    color: colors.light.text.secondary,
    lineHeight: 18,
  },
});
