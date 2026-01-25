import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View, Text, StyleSheet, FlatList, ScrollView,
  RefreshControl, TouchableOpacity, Image, Alert, ActivityIndicator,
  TextInput, Modal, Animated, Platform, StatusBar, ImageBackground, KeyboardAvoidingView
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import api from '../../config/api';
import CategoryScheduleModal from '../../components/CategoryScheduleModal';

// Zomato Theme Colors
const ZOMATO_RED = '#E23744';
const ZOMATO_DARK_RED = '#CB1A27';

export default function AdminMenuScreen({ navigation, route }) {
  const [items, setItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [foodTypeFilter, setFoodTypeFilter] = useState(route?.params?.foodTypeFilter || 'all');
  const [togglingId, setTogglingId] = useState(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.95)).current;
  const shineAnim = useRef(new Animated.Value(-1)).current;

  // Category modal
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [categoryForm, setCategoryForm] = useState({ name: '' });
  const [editingCategory, setEditingCategory] = useState(null);
  const [savingCategory, setSavingCategory] = useState(false);
  const [categoryImage, setCategoryImage] = useState(null);
  const [categoryImagePreview, setCategoryImagePreview] = useState('');
  const [deletingCategoryId, setDeletingCategoryId] = useState(null);

  // Schedule modal
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [scheduleCategory, setScheduleCategory] = useState(null);
  const [scheduleForm, setScheduleForm] = useState({
    enabled: false,
    type: 'daily',
    startTime: '09:00',
    endTime: '22:00',
    days: []
  });

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
    
    // Glass shine effect
    setTimeout(() => {
      Animated.timing(shineAnim, {
        toValue: 1,
        duration: 800,
        useNativeDriver: true,
      }).start();
    }, 300);
  }, []);

  const fetchMenu = useCallback(async () => {
    try {
      const response = await api.get('/menu');
      const menuData = response.data || [];
      setItems(menuData);
      
      // Prefetch images for faster loading
      menuData.forEach(item => {
        if (item.image) {
          Image.prefetch(item.image).catch(() => {});
        }
      });
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
      const categoryData = response.data || [];
      setCategories(categoryData);
      
      // Prefetch category images for faster loading
      categoryData.forEach(cat => {
        if (cat.image) {
          Image.prefetch(cat.image).catch(() => {});
        }
      });
    } catch (error) {
      console.error('Error fetching categories:', error);
    }
  }, []);

  useEffect(() => {
    fetchMenu();
    fetchCategories();
  }, []);

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      fetchMenu();
      fetchCategories();
    });
    return unsubscribe;
  }, [navigation]);

  // Update food type filter when route params change
  useEffect(() => {
    if (route?.params?.resetFilters) {
      // Reset all filters when coming from tab bar
      setFoodTypeFilter('all');
      setStatusFilter('all');
      setSelectedCategory('all');
      setSearchTerm('');
    } else if (route?.params?.foodTypeFilter !== undefined) {
      setFoodTypeFilter(route.params.foodTypeFilter);
    }
  }, [route?.params?.foodTypeFilter, route?.params?.resetFilters]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    Promise.all([fetchMenu(), fetchCategories()]);
  }, []);

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
              setTogglingId(item._id);
              await api.delete(`/menu/${item._id}`);
              setItems(items.filter(i => i._id !== item._id));
            } catch (error) {
              Alert.alert('Error', 'Failed to delete item');
            } finally {
              setTogglingId(null);
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
              setDeletingCategoryId(category._id);
              await api.delete(`/categories/${category._id}`);
              fetchCategories();
              if (selectedCategory === category.name) {
                setSelectedCategory('all');
              }
            } catch (error) {
              Alert.alert('Error', 'Failed to delete category');
            } finally {
              setDeletingCategoryId(null);
            }
          },
        },
      ]
    );
  };

  // Schedule functions
  const openScheduleModal = (category) => {
    setScheduleCategory(category);
    setScheduleForm({
      enabled: category.schedule?.enabled || false,
      type: category.schedule?.type || 'daily',
      startTime: category.schedule?.startTime || '09:00',
      endTime: category.schedule?.endTime || '22:00',
      days: category.schedule?.days || []
    });
    setShowScheduleModal(true);
  };

  const saveSchedule = async () => {
    try {
      setSavingCategory(true);
      await api.patch(`/categories/${scheduleCategory._id}/schedule`, scheduleForm);
      
      // Wait a moment for the scheduler to update the category status
      await new Promise(resolve => setTimeout(resolve, 500));
      
      await fetchCategories();
      setShowScheduleModal(false);
      Alert.alert('Success', 'Schedule saved successfully');
    } catch (error) {
      console.error('Schedule save error:', error);
      Alert.alert('Error', 'Failed to save schedule');
    } finally {
      setSavingCategory(false);
    }
  };

  const toggleDay = (day) => {
    setScheduleForm(prev => ({
      ...prev,
      days: prev.days.includes(day)
        ? prev.days.filter(d => d !== day)
        : [...prev.days, day].sort()
    }));
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

  // Get paused category names - memoized
  const pausedCategoryNames = useMemo(() => 
    categories.filter(c => c.isPaused).map(c => c.name),
    [categories]
  );

  const isItemPaused = useCallback((item) => {
    if (item.isPaused) return true;
    const itemCategories = Array.isArray(item.category) ? item.category : [item.category];
    return itemCategories.every(cat => pausedCategoryNames.includes(cat));
  }, [pausedCategoryNames]);

  // Filter items - memoized
  const filteredItems = useMemo(() => {
    return items.filter(item => {
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
  }, [items, searchTerm, selectedCategory, statusFilter, foodTypeFilter]);

  // Stats - memoized
  const stats = useMemo(() => {
    const totalItems = items.length;
    const availableCount = items.filter(i => i.available).length;
    const unavailableCount = items.filter(i => !i.available).length;
    const uniqueCategories = [...new Set(items.flatMap(i => Array.isArray(i.category) ? i.category : [i.category]))];
    return { totalItems, availableCount, unavailableCount, uniqueCategories };
  }, [items]);

  const renderItem = useCallback(({ item, index }) => {
    const isPaused = isItemPaused(item);

    return (
      <Animated.View style={{
        opacity: fadeAnim,
        transform: [{ scale: scaleAnim }],
      }}>
        <TouchableOpacity
          style={[
            styles.itemCard, 
            isPaused && styles.itemCardPaused,
            !item.available && styles.itemCardOutOfStock
          ]}
          onPress={() => navigation.navigate('MenuItemForm', { item })}
          activeOpacity={0.7}
        >
          <View style={styles.itemImageContainer}>
            {item.image ? (
              <Image
                source={{ uri: item.image, cache: 'force-cache' }}
                style={[styles.itemImage, isPaused && styles.itemImagePaused]}
                defaultSource={require('../../../assets/icon.png')}
                resizeMode="cover"
              />
            ) : (
              <View style={[styles.itemImage, styles.placeholderImage, isPaused && styles.placeholderImagePaused]}>
                <Ionicons name="restaurant-outline" size={32} color={isPaused ? '#9ca3af' : '#d1d5db'} />
              </View>
            )}
            {/* Discount Badge */}
            {item.offerPrice && item.offerPrice < item.price && (
              <View style={styles.discountBadge}>
                <Text style={styles.discountText}>
                  {Math.round(((item.price - item.offerPrice) / item.price) * 100)}% OFF
                </Text>
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
              <View style={styles.priceContainer}>
                {item.offerPrice && item.offerPrice < item.price ? (
                  <View style={styles.priceRow}>
                    <Text style={[styles.originalPrice, isPaused && styles.pricePaused]}>₹{item.price}</Text>
                    <Text style={[styles.offerPrice, isPaused && styles.pricePaused]}>₹{item.offerPrice}</Text>
                  </View>
                ) : (
                  <Text style={[styles.itemPrice, isPaused && styles.pricePaused]}>₹{item.price}</Text>
                )}
              </View>
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

          <TouchableOpacity 
            style={styles.deleteButton} 
            onPress={() => deleteItem(item)}
            disabled={togglingId === item._id}
          >
            {togglingId === item._id ? (
              <ActivityIndicator size="small" color={ZOMATO_RED} />
            ) : (
              <Ionicons name="trash-outline" size={20} color={ZOMATO_RED} />
            )}
          </TouchableOpacity>
        </TouchableOpacity>
      </Animated.View>
    );
  }, [fadeAnim, scaleAnim, isItemPaused, navigation, togglingId]);

  const keyExtractor = useCallback((item) => item._id, []);

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />
      {/* Premium Zomato Header */}
      <Animated.View style={{ opacity: fadeAnim }}>
        <ImageBackground
          source={require('../../../assets/backgrounds/menu.jpg')}
          style={styles.header}
          imageStyle={styles.headerBackgroundImage}
        >
          <View style={styles.headerOverlay}>
            <View style={styles.headerContent}>
              <View style={styles.headerLeft}>
                <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
                  <Ionicons name="arrow-back" size={24} color="#fff" />
                </TouchableOpacity>
                <View>
                  <Text style={styles.title}>Menu</Text>
                  <Text style={styles.subtitle}>{stats.totalItems} items • {stats.uniqueCategories.length} categories</Text>
                </View>
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
            {/* Glass Shine Effect */}
            <Animated.View
              style={[
                styles.glassShine,
                {
                  transform: [
                    {
                      translateX: shineAnim.interpolate({
                        inputRange: [-1, 1],
                        outputRange: [-200, 400],
                      }),
                    },
                  ],
                  opacity: shineAnim.interpolate({
                    inputRange: [-1, 0, 0.5, 1],
                    outputRange: [0, 0.6, 0.6, 0],
                  }),
                },
              ]}
            />
          </View>
        </ImageBackground>
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
        <LinearGradient
          colors={['#3B82F6', '#2563EB']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.statCardGradient}
        >
          <View style={styles.statCardDecor}>
            <Ionicons name="restaurant" size={40} color="rgba(255,255,255,0.15)" />
          </View>
          <Text style={styles.statValueWhite}>{stats.totalItems}</Text>
          <Text style={styles.statLabelWhite}>TOTAL</Text>
        </LinearGradient>

        <LinearGradient
          colors={['#8B5CF6', '#7C3AED']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.statCardGradient}
        >
          <View style={styles.statCardDecor}>
            <Ionicons name="folder" size={40} color="rgba(255,255,255,0.15)" />
          </View>
          <Text style={styles.statValueWhite}>{stats.uniqueCategories.length}</Text>
          <Text style={styles.statLabelWhite}>CATEGORIES</Text>
        </LinearGradient>

        <LinearGradient
          colors={['#22C55E', '#16A34A']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.statCardGradient}
        >
          <View style={styles.statCardDecor}>
            <Ionicons name="checkmark-circle" size={40} color="rgba(255,255,255,0.15)" />
          </View>
          <Text style={styles.statValueWhite}>{stats.availableCount}</Text>
          <Text style={styles.statLabelWhite}>IN STOCK</Text>
        </LinearGradient>

        <LinearGradient
          colors={['#EF4444', '#DC2626']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.statCardGradient}
        >
          <View style={styles.statCardDecor}>
            <Ionicons name="close-circle" size={40} color="rgba(255,255,255,0.15)" />
          </View>
          <Text style={styles.statValueWhite}>{stats.unavailableCount}</Text>
          <Text style={styles.statLabelWhite}>OUT</Text>
        </LinearGradient>
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
              style={styles.categoryItem}
              onPress={() => setSelectedCategory('all')}
            >
              <View style={[styles.categoryImageWrapper, selectedCategory === 'all' && styles.categoryImageWrapperActive]}>
                <View style={styles.categoryAllIcon}>
                  <Text style={styles.categoryAllText}>All</Text>
                </View>
              </View>
              <Text style={[styles.categoryName, selectedCategory === 'all' && styles.categoryNameActive]}>All</Text>
              {selectedCategory === 'all' && <View style={styles.categoryUnderline} />}
            </TouchableOpacity>
            {categories.map(cat => {
              const itemsInCat = items.filter(item => {
                const itemCategories = Array.isArray(item.category) ? item.category : [item.category];
                return itemCategories.includes(cat.name);
              });
              const allItemsPaused = itemsInCat.length > 0 && itemsInCat.every(item => item.isPaused);
              const isDeleting = deletingCategoryId === cat._id;

              return (
                <TouchableOpacity
                  key={cat._id}
                  style={styles.categoryItem}
                  onPress={() => setSelectedCategory(cat.name)}
                  onLongPress={() => {
                    Alert.alert(
                      cat.name,
                      'What would you like to do?',
                      [
                        { text: 'Cancel', style: 'cancel' },
                        { text: cat.isPaused ? 'Resume' : 'Pause', onPress: () => toggleCategoryPause(cat) },
                        { text: allItemsPaused ? 'Resume All' : 'Complete Pause', onPress: () => completePauseCategory(cat) },
                        { text: 'Schedule', onPress: () => openScheduleModal(cat) },
                        { text: 'Edit', onPress: () => openCategoryModal(cat) },
                        { text: 'Delete', style: 'destructive', onPress: () => deleteCategory(cat) },
                      ]
                    );
                  }}
                  disabled={isDeleting}
                >
                  <View style={[styles.categoryImageWrapper, selectedCategory === cat.name && styles.categoryImageWrapperActive, cat.isPaused && styles.categoryImageWrapperPaused]}>
                    {cat.image ? (
                      <Image 
                        source={{ uri: cat.image, cache: 'force-cache' }} 
                        style={[styles.categoryImage, isDeleting && styles.categoryImageDeleting]}
                        defaultSource={require('../../../assets/icon.png')}
                        resizeMode="cover"
                      />
                    ) : (
                      <View style={[styles.categoryPlaceholder, isDeleting && styles.categoryImageDeleting]}>
                        <Ionicons name="restaurant-outline" size={24} color={cat.isPaused ? '#f59e0b' : '#9ca3af'} />
                      </View>
                    )}
                    {cat.isPaused && !isDeleting && (
                      <View style={styles.categoryPausedOverlay}>
                        <Ionicons name="pause-circle" size={16} color="#f59e0b" />
                      </View>
                    )}
                    {isDeleting && (
                      <View style={styles.categoryDeletingOverlay}>
                        <ActivityIndicator size="small" color="#fff" />
                      </View>
                    )}
                  </View>
                  <Text style={[
                    styles.categoryName,
                    selectedCategory === cat.name && styles.categoryNameActive,
                    cat.isPaused && styles.categoryNamePaused,
                    isDeleting && styles.categoryNameDeleting
                  ]} numberOfLines={1}>{cat.name}</Text>
                  {selectedCategory === cat.name && <View style={styles.categoryUnderline} />}
                </TouchableOpacity>
              );
            })}
            <TouchableOpacity style={styles.categoryAddItem} onPress={() => openCategoryModal()}>
              <View style={styles.categoryAddIcon}>
                <Ionicons name="add" size={24} color="#9ca3af" />
              </View>
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
          keyExtractor={keyExtractor}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[ZOMATO_RED]} tintColor={ZOMATO_RED} />}
          showsVerticalScrollIndicator={false}
          removeClippedSubviews={true}
          maxToRenderPerBatch={10}
          updateCellsBatchingPeriod={50}
          initialNumToRender={10}
          windowSize={10}
          getItemLayout={(data, index) => ({
            length: 140,
            offset: 140 * index,
            index,
          })}
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
        <KeyboardAvoidingView 
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalOverlay}
        >
          <TouchableOpacity 
            style={styles.modalOverlay} 
            activeOpacity={1} 
            onPress={() => setShowCategoryModal(false)}
          >
            <TouchableOpacity activeOpacity={1} onPress={(e) => e.stopPropagation()}>
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
            </TouchableOpacity>
          </TouchableOpacity>
        </KeyboardAvoidingView>
      </Modal>

      {/* Schedule Modal */}
      <CategoryScheduleModal
        visible={showScheduleModal}
        category={scheduleCategory}
        scheduleForm={scheduleForm}
        setScheduleForm={setScheduleForm}
        onSave={saveSchedule}
        onClose={() => setShowScheduleModal(false)}
        saving={savingCategory}
      />
    </View>
  );
}


