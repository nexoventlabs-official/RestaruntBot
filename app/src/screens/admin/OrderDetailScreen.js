import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView, ScrollView,
  TouchableOpacity, Alert, ActivityIndicator, Modal, FlatList, Image
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import api from '../../config/api';

const STATUS_COLORS = {
  pending: '#f59e0b', confirmed: '#3b82f6', preparing: '#8b5cf6',
  ready: '#10b981', out_for_delivery: '#06b6d4', delivered: '#22c55e',
  cancelled: '#ef4444', refunded: '#6b7280',
};

const STATUS_LABELS = {
  pending: 'Pending', confirmed: 'Confirmed', preparing: 'Preparing',
  ready: 'Ready', out_for_delivery: 'Out for Delivery', delivered: 'Delivered',
  cancelled: 'Cancelled', refunded: 'Refunded',
};

const STATUS_FLOW = ['pending', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'delivered'];

export default function OrderDetailScreen({ route, navigation }) {
  const [order, setOrder] = useState(route.params.order);
  const [loading, setLoading] = useState(false);
  const [showDeliveryModal, setShowDeliveryModal] = useState(false);
  const [deliveryPartners, setDeliveryPartners] = useState([]);
  const [loadingPartners, setLoadingPartners] = useState(false);
  const [assigningPartnerId, setAssigningPartnerId] = useState(null);

  const fetchDeliveryPartners = async () => {
    setLoadingPartners(true);
    try {
      // Always fetch fresh data to get up-to-date online status
      const response = await api.get('/delivery');
      setDeliveryPartners(response.data || []);
    } catch (error) {
      console.error('Failed to fetch delivery partners:', error);
    } finally {
      setLoadingPartners(false);
    }
  };

  const updateStatus = async (newStatus, deliveryBoyId = null) => {
    setLoading(true);
    if (deliveryBoyId) {
      setAssigningPartnerId(deliveryBoyId);
    }
    
    try {
      await api.put(`/orders/${order._id}/status`, { status: newStatus });
      
      // If delivery partner is selected, assign them
      if (deliveryBoyId) {
        await api.put(`/orders/${order._id}/assign-delivery`, { deliveryBoyId });
      }
      
      setShowDeliveryModal(false);
      
      // Show success and navigate back to orders list
      Alert.alert(
        'Success', 
        deliveryBoyId ? 'Order assigned and status updated' : 'Order status updated',
        [
          {
            text: 'OK',
            onPress: () => {
              // Navigate back to orders list - it will refresh automatically
              navigation.goBack();
            }
          }
        ]
      );
    } catch (error) {
      Alert.alert('Error', error.response?.data?.error || 'Failed to update status');
    } finally {
      setLoading(false);
      setAssigningPartnerId(null);
    }
  };

  const handleStartPreparing = async () => {
    // For delivery orders, show delivery partner selection modal
    if (order.serviceType === 'delivery') {
      await fetchDeliveryPartners();
      setShowDeliveryModal(true);
    } else {
      // For non-delivery orders (pickup/dine-in), just update status
      confirmStatusUpdate('preparing');
    }
  };

  const confirmStatusUpdate = (newStatus) => {
    Alert.alert(
      'Update Status',
      `Change status to "${STATUS_LABELS[newStatus]}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Confirm', onPress: () => updateStatus(newStatus) },
      ]
    );
  };

  const cancelOrder = () => {
    Alert.alert(
      'Cancel Order',
      'Are you sure you want to cancel this order?',
      [
        { text: 'No', style: 'cancel' },
        {
          text: 'Yes, Cancel',
          style: 'destructive',
          onPress: async () => {
            setLoading(true);
            try {
              const response = await api.put(`/orders/${order._id}/status`, { status: 'cancelled' });
              setOrder(response.data);
              Alert.alert('Success', 'Order cancelled');
            } catch (error) {
              Alert.alert('Error', error.response?.data?.error || 'Failed to cancel order');
            } finally {
              setLoading(false);
            }
          },
        },
      ]
    );
  };

  const getNextStatus = () => {
    const currentIndex = STATUS_FLOW.indexOf(order.status);
    if (currentIndex >= 0 && currentIndex < STATUS_FLOW.length - 1) {
      return STATUS_FLOW[currentIndex + 1];
    }
    return null;
  };

  const nextStatus = getNextStatus();

  // Sort partners: online first, then by name
  const sortedPartners = [...deliveryPartners].sort((a, b) => {
    if (a.isOnline && !b.isOnline) return -1;
    if (!a.isOnline && b.isOnline) return 1;
    return a.name.localeCompare(b.name);
  });

  const renderDeliveryPartner = ({ item }) => {
    const isAssigning = assigningPartnerId === item._id;
    
    return (
      <TouchableOpacity
        style={[
          styles.partnerCard, 
          !item.isActive && styles.partnerCardDisabled,
          isAssigning && styles.partnerCardSelected
        ]}
        onPress={() => item.isActive && !assigningPartnerId && updateStatus('preparing', item._id)}
        disabled={!item.isActive || loading || assigningPartnerId}
      >
        <View style={styles.partnerAvatar}>
          {item.photo ? (
            <Image source={{ uri: item.photo }} style={styles.partnerPhoto} />
          ) : (
            <View style={[styles.partnerPhoto, styles.partnerPhotoPlaceholder]}>
              <Text style={styles.partnerInitial}>{item.name[0].toUpperCase()}</Text>
            </View>
          )}
          <View style={[styles.onlineDot, { backgroundColor: item.isOnline ? '#22c55e' : '#9ca3af' }]} />
        </View>
        
        <View style={styles.partnerInfo}>
          <View style={styles.partnerNameRow}>
            <Text style={styles.partnerName}>{item.name}</Text>
            {!item.isActive && (
              <View style={styles.inactiveBadge}>
                <Text style={styles.inactiveBadgeText}>Inactive</Text>
              </View>
            )}
          </View>
          <Text style={styles.partnerPhone}>{item.phone}</Text>
          <View style={styles.partnerMeta}>
            <View style={[styles.statusPill, { backgroundColor: item.isOnline ? '#dcfce7' : '#f3f4f6' }]}>
              <View style={[styles.statusDot, { backgroundColor: item.isOnline ? '#22c55e' : '#9ca3af' }]} />
              <Text style={[styles.statusPillText, { color: item.isOnline ? '#22c55e' : '#9ca3af' }]}>
                {item.isOnline ? 'Online' : 'Offline'}
              </Text>
            </View>
            {item.avgRating > 0 && (
              <View style={styles.ratingBadge}>
                <Ionicons name="star" size={12} color="#f59e0b" />
                <Text style={styles.ratingText}>{item.avgRating.toFixed(1)}</Text>
              </View>
            )}
          </View>
        </View>
        
        {isAssigning ? (
          <ActivityIndicator size="small" color="#e63946" />
        ) : (
          <Ionicons name="bicycle-outline" size={24} color={item.isActive ? '#e63946' : '#9ca3af'} />
        )}
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={24} color="#1c1d21" />
        </TouchableOpacity>
        <Text style={styles.title}>Order #{order.orderId}</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView style={styles.content}>
        <View style={styles.statusCard}>
          <View style={[styles.statusBadge, { backgroundColor: STATUS_COLORS[order.status] }]}>
            <Text style={styles.statusText}>{STATUS_LABELS[order.status]}</Text>
          </View>
          <Text style={styles.serviceType}>{order.serviceType?.toUpperCase() || 'DELIVERY'}</Text>
          <Text style={styles.statusTime}>
            {new Date(order.createdAt).toLocaleString('en-IN')}
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Customer Details</Text>
          <View style={styles.card}>
            <View style={styles.row}>
              <Ionicons name="person-outline" size={20} color="#61636b" />
              <Text style={styles.rowText}>{order.customer?.name || 'N/A'}</Text>
            </View>
            <View style={styles.row}>
              <Ionicons name="call-outline" size={20} color="#61636b" />
              <Text style={styles.rowText}>{order.customer?.phone}</Text>
            </View>
            <View style={styles.row}>
              <Ionicons name="location-outline" size={20} color="#61636b" />
              <Text style={styles.rowText}>{order.deliveryAddress?.address || order.customer?.address || 'N/A'}</Text>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Order Items</Text>
          <View style={styles.card}>
            {order.items?.map((item, index) => (
              <View key={index} style={[styles.itemRow, index > 0 && styles.itemBorder]}>
                <View style={styles.itemInfo}>
                  <Text style={styles.itemName}>{item.name}</Text>
                  <Text style={styles.itemQty}>x{item.quantity}</Text>
                </View>
                <Text style={styles.itemPrice}>₹{item.price * item.quantity}</Text>
              </View>
            ))}
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Total</Text>
              <Text style={styles.totalAmount}>₹{order.totalAmount}</Text>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Payment Info</Text>
          <View style={styles.card}>
            <View style={styles.row}>
              <Text style={styles.label}>Method:</Text>
              <Text style={styles.value}>{order.paymentMethod?.toUpperCase()}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.label}>Status:</Text>
              <Text style={[styles.value, { color: order.paymentStatus === 'paid' ? '#22c55e' : '#f59e0b' }]}>
                {order.paymentStatus?.toUpperCase()}
              </Text>
            </View>
          </View>
        </View>

        {order.assignedTo && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Delivery Partner</Text>
            <View style={styles.card}>
              <View style={styles.row}>
                <Ionicons name="bicycle-outline" size={20} color="#61636b" />
                <Text style={styles.rowText}>{order.deliveryPartnerName || 'Assigned'}</Text>
              </View>
            </View>
          </View>
        )}
      </ScrollView>

      {!['delivered', 'cancelled', 'refunded'].includes(order.status) && (
        <View style={styles.footer}>
          {loading ? (
            <ActivityIndicator size="large" color="#e63946" />
          ) : (
            <>
              {nextStatus && (
                <TouchableOpacity
                  style={[styles.actionButton, { backgroundColor: STATUS_COLORS[nextStatus] }]}
                  onPress={() => {
                    // For confirmed -> preparing on delivery orders, show modal
                    if (order.status === 'confirmed' && nextStatus === 'preparing' && order.serviceType === 'delivery') {
                      handleStartPreparing();
                    } else {
                      confirmStatusUpdate(nextStatus);
                    }
                  }}
                >
                  <Text style={styles.actionButtonText}>
                    {order.status === 'confirmed' && order.serviceType === 'delivery' 
                      ? 'Start Preparing' 
                      : `Mark as ${STATUS_LABELS[nextStatus]}`}
                  </Text>
                </TouchableOpacity>
              )}
              {order.paymentMethod === 'cod' && (
                <TouchableOpacity style={styles.cancelButton} onPress={cancelOrder}>
                  <Text style={styles.cancelButtonText}>Cancel Order</Text>
                </TouchableOpacity>
              )}
            </>
          )}
        </View>
      )}

      {/* Delivery Partner Selection Modal */}
      <Modal
        visible={showDeliveryModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowDeliveryModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>Select Delivery Partner</Text>
                <Text style={styles.modalSubtitle}>Order #{order.orderId}</Text>
              </View>
              <TouchableOpacity 
                style={styles.modalCloseButton}
                onPress={() => setShowDeliveryModal(false)}
              >
                <Ionicons name="close" size={24} color="#61636b" />
              </TouchableOpacity>
            </View>

            {loadingPartners ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color="#e63946" />
              </View>
            ) : deliveryPartners.length === 0 ? (
              <View style={styles.emptyContainer}>
                <Ionicons name="bicycle-outline" size={48} color="#d1d5db" />
                <Text style={styles.emptyText}>No delivery partners found</Text>
                <Text style={styles.emptySubtext}>Add delivery partners in the Delivery section</Text>
              </View>
            ) : (
              <FlatList
                data={sortedPartners}
                renderItem={renderDeliveryPartner}
                keyExtractor={(item) => item._id}
                contentContainerStyle={styles.partnerList}
                showsVerticalScrollIndicator={false}
              />
            )}

            <TouchableOpacity
              style={[styles.skipButton, (loading || assigningPartnerId) && styles.skipButtonDisabled]}
              onPress={() => updateStatus('preparing')}
              disabled={loading || assigningPartnerId}
            >
              {loading && !assigningPartnerId ? (
                <ActivityIndicator size="small" color="#61636b" />
              ) : (
                <Text style={styles.skipButtonText}>Skip - Assign Later</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}


const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8f9fb' },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 20, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#e5e7eb',
  },
  title: { fontSize: 18, fontWeight: 'bold', color: '#1c1d21' },
  content: { flex: 1, padding: 16 },
  statusCard: { backgroundColor: '#fff', borderRadius: 12, padding: 20, alignItems: 'center', marginBottom: 16 },
  statusBadge: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 20 },
  statusText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  serviceType: { color: '#61636b', fontSize: 12, fontWeight: '600', marginTop: 8, letterSpacing: 1 },
  statusTime: { color: '#9ca3af', marginTop: 4, fontSize: 13 },
  section: { marginBottom: 16 },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: '#1c1d21', marginBottom: 8 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  rowText: { fontSize: 14, color: '#1c1d21', flex: 1 },
  label: { fontSize: 14, color: '#61636b' },
  value: { fontSize: 14, fontWeight: '600', color: '#1c1d21' },
  itemRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12 },
  itemBorder: { borderTopWidth: 1, borderTopColor: '#f3f4f6' },
  itemInfo: { flex: 1 },
  itemName: { fontSize: 14, color: '#1c1d21' },
  itemQty: { fontSize: 12, color: '#61636b', marginTop: 2 },
  itemPrice: { fontSize: 14, fontWeight: '600', color: '#1c1d21' },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: '#e5e7eb', paddingTop: 12, marginTop: 8 },
  totalLabel: { fontSize: 16, fontWeight: '600', color: '#1c1d21' },
  totalAmount: { fontSize: 18, fontWeight: 'bold', color: '#e63946' },
  footer: { padding: 16, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#e5e7eb', gap: 12 },
  actionButton: { height: 50, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  actionButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  cancelButton: { height: 50, borderRadius: 12, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#ef4444' },
  cancelButtonText: { color: '#ef4444', fontSize: 16, fontWeight: '600' },
  
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '80%',
    paddingBottom: 24,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  modalTitle: { fontSize: 18, fontWeight: 'bold', color: '#1c1d21' },
  modalSubtitle: { fontSize: 14, color: '#61636b', marginTop: 2 },
  modalCloseButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#f3f4f6',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingContainer: {
    padding: 40,
    alignItems: 'center',
  },
  emptyContainer: {
    padding: 40,
    alignItems: 'center',
  },
  emptyText: { fontSize: 16, color: '#61636b', marginTop: 12 },
  emptySubtext: { fontSize: 14, color: '#9ca3af', marginTop: 4 },
  partnerList: {
    padding: 16,
  },
  partnerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    backgroundColor: '#f8f9fb',
    borderRadius: 12,
    marginBottom: 10,
  },
  partnerCardDisabled: {
    opacity: 0.6,
  },
  partnerCardSelected: {
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#e63946',
  },
  partnerAvatar: {
    position: 'relative',
    marginRight: 12,
  },
  partnerPhoto: {
    width: 48,
    height: 48,
    borderRadius: 24,
  },
  partnerPhotoPlaceholder: {
    backgroundColor: '#e63946',
    justifyContent: 'center',
    alignItems: 'center',
  },
  partnerInitial: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  onlineDot: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: '#fff',
  },
  partnerInfo: {
    flex: 1,
  },
  partnerNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  partnerName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1c1d21',
  },
  inactiveBadge: {
    backgroundColor: '#fee2e2',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  inactiveBadgeText: {
    fontSize: 10,
    color: '#ef4444',
    fontWeight: '600',
  },
  partnerPhone: {
    fontSize: 13,
    color: '#61636b',
    marginTop: 2,
  },
  partnerMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 6,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: '600',
  },
  ratingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  ratingText: {
    fontSize: 12,
    color: '#f59e0b',
    fontWeight: '600',
  },
  skipButton: {
    marginHorizontal: 16,
    paddingVertical: 14,
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
  },
  skipButtonDisabled: {
    opacity: 0.6,
  },
  skipButtonText: {
    fontSize: 15,
    color: '#61636b',
    fontWeight: '500',
  },
});
