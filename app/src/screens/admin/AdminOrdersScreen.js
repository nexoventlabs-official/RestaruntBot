import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput, Modal, ScrollView,
  RefreshControl, TouchableOpacity, ActivityIndicator, Animated, Platform, StatusBar, Keyboard
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import api from '../../config/api';
import { colors, spacing, radius, typography, shadows } from '../../theme';

const STATUS_CONFIG = {
  pending: { color: '#F59E0B', bg: '#FEF3C7', icon: 'time-outline', label: 'Pending' },
  confirmed: { color: '#3B82F6', bg: '#DBEAFE', icon: 'checkmark-circle-outline', label: 'Confirmed' },
  preparing: { color: '#8B5CF6', bg: '#EDE9FE', icon: 'restaurant-outline', label: 'Preparing' },
  ready: { color: '#10B981', bg: '#D1FAE5', icon: 'checkmark-done-outline', label: 'Ready' },
  out_for_delivery: { color: '#06B6D4', bg: '#CFFAFE', icon: 'bicycle-outline', label: 'Out for Delivery' },
  delivered: { color: '#22C55E', bg: '#DCFCE7', icon: 'checkmark-circle', label: 'Delivered' },
  cancelled: { color: '#EF4444', bg: '#FEE2E2', icon: 'close-circle-outline', label: 'Cancelled' },
  refunded: { color: '#6B7280', bg: '#F3F4F6', icon: 'refresh-outline', label: 'Refunded' },
};

const PAYMENT_STATUS_CONFIG = {
  pending: { color: '#F59E0B', label: 'Pending' },
  paid: { color: '#22C55E', label: 'Paid' },
  failed: { color: '#EF4444', label: 'Failed' },
  refunded: { color: '#6B7280', label: 'Refunded' },
};

const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest First', icon: 'arrow-down' },
  { value: 'oldest', label: 'Oldest First', icon: 'arrow-up' },
  { value: 'amount_high', label: 'Amount: High to Low', icon: 'trending-down' },
  { value: 'amount_low', label: 'Amount: Low to High', icon: 'trending-up' },
];

