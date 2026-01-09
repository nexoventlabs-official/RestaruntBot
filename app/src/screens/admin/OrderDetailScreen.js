import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView, ScrollView,
  TouchableOpacity, Alert, ActivityIndicator, Modal, FlatList, Image,
  Animated, Platform, StatusBar
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import api from '../../config/api';
import { colors, spacing, radius, typography, shadows } from '../../theme';

const STATUS_CONFIG = {
  pending: { color: '#F59E0B', bg: '#FEF3C7', label: 'Pending' },
  confirmed: { color: '#3B82F6', bg: '#DBEAFE', label: 'Confirmed' },
  preparing: { color: '#8B5CF6', bg: '#EDE9FE', label: 'Preparing' },
  ready: { color: '#10B981', bg: '#D1FAE5', label: 'Ready' },
  out_for_delivery: { color: '#06B6D4', bg: '#CFFAFE', label: 'Out for Delivery' },
  delivered: { color: '#22C55E', bg: '#DCFCE7', label: 'Delivered' },
  cancelled: { color: '#EF4444', bg: '#FEE2E2', label: 'Cancelled' },
  refunded: { color: '#6B7280', bg: '#F3F4F6', label: 'Refunded' },
};

const STATUS_FLOW = ['pending', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'delivered'];

export default function OrderDetailScreen({ route, navigation }) {
  const [order, setOrder] = useState(route.params.order);
  const [loading, setLoading] = useState(false);
  const [showDeliveryModal, setShowDeliveryModal] = useState(false);
  const [deliveryPartners, setDeliveryPartners] = useState([]);
  const [loadingPartners, setLoadingPartners] = useState(false);
  const [assigningPartnerId, setAssigningPartnerId] = useState(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }).start();
  }, []);

  const fetchDeliveryPartners = async () => {
    setLoadingPartners(true);
    try {
      const response = await api.get('/delivery');
      setDeliveryPartners(response.data || []);
    } catch (error) { console.error('Failed to fetch delivery partners:', error); }
    finally { setLoadingPartners(false); }
  };

  const updateStatus = async (newStatus, deliveryBoyId = null) => {
    setLoading(true);
    if (deliveryBoyId) setAssigningPartnerId(deliveryBoyId);
    try {
      await api.put(`/orders/${order._id}/status`, { status: newStatus });
      if (deliveryBoyId) await api.put(`/orders/${order._id}/assign-delivery`, { deliveryBoyId });
      setShowDeliveryModal(false);
      Alert.alert('Success', deliveryBoyId ? 'Order assigned and status updated' : 'Order status updated', [{ text: 'OK', onPress: () => navigation.goBack() }]);
    } catch (error) { Alert.alert('Error', error.response?.data?.error || 'Failed to update status'); }
    finally { setLoading(false); setAssigningPartnerId(null); }
  };

  const handleStartPreparing = async () => {
    if (order.serviceType === 'delivery') { await fetchDeliveryPartners(); setShowDeliveryModal(true); }
    else confirmStatusUpdate('preparing');
  };

  const confirmStatusUpdate = (newStatus) => {
    Alert.alert('Update Status', `Change status to "${STATUS_CONFIG[newStatus]?.label}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Confirm', onPress: () => updateStatus(newStatus) },
    ]);
  };

  const cancelOrder = () => {
    Alert.alert('Cancel Order', 'Are you sure you want to cancel this order?', [
      { text: 'No', style: 'cancel' },
      { text: 'Yes, Cancel', style: 'destructive', onPress: async () => {
        setLoading(true);
        try {
          const response = await api.put(`/orders/${order._id}/status`, { status: 'cancelled' });
          setOrder(response.data);
          Alert.alert('Success', 'Order cancelled');
        } catch (error) { Alert.alert('Error', error.response?.data?.error || 'Failed to cancel order'); }
        finally { setLoading(false); }
      }},
    ]);
  };

  const getNextStatus = () => {
    const currentIndex = STATUS_FLOW.indexOf(order.status);
    if (currentIndex >= 0 && currentIndex < STATUS_FLOW.length - 1) return STATUS_FLOW[currentIndex + 1];
    return null;
  };

  const nextStatus = getNextStatus();
  const statusConfig = STATUS_CONFIG[order.status] || STATUS_CONFIG.pending;
  const sortedPartners = [...deliveryPartners].sort((a, b) => {
    if (a.isOnline && !b.isOnline) return -1;
    if (!a.isOnline && b.isOnline) return 1;
    return a.name.localeCompare(b.name);
  });

  const renderDeliveryPartner = ({ item }) => {
    const isAssigning = assigningPartnerId === item._id;
    return (
      <TouchableOpacity
        style={[styles.partnerCard, !item.isActive && styles.partnerCardDisabled, isAssigning && styles.partnerCardSelected]}
        onPress={() => item.isActive && !assigningPartnerId && updateStatus('preparing', item._id)}
        disabled={!item.isActive || loading || assigningPartnerId}
        activeOpacity={0.7}
      >
        <View style={styles.partnerAvatar}>
          {item.photo ? <Image source={{ uri: item.photo }} style={styles.partnerPhoto} /> : (
            <View style={[styles.partnerPhoto, styles.partnerPhotoPlaceholder]}>
              <Text style={styles.partnerInitial}>{item.name[0].toUpperCase()}</Text>
            </View>
          )}
          <View style={[styles.onlineDot, { backgroundColor: item.isOnline ? '#22C55E' : '#9CA3AF' }]} />
        </View>
        <View style={styles.partnerInfo}>
          <View style={styles.partnerNameRow}>
            <Text style={styles.partnerName}>{item.name}</Text>
            {!item.isActive && <View style={styles.inactiveBadge}><Text style={styles.inactiveBadgeText}>Inactive</Text></View>}
          </View>
          <Text style={styles.partnerPhone}>{item.phone}</Text>
          <View style={styles.partnerMeta}>
            <View style={[styles.statusPill, { backgroundColor: item.isOnline ? '#DCFCE7' : colors.light.surfaceSecondary }]}>
              <View style={[styles.statusDot, { backgroundColor: item.isOnline ? '#22C55E' : '#9CA3AF' }]} />
              <Text style={[styles.statusPillText, { color: item.isOnline ? '#22C55E' : '#9CA3AF' }]}>{item.isOnline ? 'Online' : 'Offline'}</Text>
            </View>
            {item.avgRating > 0 && <View style={styles.ratingBadge}><Ionicons name="star" size={12} color="#F59E0B" /><Text style={styles.ratingText}>{item.avgRating.toFixed(1)}</Text></View>}
          </View>
        </View>
        {isAssigning ? <ActivityIndicator size="small" color={colors.zomato.red} /> : <Ionicons name="bicycle-outline" size={24} color={item.isActive ? colors.zomato.red : '#9CA3AF'} />}
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={colors.zomato.red} />
      
      <Animated.View style={{ opacity: fadeAnim }}>
        <LinearGradient colors={[colors.zomato.red, colors.zomato.darkRed]} style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
            <Ionicons name="arrow-back" size={24} color="#fff" />
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Text style={styles.title}>Order #{order.orderId}</Text>
            <View style={[styles.statusBadgeHeader, { backgroundColor: statusConfig.color }]}>
              <Text style={styles.statusTextHeader}>{statusConfig.label}</Text>
            </View>
          </View>
          <View style={{ width: 44 }} />
        </LinearGradient>
      </Animated.View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.statusCard}>
          <View style={[styles.statusBadge, { backgroundColor: statusConfig.bg }]}>
            <Text style={[styles.statusText, { color: statusConfig.color }]}>{statusConfig.label}</Text>
          </View>
          <Text style={styles.serviceType}>{order.serviceType?.toUpperCase() || 'DELIVERY'}</Text>
          <Text style={styles.statusTime}>{new Date(order.createdAt).toLocaleString('en-IN')}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Customer Details</Text>
          <View style={styles.card}>
            <View style={styles.row}><Ionicons name="person-outline" size={20} color={colors.light.text.secondary} /><Text style={styles.rowText}>{order.customer?.name || 'N/A'}</Text></View>
            <View style={styles.row}><Ionicons name="call-outline" size={20} color={colors.light.text.secondary} /><Text style={styles.rowText}>{order.customer?.phone}</Text></View>
            <View style={styles.row}><Ionicons name="location-outline" size={20} color={colors.light.text.secondary} /><Text style={styles.rowText}>{order.deliveryAddress?.address || order.customer?.address || 'N/A'}</Text></View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Order Items</Text>
          <View style={styles.card}>
            {order.items?.map((item, index) => (
              <View key={index} style={[styles.itemRow, index > 0 && styles.itemBorder]}>
                <View style={styles.itemInfo}><Text style={styles.itemName}>{item.name}</Text><Text style={styles.itemQty}>x{item.quantity}</Text></View>
                <Text style={styles.itemPrice}>₹{item.price * item.quantity}</Text>
              </View>
            ))}
            <View style={styles.totalRow}><Text style={styles.totalLabel}>Total</Text><Text style={styles.totalAmount}>₹{order.totalAmount}</Text></View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Payment Info</Text>
          <View style={styles.card}>
            <View style={styles.row}><Text style={styles.label}>Method:</Text><Text style={styles.value}>{order.paymentMethod?.toUpperCase()}</Text></View>
            <View style={styles.row}><Text style={styles.label}>Status:</Text><Text style={[styles.value, { color: order.paymentStatus === 'paid' ? '#22C55E' : '#F59E0B' }]}>{order.paymentStatus?.toUpperCase()}</Text></View>
          </View>
        </View>

        {order.assignedTo && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Delivery Partner</Text>
            <View style={styles.card}><View style={styles.row}><Ionicons name="bicycle-outline" size={20} color={colors.light.text.secondary} /><Text style={styles.rowText}>{order.deliveryPartnerName || 'Assigned'}</Text></View></View>
          </View>
        )}
        <View style={{ height: 120 }} />
      </ScrollView>

      {!['delivered', 'cancelled', 'refunded'].includes(order.status) && (
        <View style={styles.footer}>
          {loading ? <ActivityIndicator size="large" color={colors.zomato.red} /> : (
            <>
              {nextStatus && (
                <TouchableOpacity style={styles.actionButton} onPress={() => {
                  if (order.status === 'confirmed' && nextStatus === 'preparing' && order.serviceType === 'delivery') handleStartPreparing();
                  else confirmStatusUpdate(nextStatus);
                }} activeOpacity={0.8}>
                  <LinearGradient colors={[STATUS_CONFIG[nextStatus]?.color || colors.zomato.red, STATUS_CONFIG[nextStatus]?.color || colors.zomato.darkRed]} style={styles.actionButtonGradient}>
                    <Text style={styles.actionButtonText}>{order.status === 'confirmed' && order.serviceType === 'delivery' ? 'Start Preparing' : `Mark as ${STATUS_CONFIG[nextStatus]?.label}`}</Text>
                  </LinearGradient>
                </TouchableOpacity>
              )}
              {order.paymentMethod === 'cod' && (
                <TouchableOpacity style={styles.cancelButton} onPress={cancelOrder}><Text style={styles.cancelButtonText}>Cancel Order</Text></TouchableOpacity>
              )}
            </>
          )}
        </View>
      )}

      <Modal visible={showDeliveryModal} animationType="slide" transparent={true} onRequestClose={() => setShowDeliveryModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <View><Text style={styles.modalTitle}>Select Delivery Partner</Text><Text style={styles.modalSubtitle}>Order #{order.orderId}</Text></View>
              <TouchableOpacity style={styles.modalCloseButton} onPress={() => setShowDeliveryModal(false)}><Ionicons name="close" size={24} color={colors.light.text.secondary} /></TouchableOpacity>
            </View>
            {loadingPartners ? <View style={styles.loadingContainer}><ActivityIndicator size="large" color={colors.zomato.red} /></View> : deliveryPartners.length === 0 ? (
              <View style={styles.emptyContainer}><Ionicons name="bicycle-outline" size={48} color={colors.light.text.tertiary} /><Text style={styles.emptyText}>No delivery partners found</Text></View>
            ) : <FlatList data={sortedPartners} renderItem={renderDeliveryPartner} keyExtractor={(item) => item._id} contentContainerStyle={styles.partnerList} showsVerticalScrollIndicator={false} />}
            <TouchableOpacity style={[styles.skipButton, (loading || assigningPartnerId) && styles.skipButtonDisabled]} onPress={() => updateStatus('preparing')} disabled={loading || assigningPartnerId}>
              {loading && !assigningPartnerId ? <ActivityIndicator size="small" color={colors.light.text.secondary} /> : <Text style={styles.skipButtonText}>Skip - Assign Later</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.light.background },
  header: { paddingTop: Platform.OS === 'android' ? 50 : 16, paddingBottom: spacing.lg, paddingHorizontal: spacing.screenHorizontal, borderBottomLeftRadius: 24, borderBottomRightRadius: 24, flexDirection: 'row', alignItems: 'center' },
  backButton: { width: 44, height: 44, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.15)', justifyContent: 'center', alignItems: 'center' },
  headerCenter: { flex: 1, alignItems: 'center' },
  title: { fontSize: typography.headline.small.fontSize, fontWeight: '700', color: '#fff' },
  statusBadgeHeader: { paddingHorizontal: spacing.md, paddingVertical: 4, borderRadius: radius.full, marginTop: spacing.xs },
  statusTextHeader: { color: '#fff', fontSize: typography.label.small.fontSize, fontWeight: '600' },
  content: { flex: 1, padding: spacing.screenHorizontal },
  statusCard: { backgroundColor: colors.light.surface, borderRadius: radius.xl, padding: spacing.lg, alignItems: 'center', marginBottom: spacing.base, ...shadows.card },
  statusBadge: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.full },
  statusText: { fontSize: typography.title.large.fontSize, fontWeight: '700' },
  serviceType: { color: colors.light.text.secondary, fontSize: typography.label.small.fontSize, fontWeight: '600', marginTop: spacing.sm, letterSpacing: 1 },
  statusTime: { color: colors.light.text.tertiary, marginTop: spacing.xs, fontSize: typography.body.small.fontSize },
  section: { marginBottom: spacing.base },
  sectionTitle: { fontSize: typography.title.large.fontSize, fontWeight: '600', color: colors.light.text.primary, marginBottom: spacing.sm },
  card: { backgroundColor: colors.light.surface, borderRadius: radius.xl, padding: spacing.base, ...shadows.card },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  rowText: { fontSize: typography.body.medium.fontSize, color: colors.light.text.primary, flex: 1 },
  label: { fontSize: typography.body.medium.fontSize, color: colors.light.text.secondary },
  value: { fontSize: typography.body.medium.fontSize, fontWeight: '600', color: colors.light.text.primary },
  itemRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.md },
  itemBorder: { borderTopWidth: 1, borderTopColor: colors.light.borderLight },
  itemInfo: { flex: 1 },
  itemName: { fontSize: typography.body.medium.fontSize, color: colors.light.text.primary },
  itemQty: { fontSize: typography.body.small.fontSize, color: colors.light.text.secondary, marginTop: 2 },
  itemPrice: { fontSize: typography.body.medium.fontSize, fontWeight: '600', color: colors.light.text.primary },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: colors.light.border, paddingTop: spacing.md, marginTop: spacing.sm },
  totalLabel: { fontSize: typography.title.large.fontSize, fontWeight: '600', color: colors.light.text.primary },
  totalAmount: { fontSize: typography.headline.small.fontSize, fontWeight: '700', color: colors.zomato.red },
  footer: { padding: spacing.screenHorizontal, paddingBottom: spacing.xl, backgroundColor: colors.light.surface, gap: spacing.sm, ...shadows.lg },
  actionButton: { borderRadius: radius.lg, overflow: 'hidden' },
  actionButtonGradient: { height: 52, justifyContent: 'center', alignItems: 'center' },
  actionButtonText: { color: '#fff', fontSize: typography.title.large.fontSize, fontWeight: '600' },
  cancelButton: { height: 52, borderRadius: radius.lg, justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#EF4444' },
  cancelButtonText: { color: '#EF4444', fontSize: typography.title.large.fontSize, fontWeight: '600' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: colors.light.surface, borderTopLeftRadius: radius.bottomSheet, borderTopRightRadius: radius.bottomSheet, maxHeight: '80%', paddingBottom: spacing.xl },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.light.borderLight },
  modalTitle: { fontSize: typography.headline.small.fontSize, fontWeight: '700', color: colors.light.text.primary },
  modalSubtitle: { fontSize: typography.body.medium.fontSize, color: colors.light.text.secondary, marginTop: 2 },
  modalCloseButton: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.light.surfaceSecondary, justifyContent: 'center', alignItems: 'center' },
  loadingContainer: { padding: 40, alignItems: 'center' },
  emptyContainer: { padding: 40, alignItems: 'center' },
  emptyText: { fontSize: typography.body.large.fontSize, color: colors.light.text.secondary, marginTop: spacing.md },
  partnerList: { padding: spacing.base },
  partnerCard: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, backgroundColor: colors.light.surfaceSecondary, borderRadius: radius.lg, marginBottom: spacing.sm },
  partnerCardDisabled: { opacity: 0.6 },
  partnerCardSelected: { backgroundColor: colors.primary[50], borderWidth: 1, borderColor: colors.zomato.red },
  partnerAvatar: { position: 'relative', marginRight: spacing.md },
  partnerPhoto: { width: 48, height: 48, borderRadius: 14 },
  partnerPhotoPlaceholder: { backgroundColor: colors.zomato.red, justifyContent: 'center', alignItems: 'center' },
  partnerInitial: { color: '#fff', fontSize: typography.headline.small.fontSize, fontWeight: 'bold' },
  onlineDot: { position: 'absolute', bottom: 0, right: 0, width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: '#fff' },
  partnerInfo: { flex: 1 },
  partnerNameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  partnerName: { fontSize: typography.title.medium.fontSize, fontWeight: '600', color: colors.light.text.primary },
  inactiveBadge: { backgroundColor: '#FEE2E2', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  inactiveBadgeText: { fontSize: typography.label.small.fontSize, color: '#EF4444', fontWeight: '600' },
  partnerPhone: { fontSize: typography.body.small.fontSize, color: colors.light.text.secondary, marginTop: 2 },
  partnerMeta: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs },
  statusPill: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.full, gap: 4 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusPillText: { fontSize: typography.label.small.fontSize, fontWeight: '600' },
  ratingBadge: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  ratingText: { fontSize: typography.label.small.fontSize, color: '#F59E0B', fontWeight: '600' },
  skipButton: { marginHorizontal: spacing.base, paddingVertical: spacing.md, alignItems: 'center', borderTopWidth: 1, borderTopColor: colors.light.border },
  skipButtonDisabled: { opacity: 0.6 },
  skipButtonText: { fontSize: typography.title.medium.fontSize, color: colors.light.text.secondary, fontWeight: '500' },
});
