import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView, FlatList,
  RefreshControl, TouchableOpacity, Image, Alert, ActivityIndicator
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import api from '../../config/api';

export default function AdminOffersScreen({ navigation }) {
  const [offers, setOffers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchOffers = async () => {
    try {
      const response = await api.get('/offers');
      setOffers(response.data);
    } catch (error) {
      console.error('Error fetching offers:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchOffers();
    const unsubscribe = navigation.addListener('focus', fetchOffers);
    return unsubscribe;
  }, [navigation]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchOffers();
  }, []);

  const toggleActive = async (offer) => {
    try {
      await api.patch(`/offers/${offer._id}/toggle`);
      setOffers(offers.map(o => o._id === offer._id ? { ...o, isActive: !o.isActive } : o));
    } catch (error) {
      Alert.alert('Error', 'Failed to update offer');
    }
  };

  const deleteOffer = (offer) => {
    Alert.alert(
      'Delete Offer',
      `Are you sure you want to delete "${offer.title}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.delete(`/offers/${offer._id}`);
              setOffers(offers.filter(o => o._id !== offer._id));
            } catch (error) {
              Alert.alert('Error', 'Failed to delete offer');
            }
          },
        },
      ]
    );
  };

  const renderOffer = ({ item }) => (
    <TouchableOpacity
      style={styles.offerCard}
      onPress={() => navigation.navigate('OfferForm', { offer: item })}
    >
      <Image source={{ uri: item.image }} style={styles.offerImage} />
      
      <View style={styles.offerInfo}>
        <Text style={styles.offerTitle} numberOfLines={1}>{item.title || 'Untitled Offer'}</Text>
        
        {item.code && (
          <View style={styles.codeContainer}>
            <Text style={styles.codeLabel}>Code:</Text>
            <Text style={styles.codeValue}>{item.code}</Text>
          </View>
        )}
        
        {item.discountType !== 'none' && (
          <Text style={styles.discount}>
            {item.discountType === 'percentage' ? `${item.discountValue}% OFF` : `₹${item.discountValue} OFF`}
          </Text>
        )}
        
        <View style={styles.offerFooter}>
          <TouchableOpacity
            style={[styles.statusBadge, { backgroundColor: item.isActive ? '#dcfce7' : '#fee2e2' }]}
            onPress={() => toggleActive(item)}
          >
            <Text style={[styles.statusText, { color: item.isActive ? '#22c55e' : '#ef4444' }]}>
              {item.isActive ? 'Active' : 'Inactive'}
            </Text>
          </TouchableOpacity>
          
          <TouchableOpacity onPress={() => deleteOffer(item)}>
            <Ionicons name="trash-outline" size={20} color="#ef4444" />
          </TouchableOpacity>
        </View>
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Offers</Text>
        <TouchableOpacity
          style={styles.addButton}
          onPress={() => navigation.navigate('OfferForm', {})}
        >
          <Ionicons name="add" size={24} color="#fff" />
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator size="large" color="#e63946" style={{ flex: 1 }} />
      ) : (
        <FlatList
          data={offers}
          renderItem={renderOffer}
          keyExtractor={(item) => item._id}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#e63946']} />}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="pricetag-outline" size={64} color="#d1d5db" />
              <Text style={styles.emptyText}>No offers</Text>
              <TouchableOpacity
                style={styles.emptyButton}
                onPress={() => navigation.navigate('OfferForm', {})}
              >
                <Text style={styles.emptyButtonText}>Create First Offer</Text>
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
  offerCard: { flexDirection: 'row', backgroundColor: '#fff', borderRadius: 12, overflow: 'hidden', marginBottom: 12 },
  offerImage: { width: 100, height: 100 },
  offerInfo: { flex: 1, padding: 12 },
  offerTitle: { fontSize: 16, fontWeight: '600', color: '#1c1d21' },
  codeContainer: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  codeLabel: { fontSize: 12, color: '#61636b' },
  codeValue: { fontSize: 12, fontWeight: '600', color: '#e63946', marginLeft: 4 },
  discount: { fontSize: 14, fontWeight: 'bold', color: '#22c55e', marginTop: 4 },
  offerFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  statusText: { fontSize: 12, fontWeight: '500' },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 100 },
  emptyText: { fontSize: 16, color: '#9ca3af', marginTop: 16 },
  emptyButton: { marginTop: 16, backgroundColor: '#e63946', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 8 },
  emptyButtonText: { color: '#fff', fontWeight: '600' },
});
