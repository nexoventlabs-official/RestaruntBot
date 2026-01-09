import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView, FlatList, ScrollView,
  RefreshControl, TouchableOpacity, Image, Alert, ActivityIndicator,
  TextInput, Modal, Animated, Platform
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import api from '../../config/api';

// Zomato Theme Colors
const ZOMATO_RED = '#E23744';
const ZOMATO_DARK_RED = '#CB1A27';

export default function AdminMenuScreen({ navigation }) {
  const [items, setItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [foodTypeFilter, setFoodTypeFilter] = useState('all');
  const [togglingId, setTogglingId] = useState(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.95)).current;
  
  // Category modal
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [categoryForm, setCategoryForm] = useState({ name: '' });
  const [editingCategory, setEditingCategory] = useState(null);
  const [savingCategory, setSavingCategory] = useState(false);
  const [categoryImage, setCategoryImage] = useState(null);
  const [categoryImagePreview, setCategoryImagePreview] = useState('');

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 500,
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        friction: 8,
        tension: 40,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  const fetchMenu = useCallback(async () => {
    try {
      const response = await api.get('/menu');
      setItems(response.data || []);
    } catch (error) {
      console.error('Error fetching menu:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const fetchCategories = useCallback(async () => {
    try {
      const response = await api.get('/categories');
      setCategories(response.data || []);
    } catch (error) {
      console.error('Error fetching categories:', error);
    }
  }, []);

  useEffect(() => {
    fetchMenu();
    fetchCategories();
    const unsubscribe = navigation.addListener('focus', () => {
      fetchMenu();
      fetchCategories();
    });
    return unsubscribe;
  }, [navigation, fetchMenu, fetchCategories]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchMenu();
    fetchCategories();
  }, [fetchMenu, fetchCategories]);

  const toggleAvailability = async (item) => {
    setTogglingId(item._id);
    setItems(prev => prev.map(i => i._id === item._id ? { ...i, available: !i.available } : i));
    try {
      const tags = Array.isArray(item.tags) ? item.tags.join(', ') : (item.tags || '');
      await api.put(`/menu/${item._id}`, { ...item, available: !item.available, tags });
    } catch (error) {
      setItems(prev => prev.map(i => i._id === item._id ? { ...i, available: item.available } : i));
      Alert.alert('Error', 'Failed to update availability');
    } finally {
      setTogglingId(null);
    }
  };

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

  // Category functions
  const openCategoryModal = (category = null) => {
    if (category) {
      setEditingCategory(category);
      setCategoryForm({ name: category.name });
      setCategoryImagePreview(category.image || '');
      setCategoryImage(null);
    } else {
      setEditingCategory(null);
      setCategoryForm({ name: '' });
      setCategoryImagePreview('');
      setCategoryImage(null);
    }
    setShowCategoryModal(true);
  };

  const pickCategoryImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!result.canceled) {
      setCategoryImage(result.assets[0]);
      setCategoryImagePreview(result.assets[0].uri);
    }
  };

  const removeCategoryImage = () => {
    setCategoryImage(null);
    setCategoryImagePreview('');
  };

  const saveCategory = async () => {
    if (!categoryForm.name.trim()) {
      Alert.alert('Error', 'Category name is required');
      return;
    }
    setSavingCategory(true);
    try {
      const formData = new FormData();
      formData.append('name', categoryForm.name);
      formData.append('description', '');
      
      if (categoryImage) {
        const filename = categoryImage.uri.split('/').pop();
        const match = /\.(\w+)$/.exec(filename);
        const type = match ? `image/${match[1]}` : 'image/jpeg';
        formData.append('image', { uri: categoryImage.uri, name: filename, type });
      } else if (!categoryImagePreview && editingCategory?.image) {
        formData.append('removeImage', 'true');
      }

      if (editingCategory) {
        await api.put(`/categories/${editingCategory._id}`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
      } else {
        await api.post('/categories', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
      }
      setShowCategoryModal(false);
      setCategoryImage(null);
      setCategoryImagePreview('');
      fetchCategories();
    } catch (error) {
      Alert.alert('Error', error.response?.data?.error || 'Failed to save category');
    } finally {
      setSavingCategory(false);
    }
  };

  const deleteCategory = (category) => {
    Alert.alert(
      'Delete Category',
      `Delete "${category.name}"? Items in this category won't be deleted.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.delete(`/categories/${category._id}`);
              fetchCategories();
              if (selectedCategory === category.name) {
                setSelectedCategory('all');
              }
            } catch (error) {
              Alert.alert('Error', 'Failed to delete category');
            }
          },
        },
      ]
    );
  };

  const toggleCategoryPause = async (category) => {
    try {
      setCategories(prev => prev.map(c => 
        c._id === category._id ? { ...c, isPaused: !c.isPaused } : c
      ));
      await api.patch(`/categories/${category._id}/toggle-pause`);
      fetchCategories();
    } catch (error) {
      setCategories(prev => prev.map(c => 
        c._id === category._id ? { ...c, isPaused: category.isPaused } : c
      ));
      Alert.alert('Error', 'Failed to toggle pause status');
    }
  };

  const completePauseCategory = async (category) => {
    const itemsInCategory = items.filter(item => {
      const itemCategories = Array.isArray(item.category) ? item.category : [item.category];
      return itemCategories.includes(category.name);
    });
    
    if (itemsInCategory.length === 0) {
      Alert.alert('Info', 'No items in this category');
      return;
    }

    const pausedItems = itemsInCategory.filter(item => item.isPaused);
    const unpausedItems = itemsInCategory.filter(item => !item.isPaused);
    const allPaused = unpausedItems.length === 0;

    Alert.alert(
      allPaused ? 'Resume All' : 'Complete Pause',
      allPaused 
        ? `This will resume ${pausedItems.length} item(s) in "${category.name}". Continue?`
        : `This will pause ${unpausedItems.length} item(s) in "${category.name}". Continue?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: allPaused ? 'Resume All' : 'Pause All',
          onPress: async () => {
            try {
              await api.patch('/menu/bulk-pause', { 
                categoryName: category.name, 
                isPaused: !allPaused 
              });
              setItems(prev => prev.map(item => {
                const itemCategories = Array.isArray(item.category) ? item.category : [item.category];
                if (itemCategories.includes(category.name)) {
                  return { ...item, isPaused: !allPaused };
                }
                return item;
              }));
              Alert.alert('Success', allPaused 
                ? `${pausedItems.length} item(s) resumed`
                : `${unpausedItems.length} item(s) paused`
              );
              fetchMenu();
            } catch (error) {
              Alert.alert('Error', allPaused ? 'Failed to resume items' : 'Failed to pause items');
              fetchMenu();
            }
          },
        },
      ]
    );
  };

  // Get paused category names
  const pausedCategoryNames = categories.filter(c => c.isPaused).map(c => c.name);

  const isItemPaused = (item) => {
    if (item.isPaused) return true;
    const itemCategories = Array.isArray(item.category) ? item.category : [item.category];
    return itemCategories.every(cat => pausedCategoryNames.includes(cat));
  };

  // Filter items
  const filteredItems = items.filter(item => {
    const itemCategories = Array.isArray(item.category) ? item.category : [item.category];
    const matchesSearch = item.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      itemCategories.some(cat => cat?.toLowerCase().includes(searchTerm.toLowerCase()));
    const matchesCategory = selectedCategory === 'all' || itemCategories.includes(selectedCategory);
    const matchesStatus = statusFilter === 'all' || 
      (statusFilter === 'available' && item.available) || 
      (statusFilter === 'unavailable' && !item.available);
    const matchesFoodType = foodTypeFilter === 'all' || item.foodType === foodTypeFilter;
    return matchesSearch && matchesCategory && matchesStatus && matchesFoodType;
  });

  // Stats
  const totalItems = items.length;
  const availableCount = items.filter(i => i.available).length;
  const unavailableCount = items.filter(i => !i.available).length;
  const uniqueCategories = [...new Set(items.flatMap(i => Array.isArray(i.category) ? i.category : [i.category]))];

  const renderItem = ({ item, index }) => {
    const isPaused = isItemPaused(item);
    
    return (
      <Animated.View style={{
        opacity: fadeAnim,
        transform: [{ scale: scaleAnim }],
      }}>
        <TouchableOpacity
          style={[styles.itemCard, isPaused && styles.itemCardPaused]}
          onPress={() => navigation.navigate('MenuItemForm', { item })}
          activeOpacity={0.7}
        >
          <View style={styles.itemImageContainer}>
            {item.image ? (
              <Image 
                source={{ uri: item.image }} 
                style={[styles.itemImage, isPaused && styles.itemImagePaused]} 
              />
            ) : (
              <View style={[styles.itemImage, styles.placeholderImage, isPaused && styles.placeholderImagePaused]}>
                <Ionicons name="restaurant-outline" size={28} color={isPaused ? '#9ca3af' : '#d1d5db'} />
              </View>
            )}
            {isPaused && (
              <View style={styles.pausedBadge}>
                <Ionicons name="pause-circle" size={20} color="#f59e0b" />
              </View>
            )}
            {item.foodType && item.foodType !== 'none' && (
              <View style={[styles.foodTypeBadge, { 
                borderColor: isPaused ? '#9ca3af' : (item.foodType === 'veg' ? '#22c55e' : item.foodType === 'egg' ? '#f59e0b' : '#ef4444')
              }]}>
                <View style={[styles.foodTypeDot, { 
                  backgroundColor: isPaused ? '#9ca3af' : (item.foodType === 'veg' ? '#22c55e' : item.foodType === 'egg' ? '#f59e0b' : '#ef4444')
                }]} />
              </View>
            )}
          </View>
          
          <View style={styles.itemInfo}>
            <Text style={[styles.itemName, isPaused && styles.textPaused]} numberOfLines={1}>{item.name}</Text>
            <Text style={[styles.itemCategory, isPaused && styles.textPaused]} numberOfLines={1}>
              {Array.isArray(item.category) ? item.category.join(', ') : item.category}
            </Text>
            {item.preparationTime > 0 && (
              <View style={styles.prepTimeRow}>
                <Ionicons name="time-outline" size={12} color="#9ca3af" />
                <Text style={styles.prepTimeText}>{item.preparationTime} min</Text>
              </View>
            )}
            <View style={styles.itemFooter}>
              <Text style={[styles.itemPrice, isPaused && styles.pricePaused]}>₹{item.price}</Text>
              {isPaused ? (
                <View style={styles.pausedStatusBadge}>
                  <Text style={styles.pausedStatusText}>Paused</Text>
                </View>
              ) : (
                <TouchableOpacity 
                  style={[styles.availabilityToggle, { backgroundColor: item.available ? '#DCFCE7' : '#FEE2E2' }]}
                  onPress={() => toggleAvailability(item)}
                  disabled={togglingId === item._id}
                >
                  {togglingId === item._id ? (
                    <ActivityIndicator size="small" color={item.available ? '#22c55e' : '#ef4444'} />
                  ) : (
                    <Text style={[styles.availabilityText, { color: item.available ? '#16A34A' : '#DC2626' }]}>
                      {item.available ? 'In Stock' : 'Out'}
                    </Text>
                  )}
                </TouchableOpacity>
              )}
            </View>
          </View>

          <TouchableOpacity style={styles.deleteButton} onPress={() => deleteItem(item)}>
            <Ionicons name="trash-outline" size={18} color="#ef4444" />
          </TouchableOpacity>
        </TouchableOpacity>
      </Animated.View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Premium Zomato Header */}
      <Animated.View style={{ opacity: fadeAnim }}>
        <LinearGradient
          colors={[ZOMATO_RED, ZOMATO_DARK_RED]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.header}
        >
          <View style={styles.headerContent}>
            <View>
              <Text style={styles.title}>Menu</Text>
              <Text style={styles.subtitle}>{totalItems} items • {uniqueCategories.length} categories</Text>
            </View>
            <View style={styles.headerButtons}>
              <TouchableOpacity style={styles.headerButton} onPress={() => openCategoryModal()}>
                <Ionicons name="folder-outline" size={20} color={ZOMATO_RED} />
              </TouchableOpacity>
              <TouchableOpacity style={styles.headerButton} onPress={() => navigation.navigate('MenuItemForm', {})}>
                <Ionicons name="add" size={24} color={ZOMATO_RED} />
              </TouchableOpacity>
            </View>
          </View>
        </LinearGradient>
      </Animated.View>

      {/* Premium Search Bar */}
      <View style={styles.searchContainer}>
        <View style={styles.searchInputWrapper}>
          <Ionicons name="search-outline" size={20} color="#9ca3af" />
          <TextInput
            style={styles.searchInput}
            placeholder="Search menu items..."
            value={searchTerm}
            onChangeText={setSearchTerm}
            placeholderTextColor="#9ca3af"
          />
          {searchTerm.length > 0 && (
            <TouchableOpacity onPress={() => setSearchTerm('')}>
              <Ionicons name="close-circle" size={20} color="#9ca3af" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Stats Cards */}
      <View style={styles.statsContainer}>
        <View style={[styles.statCard, styles.statCardTotal]}>
          <Text style={styles.statValue}>{totalItems}</Text>
          <Text style={styles.statLabel}>Total</Text>
        </View>
        <View style={[styles.statCard, styles.statCardCategories]}>
          <Text style={styles.statValue}>{uniqueCategories.length}</Text>
          <Text style={styles.statLabel}>Categories</Text>
        </View>
        <View style={[styles.statCard, styles.statCardAvailable]}>
          <Text style={[styles.statValue, { color: '#16A34A' }]}>{availableCount}</Text>
          <Text style={styles.statLabel}>In Stock</Text>
        </View>
        <View style={[styles.statCard, styles.statCardUnavailable]}>
          <Text style={[styles.statValue, { color: '#DC2626' }]}>{unavailableCount}</Text>
          <Text style={styles.statLabel}>Out</Text>
        </View>
      </View>

      {/* Filter Chips */}
      <View style={styles.filtersContainer}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
          <TouchableOpacity
            style={[styles.filterChip, statusFilter === 'all' && styles.filterChipActive]}
            onPress={() => setStatusFilter('all')}
          >
            <Text style={[styles.filterChipText, statusFilter === 'all' && styles.filterChipTextActive]}>All</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.filterChip, statusFilter === 'available' && styles.filterChipAvailable]}
            onPress={() => setStatusFilter('available')}
          >
            <Text style={[styles.filterChipText, statusFilter === 'available' && styles.filterChipTextActive]}>In Stock</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.filterChip, statusFilter === 'unavailable' && styles.filterChipUnavailable]}
            onPress={() => setStatusFilter('unavailable')}
          >
            <Text style={[styles.filterChipText, statusFilter === 'unavailable' && styles.filterChipTextActive]}>Out of Stock</Text>
          </TouchableOpacity>
          <View style={styles.filterDivider} />
          <TouchableOpacity
            style={[styles.filterChip, foodTypeFilter === 'veg' && { backgroundColor: '#22c55e', borderColor: '#22c55e' }]}
            onPress={() => setFoodTypeFilter(foodTypeFilter === 'veg' ? 'all' : 'veg')}
          >
            <View style={[styles.foodTypeIcon, { borderColor: foodTypeFilter === 'veg' ? '#fff' : '#22c55e' }]}>
              <View style={[styles.foodTypeIconDot, { backgroundColor: foodTypeFilter === 'veg' ? '#fff' : '#22c55e' }]} />
            </View>
            <Text style={[styles.filterChipText, foodTypeFilter === 'veg' && styles.filterChipTextActive]}>Veg</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.filterChip, foodTypeFilter === 'nonveg' && { backgroundColor: '#ef4444', borderColor: '#ef4444' }]}
            onPress={() => setFoodTypeFilter(foodTypeFilter === 'nonveg' ? 'all' : 'nonveg')}
          >
            <View style={[styles.foodTypeIcon, { borderColor: foodTypeFilter === 'nonveg' ? '#fff' : '#ef4444' }]}>
              <View style={[styles.foodTypeIconDot, { backgroundColor: foodTypeFilter === 'nonveg' ? '#fff' : '#ef4444' }]} />
            </View>
            <Text style={[styles.filterChipText, foodTypeFilter === 'nonveg' && styles.filterChipTextActive]}>Non-Veg</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.filterChip, foodTypeFilter === 'egg' && { backgroundColor: '#f59e0b', borderColor: '#f59e0b' }]}
            onPress={() => setFoodTypeFilter(foodTypeFilter === 'egg' ? 'all' : 'egg')}
          >
            <View style={[styles.foodTypeIcon, { borderColor: foodTypeFilter === 'egg' ? '#fff' : '#f59e0b' }]}>
              <View style={[styles.foodTypeIconDot, { backgroundColor: foodTypeFilter === 'egg' ? '#fff' : '#f59e0b' }]} />
            </View>
            <Text style={[styles.filterChipText, foodTypeFilter === 'egg' && styles.filterChipTextActive]}>Egg</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>

      {/* Category Filter */}
      {categories.length > 0 && (
        <View style={styles.categoryFilterContainer}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryFilterList}>
            <TouchableOpacity
              style={[styles.categoryChip, selectedCategory === 'all' && styles.categoryChipActive]}
              onPress={() => setSelectedCategory('all')}
            >
              <View style={[styles.categoryChipIcon, selectedCategory === 'all' && styles.categoryChipIconActive]}>
                <Ionicons name="grid-outline" size={14} color={selectedCategory === 'all' ? '#fff' : ZOMATO_RED} />
              </View>
              <Text style={[styles.categoryChipText, selectedCategory === 'all' && styles.categoryChipTextActive]}>All</Text>
            </TouchableOpacity>
            {categories.map(cat => {
              const itemsInCat = items.filter(item => {
                const itemCategories = Array.isArray(item.category) ? item.category : [item.category];
                return itemCategories.includes(cat.name);
              });
              const allItemsPaused = itemsInCat.length > 0 && itemsInCat.every(item => item.isPaused);
              
              return (
                <TouchableOpacity
                  key={cat._id}
                  style={[styles.categoryChip, selectedCategory === cat.name && styles.categoryChipActive, cat.isPaused && styles.categoryChipPaused]}
                  onPress={() => setSelectedCategory(cat.name)}
                  onLongPress={() => {
                    Alert.alert(
                      cat.name,
                      'What would you like to do?',
                      [
                        { text: 'Cancel', style: 'cancel' },
                        { text: cat.isPaused ? 'Resume' : 'Pause', onPress: () => toggleCategoryPause(cat) },
                        { text: allItemsPaused ? 'Resume All' : 'Complete Pause', onPress: () => completePauseCategory(cat) },
                        { text: 'Edit', onPress: () => openCategoryModal(cat) },
                        { text: 'Delete', style: 'destructive', onPress: () => deleteCategory(cat) },
                      ]
                    );
                  }}
                >
                  <View style={[styles.categoryChipIcon, selectedCategory === cat.name && styles.categoryChipIconActive, cat.isPaused && styles.categoryChipIconPaused]}>
                    {cat.image ? (
                      <Image source={{ uri: cat.image }} style={styles.categoryChipImage} />
                    ) : (
                      <Ionicons name="folder-outline" size={14} color={selectedCategory === cat.name ? '#fff' : (cat.isPaused ? '#f59e0b' : '#696969')} />
                    )}
                  </View>
                  <Text style={[
                    styles.categoryChipText, 
                    selectedCategory === cat.name && styles.categoryChipTextActive,
                    cat.isPaused && styles.categoryChipTextPaused
                  ]}>{cat.name}</Text>
                  {cat.isPaused && <Ionicons name="pause-circle" size={14} color="#f59e0b" />}
                </TouchableOpacity>
              );
            })}
            <TouchableOpacity style={styles.addCategoryChip} onPress={() => openCategoryModal()}>
              <Ionicons name="add" size={20} color="#696969" />
            </TouchableOpacity>
          </ScrollView>
        </View>
      )}

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={ZOMATO_RED} />
          <Text style={styles.loadingText}>Loading menu...</Text>
        </View>
      ) : (
        <FlatList
          data={filteredItems}
          renderItem={renderItem}
          keyExtractor={(item) => item._id}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[ZOMATO_RED]} tintColor={ZOMATO_RED} />}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <View style={styles.emptyIconContainer}>
                <Ionicons name="restaurant-outline" size={48} color={ZOMATO_RED} />
              </View>
              <Text style={styles.emptyTitle}>
                {searchTerm || selectedCategory !== 'all' || statusFilter !== 'all' || foodTypeFilter !== 'all'
                  ? 'No items found'
                  : 'No menu items yet'}
              </Text>
              <Text style={styles.emptySubtitle}>
                {searchTerm || selectedCategory !== 'all' || statusFilter !== 'all' || foodTypeFilter !== 'all'
                  ? 'Try adjusting your filters'
                  : 'Add your first menu item to get started'}
              </Text>
              {!searchTerm && selectedCategory === 'all' && statusFilter === 'all' && foodTypeFilter === 'all' && (
                <TouchableOpacity
                  style={styles.emptyButton}
                  onPress={() => navigation.navigate('MenuItemForm', {})}
                >
                  <Ionicons name="add" size={20} color="#fff" />
                  <Text style={styles.emptyButtonText}>Add First Item</Text>
                </TouchableOpacity>
              )}
            </View>
          }
        />
      )}

      {/* Category Modal */}
      <Modal
        visible={showCategoryModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowCategoryModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHandle} />
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{editingCategory ? 'Edit Category' : 'New Category'}</Text>
              <TouchableOpacity style={styles.modalCloseButton} onPress={() => setShowCategoryModal(false)}>
                <Ionicons name="close" size={24} color="#696969" />
              </TouchableOpacity>
            </View>
            
            <View style={styles.modalBody}>
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Category Name</Text>
                <TextInput
                  style={styles.modalInput}
                  value={categoryForm.name}
                  onChangeText={(text) => setCategoryForm({ ...categoryForm, name: text })}
                  placeholder="e.g., Main Course"
                  placeholderTextColor="#9ca3af"
                />
              </View>
              
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Category Image</Text>
                <View style={styles.categoryImageSection}>
                  {categoryImagePreview ? (
                    <View style={styles.categoryImageContainer}>
                      <Image source={{ uri: categoryImagePreview }} style={styles.categoryImagePreview} />
                      <TouchableOpacity style={styles.removeCategoryImageButton} onPress={removeCategoryImage}>
                        <Ionicons name="close-circle" size={28} color="#ef4444" />
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <TouchableOpacity style={styles.categoryImagePlaceholder} onPress={pickCategoryImage}>
                      <Ionicons name="camera-outline" size={32} color="#9ca3af" />
                      <Text style={styles.categoryImagePlaceholderText}>Add Image</Text>
                    </TouchableOpacity>
                  )}
                  {categoryImagePreview && (
                    <TouchableOpacity style={styles.changeCategoryImageButton} onPress={pickCategoryImage}>
                      <Ionicons name="image-outline" size={18} color="#696969" />
                      <Text style={styles.changeCategoryImageText}>Change</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            </View>

            <View style={styles.modalFooter}>
              <TouchableOpacity
                style={[styles.modalButton, savingCategory && styles.modalButtonDisabled]}
                onPress={saveCategory}
                disabled={savingCategory}
              >
                {savingCategory ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.modalButtonText}>{editingCategory ? 'Update Category' : 'Add Category'}</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}


const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F8F8' },
  
  // Header
  header: {
    paddingTop: Platform.OS === 'android' ? 44 : 12,
    paddingBottom: 24,
    paddingHorizontal: 20,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
  },
  headerContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: { fontSize: 28, fontWeight: '800', color: '#fff', letterSpacing: -0.5 },
  subtitle: { fontSize: 14, color: 'rgba(255,255,255,0.85)', marginTop: 4, fontWeight: '500' },
  headerButtons: { flexDirection: 'row', gap: 12 },
  headerButton: { 
    width: 46, height: 46, borderRadius: 23, backgroundColor: '#fff', 
    justifyContent: 'center', alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 6,
  },
  
  // Search
  searchContainer: { paddingHorizontal: 16, marginTop: -20 },
  searchInputWrapper: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff',
    borderRadius: 16, paddingHorizontal: 16, height: 52,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
    gap: 12,
  },
  searchInput: { flex: 1, fontSize: 15, color: '#1C1C1C', fontWeight: '500' },
  
  // Stats
  statsContainer: { flexDirection: 'row', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8, gap: 10 },
  statCard: { 
    flex: 1, backgroundColor: '#fff', borderRadius: 14, padding: 14, alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  statCardTotal: { borderLeftWidth: 3, borderLeftColor: ZOMATO_RED },
  statCardCategories: { borderLeftWidth: 3, borderLeftColor: '#8B5CF6' },
  statCardAvailable: { borderLeftWidth: 3, borderLeftColor: '#22C55E' },
  statCardUnavailable: { borderLeftWidth: 3, borderLeftColor: '#EF4444' },
  statValue: { fontSize: 22, fontWeight: '800', color: '#1C1C1C' },
  statLabel: { fontSize: 11, color: '#696969', marginTop: 2, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },

  // Filters
  filtersContainer: { paddingVertical: 8 },
  filterRow: { paddingHorizontal: 16, gap: 8 },
  filterChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 24,
    backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#E8E8E8',
  },
  filterChipActive: { backgroundColor: '#1C1C1C', borderColor: '#1C1C1C' },
  filterChipAvailable: { backgroundColor: '#22C55E', borderColor: '#22C55E' },
  filterChipUnavailable: { backgroundColor: '#EF4444', borderColor: '#EF4444' },
  filterChipText: { fontSize: 13, color: '#696969', fontWeight: '600' },
  filterChipTextActive: { color: '#fff' },
  filterDivider: { width: 1, height: 28, backgroundColor: '#E8E8E8', marginHorizontal: 4 },
  foodTypeIcon: { width: 16, height: 16, borderRadius: 4, borderWidth: 2, justifyContent: 'center', alignItems: 'center' },
  foodTypeIconDot: { width: 8, height: 8, borderRadius: 4 },
  
  // Category Filter
  categoryFilterContainer: { backgroundColor: '#fff', paddingVertical: 14, marginTop: 4, borderTopWidth: 1, borderBottomWidth: 1, borderColor: '#F0F0F0' },
  categoryFilterList: { paddingHorizontal: 16, gap: 10 },
  categoryChip: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 24,
    backgroundColor: '#F5F5F5',
  },
  categoryChipActive: { backgroundColor: ZOMATO_RED },
  categoryChipPaused: { backgroundColor: '#FEF3C7' },
  categoryChipIcon: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#fff', justifyContent: 'center', alignItems: 'center', overflow: 'hidden' },
  categoryChipIconActive: { backgroundColor: 'rgba(255,255,255,0.25)' },
  categoryChipIconPaused: { backgroundColor: '#FEF3C7' },
  categoryChipImage: { width: 28, height: 28, borderRadius: 14 },
  categoryChipText: { fontSize: 13, color: '#696969', fontWeight: '600' },
  categoryChipTextActive: { color: '#fff' },
  categoryChipTextPaused: { color: '#D97706' },
  addCategoryChip: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: '#F5F5F5',
    justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderStyle: 'dashed', borderColor: '#D1D5DB',
  },

  // Loading
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { marginTop: 12, fontSize: 14, color: '#696969', fontWeight: '500' },
  
  // List
  listContent: { padding: 16, paddingBottom: 100 },
  itemCard: { 
    flexDirection: 'row', backgroundColor: '#fff', borderRadius: 18, 
    padding: 14, marginBottom: 12, alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 3,
  },
  itemCardPaused: { backgroundColor: '#FEFCE8', borderWidth: 1, borderColor: '#FEF3C7' },
  itemImageContainer: { position: 'relative' },
  itemImage: { width: 76, height: 76, borderRadius: 14 },
  itemImagePaused: { opacity: 0.6 },
  placeholderImage: { backgroundColor: '#F5F5F5', justifyContent: 'center', alignItems: 'center' },
  placeholderImagePaused: { backgroundColor: '#FEF3C7' },
  pausedBadge: { 
    position: 'absolute', top: -6, right: -6, 
    backgroundColor: '#fff', borderRadius: 12, padding: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  foodTypeBadge: { 
    position: 'absolute', top: 4, left: 4,
    width: 18, height: 18, borderRadius: 5, borderWidth: 2, 
    backgroundColor: '#fff', justifyContent: 'center', alignItems: 'center' 
  },
  foodTypeDot: { width: 8, height: 8, borderRadius: 4 },
  itemInfo: { flex: 1, marginLeft: 14 },
  itemName: { fontSize: 16, fontWeight: '700', color: '#1C1C1C' },
  itemCategory: { fontSize: 12, color: '#696969', marginTop: 3, fontWeight: '500' },
  textPaused: { color: '#9CA3AF' },
  prepTimeRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  prepTimeText: { fontSize: 11, color: '#9CA3AF', fontWeight: '500' },
  itemFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 },
  itemPrice: { fontSize: 18, fontWeight: '800', color: ZOMATO_RED },
  pricePaused: { color: '#9CA3AF' },
  availabilityToggle: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 12, minWidth: 70, alignItems: 'center' },
  availabilityText: { fontSize: 11, fontWeight: '700' },
  pausedStatusBadge: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, backgroundColor: '#FEF3C7' },
  pausedStatusText: { fontSize: 10, fontWeight: '700', color: '#D97706' },
  deleteButton: { padding: 12 },

  // Empty
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 60, paddingHorizontal: 40 },
  emptyIconContainer: {
    width: 100, height: 100, borderRadius: 50, backgroundColor: '#FEF2F2',
    justifyContent: 'center', alignItems: 'center', marginBottom: 20,
  },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#1C1C1C', textAlign: 'center' },
  emptySubtitle: { fontSize: 14, color: '#696969', marginTop: 8, textAlign: 'center', lineHeight: 20 },
  emptyButton: { 
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginTop: 24, backgroundColor: ZOMATO_RED, paddingHorizontal: 24, paddingVertical: 14, borderRadius: 14,
    shadowColor: ZOMATO_RED,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  emptyButtonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  
  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#fff', borderTopLeftRadius: 28, borderTopRightRadius: 28 },
  modalHandle: { width: 40, height: 4, backgroundColor: '#E8E8E8', borderRadius: 2, alignSelf: 'center', marginTop: 12 },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 24, paddingTop: 20, paddingBottom: 16,
  },
  modalTitle: { fontSize: 20, fontWeight: '800', color: '#1C1C1C' },
  modalCloseButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#F5F5F5', justifyContent: 'center', alignItems: 'center' },
  modalBody: { paddingHorizontal: 24, paddingBottom: 16, gap: 20 },
  inputGroup: { gap: 10 },
  inputLabel: { fontSize: 14, fontWeight: '700', color: '#1C1C1C' },
  modalInput: {
    backgroundColor: '#F8F8F8', borderRadius: 14, paddingHorizontal: 18, height: 54,
    fontSize: 15, color: '#1C1C1C', borderWidth: 1.5, borderColor: '#E8E8E8', fontWeight: '500',
  },
  modalFooter: { padding: 24, paddingTop: 8 },
  modalButton: { 
    backgroundColor: ZOMATO_RED, height: 54, borderRadius: 16, justifyContent: 'center', alignItems: 'center',
    shadowColor: ZOMATO_RED,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  modalButtonDisabled: { opacity: 0.7 },
  modalButtonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  
  // Category Image
  categoryImageSection: { alignItems: 'center', gap: 14 },
  categoryImageContainer: { position: 'relative' },
  categoryImagePreview: { width: 110, height: 110, borderRadius: 55, borderWidth: 3, borderColor: '#F0F0F0' },
  removeCategoryImageButton: { position: 'absolute', top: -4, right: -4 },
  categoryImagePlaceholder: {
    width: 110, height: 110, borderRadius: 55, backgroundColor: '#F8F8F8',
    justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#E8E8E8', borderStyle: 'dashed',
  },
  categoryImagePlaceholderText: { color: '#9CA3AF', marginTop: 6, fontSize: 13, fontWeight: '600' },
  changeCategoryImageButton: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 18, paddingVertical: 10, backgroundColor: '#F5F5F5', borderRadius: 24,
  },
  changeCategoryImageText: { fontSize: 13, color: '#696969', fontWeight: '600' },
});
