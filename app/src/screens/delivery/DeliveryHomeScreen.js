import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView, ScrollView,
  RefreshControl, TouchableOpacity, Image, Switch, Animated, Platform, StatusBar
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../context/AuthContext';
import api from '../../config/api';
import { Card } from '../../components/ui/Card';
import { StatsCardSkeleton } from '../../components/ui/Skeleton';
import { colors, spacing, radius, typography, shadows } from '../../theme';

const DELIVERY_GREEN = '#267E3E';
const DELIVERY_DARK_GREEN = '#1B5E2E';

const StatCard = ({ icon, title, value, color, bgColor }) => (
  <View style={styles.statCard}>
    <View style={[styles.statIconContainer, { backgroundColor: bgColor }]}>
      <Ionicons name={icon} size={22} color={color} />
    </View>
    <Text style={styles.statValue}>{value}</Text>
    <Text style={styles.statTitle}>{title}</Text>
  </View>
);

export default function DeliveryHomeScreen({ navigation }) {
  const { user, logout, setUser } = useAuth();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isOnline, setIsOnline] = useState(user?.isOnline || false);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 500, useNativeDriver: true }).start();
    // Pulse animation for online indicator
    if (isOnline) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.2, duration: 1000, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 1000, useNativeDriver: true }),
        ])
      ).start();
    }
  }, [isOnline]);

  const fetchStats = async () => {
    try {
      const response = await api.get('/delivery/orders/stats');
      setStats(response.data);
    } catch (error) { console.error('Error fetching stats:', error); }
    finally { setLoading(false); setRefreshing(false); }
  };

  useEffect(() => { fetchStats(); }, []);
  const onRefresh = useCallback(() => { setRefreshing(true); fetchStats(); }, []);

  const toggleOnlineStatus = async (value) => {
    setIsOnline(value);
    try {
      await api.post('/delivery/status', { isOnline: value });
      setUser({ ...user, isOnline: value });
    } catch (error) { setIsOnline(!value); console.error('Error updating status:', error); }
  };

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good Morning';
    if (hour < 17) return 'Good Afternoon';
    return 'Good Evening';
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={DELIVERY_GREEN} />
      
      <Animated.View style={[styles.headerWrapper, { opacity: fadeAnim }]}>
        <LinearGradient colors={[DELIVERY_GREEN, DELIVERY_DARK_GREEN]} style={styles.header}>
          <View style={styles.headerContent}>
            <View style={styles.profileSection}>
              {user?.photo ? (
                <Image source={{ uri: user.photo }} style={styles.avatar} />
              ) : (
                <View style={[styles.avatar, styles.avatarPlaceholder]}>
                  <Ionicons name="person" size={22} color={DELIVERY_GREEN} />
                </View>
              )}
              <View style={styles.profileInfo}>
                <Text style={styles.greeting}>{getGreeting()}</Text>
                <Text style={styles.name}>{user?.name || 'Partner'}</Text>
              </View>
            </View>
            <View style={styles.headerActions}>
              <TouchableOpacity style={styles.headerButton}>
                <Ionicons name="notifications-outline" size={22} color="#fff" />
              </TouchableOpacity>
              <TouchableOpacity style={styles.headerButton} onPress={logout}>
                <Ionicons name="log-out-outline" size={22} color="#fff" />
              </TouchableOpacity>
            </View>
          </View>

          {/* Rating Badge */}
          <View style={styles.ratingBadge}>
            <Ionicons name="star" size={16} color="#FFD700" />
            <Text style={styles.ratingText}>{user?.avgRating?.toFixed(1) || '0.0'}</Text>
            <Text style={styles.ratingLabel}>Rating</Text>
          </View>
        </LinearGradient>
      </Animated.View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[DELIVERY_GREEN]} />}
        contentContainerStyle={styles.scrollContent}>
        
        {/* Online Toggle Card */}
        <View style={styles.onlineCard}>
          <View style={styles.onlineLeft}>
            <Animated.View style={[styles.onlineDot, { backgroundColor: isOnline ? '#22c55e' : '#9ca3af', transform: [{ scale: isOnline ? pulseAnim : 1 }] }]} />
            <View style={styles.onlineTextContainer}>
              <Text style={styles.onlineStatus}>{isOnline ? "You're Online" : "You're Offline"}</Text>
              <Text style={styles.onlineSubtext}>{isOnline ? 'Ready to receive orders' : 'Go online to start earning'}</Text>
            </View>
          </View>
          <Switch
            value={isOnline}
            onValueChange={toggleOnlineStatus}
            trackColor={{ false: '#E5E7EB', true: '#BBF7D0' }}
            thumbColor={isOnline ? DELIVERY_GREEN : '#9CA3AF'}
            ios_backgroundColor="#E5E7EB"
          />
        </View>

        {/* Today's Performance */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Today's Performance</Text>
        </View>
        
        {loading ? (
          <View style={styles.statsGrid}><StatsCardSkeleton /><StatsCardSkeleton /></View>
        ) : (
          <View style={styles.statsGrid}>
            <StatCard icon="checkmark-circle" title="Delivered" value={stats?.todayDelivered || 0} color="#22c55e" bgColor="#DCFCE7" />
            <StatCard icon="bicycle" title="Active" value={stats?.activeOrders || 0} color="#f59e0b" bgColor="#FEF3C7" />
          </View>
        )}

        {/* Overall Stats */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Overall Stats</Text>
        </View>
        
        {loading ? (
          <View style={styles.statsGrid}><StatsCardSkeleton /><StatsCardSkeleton /></View>
        ) : (
          <View style={styles.statsGrid}>
            <StatCard icon="trophy" title="Total Deliveries" value={stats?.totalDelivered || 0} color="#8b5cf6" bgColor="#EDE9FE" />
            <StatCard icon="star" title="Rating" value={user?.avgRating?.toFixed(1) || '0.0'} color="#f59e0b" bgColor="#FEF3C7" />
          </View>
        )}

        {/* Quick Actions */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Quick Actions</Text>
        </View>
        
        <TouchableOpacity style={styles.actionCard} onPress={() => navigation.navigate('MyOrders')} activeOpacity={0.8}>
          <View style={[styles.actionIcon, { backgroundColor: '#E8F5E9' }]}>
            <Ionicons name="bicycle" size={24} color={DELIVERY_GREEN} />
          </View>
          <View style={styles.actionText}>
            <Text style={styles.actionTitle}>My Active Orders</Text>
            <Text style={styles.actionSubtitle}>{stats?.activeOrders || 0} orders in progress</Text>
          </View>
          <View style={styles.actionArrow}>
            <Ionicons name="chevron-forward" size={20} color={colors.light.text.tertiary} />
          </View>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionCard} onPress={() => navigation.navigate('AvailableOrders')} activeOpacity={0.8}>
          <View style={[styles.actionIcon, { backgroundColor: '#FEF3C7' }]}>
            <Ionicons name="list" size={24} color="#F59E0B" />
          </View>
          <View style={styles.actionText}>
            <Text style={styles.actionTitle}>Available Orders</Text>
            <Text style={styles.actionSubtitle}>Find new deliveries</Text>
          </View>
          <View style={styles.actionArrow}>
            <Ionicons name="chevron-forward" size={20} color={colors.light.text.tertiary} />
          </View>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionCard} onPress={() => navigation.navigate('History')} activeOpacity={0.8}>
          <View style={[styles.actionIcon, { backgroundColor: '#DBEAFE' }]}>
            <Ionicons name="time" size={24} color="#3B82F6" />
          </View>
          <View style={styles.actionText}>
            <Text style={styles.actionTitle}>Delivery History</Text>
            <Text style={styles.actionSubtitle}>View past deliveries</Text>
          </View>
          <View style={styles.actionArrow}>
            <Ionicons name="chevron-forward" size={20} color={colors.light.text.tertiary} />
          </View>
        </TouchableOpacity>

        {/* Tips Card */}
        <View style={styles.tipsCard}>
          <LinearGradient colors={['#E8F5E9', '#F0FDF4']} style={styles.tipsGradient}>
            <View style={styles.tipsIcon}>
              <Ionicons name="bulb" size={24} color={DELIVERY_GREEN} />
            </View>
            <View style={styles.tipsContent}>
              <Text style={styles.tipsTitle}>Pro Tips</Text>
              <Text style={styles.tipsText}>• Stay online during peak hours (12-2 PM, 7-10 PM)</Text>
              <Text style={styles.tipsText}>• Maintain high ratings for priority orders</Text>
              <Text style={styles.tipsText}>• Tap address to navigate via Google Maps</Text>
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
  headerContent: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  profileSection: { flexDirection: 'row', alignItems: 'center' },
  avatar: { width: 52, height: 52, borderRadius: 18, borderWidth: 2, borderColor: 'rgba(255,255,255,0.3)' },
  avatarPlaceholder: { backgroundColor: '#fff', justifyContent: 'center', alignItems: 'center' },
  profileInfo: { marginLeft: spacing.md },
  greeting: { fontSize: typography.body.small.fontSize, color: 'rgba(255,255,255,0.8)' },
  name: { fontSize: typography.headline.small.fontSize, fontWeight: '700', color: '#fff' },
  headerActions: { flexDirection: 'row', gap: spacing.sm },
  headerButton: { width: 44, height: 44, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.15)', justifyContent: 'center', alignItems: 'center' },
  ratingBadge: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, marginTop: spacing.md, gap: spacing.xs },
  ratingText: { fontSize: typography.title.medium.fontSize, fontWeight: '700', color: '#fff' },
  ratingLabel: { fontSize: typography.label.small.fontSize, color: 'rgba(255,255,255,0.8)' },
  content: { flex: 1, padding: spacing.screenHorizontal },
  scrollContent: { paddingTop: spacing.md, paddingBottom: 100 },
  onlineCard: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: colors.light.surface, borderRadius: radius.xl, padding: spacing.base, marginBottom: spacing.md, ...shadows.card },
  onlineLeft: { flexDirection: 'row', alignItems: 'center' },
  onlineDot: { width: 14, height: 14, borderRadius: 7 },
  onlineTextContainer: { marginLeft: spacing.md },
  onlineStatus: { fontSize: typography.title.large.fontSize, fontWeight: '600', color: colors.light.text.primary },
  onlineSubtext: { fontSize: typography.body.small.fontSize, color: colors.light.text.secondary, marginTop: 2 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.lg, marginBottom: spacing.md },
  sectionTitle: { fontSize: typography.headline.small.fontSize, fontWeight: '600', color: colors.light.text.primary },
  statsGrid: { flexDirection: 'row', gap: spacing.md },
  statCard: { flex: 1, backgroundColor: colors.light.surface, borderRadius: radius.xl, padding: spacing.base, ...shadows.card },
  statIconContainer: { width: 44, height: 44, borderRadius: 14, justifyContent: 'center', alignItems: 'center', marginBottom: spacing.md },
  statValue: { fontSize: 26, fontWeight: '700', color: colors.light.text.primary },
  statTitle: { fontSize: typography.body.medium.fontSize, color: colors.light.text.secondary, marginTop: spacing.xs },
  actionCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.light.surface, borderRadius: radius.lg, padding: spacing.base, marginBottom: spacing.sm, ...shadows.sm },
  actionIcon: { width: 48, height: 48, borderRadius: 14, justifyContent: 'center', alignItems: 'center' },
  actionText: { flex: 1, marginLeft: spacing.md },
  actionTitle: { fontSize: typography.title.medium.fontSize, fontWeight: '600', color: colors.light.text.primary },
  actionSubtitle: { fontSize: typography.body.small.fontSize, color: colors.light.text.secondary, marginTop: 2 },
  actionArrow: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.light.surfaceSecondary, justifyContent: 'center', alignItems: 'center' },
  tipsCard: { marginTop: spacing.lg, borderRadius: radius.xl, overflow: 'hidden', ...shadows.sm },
  tipsGradient: { flexDirection: 'row', padding: spacing.base },
  tipsIcon: { width: 48, height: 48, borderRadius: 14, backgroundColor: 'rgba(38, 126, 62, 0.1)', justifyContent: 'center', alignItems: 'center' },
  tipsContent: { flex: 1, marginLeft: spacing.md },
  tipsTitle: { fontSize: typography.title.medium.fontSize, fontWeight: '600', color: DELIVERY_GREEN, marginBottom: spacing.sm },
  tipsText: { fontSize: typography.body.small.fontSize, color: colors.light.text.secondary, marginTop: spacing.xs, lineHeight: 18 },
});
