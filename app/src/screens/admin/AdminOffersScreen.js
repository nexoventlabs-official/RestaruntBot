import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView, FlatList,
  RefreshControl, TouchableOpacity, Image, Alert, ActivityIndicator, Animated, Platform, StatusBar
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import api from '../../config/api';
import { colors, spacing, radius, typography, shadows } from '../../theme';

export default function AdminOffersScreen({ navigation }) {
  const [offers, setOffers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }).start();
  }, []);

  const fetchOffers = async () => {
    try {
      const response = await api.get('/offers');
      setOffers(response.data);
    } catch (error) { console.error('Error fetching offers:', error); }
    finally { setLoading(false); setRefreshing(false); }
  };

  useEffect(() => {
    fetchOffers();
    const unsubscribe = navigation.addListener('focus', fetchOffers);
    return unsubscribe;
  }, [navigation]);

  const onRefresh = useCallback(() => { setRefreshing(true); fetchOffers(); }, []);

  const toggleActive = async (offer) => {
    try {
      await api.patch(`/offers/${offer._id}/toggle`);
      setOffers(offers.map(o => o._id === offer._id ? { ...o, isActive: !o.isActive } : o));
    } catch (error) { Alert.alert('Error', 'Failed to update offer'); }
  };

  const deleteOffer = (offer) => {
    Alert.alert('Delete Offer', `Are you sure you want to delete "${offer.title}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try { await api.delete(`/offers/${offer._id}`); setOffers(offers.filter(o => o._id !== offer._id)); }
        catch (error) { Alert.alert('Error', 'Failed to delete offer'); }
      }},
    ]);
  };

  const renderOffer = ({ item }) => (
    <Animated.View style={{ opacity: fadeAnim }}>
      <TouchableOpacity style={styles.offerCard} onPress={() => navigation.navigate('OfferForm', { offer: item })} activeOpacity={0.8}>
        <View style={styles.offerImageContainer}>
          {item.image ? (
            <Image source={{ uri: item.image }} style={styles.offerImage} />
          ) : (
            <View style={[styles.offerImage, styles.offerImagePlaceholder]}>
              <Ionicons name="pricetag-outline" size={32} color={colors.light.text.tertiary} />
            </View>
          )}
          {item.discountType !== 'none' && (
            <View style={styles.discountBadge}>
              <Text style={styles.discountText}>
                {item.discountType === 'percentage' ? `${item.discountValue}%` : `₹${item.discountValue}`}
              </Text>
              <Text style={styles.discountLabel}>OFF</Text>
            </View>
          )}
        </View>
        
        <View style={styles.offerInfo}>
          <Text style={styles.offerTitle} numberOfLines={1}>{item.title || 'Untitled Offer'}</Text>
          
          {item.code && (
            <View style={styles.codeContainer}>
              <Ionicons name="ticket-outline" size={14} color={colors.zomato.red} />
              <Text style={styles.codeValue}>{item.code}</Text>
            </View>
          )}
          
          <View style={styles.offerFooter}>
            <TouchableOpacity
              style={[styles.statusBadge, { backgroundColor: item.isActive ? '#DCFCE7' : '#FEE2E2' }]}
              onPress={() => toggleActive(item)}
              activeOpacity={0.7}
            >
              <View style={[styles.statusDot, { backgroundColor: item.isActive ? '#22C55E' : '#EF4444' }]} />
              <Text style={[styles.statusText, { color: item.isActive ? '#22C55E' : '#EF4444' }]}>
                {item.isActive ? 'Active' : 'Inactive'}
              </Text>
            </TouchableOpacity>
            
            <TouchableOpacity style={styles.deleteButton} onPress={() => deleteOffer(item)}>
              <Ionicons name="trash-outline" size={18} color="#EF4444" />
            </TouchableOpacity>
          </View>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />
      
      <LinearGradient colors={[colors.zomato.red, colors.zomato.darkRed]} style={styles.header}>
        <View style={styles.headerContent}>
          <View>
            <Text style={styles.title}>Offers & Promotions</Text>
            <Text style={styles.subtitle}>{offers.length} active offers</Text>
          </View>
          <TouchableOpacity style={styles.addButton} onPress={() => navigation.navigate('OfferForm', {})} activeOpacity={0.8}>
            <Ionicons name="add" size={24} color={colors.zomato.red} />
          </TouchableOpacity>
        </View>
      </LinearGradient>

      {loading ? (
        <ActivityIndicator size="large" color={colors.zomato.red} style={{ flex: 1 }} />
      ) : (
        <FlatList
          data={offers}
          renderItem={renderOffer}
          keyExtractor={(item) => item._id}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.zomato.red]} />}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <View style={styles.emptyIconContainer}>
                <Ionicons name="pricetag-outline" size={48} color={colors.light.text.tertiary} />
              </View>
              <Text style={styles.emptyTitle}>No offers yet</Text>
              <Text style={styles.emptyText}>Create your first promotional offer</Text>
              <TouchableOpacity style={styles.emptyButton} onPress={() => navigation.navigate('OfferForm', {})} activeOpacity={0.8}>
                <LinearGradient colors={[colors.zomato.red, colors.zomato.darkRed]} style={styles.emptyButtonGradient}>
                  <Ionicons name="add" size={20} color="#fff" />
                  <Text style={styles.emptyButtonText}>Create Offer</Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.light.background },
  header: { paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight + 20 : 60, paddingBottom: spacing.lg, paddingHorizontal: spacing.screenHorizontal, borderBottomLeftRadius: 24, borderBottomRightRadius: 24 },
  headerContent: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: typography.display.small.fontSize, fontWeight: '700', color: '#fff' },
  subtitle: { fontSize: typography.body.medium.fontSize, color: 'rgba(255,255,255,0.8)', marginTop: 2 },
  addButton: { width: 48, height: 48, borderRadius: 16, backgroundColor: '#fff', justifyContent: 'center', alignItems: 'center', ...shadows.md },
  listContent: { padding: spacing.screenHorizontal, paddingBottom: 100 },
  offerCard: { flexDirection: 'row', backgroundColor: colors.light.surface, borderRadius: radius.xl, overflow: 'hidden', marginBottom: spacing.md, ...shadows.card },
  offerImageContainer: { position: 'relative' },
  offerImage: { width: 110, height: 110 },
  offerImagePlaceholder: { backgroundColor: colors.light.surfaceSecondary, justifyContent: 'center', alignItems: 'center' },
  discountBadge: { position: 'absolute', top: spacing.sm, left: spacing.sm, backgroundColor: colors.zomato.red, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 2, alignItems: 'center' },
  discountText: { fontSize: typography.title.medium.fontSize, fontWeight: '700', color: '#fff' },
  discountLabel: { fontSize: typography.label.small.fontSize, color: 'rgba(255,255,255,0.9)' },
  offerInfo: { flex: 1, padding: spacing.md, justifyContent: 'space-between' },
  offerTitle: { fontSize: typography.title.large.fontSize, fontWeight: '600', color: colors.light.text.primary },
  codeContainer: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.xs },
  codeValue: { fontSize: typography.title.medium.fontSize, fontWeight: '700', color: colors.zomato.red },
  offerFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.sm },
  statusBadge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.full },
  statusDot: { width: 8, height: 8, borderRadius: 4, marginRight: spacing.xs },
  statusText: { fontSize: typography.label.medium.fontSize, fontWeight: '600' },
  deleteButton: { width: 36, height: 36, borderRadius: 10, backgroundColor: '#FEE2E2', justifyContent: 'center', alignItems: 'center' },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 100 },
  emptyIconContainer: { width: 80, height: 80, borderRadius: 40, backgroundColor: colors.light.surfaceSecondary, justifyContent: 'center', alignItems: 'center', marginBottom: spacing.base },
  emptyTitle: { fontSize: typography.headline.small.fontSize, fontWeight: '600', color: colors.light.text.secondary },
  emptyText: { fontSize: typography.body.medium.fontSize, color: colors.light.text.tertiary, marginTop: spacing.xs },
  emptyButton: { marginTop: spacing.lg, borderRadius: radius.lg, overflow: 'hidden' },
  emptyButtonGradient: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.xl, paddingVertical: spacing.md },
  emptyButtonText: { color: '#fff', fontWeight: '600', fontSize: typography.title.medium.fontSize },
});
