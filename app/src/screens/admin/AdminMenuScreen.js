import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView, FlatList, ScrollView,
  RefreshControl, TouchableOpacity, Image, Alert, ActivityIndicator,
  TextInput, Modal
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import api from '../../config/api';

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
  
  // Category modal
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [categoryForm, setCategoryForm] = useState({ name: '' });
  const [editingCategory, setEditingCategory] = useState(null);
  const [savingCategory, setSavingCategory] = useState(false);
  const [categoryImage, setCategoryImage] = useState(null);
  const [categoryImagePreview, setCategoryImagePreview] = useState('');

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
    // Optimistic update
    setItems(prev => prev.map(i => i._id === item._id ? { ...i, available: !i.available } : i));
    try {
      const tags = Array.isArray(item.tags) ? item.tags.join(', ') : (item.tags || '');
      await api.put(`/menu/${item._id}`, { ...item, available: !item.available, tags });
    } catch (error) {
      // Revert on error
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
      
      // Handle image
      if (categoryImage) {
        const filename = categoryImage.uri.split('/').pop();
        const match = /\.(\w+)$/.exec(filename);
        const type = match ? `image/${match[1]}` : 'image/jpeg';
        formData.append('image', { uri: categoryImage.uri, name: filename, type });
      } else if (!categoryImagePreview && editingCategory?.image) {
        // Image was removed
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

  // Get paused category names
  const pausedCategoryNames = categories.filter(c => c.isPaused).map(c => c.name);

  // Filter items - hide items from paused categories
  const filteredItems = items.filter(item => {
    const itemCategories = Array.isArray(item.category) ? item.category : [item.category];
    
    // Check if ALL categories of this item are paused - if so, hide the item
    const allCategoriesPaused = itemCategories.every(cat => pausedCategoryNames.includes(cat));
    if (allCategoriesPaused) return false;
    
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

  const renderItem = ({ item }) => (
    <TouchableOpacity
      style={styles.itemCard}
      onPress={() => navigation.navigate('MenuItemForm', { item })}
    >
      <View style={styles.itemImageContainer}>
        {item.image ? (
          <Image source={{ uri: item.image }} style={styles.itemImage} />
        ) : (
          <View style={[styles.itemImage, styles.placeholderImage]}>
            <Ionicons name="restaurant-outline" size={28} color="#d1d5db" />
          </View>
        )}
        {item.foodType && item.foodType !== 'none' && (
          <View style={[styles.foodTypeBadge, { 
            borderColor: item.foodType === 'veg' ? '#22c55e' : item.foodType === 'egg' ? '#f59e0b' : '#ef4444' 
          }]}>
            <View style={[styles.foodTypeDot, { 
              backgroundColor: item.foodType === 'veg' ? '#22c55e' : item.foodType === 'egg' ? '#f59e0b' : '#ef4444' 
            }]} />
          </View>
        )}
      </View>
      
      <View style={styles.itemInfo}>
        <Text style={styles.itemName} numberOfLines={1}>{item.name}</Text>
        <Text style={styles.itemCategory} numberOfLines={1}>
          {Array.isArray(item.category) ? item.category.join(', ') : item.category}
        </Text>
        {item.preparationTime > 0 && (
          <View style={styles.prepTimeRow}>
            <Ionicons name="time-outline" size={12} color="#9ca3af" />
            <Text style={styles.prepTimeText}>{item.preparationTime} min</Text>
          </View>
        )}
        <View style={styles.itemFooter}>
          <Text style={styles.itemPrice}>₹{item.price}</Text>
          <TouchableOpacity 
            style={[styles.availabilityToggle, { backgroundColor: item.available ? '#dcfce7' : '#fee2e2' }]}
            onPress={() => toggleAvailability(item)}
            disabled={togglingId === item._id}
          >
            {togglingId === item._id ? (
              <ActivityIndicator size="small" color={item.available ? '#22c55e' : '#ef4444'} />
            ) : (
              <Text style={[styles.availabilityText, { color: item.available ? '#22c55e' : '#ef4444' }]}>
                {item.available ? 'Available' : 'Unavailable'}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </View>

      <TouchableOpacity style={styles.deleteButton} onPress={() => deleteItem(item)}>
        <Ionicons name="trash-outline" size={18} color="#ef4444" />
      </TouchableOpacity>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Menu</Text>
        <View style={styles.headerButtons}>
          <TouchableOpacity style={styles.categoryButton} onPress={() => openCategoryModal()}>
            <Ionicons name="folder-outline" size={22} color="#1c1d21" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.addButton} onPress={() => navigation.navigate('MenuItemForm', {})}>
            <Ionicons name="add" size={24} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Search */}
      <View style={styles.searchContainer}>
        <Ionicons name="search-outline" size={20} color="#9ca3af" style={styles.searchIcon} />
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

      {/* Stats */}
      <View style={styles.statsContainer}>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{totalItems}</Text>
          <Text style={styles.statLabel}>Total</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{uniqueCategories.length}</Text>
          <Text style={styles.statLabel}>Categories</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={[styles.statValue, { color: '#22c55e' }]}>{availableCount}</Text>
          <Text style={styles.statLabel}>Available</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={[styles.statValue, { color: '#ef4444' }]}>{unavailableCount}</Text>
          <Text style={styles.statLabel}>Unavailable</Text>
        </View>
      </View>

      {/* Filters */}
      <View style={styles.filtersContainer}>
        {/* Status Filter */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRow}>
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
            <Text style={[styles.filterChipText, statusFilter === 'available' && styles.filterChipTextActive]}>Available</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.filterChip, statusFilter === 'unavailable' && styles.filterChipUnavailable]}
            onPress={() => setStatusFilter('unavailable')}
          >
            <Text style={[styles.filterChipText, statusFilter === 'unavailable' && styles.filterChipTextActive]}>Unavailable</Text>
          </TouchableOpacity>
          <View style={styles.filterDivider} />
          <TouchableOpacity
            style={[styles.filterChip, foodTypeFilter === 'all' && styles.filterChipActive]}
            onPress={() => setFoodTypeFilter('all')}
          >
            <Text style={[styles.filterChipText, foodTypeFilter === 'all' && styles.filterChipTextActive]}>All Types</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.filterChip, foodTypeFilter === 'veg' && { backgroundColor: '#22c55e' }]}
            onPress={() => setFoodTypeFilter('veg')}
          >
            <View style={[styles.foodTypeIcon, { borderColor: foodTypeFilter === 'veg' ? '#fff' : '#22c55e' }]}>
              <View style={[styles.foodTypeIconDot, { backgroundColor: foodTypeFilter === 'veg' ? '#fff' : '#22c55e' }]} />
            </View>
            <Text style={[styles.filterChipText, foodTypeFilter === 'veg' && styles.filterChipTextActive]}>Veg</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.filterChip, foodTypeFilter === 'nonveg' && { backgroundColor: '#ef4444' }]}
            onPress={() => setFoodTypeFilter('nonveg')}
          >
            <View style={[styles.foodTypeIcon, { borderColor: foodTypeFilter === 'nonveg' ? '#fff' : '#ef4444' }]}>
              <View style={[styles.foodTypeIconDot, { backgroundColor: foodTypeFilter === 'nonveg' ? '#fff' : '#ef4444' }]} />
            </View>
            <Text style={[styles.filterChipText, foodTypeFilter === 'nonveg' && styles.filterChipTextActive]}>Non-Veg</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.filterChip, foodTypeFilter === 'egg' && { backgroundColor: '#f59e0b' }]}
            onPress={() => setFoodTypeFilter('egg')}
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
              <View style={styles.categoryChipIcon}>
                <Text style={styles.categoryChipIconText}>All</Text>
              </View>
              <Text style={[styles.categoryChipText, selectedCategory === 'all' && styles.categoryChipTextActive]}>All</Text>
            </TouchableOpacity>
            {categories.map(cat => (
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
                      { text: 'Edit', onPress: () => openCategoryModal(cat) },
                      { text: 'Delete', style: 'destructive', onPress: () => deleteCategory(cat) },
                    ]
                  );
                }}
              >
                <View style={[styles.categoryChipIcon, cat.isPaused && styles.categoryChipIconPaused]}>
                  {cat.image ? (
                    <Image source={{ uri: cat.image }} style={styles.categoryChipImage} />
                  ) : (
                    <Ionicons name="folder-outline" size={16} color={cat.isPaused ? '#f59e0b' : '#61636b'} />
                  )}
                </View>
                <Text style={[
                  styles.categoryChipText, 
                  selectedCategory === cat.name && styles.categoryChipTextActive,
                  cat.isPaused && styles.categoryChipTextPaused
                ]}>{cat.name}</Text>
                {cat.isPaused && <Ionicons name="pause-circle" size={14} color="#f59e0b" />}
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.addCategoryChip} onPress={() => openCategoryModal()}>
              <Ionicons name="add" size={20} color="#61636b" />
            </TouchableOpacity>
          </ScrollView>
        </View>
      )}

      {loading ? (
        <ActivityIndicator size="large" color="#e63946" style={{ flex: 1 }} />
      ) : (
        <FlatList
          data={filteredItems}
          renderItem={renderItem}
          keyExtractor={(item) => item._id}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#e63946']} />}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="restaurant-outline" size={64} color="#d1d5db" />
              <Text style={styles.emptyText}>
                {searchTerm || selectedCategory !== 'all' || statusFilter !== 'all' || foodTypeFilter !== 'all'
                  ? 'No items match your filters'
                  : 'No menu items'}
              </Text>
              {!searchTerm && selectedCategory === 'all' && statusFilter === 'all' && foodTypeFilter === 'all' && (
                <TouchableOpacity
                  style={styles.emptyButton}
                  onPress={() => navigation.navigate('MenuItemForm', {})}
                >
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
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{editingCategory ? 'Edit Category' : 'Add Category'}</Text>
              <TouchableOpacity onPress={() => setShowCategoryModal(false)}>
                <Ionicons name="close" size={24} color="#61636b" />
              </TouchableOpacity>
            </View>
            
            <View style={styles.modalBody}>
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Category Name *</Text>
                <TextInput
                  style={styles.modalInput}
                  value={categoryForm.name}
                  onChangeText={(text) => setCategoryForm({ ...categoryForm, name: text })}
                  placeholder="e.g., Main Course"
                  placeholderTextColor="#9ca3af"
                />
              </View>
              
              {/* Category Image */}
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Category Image</Text>
                <View style={styles.categoryImageSection}>
                  {categoryImagePreview ? (
                    <View style={styles.categoryImageContainer}>
                      <Image source={{ uri: categoryImagePreview }} style={styles.categoryImagePreview} />
                      <TouchableOpacity style={styles.removeCategoryImageButton} onPress={removeCategoryImage}>
                        <Ionicons name="close-circle" size={24} color="#ef4444" />
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <TouchableOpacity style={styles.categoryImagePlaceholder} onPress={pickCategoryImage}>
                      <Ionicons name="camera-outline" size={28} color="#9ca3af" />
                      <Text style={styles.categoryImagePlaceholderText}>Add Image</Text>
                    </TouchableOpacity>
                  )}
                  {categoryImagePreview && (
                    <TouchableOpacity style={styles.changeCategoryImageButton} onPress={pickCategoryImage}>
                      <Ionicons name="image-outline" size={18} color="#61636b" />
                      <Text style={styles.changeCategoryImageText}>Change Image</Text>
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
                  <Text style={styles.modalButtonText}>{editingCategory ? 'Update' : 'Add Category'}</Text>
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
  container: { flex: 1, backgroundColor: '#f8f9fb' },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 16, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#e5e7eb',
  },
  title: { fontSize: 24, fontWeight: 'bold', color: '#1c1d21' },
  headerButtons: { flexDirection: 'row', gap: 10 },
  categoryButton: { 
    width: 44, height: 44, borderRadius: 22, backgroundColor: '#f3f4f6', 
    justifyContent: 'center', alignItems: 'center' 
  },
  addButton: { 
    width: 44, height: 44, borderRadius: 22, backgroundColor: '#e63946', 
    justifyContent: 'center', alignItems: 'center' 
  },
  
  // Search
  searchContainer: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff',
    marginHorizontal: 16, marginTop: 12, borderRadius: 12, paddingHorizontal: 12,
    borderWidth: 1, borderColor: '#e5e7eb',
  },
  searchIcon: { marginRight: 8 },
  searchInput: { flex: 1, height: 44, fontSize: 15, color: '#1c1d21' },
  
  // Stats
  statsContainer: { flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
  statCard: { flex: 1, backgroundColor: '#fff', borderRadius: 10, padding: 12, alignItems: 'center' },
  statValue: { fontSize: 20, fontWeight: 'bold', color: '#1c1d21' },
  statLabel: { fontSize: 11, color: '#61636b', marginTop: 2 },
  
  // Filters
  filtersContainer: { paddingVertical: 8 },
  filterRow: { paddingHorizontal: 16 },
  filterChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20,
    backgroundColor: '#fff', marginRight: 8, borderWidth: 1, borderColor: '#e5e7eb',
  },
  filterChipActive: { backgroundColor: '#1c1d21', borderColor: '#1c1d21' },
  filterChipAvailable: { backgroundColor: '#22c55e', borderColor: '#22c55e' },
  filterChipUnavailable: { backgroundColor: '#ef4444', borderColor: '#ef4444' },
  filterChipText: { fontSize: 13, color: '#61636b', fontWeight: '500' },
  filterChipTextActive: { color: '#fff' },
  filterDivider: { width: 1, height: 24, backgroundColor: '#e5e7eb', marginHorizontal: 4 },
  foodTypeIcon: { width: 14, height: 14, borderRadius: 3, borderWidth: 2, justifyContent: 'center', alignItems: 'center' },
  foodTypeIconDot: { width: 6, height: 6, borderRadius: 3 },
  
  // Category Filter
  categoryFilterContainer: { backgroundColor: '#fff', paddingVertical: 12, marginTop: 4 },
  categoryFilterList: { paddingHorizontal: 16 },
  categoryChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20,
    backgroundColor: '#f3f4f6', marginRight: 8,
  },
  categoryChipActive: { backgroundColor: '#e63946' },
  categoryChipPaused: { backgroundColor: '#fef3c7' },
  categoryChipIcon: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#fff', justifyContent: 'center', alignItems: 'center', overflow: 'hidden' },
  categoryChipIconPaused: { backgroundColor: '#fef3c7' },
  categoryChipImage: { width: 28, height: 28, borderRadius: 14 },
  categoryChipIconText: { fontSize: 10, fontWeight: 'bold', color: '#e63946' },
  categoryChipText: { fontSize: 13, color: '#61636b', fontWeight: '500' },
  categoryChipTextActive: { color: '#fff' },
  categoryChipTextPaused: { color: '#f59e0b' },
  addCategoryChip: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: '#f3f4f6',
    justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderStyle: 'dashed', borderColor: '#d1d5db',
  },
  
  // List
  listContent: { padding: 16 },
  itemCard: { 
    flexDirection: 'row', backgroundColor: '#fff', borderRadius: 12, 
    padding: 10, marginBottom: 10, alignItems: 'center' 
  },
  itemImageContainer: { position: 'relative' },
  itemImage: { width: 70, height: 70, borderRadius: 10 },
  placeholderImage: { backgroundColor: '#f3f4f6', justifyContent: 'center', alignItems: 'center' },
  foodTypeBadge: { 
    position: 'absolute', top: 4, left: 4,
    width: 16, height: 16, borderRadius: 4, borderWidth: 2, 
    backgroundColor: '#fff', justifyContent: 'center', alignItems: 'center' 
  },
  foodTypeDot: { width: 8, height: 8, borderRadius: 4 },
  itemInfo: { flex: 1, marginLeft: 12 },
  itemName: { fontSize: 15, fontWeight: '600', color: '#1c1d21' },
  itemCategory: { fontSize: 12, color: '#61636b', marginTop: 2 },
  prepTimeRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  prepTimeText: { fontSize: 11, color: '#9ca3af' },
  itemFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 },
  itemPrice: { fontSize: 16, fontWeight: 'bold', color: '#e63946' },
  availabilityToggle: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, minWidth: 80, alignItems: 'center' },
  availabilityText: { fontSize: 11, fontWeight: '600' },
  deleteButton: { padding: 10 },
  
  // Empty
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 60 },
  emptyText: { fontSize: 15, color: '#9ca3af', marginTop: 12, textAlign: 'center' },
  emptyButton: { marginTop: 16, backgroundColor: '#e63946', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 10 },
  emptyButtonText: { color: '#fff', fontWeight: '600' },
  
  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 20, borderBottomWidth: 1, borderBottomColor: '#e5e7eb',
  },
  modalTitle: { fontSize: 18, fontWeight: 'bold', color: '#1c1d21' },
  modalBody: { padding: 20, gap: 16 },
  inputGroup: { gap: 8 },
  inputLabel: { fontSize: 14, fontWeight: '500', color: '#1c1d21' },
  modalInput: {
    backgroundColor: '#f3f4f6', borderRadius: 12, paddingHorizontal: 16, height: 50,
    fontSize: 15, color: '#1c1d21',
  },
  modalTextArea: { height: 80, textAlignVertical: 'top', paddingTop: 12 },
  modalFooter: { padding: 20, borderTopWidth: 1, borderTopColor: '#e5e7eb' },
  modalButton: { backgroundColor: '#e63946', height: 50, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  modalButtonDisabled: { opacity: 0.7 },
  modalButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  
  // Category Image
  categoryImageSection: { alignItems: 'center', gap: 12 },
  categoryImageContainer: { position: 'relative' },
  categoryImagePreview: { width: 100, height: 100, borderRadius: 50 },
  removeCategoryImageButton: { position: 'absolute', top: -4, right: -4 },
  categoryImagePlaceholder: {
    width: 100, height: 100, borderRadius: 50, backgroundColor: '#f3f4f6',
    justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#e5e7eb', borderStyle: 'dashed',
  },
  categoryImagePlaceholderText: { color: '#9ca3af', marginTop: 4, fontSize: 12 },
  changeCategoryImageButton: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 16, paddingVertical: 8, backgroundColor: '#f3f4f6', borderRadius: 20,
  },
  changeCategoryImageText: { fontSize: 13, color: '#61636b', fontWeight: '500' },
});
