import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView, FlatList,
  RefreshControl, TouchableOpacity, Image, Alert, ActivityIndicator
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import api from '../../config/api';

export default function AdminDeliveryScreen({ navigation }) {
  const [deliveryBoys, setDeliveryBoys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchDeliveryBoys = async () => {
    try {
      const response = await api.get('/delivery');
      setDeliveryBoys(response.data);
    } catch (error) {
      console.error('Error fetching delivery boys:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchDeliveryBoys();
    const unsubscribe = navigation.addListener('focus', fetchDeliveryBoys);
    return unsubscribe;
  }, [navigation]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchDeliveryBoys();
  }, []);

  const resetPassword = (item) => {
    Alert.alert(
      'Reset Password',
      `Send new password to ${item.email}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          onPress: async () => {
            try {
              await api.post(`/delivery/${item._id}/reset-password`);
              Alert.alert('Success', 'New password sent to email');
            } catch (error) {
              Alert.alert('Error', 'Failed to reset password');
            }
          },
        },
      ]
    );
  };

  const deleteDeliveryBoy = (item) => {
    Alert.alert(
      'Delete Delivery Partner',
      `Are you sure you want to delete "${item.name}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.delete(`/delivery/${item._id}`);
              setDeliveryBoys(deliveryBoys.filter(d => d._id !== item._id));
            } catch (error) {
              Alert.alert('Error', 'Failed to delete');
            }
          },
        },
      ]
    );
  };

  const renderItem = ({ item }) => (
    <TouchableOpacity
      style={styles.card}
      onPress={() => navigation.navigate('DeliveryForm', { deliveryBoy: item })}
    >
      <View style={styles.cardHeader}>
        {item.photo ? (
          <Image source={{ uri: item.photo }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, styles.avatarPlaceholder]}>
            <Ionicons name="person" size={24} color="#9ca3af" />
          </View>
        )}
        
        <View style={styles.info}>
          <Text style={styles.name}>{item.name}</Text>
          <Text style={styles.email}>{item.email}</Text>
          <Text style={styles.phone}>{item.phone}</Text>
        </View>

        <View style={styles.statusContainer}>
          <View style={[styles.onlineBadge, { backgroundColor: item.isOnline ? '#dcfce7' : '#f3f4f6' }]}>
            <View style={[styles.onlineDot, { backgroundColor: item.isOnline ? '#22c55e' : '#9ca3af' }]} />
            <Text style={[styles.onlineText, { color: item.isOnline ? '#22c55e' : '#9ca3af' }]}>
              {item.isOnline ? 'Online' : 'Offline'}
            </Text>
          </View>
          <View style={[styles.activeBadge, { backgroundColor: item.isActive ? '#dbeafe' : '#fee2e2' }]}>
            <Text style={[styles.activeText, { color: item.isActive ? '#3b82f6' : '#ef4444' }]}>
              {item.isActive ? 'Active' : 'Inactive'}
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.cardFooter}>
        <View style={styles.stats}>
          <View style={styles.statItem}>
            <Ionicons name="star" size={16} color="#f59e0b" />
            <Text style={styles.statText}>{item.avgRating?.toFixed(1) || '0.0'}</Text>
          </View>
          <View style={styles.statItem}>
            <Ionicons name="bicycle" size={16} color="#61636b" />
            <Text style={styles.statText}>{item.totalRatings || 0} deliveries</Text>
          </View>
        </View>

        <View style={styles.actions}>
          <TouchableOpacity style={styles.actionButton} onPress={() => resetPassword(item)}>
            <Ionicons name="key-outline" size={20} color="#3b82f6" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionButton} onPress={() => deleteDeliveryBoy(item)}>
            <Ionicons name="trash-outline" size={20} color="#ef4444" />
          </TouchableOpacity>
        </View>
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Delivery Partners</Text>
        <TouchableOpacity
          style={styles.addButton}
          onPress={() => navigation.navigate('DeliveryForm', {})}
        >
          <Ionicons name="add" size={24} color="#fff" />
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator size="large" color="#e63946" style={{ flex: 1 }} />
      ) : (
        <FlatList
          data={deliveryBoys}
          renderItem={renderItem}
          keyExtractor={(item) => item._id}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#e63946']} />}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="bicycle-outline" size={64} color="#d1d5db" />
              <Text style={styles.emptyText}>No delivery partners</Text>
              <TouchableOpacity
                style={styles.emptyButton}
                onPress={() => navigation.navigate('DeliveryForm', {})}
              >
                <Text style={styles.emptyButtonText}>Add First Partner</Text>
              </TouchableOpacity>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8f9fb' },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 20, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#e5e7eb',
  },
  title: { fontSize: 24, fontWeight: 'bold', color: '#1c1d21' },
  addButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#e63946', justifyContent: 'center', alignItems: 'center' },
  listContent: { padding: 16 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 12 },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start' },
  avatar: { width: 56, height: 56, borderRadius: 28 },
  avatarPlaceholder: { backgroundColor: '#f3f4f6', justifyContent: 'center', alignItems: 'center' },
  info: { flex: 1, marginLeft: 12 },
  name: { fontSize: 16, fontWeight: '600', color: '#1c1d21' },
  email: { fontSize: 14, color: '#61636b', marginTop: 2 },
  phone: { fontSize: 14, color: '#61636b', marginTop: 2 },
  statusContainer: { alignItems: 'flex-end', gap: 4 },
  onlineBadge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12 },
  onlineDot: { width: 8, height: 8, borderRadius: 4, marginRight: 4 },
  onlineText: { fontSize: 12, fontWeight: '500' },
  activeBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  activeText: { fontSize: 12, fontWeight: '500' },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#f3f4f6' },
  stats: { flexDirection: 'row', gap: 16 },
  statItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  statText: { fontSize: 14, color: '#61636b' },
  actions: { flexDirection: 'row', gap: 8 },
  actionButton: { padding: 8 },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 100 },
  emptyText: { fontSize: 16, color: '#9ca3af', marginTop: 16 },
  emptyButton: { marginTop: 16, backgroundColor: '#e63946', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 8 },
  emptyButtonText: { color: '#fff', fontWeight: '600' },
});