const PremiumOrderCard = ({ item, onPress, index, searchTerm }) => {
  const statusConfig = STATUS_CONFIG[item.status] || STATUS_CONFIG.pending;
  const scaleAnim = useRef(new Animated.Value(0.95)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacityAnim, { toValue: 1, duration: 400, delay: index * 50, useNativeDriver: true }),
      Animated.spring(scaleAnim, { toValue: 1, friction: 8, tension: 40, delay: index * 50, useNativeDriver: true }),
    ]).start();
  }, []);

  const highlightText = (text, highlight) => {
    if (!highlight || !text) return <Text>{text}</Text>;
    const parts = text.split(new RegExp(`(${highlight})`, 'gi'));
    return (
      <Text>
        {parts.map((part, i) => 
          part.toLowerCase() === highlight.toLowerCase() 
            ? <Text key={i} style={styles.highlightedText}>{part}</Text>
            : part
        )}
      </Text>
    );
  };

  return (
    <Animated.View style={{ opacity: opacityAnim, transform: [{ scale: scaleAnim }] }}>
      <TouchableOpacity style={styles.orderCard} onPress={onPress} activeOpacity={0.9}>
        <View style={[styles.cardAccent, { backgroundColor: statusConfig.color }]} />
        <View style={styles.cardContent}>
          <View style={styles.orderHeader}>
            <View style={styles.orderIdSection}>
              <View style={styles.orderIdBadge}>
                <Ionicons name="receipt-outline" size={14} color={colors.zomato.red} />
                <Text style={styles.orderId}>{highlightText(`#${item.orderId}`, searchTerm)}</Text>
              </View>
              <View style={[styles.statusBadge, { backgroundColor: statusConfig.bg }]}>
                <View style={[styles.statusDot, { backgroundColor: statusConfig.color }]} />
                <Ionicons name={statusConfig.icon} size={12} color={statusConfig.color} />
                <Text style={[styles.statusText, { color: statusConfig.color }]}>{statusConfig.label}</Text>
              </View>
            </View>
          </View>
          <View style={styles.customerSection}>
            <View style={styles.customerAvatarContainer}>
              <LinearGradient colors={[colors.light.surfaceSecondary, colors.light.border]} style={styles.customerAvatar}>
                <Ionicons name="person" size={18} color={colors.light.text.secondary} />
              </LinearGradient>
              <View style={[styles.onlineIndicator, { backgroundColor: statusConfig.color }]} />
            </View>
            <View style={styles.customerInfo}>
              <Text style={styles.customerName}>{highlightText(item.customer?.name || item.customer?.phone || 'Customer', searchTerm)}</Text>
              <View style={styles.addressRow}>
                <View style={styles.addressIconContainer}><Ionicons name="location" size={12} color={colors.zomato.red} /></View>
                <Text style={styles.addressText} numberOfLines={1}>{item.deliveryAddress?.address || item.customer?.address || 'N/A'}</Text>
              </View>
            </View>
          </View>
          <View style={styles.itemsPreview}>
            <View style={styles.itemsIconContainer}><Ionicons name="fast-food-outline" size={14} color={colors.light.text.secondary} /></View>
            <Text style={styles.itemsPreviewText} numberOfLines={1}>
              {item.items?.slice(0, 2).map(i => i.name || i.menuItem?.name).join(', ') || 'Items'}
              {item.items?.length > 2 && ` +${item.items.length - 2} more`}
            </Text>
          </View>
          <View style={styles.orderFooter}>
            <View style={styles.amountSection}>
              <Text style={styles.amountLabel}>Total</Text>
              <View style={styles.amountRow}><Text style={styles.currencySymbol}>₹</Text><Text style={styles.amount}>{item.totalAmount}</Text></View>
            </View>
            <View style={styles.footerDivider} />
            <View style={styles.itemsCountSection}>
              <View style={styles.itemsCountBadge}><Ionicons name="cube-outline" size={14} color={colors.light.text.secondary} /><Text style={styles.itemsCountText}>{item.items?.length || 0}</Text></View>
              <Text style={styles.itemsLabel}>items</Text>
            </View>
            <View style={styles.footerDivider} />
            <View style={styles.timeSection}>
              <View style={styles.timeIconContainer}><Ionicons name="time-outline" size={14} color={colors.light.text.tertiary} /></View>
              <Text style={styles.time}>{new Date(item.createdAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</Text>
            </View>
          </View>
          <TouchableOpacity style={styles.viewDetailsButton} onPress={onPress}>
            <Text style={styles.viewDetailsText}>View Details</Text>
            <View style={styles.arrowContainer}><Ionicons name="arrow-forward" size={16} color={colors.zomato.red} /></View>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
};


export default function AdminOrdersScreen({ navigation }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState('all');
  const fadeAnim = useRef(new Animated.Value(0)).current;
  
  // Search & Filter States
  const [showSearch, setShowSearch] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [paymentFilter, setPaymentFilter] = useState('all');
  const [sortBy, setSortBy] = useState('newest');
  const [dateFilter, setDateFilter] = useState('all');
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');
  
  const searchInputRef = useRef(null);
  const searchSlideAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }).start();
  }, []);

  const fetchOrders = useCallback(async () => {
    try {
      const params = filter !== 'all' ? { status: filter } : {};
      const response = await api.get('/orders', { params });
      setOrders(response.data.orders || []);
    } catch (error) { console.error('Error fetching orders:', error); }
    finally { setLoading(false); setRefreshing(false); }
  }, [filter]);

  useEffect(() => { fetchOrders(); }, [fetchOrders]);
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => fetchOrders());
    return unsubscribe;
  }, [navigation, fetchOrders]);

  const onRefresh = useCallback(() => { setRefreshing(true); fetchOrders(); }, [filter]);

  // Toggle Search Bar
  const toggleSearch = () => {
    if (showSearch) {
      Animated.timing(searchSlideAnim, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => {
        setShowSearch(false);
        setSearchTerm('');
        Keyboard.dismiss();
      });
    } else {
      setShowSearch(true);
      Animated.timing(searchSlideAnim, { toValue: 1, duration: 200, useNativeDriver: true }).start(() => {
        searchInputRef.current?.focus();
      });
    }
  };

  // Filter & Sort Logic
  const filteredAndSortedOrders = useMemo(() => {
    let result = [...orders];

    // Search filter
    if (searchTerm.trim()) {
      const search = searchTerm.toLowerCase().trim();
      result = result.filter(order => 
        order.orderId?.toLowerCase().includes(search) ||
        order.customer?.name?.toLowerCase().includes(search) ||
        order.customer?.phone?.toLowerCase().includes(search) ||
        order.deliveryAddress?.address?.toLowerCase().includes(search) ||
        order.items?.some(item => (item.name || item.menuItem?.name)?.toLowerCase().includes(search))
      );
    }

    // Status filter (already applied via API, but also filter locally for combined filters)
    if (filter !== 'all') {
      result = result.filter(order => order.status === filter);
    }

    // Payment status filter
    if (paymentFilter !== 'all') {
      result = result.filter(order => order.paymentStatus === paymentFilter);
    }

    // Date filter
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
    const weekAgo = new Date(today); weekAgo.setDate(weekAgo.getDate() - 7);
    const monthAgo = new Date(today); monthAgo.setMonth(monthAgo.getMonth() - 1);

    if (dateFilter === 'today') {
      result = result.filter(order => new Date(order.createdAt) >= today);
    } else if (dateFilter === 'yesterday') {
      result = result.filter(order => {
        const d = new Date(order.createdAt);
        return d >= yesterday && d < today;
      });
    } else if (dateFilter === 'week') {
      result = result.filter(order => new Date(order.createdAt) >= weekAgo);
    } else if (dateFilter === 'month') {
      result = result.filter(order => new Date(order.createdAt) >= monthAgo);
    }

    // Amount filter
    if (minAmount) {
      result = result.filter(order => order.totalAmount >= parseFloat(minAmount));
    }
    if (maxAmount) {
      result = result.filter(order => order.totalAmount <= parseFloat(maxAmount));
    }

    // Sort
    result.sort((a, b) => {
      switch (sortBy) {
        case 'oldest': return new Date(a.createdAt) - new Date(b.createdAt);
        case 'amount_high': return b.totalAmount - a.totalAmount;
        case 'amount_low': return a.totalAmount - b.totalAmount;
        default: return new Date(b.createdAt) - new Date(a.createdAt);
      }
    });

    return result;
  }, [orders, searchTerm, filter, paymentFilter, dateFilter, minAmount, maxAmount, sortBy]);

  const activeFiltersCount = useMemo(() => {
    let count = 0;
    if (paymentFilter !== 'all') count++;
    if (dateFilter !== 'all') count++;
    if (minAmount || maxAmount) count++;
    if (sortBy !== 'newest') count++;
    return count;
  }, [paymentFilter, dateFilter, minAmount, maxAmount, sortBy]);

  const clearAllFilters = () => {
    setPaymentFilter('all');
    setDateFilter('all');
    setMinAmount('');
    setMaxAmount('');
    setSortBy('newest');
  };

  const FilterChip = ({ status, label, icon, count }) => {
    const isActive = filter === status;
    const statusColor = STATUS_CONFIG[status]?.color || colors.zomato.red;
    return (
      <TouchableOpacity
        style={[styles.filterChip, isActive && styles.filterChipActive, isActive && { backgroundColor: statusColor }]}
        onPress={() => setFilter(status)} activeOpacity={0.8}
      >
        <Ionicons name={icon} size={14} color={isActive ? '#fff' : colors.light.text.secondary} />
        <Text style={[styles.filterText, isActive && styles.filterTextActive]}>{label}</Text>
        {count > 0 && (
          <View style={[styles.filterCount, isActive && styles.filterCountActive]}>
            <Text style={[styles.filterCountText, isActive && styles.filterCountTextActive]}>{count}</Text>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  const getFilterCount = (status) => {
    if (status === 'all') return orders.length;
    return orders.filter(o => o.status === status).length;
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />
      
      {/* Header */}
      <LinearGradient colors={[colors.zomato.red, colors.zomato.darkRed, '#8B1A1A']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.header}>
        <View style={styles.headerContent}>
          <View style={styles.headerLeft}>
            <View style={styles.titleRow}>
              <View style={styles.titleIconContainer}><Ionicons name="receipt" size={20} color="#fff" /></View>
              <Text style={styles.title}>Orders</Text>
            </View>
            <Text style={styles.subtitle}>{filteredAndSortedOrders.length} of {orders.length} orders</Text>
          </View>
          <View style={styles.headerActions}>
            <TouchableOpacity style={[styles.searchButton, showSearch && styles.headerButtonActive]} onPress={toggleSearch}>
              <Ionicons name={showSearch ? "close" : "search"} size={20} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity style={[styles.filterButton, activeFiltersCount > 0 && styles.headerButtonActive]} onPress={() => setShowFilterModal(true)}>
              <Ionicons name="options-outline" size={20} color="#fff" />
              {activeFiltersCount > 0 && (
                <View style={styles.filterBadge}><Text style={styles.filterBadgeText}>{activeFiltersCount}</Text></View>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </LinearGradient>

      {/* Search Bar */}
      {showSearch && (
        <Animated.View style={[styles.searchContainer, { opacity: searchSlideAnim, transform: [{ translateY: searchSlideAnim.interpolate({ inputRange: [0, 1], outputRange: [-20, 0] }) }] }]}>
          <View style={styles.searchInputWrapper}>
            <Ionicons name="search-outline" size={20} color={colors.light.text.tertiary} />
            <TextInput
              ref={searchInputRef}
              style={styles.searchInput}
              placeholder="Search by order ID, customer, phone, address..."
              placeholderTextColor={colors.light.text.tertiary}
              value={searchTerm}
              onChangeText={setSearchTerm}
              autoCapitalize="none"
              returnKeyType="search"
            />
            {searchTerm.length > 0 && (
              <TouchableOpacity onPress={() => setSearchTerm('')}>
                <Ionicons name="close-circle" size={20} color={colors.light.text.tertiary} />
              </TouchableOpacity>
            )}
          </View>
          {searchTerm.length > 0 && (
            <Text style={styles.searchResultsText}>{filteredAndSortedOrders.length} results found</Text>
          )}
        </Animated.View>
      )}

      {/* Status Filter Chips */}
      <View style={styles.filterContainer}>
        <FlatList horizontal showsHorizontalScrollIndicator={false}
          data={[
            { status: 'all', label: 'All', icon: 'apps-outline' },
            { status: 'pending', label: 'Pending', icon: 'time-outline' },
            { status: 'preparing', label: 'Preparing', icon: 'restaurant-outline' },
            { status: 'ready', label: 'Ready', icon: 'checkmark-done-outline' },
            { status: 'out_for_delivery', label: 'Delivery', icon: 'bicycle-outline' },
            { status: 'delivered', label: 'Done', icon: 'checkmark-circle-outline' },
          ]}
          renderItem={({ item }) => <FilterChip status={item.status} label={item.label} icon={item.icon} count={getFilterCount(item.status)} />}
          keyExtractor={(item) => item.status} contentContainerStyle={styles.filterList}
        />
      </View>

      {/* Orders List */}
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.zomato.red} />
          <Text style={styles.loadingText}>Loading orders...</Text>
        </View>
      ) : (
        <FlatList 
          data={filteredAndSortedOrders}
          renderItem={({ item, index }) => <PremiumOrderCard item={item} index={index} searchTerm={searchTerm} onPress={() => navigation.navigate('OrderDetail', { order: item })} />}
          keyExtractor={(item) => item._id} 
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.zomato.red]} tintColor={colors.zomato.red} />}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <View style={styles.emptyIconContainer}>
                <LinearGradient colors={[colors.light.surfaceSecondary, colors.light.border]} style={styles.emptyIconGradient}>
                  <Ionicons name={searchTerm ? "search-outline" : "receipt-outline"} size={48} color={colors.light.text.tertiary} />
                </LinearGradient>
              </View>
              <Text style={styles.emptyTitle}>{searchTerm ? 'No matching orders' : 'No orders found'}</Text>
              <Text style={styles.emptyText}>{searchTerm ? `No orders match "${searchTerm}"` : filter !== 'all' ? 'Try changing the filter' : 'Orders will appear here'}</Text>
              {(searchTerm || filter !== 'all' || activeFiltersCount > 0) && (
                <TouchableOpacity style={styles.resetFilterButton} onPress={() => { setSearchTerm(''); setFilter('all'); clearAllFilters(); }}>
                  <Text style={styles.resetFilterText}>Clear All Filters</Text>
                </TouchableOpacity>
              )}
            </View>
          }
        />
      )}

      {/* Filter Modal */}
      <Modal visible={showFilterModal} animationType="slide" transparent={true} onRequestClose={() => setShowFilterModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHandle} />
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Filters & Sort</Text>
              <TouchableOpacity onPress={() => setShowFilterModal(false)} style={styles.modalCloseButton}>
                <Ionicons name="close" size={24} color={colors.light.text.secondary} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalBody} showsVerticalScrollIndicator={false}>
              {/* Sort By */}
              <View style={styles.filterSection}>
                <Text style={styles.filterSectionTitle}>Sort By</Text>
                <View style={styles.sortOptions}>
                  {SORT_OPTIONS.map(option => (
                    <TouchableOpacity
                      key={option.value}
                      style={[styles.sortOption, sortBy === option.value && styles.sortOptionActive]}
                      onPress={() => setSortBy(option.value)}
                    >
                      <Ionicons name={option.icon} size={16} color={sortBy === option.value ? '#fff' : colors.light.text.secondary} />
                      <Text style={[styles.sortOptionText, sortBy === option.value && styles.sortOptionTextActive]}>{option.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* Payment Status */}
              <View style={styles.filterSection}>
                <Text style={styles.filterSectionTitle}>Payment Status</Text>
                <View style={styles.paymentOptions}>
                  <TouchableOpacity style={[styles.paymentOption, paymentFilter === 'all' && styles.paymentOptionActive]} onPress={() => setPaymentFilter('all')}>
                    <Text style={[styles.paymentOptionText, paymentFilter === 'all' && styles.paymentOptionTextActive]}>All</Text>
                  </TouchableOpacity>
                  {Object.entries(PAYMENT_STATUS_CONFIG).map(([key, config]) => (
                    <TouchableOpacity
                      key={key}
                      style={[styles.paymentOption, paymentFilter === key && { backgroundColor: config.color, borderColor: config.color }]}
                      onPress={() => setPaymentFilter(key)}
                    >
                      <Text style={[styles.paymentOptionText, paymentFilter === key && styles.paymentOptionTextActive]}>{config.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* Date Filter */}
              <View style={styles.filterSection}>
                <Text style={styles.filterSectionTitle}>Date Range</Text>
                <View style={styles.dateOptions}>
                  {[{ value: 'all', label: 'All Time' }, { value: 'today', label: 'Today' }, { value: 'yesterday', label: 'Yesterday' }, { value: 'week', label: 'This Week' }, { value: 'month', label: 'This Month' }].map(option => (
                    <TouchableOpacity
                      key={option.value}
                      style={[styles.dateOption, dateFilter === option.value && styles.dateOptionActive]}
                      onPress={() => setDateFilter(option.value)}
                    >
                      <Text style={[styles.dateOptionText, dateFilter === option.value && styles.dateOptionTextActive]}>{option.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* Amount Range */}
              <View style={styles.filterSection}>
                <Text style={styles.filterSectionTitle}>Amount Range</Text>
                <View style={styles.amountInputs}>
                  <View style={styles.amountInputWrapper}>
                    <Text style={styles.amountInputLabel}>Min ₹</Text>
                    <TextInput style={styles.amountInput} placeholder="0" placeholderTextColor={colors.light.text.tertiary} value={minAmount} onChangeText={setMinAmount} keyboardType="numeric" />
                  </View>
                  <Text style={styles.amountSeparator}>to</Text>
                  <View style={styles.amountInputWrapper}>
                    <Text style={styles.amountInputLabel}>Max ₹</Text>
                    <TextInput style={styles.amountInput} placeholder="Any" placeholderTextColor={colors.light.text.tertiary} value={maxAmount} onChangeText={setMaxAmount} keyboardType="numeric" />
                  </View>
                </View>
              </View>
            </ScrollView>

            {/* Modal Footer */}
            <View style={styles.modalFooter}>
              <TouchableOpacity style={styles.clearButton} onPress={clearAllFilters}>
                <Text style={styles.clearButtonText}>Clear All</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.applyButton} onPress={() => setShowFilterModal(false)}>
                <Text style={styles.applyButtonText}>Apply Filters</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}


const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.light.background },
  header: { paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight + 20 : 60, paddingBottom: spacing.lg + 4, paddingHorizontal: spacing.screenHorizontal, borderBottomLeftRadius: 28, borderBottomRightRadius: 28 },
  headerContent: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  headerLeft: {},
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  titleIconContainer: { width: 36, height: 36, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.15)', justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 28, fontWeight: '800', color: '#fff', letterSpacing: -0.5 },
  subtitle: { fontSize: 14, color: 'rgba(255,255,255,0.8)', marginTop: spacing.xs, marginLeft: 48 },
  headerActions: { flexDirection: 'row', gap: spacing.sm },
  searchButton: { width: 44, height: 44, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.15)', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  filterButton: { width: 44, height: 44, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.15)', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  headerButtonActive: { backgroundColor: 'rgba(255,255,255,0.3)' },
  filterBadge: { position: 'absolute', top: 6, right: 6, width: 18, height: 18, borderRadius: 9, backgroundColor: '#FFD700', justifyContent: 'center', alignItems: 'center' },
  filterBadgeText: { fontSize: 10, fontWeight: '700', color: '#000' },
  
  // Search
  searchContainer: { backgroundColor: colors.light.surface, paddingHorizontal: spacing.screenHorizontal, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.light.borderLight },
  searchInputWrapper: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.light.surfaceSecondary, borderRadius: radius.lg, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.sm },
  searchInput: { flex: 1, fontSize: 15, color: colors.light.text.primary, paddingVertical: spacing.xs },
  searchResultsText: { fontSize: 12, color: colors.light.text.tertiary, marginTop: spacing.sm, textAlign: 'center' },
  highlightedText: { backgroundColor: '#FEF3C7', color: '#92400E', fontWeight: '600' },
  
  // Filter Chips
  filterContainer: { backgroundColor: colors.light.surface, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.light.borderLight, ...shadows.xs },
  filterList: { paddingHorizontal: spacing.screenHorizontal, gap: spacing.sm },
  filterChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2, borderRadius: radius.full, backgroundColor: colors.light.surfaceSecondary, marginRight: spacing.sm, borderWidth: 1, borderColor: colors.light.borderLight },
  filterChipActive: { borderColor: 'transparent' },
  filterText: { fontSize: 13, color: colors.light.text.secondary, fontWeight: '600' },
  filterTextActive: { color: '#fff' },
  filterCount: { backgroundColor: colors.light.border, paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.full, minWidth: 20, alignItems: 'center' },
  filterCountActive: { backgroundColor: 'rgba(255,255,255,0.25)' },
  filterCountText: { fontSize: 11, fontWeight: '700', color: colors.light.text.secondary },
  filterCountTextActive: { color: '#fff' },
  
  // Loading & List
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: spacing.md },
  loadingText: { fontSize: 14, color: colors.light.text.secondary },
  listContent: { padding: spacing.screenHorizontal, paddingBottom: 100 },
  
  // Order Card
  orderCard: { backgroundColor: colors.light.surface, borderRadius: radius.xl + 4, marginBottom: spacing.md, overflow: 'hidden', ...shadows.md },
  cardAccent: { height: 4, width: '100%' },
  cardContent: { padding: spacing.base },
  orderHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md },
  orderIdSection: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  orderIdBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.zomato.red + '10', paddingHorizontal: spacing.sm + 2, paddingVertical: 6, borderRadius: radius.md },
  orderId: { fontSize: 15, fontWeight: '700', color: colors.zomato.red },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: spacing.sm + 2, paddingVertical: 6, borderRadius: radius.full },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 12, fontWeight: '600' },
  customerSection: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md, borderTopWidth: 1, borderTopColor: colors.light.borderLight },
  customerAvatarContainer: { position: 'relative' },
  customerAvatar: { width: 48, height: 48, borderRadius: 14, justifyContent: 'center', alignItems: 'center' },
  onlineIndicator: { position: 'absolute', bottom: 0, right: 0, width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: colors.light.surface },
  customerInfo: { flex: 1, marginLeft: spacing.md },
  customerName: { fontSize: 16, fontWeight: '600', color: colors.light.text.primary },
  addressRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  addressIconContainer: { width: 20, height: 20, borderRadius: 6, backgroundColor: colors.zomato.red + '10', justifyContent: 'center', alignItems: 'center' },
  addressText: { fontSize: 13, color: colors.light.text.tertiary, flex: 1 },
  itemsPreview: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.light.surfaceSecondary, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md, marginBottom: spacing.md },
  itemsIconContainer: { width: 24, height: 24, borderRadius: 6, backgroundColor: colors.light.surface, justifyContent: 'center', alignItems: 'center' },
  itemsPreviewText: { flex: 1, fontSize: 13, color: colors.light.text.secondary },
  orderFooter: { flexDirection: 'row', alignItems: 'center', paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.light.borderLight },
  amountSection: { flex: 1 },
  amountLabel: { fontSize: 11, color: colors.light.text.tertiary, fontWeight: '500', textTransform: 'uppercase', letterSpacing: 0.5 },
  amountRow: { flexDirection: 'row', alignItems: 'baseline', marginTop: 2 },
  currencySymbol: { fontSize: 14, fontWeight: '600', color: colors.zomato.red },
  amount: { fontSize: 20, fontWeight: '700', color: colors.zomato.red },
  footerDivider: { width: 1, height: 32, backgroundColor: colors.light.borderLight, marginHorizontal: spacing.md },
  itemsCountSection: { alignItems: 'center' },
  itemsCountBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.light.surfaceSecondary, paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.sm },
  itemsCountText: { fontSize: 14, color: colors.light.text.primary, fontWeight: '700' },
  itemsLabel: { fontSize: 11, color: colors.light.text.tertiary, marginTop: 2 },
  timeSection: { flex: 1, alignItems: 'flex-end' },
  timeIconContainer: { width: 24, height: 24, borderRadius: 6, backgroundColor: colors.light.surfaceSecondary, justifyContent: 'center', alignItems: 'center', marginBottom: 2 },
  time: { fontSize: 11, color: colors.light.text.tertiary, fontWeight: '500' },
  viewDetailsButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: colors.zomato.red + '08', paddingVertical: spacing.md, borderRadius: radius.lg, marginTop: spacing.md, gap: spacing.sm },
  viewDetailsText: { fontSize: 14, fontWeight: '600', color: colors.zomato.red },
  arrowContainer: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.zomato.red + '15', justifyContent: 'center', alignItems: 'center' },
  
  // Empty State
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 80, paddingHorizontal: spacing.xl },
  emptyIconContainer: { marginBottom: spacing.lg },
  emptyIconGradient: { width: 100, height: 100, borderRadius: 30, justifyContent: 'center', alignItems: 'center' },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: colors.light.text.primary, marginBottom: spacing.xs },
  emptyText: { fontSize: 14, color: colors.light.text.tertiary, textAlign: 'center' },
  resetFilterButton: { marginTop: spacing.lg, backgroundColor: colors.zomato.red, paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderRadius: radius.full },
  resetFilterText: { fontSize: 14, fontWeight: '600', color: '#fff' },
  
  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: colors.light.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '85%' },
  modalHandle: { width: 40, height: 4, backgroundColor: colors.light.border, borderRadius: 2, alignSelf: 'center', marginTop: spacing.md },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing.screenHorizontal, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.light.borderLight },
  modalTitle: { fontSize: 20, fontWeight: '700', color: colors.light.text.primary },
  modalCloseButton: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.light.surfaceSecondary, justifyContent: 'center', alignItems: 'center' },
  modalBody: { paddingHorizontal: spacing.screenHorizontal, paddingVertical: spacing.md },
  modalFooter: { flexDirection: 'row', gap: spacing.md, paddingHorizontal: spacing.screenHorizontal, paddingVertical: spacing.lg, borderTopWidth: 1, borderTopColor: colors.light.borderLight },
  
  // Filter Sections
  filterSection: { marginBottom: spacing.xl },
  filterSectionTitle: { fontSize: 14, fontWeight: '600', color: colors.light.text.secondary, marginBottom: spacing.md, textTransform: 'uppercase', letterSpacing: 0.5 },
  
  // Sort Options
  sortOptions: { gap: spacing.sm },
  sortOption: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.md, borderRadius: radius.lg, backgroundColor: colors.light.surfaceSecondary, borderWidth: 1, borderColor: colors.light.borderLight },
  sortOptionActive: { backgroundColor: colors.zomato.red, borderColor: colors.zomato.red },
  sortOptionText: { fontSize: 14, color: colors.light.text.secondary, fontWeight: '500' },
  sortOptionTextActive: { color: '#fff', fontWeight: '600' },
  
  // Payment Options
  paymentOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  paymentOption: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.full, backgroundColor: colors.light.surfaceSecondary, borderWidth: 1, borderColor: colors.light.borderLight },
  paymentOptionActive: { backgroundColor: colors.zomato.red, borderColor: colors.zomato.red },
  paymentOptionText: { fontSize: 13, color: colors.light.text.secondary, fontWeight: '500' },
  paymentOptionTextActive: { color: '#fff', fontWeight: '600' },
  
  // Date Options
  dateOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  dateOption: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.full, backgroundColor: colors.light.surfaceSecondary, borderWidth: 1, borderColor: colors.light.borderLight },
  dateOptionActive: { backgroundColor: colors.zomato.red, borderColor: colors.zomato.red },
  dateOptionText: { fontSize: 13, color: colors.light.text.secondary, fontWeight: '500' },
  dateOptionTextActive: { color: '#fff', fontWeight: '600' },
  
  // Amount Inputs
  amountInputs: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  amountInputWrapper: { flex: 1 },
  amountInputLabel: { fontSize: 12, color: colors.light.text.tertiary, marginBottom: spacing.xs },
  amountInput: { backgroundColor: colors.light.surfaceSecondary, borderRadius: radius.lg, paddingHorizontal: spacing.md, paddingVertical: spacing.md, fontSize: 16, color: colors.light.text.primary, borderWidth: 1, borderColor: colors.light.borderLight },
  amountSeparator: { fontSize: 14, color: colors.light.text.tertiary, marginTop: spacing.lg },
  
  // Buttons
  clearButton: { flex: 1, paddingVertical: spacing.md, borderRadius: radius.lg, backgroundColor: colors.light.surfaceSecondary, alignItems: 'center' },
  clearButtonText: { fontSize: 15, fontWeight: '600', color: colors.light.text.secondary },
  applyButton: { flex: 2, paddingVertical: spacing.md, borderRadius: radius.lg, backgroundColor: colors.zomato.red, alignItems: 'center' },
  applyButtonText: { fontSize: 15, fontWeight: '600', color: '#fff' },
});
