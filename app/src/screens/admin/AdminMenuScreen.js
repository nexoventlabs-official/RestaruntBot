import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView, FlatList,
  RefreshControl, TouchableOpacity, Image, Alert, ActivityIndicator
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import api from '../../config/api';

export default function AdminMenuScreen({ navigation }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchMenu = async () => {
    try {
      const response = await api.get('/menu');
      setItems(response.data);
    } catch (error) {
      console.error('Error fetching menu:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchMenu();
    const unsubscribe = navigation.addListener('focus', fetchMenu);
    return unsubscribe;
  }, [navigation]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchMenu();
  }, []);

  const deleteItem = (item) => {
    Alert.alert(
      'Delete Item',
      `Are you sure you want to delete "${item.name}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.delete(`/menu/${item._id}`);
              setItems(items.filter(i => i._id !== item._id));
            } catch (error) {
              Alert.alert('Error', 'Failed to delete item');
            }
          },
        },
      ]
    );
  };

  const renderItem = ({ item }) => (
    <TouchableOpacity
      style={styles.itemCard}
      onPress={() => navigation.navigate('MenuItemForm', { item })}
    >
      {item.image ? (
        <Image source={{ uri: item.image }} style={styles.itemImage} />
      ) : (
        <View style={[styles.itemImage, styles.placeholderImage]}>
          <Ionicons name="restaurant-outline" size={32} color="#d1d5db" />
        </View>
      )}
      
      <View style={styles.itemInfo}>
        <View style={styles.itemHeader}>
          <Text style={styles.itemName} numberOfLines={1}>{item.name}</Text>
          {item.foodType && item.foodType !== 'none' && (
            <View style={[styles.foodTypeBadge, { backgroundColor: item.foodType === 'veg' ? '#22c55e' : '#ef4444' }]}>
              <View style={styles.foodTypeDot} />
            </View>
          )}
        </View>
        
        <Text style={styles.itemCategory}>{item.category?.join(', ')}</Text>
        
        <View style={styles.itemFooter}>
          <Text style={styles.itemPrice}>₹{item.price}</Text>
          <View style={[styles.availabilityBadge, { backgroundColor: item.available ? '#dcfce7' : '#fee2e2' }]}>
            <Text style={[styles.availabilityText, { color: item.available ? '#22c55e' : '#ef4444' }]}>
              {item.available ? 'Available' : 'Unavailable'}
            </Text>
          </View>
        </View>
      </View>

      <TouchableOpacity style={styles.deleteButton} onPress={() => deleteItem(item)}>
        <Ionicons name="trash-outline" size={20} color="#ef4444" />
      </TouchableOpacity>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Menu Items</Text>
        <TouchableOpacity
          style={styles.addButton}
          onPress={() => navigation.navigate('MenuItemForm', {})}
        >
          <Ionicons name="add" size={24} color="#fff" />
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator size="large" color="#e63946" style={{ flex: 1 }} />
      ) : (
        <FlatList
          data={items}
          renderItem={renderItem}
          keyExtractor={(item) => item._id}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#e63946']} />}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="restaurant-outline" size={64} color="#d1d5db" />
              <Text style={styles.emptyText}>No menu items</Text>
              <TouchableOpacity
                style={styles.emptyButton}
                onPress={() => navigation.navigate('MenuItemForm', {})}
              >
                <Text style={styles.emptyButtonText}>Add First Item</Text>
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
  itemCard: { flexDirection: 'row', backgroundColor: '#fff', borderRadius: 12, padding: 12, marginBottom: 12, alignItems: 'center' },
  itemImage: { width: 80, height: 80, borderRadius: 8 },
  placeholderImage: { backgroundColor: '#f3f4f6', justifyContent: 'center', alignItems: 'center' },
  itemInfo: { flex: 1, marginLeft: 12 },
  itemHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  itemName: { fontSize: 16, fontWeight: '600', color: '#1c1d21', flex: 1 },
  foodTypeBadge: { width: 16, height: 16, borderRadius: 4, justifyContent: 'center', alignItems: 'center' },
  foodTypeDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#fff' },
  itemCategory: { fontSize: 12, color: '#61636b', marginTop: 4 },
  itemFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  itemPrice: { fontSize: 16, fontWeight: 'bold', color: '#e63946' },
  availabilityBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  availabilityText: { fontSize: 12, fontWeight: '500' },
  deleteButton: { padding: 8 },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 100 },
  emptyText: { fontSize: 16, color: '#9ca3af', marginTop: 16 },
  emptyButton: { marginTop: 16, backgroundColor: '#e63946', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 8 },
  emptyButtonText: { color: '#fff', fontWeight: '600' },
});