const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F8F8' },

  // Header
  header: {
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight + 35 : 75,
    paddingBottom: 55,
    paddingHorizontal: 20,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
    overflow: 'hidden',
  },
  headerBackgroundImage: {
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
  },
  headerOverlay: {
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    marginTop: -(Platform.OS === 'android' ? StatusBar.currentHeight + 35 : 75),
    marginBottom: -55,
    marginHorizontal: -20,
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight + 35 : 75,
    paddingBottom: 55,
    paddingHorizontal: 20,
    overflow: 'hidden',
  },
  glassShine: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: 100,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    transform: [{ skewX: '-20deg' }],
  },
  headerContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
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
  statCardGradient: {
    flex: 1, 
    borderRadius: 16, 
    paddingVertical: 16,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
    height: 90,
    overflow: 'hidden',
  },
  statCardDecor: {
    position: 'absolute',
    right: -5,
    bottom: -5,
  },
  statValueWhite: { fontSize: 24, fontWeight: '800', color: '#fff' },
  statLabelWhite: { fontSize: 9, color: 'rgba(255,255,255,0.9)', marginTop: 4, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, textAlign: 'center' },

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
  categoryFilterContainer: { paddingVertical: 16, backgroundColor: '#fff' },
  categoryFilterList: { paddingHorizontal: 16, gap: 20 },
  categoryItem: {
    alignItems: 'center',
    width: 70,
  },
  categoryImageWrapper: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#F5F5F5',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  categoryImageWrapperActive: {
    borderColor: ZOMATO_RED,
  },
  categoryImageWrapperPaused: {
    borderColor: '#f59e0b',
    opacity: 0.7,
  },
  categoryImage: {
    width: '100%',
    height: '100%',
    borderRadius: 30,
  },
  categoryPlaceholder: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F5F5F5',
  },
  categoryAllIcon: {
    width: '100%',
    height: '100%',
    borderRadius: 30,
    backgroundColor: ZOMATO_RED,
    justifyContent: 'center',
    alignItems: 'center',
  },
  categoryAllText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
  },
  categoryPausedOverlay: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    backgroundColor: '#fff',
    borderRadius: 10,
  },
  categoryDeletingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  categoryImageDeleting: {
    opacity: 0.5,
  },
  categoryName: {
    fontSize: 12,
    color: '#696969',
    fontWeight: '500',
    marginTop: 6,
    textAlign: 'center',
  },
  categoryNameActive: {
    color: ZOMATO_RED,
    fontWeight: '600',
  },
  categoryNamePaused: {
    color: '#D97706',
  },
  categoryNameDeleting: {
    opacity: 0.5,
  },
  categoryUnderline: {
    width: 20,
    height: 2,
    backgroundColor: ZOMATO_RED,
    borderRadius: 1,
    marginTop: 4,
  },
  categoryAddItem: {
    alignItems: 'center',
    width: 70,
  },
  categoryAddIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#F5F5F5',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: '#D1D5DB',
  },

  // Loading
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { marginTop: 12, fontSize: 14, color: '#696969', fontWeight: '500' },

  // List
  listContent: { padding: 16, paddingBottom: 100 },
  itemCard: {
    flexDirection: 'row', 
    backgroundColor: '#fff', 
    borderRadius: 20,
    padding: 16, 
    marginBottom: 14, 
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
  },
  itemCardPaused: { backgroundColor: '#FEFCE8', borderWidth: 1, borderColor: '#FEF3C7' },
  itemCardOutOfStock: { backgroundColor: '#FEE2E2', borderWidth: 2, borderColor: '#FCA5A5' },
  itemImageContainer: { position: 'relative' },
  itemImage: { width: 90, height: 90, borderRadius: 16 },
  itemImagePaused: { opacity: 0.6 },
  placeholderImage: { backgroundColor: '#F5F5F5', justifyContent: 'center', alignItems: 'center' },
  placeholderImagePaused: { backgroundColor: '#FEF3C7' },
  foodTypeBadge: {
    position: 'absolute', bottom: 6, left: 6,
    width: 20, height: 20, borderRadius: 5, borderWidth: 2,
    backgroundColor: '#fff', justifyContent: 'center', alignItems: 'center'
  },
  foodTypeDot: { width: 10, height: 10, borderRadius: 5 },
  discountBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    backgroundColor: '#22C55E',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  discountText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  itemInfo: { flex: 1, marginLeft: 16 },
  itemName: { fontSize: 17, fontWeight: '700', color: '#1C1C1C' },
  itemCategory: { fontSize: 13, color: '#696969', marginTop: 4, fontWeight: '500' },
  textPaused: { color: '#9CA3AF' },
  prepTimeRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 },
  prepTimeText: { fontSize: 12, color: '#9CA3AF', fontWeight: '500' },
  itemFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 },
  priceContainer: { flexDirection: 'row', alignItems: 'center' },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  itemPrice: { fontSize: 20, fontWeight: '800', color: ZOMATO_RED },
  originalPrice: { fontSize: 16, fontWeight: '500', color: '#9CA3AF', textDecorationLine: 'line-through' },
  offerPrice: { fontSize: 20, fontWeight: '800', color: '#22C55E' },
  pricePaused: { color: '#9CA3AF' },
  availabilityToggle: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, minWidth: 80, alignItems: 'center' },
  availabilityText: { fontSize: 12, fontWeight: '700' },
  pausedStatusBadge: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12, backgroundColor: '#FEF3C7' },
  pausedStatusText: { fontSize: 11, fontWeight: '700', color: '#D97706' },
  deleteButton: { padding: 12, marginLeft: 4 },

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
  modalContent: { 
    backgroundColor: '#fff', 
    borderTopLeftRadius: 28, 
    borderTopRightRadius: 28,
  },
  modalHandle: { width: 40, height: 4, backgroundColor: '#E8E8E8', borderRadius: 2, alignSelf: 'center', marginTop: 12 },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 24, paddingTop: 20, paddingBottom: 16,
  },
  modalTitle: { fontSize: 20, fontWeight: '800', color: '#1C1C1C' },
  modalCloseButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#F5F5F5', justifyContent: 'center', alignItems: 'center' },
  modalBody: { 
    paddingHorizontal: 24, 
    paddingTop: 8,
    paddingBottom: 24, 
    gap: 20,
  },
  inputGroup: { gap: 10 },
  inputLabel: { fontSize: 14, fontWeight: '700', color: '#1C1C1C' },
  modalInput: {
    backgroundColor: '#F8F8F8', borderRadius: 14, paddingHorizontal: 18, height: 54,
    fontSize: 15, color: '#1C1C1C', borderWidth: 1.5, borderColor: '#E8E8E8', fontWeight: '500',
  },
  modalFooter: { 
    padding: 24, 
    paddingTop: 16,
    paddingBottom: Platform.OS === 'ios' ? 34 : 24,
  },
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
