import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView, ScrollView,
  RefreshControl, TouchableOpacity, Image, ActivityIndicator, Switch
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../context/AuthContext';
import api from '../../config/api';

export default function DeliveryHomeScreen() {
  const { user, logout, setUser } = useAuth();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isOnline, setIsOnline] = useState(user?.isOnline || false);

  const fetchStats = async () => {
    try {
      const response = await api.get('/delivery/orders/stats');
      setStats(response.data);
    } catch (error) {
      console.error('Error fetching stats:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchStats();
  }, []);

  const toggleOnlineStatus = async (value) => {
    setIsOnline(value);
    try {
      await api.post('/delivery/status', { isOnline: value });
      setUser({ ...user, isOnline: value });
    } catch (error) {
      setIsOnline(!value);
      console.error('Error updating status:', error);
    }
  };

  const StatCard = ({ icon, title, value, color }) => (
    <View style={[styles.statCard, { borderLeftColor: color }]}>
      <View style={[styles.iconContainer, { backgroundColor: color + '20' }]}>
        <Ionicons name={icon} size={24} color={color} />
      </View>
      <View style={styles.statInfo}>
        <Text style={styles.statValue}>{value}</Text>
        <Text style={styles.statTitle}>{title}</Text>
      </View>
    </View>
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator size="large" color="#2a9d8f" style={{ flex: 1 }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View style={styles.profileSection}>
          {user?.photo ? (
            <Image source={{ uri: user.photo }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, styles.avatarPlaceholder]}>
              <Ionicons name="person" size={24} color="#9ca3af" />
            </View>
          )}
          <View style={styles.profileInfo}>
            <Text style={styles.greeting}>Welcome back,</Text>
            <Text style={styles.name}>{user?.name || 'Delivery Partner'}</Text>
          </View>
        </View>
        <TouchableOpacity style={styles.logoutButton} onPress={logout}>
          <Ionicons name="log-out-outline" size={24} color="#ef4444" />
        </TouchableOpacity>
      </View>

      <View style={styles.onlineToggle}>
        <View style={styles.onlineInfo}>
          <View style={[styles.onlineDot, { backgroundColor: isOnline ? '#22c55e' : '#9ca3af' }]} />
          <Text style={styles.onlineText}>{isOnline ? 'You are Online' : 'You are Offline'}</Text>
        </View>
        <Switch
          value={isOnline}
          onValueChange={toggleOnlineStatus}
          trackColor={{ false: '#d1d5db', true: '#86efac' }}
          thumbColor={isOnline ? '#22c55e' : '#9ca3af'}
        />
      </View>

      <ScrollView
        style={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#2a9d8f']} />}
      >
        <Text style={styles.sectionTitle}>Today's Stats</Text>
        
        <View style={styles.statsGrid}>
          <StatCard icon="checkmark-circle" title="Delivered Today" value={stats?.todayDelivered || 0} color="#22c55e" />
          <StatCard icon="bicycle" title="Active Orders" value={stats?.activeOrders || 0} color="#f59e0b" />
        </View>

        <Text style={styles.sectionTitle}>Overall Stats</Text>
        
        <View style={styles.statsGrid}>
          <StatCard icon="trophy" title="Total Deliveries" value={stats?.totalDelivered || 0} color="#8b5cf6" />
          <StatCard icon="star" title="Rating" value={user?.avgRating?.toFixed(1) || '0.0'} color="#f59e0b" />
        </View>

        <View style={styles.tipsCard}>
          <Ionicons name="bulb-outline" size={24} color="#f59e0b" />
          <View style={styles.tipsContent}>
            <Text style={styles.tipsTitle}>Quick Tips</Text>
            <Text style={styles.tipsText}>• Stay online to receive new orders</Text>
            <Text style={styles.tipsText}>• Check "My Orders" tab for active deliveries</Text>
            <Text style={styles.tipsText}>• Tap on address to navigate via Google Maps</Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8f9fb' },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 20, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#e5e7eb',
  },
  profileSection: { flexDirection: 'row', alignItems: 'center' },
  avatar: { width: 48, height: 48, borderRadius: 24 },
  avatarPlaceholder: { backgroundColor: '#f3f4f6', justifyContent: 'center', alignItems: 'center' },
  profileInfo: { marginLeft: 12 },
  greeting: { fontSize: 14, color: '#61636b' },
  name: { fontSize: 18, fontWeight: 'bold', color: '#1c1d21' },
  logoutButton: { padding: 8 },
  onlineToggle: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: '#fff', padding: 16, marginHorizontal: 16, marginTop: 16, borderRadius: 12,
  },
  onlineInfo: { flexDirection: 'row', alignItems: 'center' },
  onlineDot: { width: 12, height: 12, borderRadius: 6, marginRight: 8 },
  onlineText: { fontSize: 16, fontWeight: '600', color: '#1c1d21' },
  content: { flex: 1, padding: 16 },
  sectionTitle: { fontSize: 18, fontWeight: '600', color: '#1c1d21', marginTop: 8, marginBottom: 12 },
  statsGrid: { flexDirection: 'row', gap: 12, marginBottom: 8 },
  statCard: {
    flex: 1, backgroundColor: '#fff', borderRadius: 12, padding: 16,
    borderLeftWidth: 4,
  },
  iconContainer: { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center', marginBottom: 12 },
  statInfo: {},
  statValue: { fontSize: 24, fontWeight: 'bold', color: '#1c1d21' },
  statTitle: { fontSize: 14, color: '#61636b', marginTop: 4 },
  tipsCard: {
    flexDirection: 'row', backgroundColor: '#fef3c7', borderRadius: 12, padding: 16, marginTop: 16,
  },
  tipsContent: { flex: 1, marginLeft: 12 },
  tipsTitle: { fontSize: 16, fontWeight: '600', color: '#92400e', marginBottom: 8 },
  tipsText: { fontSize: 14, color: '#92400e', marginTop: 4 },
});
