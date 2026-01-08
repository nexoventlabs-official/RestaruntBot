import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView, ScrollView,
  RefreshControl, TouchableOpacity, ActivityIndicator
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../context/AuthContext';
import api from '../../config/api';

export default function AdminHomeScreen() {
  const { user, logout } = useAuth();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchStats = async () => {
    try {
      const [ordersRes, menuRes, deliveryRes] = await Promise.all([
        api.get('/orders?limit=100'),
        api.get('/menu'),
        api.get('/delivery'),
      ]);

      const orders = ordersRes.data.orders || [];
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const todayOrders = orders.filter(o => new Date(o.createdAt) >= today);
      const pendingOrders = orders.filter(o => ['pending', 'confirmed', 'preparing'].includes(o.status));
      const deliveryOrders = orders.filter(o => ['ready', 'out_for_delivery'].includes(o.status));

      setStats({
        todayOrders: todayOrders.length,
        pendingOrders: pendingOrders.length,
        deliveryOrders: deliveryOrders.length,
        totalMenu: menuRes.data.length,
        activeDelivery: deliveryRes.data.filter(d => d.isOnline).length,
        totalDelivery: deliveryRes.data.length,
        todayRevenue: todayOrders.filter(o => o.paymentStatus === 'paid').reduce((sum, o) => sum + o.totalAmount, 0),
      });
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

  const StatCard = ({ icon, title, value, color, subtitle }) => (
    <View style={[styles.statCard, { borderLeftColor: color }]}>
      <View style={[styles.iconContainer, { backgroundColor: color + '20' }]}>
        <Ionicons name={icon} size={24} color={color} />
      </View>
      <View style={styles.statInfo}>
        <Text style={styles.statValue}>{value}</Text>
        <Text style={styles.statTitle}>{title}</Text>
        {subtitle && <Text style={styles.statSubtitle}>{subtitle}</Text>}
      </View>
    </View>
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator size="large" color="#e63946" style={{ flex: 1 }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>Welcome back,</Text>
          <Text style={styles.username}>{user?.username || 'Admin'}</Text>
        </View>
        <TouchableOpacity style={styles.logoutButton} onPress={logout}>
          <Ionicons name="log-out-outline" size={24} color="#e63946" />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#e63946']} />}
      >
        <Text style={styles.sectionTitle}>Today's Overview</Text>
        
        <View style={styles.statsGrid}>
          <StatCard icon="receipt" title="Today's Orders" value={stats?.todayOrders || 0} color="#e63946" />
          <StatCard icon="cash" title="Today's Revenue" value={`₹${stats?.todayRevenue || 0}`} color="#2a9d8f" />
        </View>

        <Text style={styles.sectionTitle}>Order Status</Text>
        
        <View style={styles.statsGrid}>
          <StatCard icon="time" title="Pending" value={stats?.pendingOrders || 0} color="#f59e0b" />
          <StatCard icon="bicycle" title="In Delivery" value={stats?.deliveryOrders || 0} color="#3b82f6" />
        </View>

        <Text style={styles.sectionTitle}>Resources</Text>
        
        <View style={styles.statsGrid}>
          <StatCard icon="restaurant" title="Menu Items" value={stats?.totalMenu || 0} color="#8b5cf6" />
          <StatCard 
            icon="people" 
            title="Delivery Partners" 
            value={`${stats?.activeDelivery || 0}/${stats?.totalDelivery || 0}`} 
            color="#10b981"
            subtitle="Online / Total"
          />
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
  greeting: { fontSize: 14, color: '#61636b' },
  username: { fontSize: 24, fontWeight: 'bold', color: '#1c1d21' },
  logoutButton: { padding: 8 },
  content: { flex: 1, padding: 16 },
  sectionTitle: { fontSize: 18, fontWeight: '600', color: '#1c1d21', marginTop: 16, marginBottom: 12 },
  statsGrid: { flexDirection: 'row', gap: 12 },
  statCard: {
    flex: 1, backgroundColor: '#fff', borderRadius: 12, padding: 16,
    borderLeftWidth: 4, marginBottom: 12,
  },
  iconContainer: { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center', marginBottom: 12 },
  statInfo: {},
  statValue: { fontSize: 24, fontWeight: 'bold', color: '#1c1d21' },
  statTitle: { fontSize: 14, color: '#61636b', marginTop: 4 },
  statSubtitle: { fontSize: 12, color: '#9ca3af', marginTop: 2 },
});
