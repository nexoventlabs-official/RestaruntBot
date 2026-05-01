import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View, Text, StyleSheet, FlatList, SectionList, ScrollView,
  RefreshControl, TouchableOpacity, Image, Alert, ActivityIndicator,
  TextInput, Modal, Animated, Platform, StatusBar, ImageBackground, KeyboardAvoidingView
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import DateTimePicker from '@react-native-community/datetimepicker';
import api from '../../config/api';
import CategoryScheduleModal from '../../components/CategoryScheduleModal';

// Zomato Theme Colors
const ZOMATO_RED = '#E23744';
const ZOMATO_DARK_RED = '#CB1A27';

// Day names for schedule display
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Format time from 24-hour to 12-hour with AM/PM
const formatTime12Hour = (time24) => {
  if (!time24) return '';
  const [hours, minutes] = time24.split(':').map(Number);
  const period = hours >= 12 ? 'PM' : 'AM';
  const hours12 = hours % 12 || 12;
  return `${hours12}:${minutes.toString().padStart(2, '0')} ${period}`;
};

// Get next schedule time for a category (handles custom days)
const getNextScheduleTime = (schedule) => {
  if (!schedule || !schedule.enabled) return null;
  
  // For custom schedules with custom days
  if (schedule.type === 'custom' && schedule.customDays && schedule.customDays.length > 0) {
    const now = new Date();
    const currentDay = now.getDay();
    const currentHours = now.getHours();
    const currentMins = now.getMinutes();
    const currentMinutes = currentHours * 60 + currentMins;
    
    // Find today's schedule
    const todaySchedule = schedule.customDays.find(d => d.day === currentDay && d.enabled);
    
    if (todaySchedule) {
      const [startH, startM] = todaySchedule.startTime.split(':').map(Number);
      const startMinutes = startH * 60 + startM;
      
      // If we're before today's start time, show today's schedule
      if (currentMinutes < startMinutes) {
        return {
          day: DAY_NAMES[currentDay],
          startTime: todaySchedule.startTime,
          endTime: todaySchedule.endTime,
          isToday: true
        };
      }
      
      // If we're within today's schedule
      const [endH, endM] = todaySchedule.endTime.split(':').map(Number);
      const endMinutes = endH * 60 + endM;
      if (currentMinutes < endMinutes || endMinutes < startMinutes) {
        return {
          day: DAY_NAMES[currentDay],
          startTime: todaySchedule.startTime,
          endTime: todaySchedule.endTime,
          isToday: true,
          isActive: true
        };
      }
    }
    
    // Find next enabled day
    for (let i = 1; i <= 7; i++) {
      const nextDay = (currentDay + i) % 7;
      const nextSchedule = schedule.customDays.find(d => d.day === nextDay && d.enabled);
      if (nextSchedule) {
        return {
          day: DAY_NAMES[nextDay],
          startTime: nextSchedule.startTime,
          endTime: nextSchedule.endTime,
          isToday: false
        };
      }
    }
    
    return null;
  }
  
  // For daily schedule or custom with same time for all days
  if (schedule.startTime && schedule.endTime) {
    return {
      day: null,
      startTime: schedule.startTime,
      endTime: schedule.endTime,
      isDaily: true
    };
  }
  
  return null;
};

// Format schedule display text
const formatScheduleDisplay = (schedule) => {
  const nextSchedule = getNextScheduleTime(schedule);
  if (!nextSchedule) return '';
  
  const startFormatted = formatTime12Hour(nextSchedule.startTime);
  const endFormatted = formatTime12Hour(nextSchedule.endTime);
  
  if (nextSchedule.isDaily) {
    return `${startFormatted} - ${endFormatted}`;
  }
  
  if (nextSchedule.isToday) {
    return `Today ${startFormatted} - ${endFormatted}`;
  }
  
  return `${nextSchedule.day} ${startFormatted} - ${endFormatted}`;
};

export default function AdminMenuScreen({ navigation, route }) {
  const [items, setItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [foodTypeFilter, setFoodTypeFilter] = useState(route?.params?.foodTypeFilter || 'all');
  const [selectedTitle, setSelectedTitle] = useState('all');
  const [togglingId, setTogglingId] = useState(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.95)).current;
  const shineAnim = useRef(new Animated.Value(-1)).current;
  const lastTitleTap = useRef({});

  // Category modal
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [categoryForm, setCategoryForm] = useState({ name: '' });
  const [editingCategory, setEditingCategory] = useState(null);
  const [savingCategory, setSavingCategory] = useState(false);
  const [categoryImage, setCategoryImage] = useState(null);
  const [categoryImagePreview, setCategoryImagePreview] = useState('');
  const [pickingCategoryImage, setPickingCategoryImage] = useState(false);
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

  // Category action modal (for long press)
  const [showCategoryActionModal, setShowCategoryActionModal] = useState(false);
  const [categoryActionTarget, setCategoryActionTarget] = useState(null);

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
      setSelectedTitle('all');
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

  // Quantity toggle modal state
  const [showQtyModal, setShowQtyModal] = useState(false);
  const [qtyModalItem, setQtyModalItem] = useState(null); // the vItem with quantities

  // Toggle a single quantity option's availability
  const toggleQuantityAvailability = async (vItem, qIdx) => {
    const parentId = vItem.parentId;
    const vIdx = vItem.variantIndex;
    // Optimistic update
    setItems(prev => prev.map(i => {
      if (i._id !== parentId) return i;
      const updatedVariants = i.variants.map((v, idx) => {
        if (idx !== vIdx) return v;
        const updatedQtys = v.quantities.map((q, qi) =>
          qi === qIdx ? { ...q, available: q.available === false ? true : false } : q
        );
        return { ...v, quantities: updatedQtys };
      });
      return { ...i, variants: updatedVariants };
    }));
    // Update modal item too
    setQtyModalItem(prev => {
      if (!prev) return prev;
      const updatedQtys = prev.quantities.map((q, qi) =>
        qi === qIdx ? { ...q, available: q.available === false ? true : false } : q
      );
      return { ...prev, quantities: updatedQtys };
    });
    try {
      await api.patch(`/menu/${parentId}/variant/${vIdx}/quantity/${qIdx}/toggle`);
    } catch (error) {
      // Revert on error — refetch
      try { const { data } = await api.get('/menu'); setItems(data); } catch {}
      Alert.alert('Error', 'Failed to toggle quantity availability');
    }
  };

  // Toggle a single variant's availability (tapping Active/Off badge)
  const toggleVariantAvailability = async (vItem) => {
    // If variant has quantity options, show the qty dialog instead
    if (vItem.quantities && vItem.quantities.length > 0 && vItem.variantIndex >= 0) {
      setQtyModalItem(vItem);
      setShowQtyModal(true);
      return;
    }

    const parentId = vItem.parentId;
    const vIdx = vItem.variantIndex;
    const wasAvail = vItem.variantAvailable;
    // Optimistic update
    setItems(prev => prev.map(i => {
      if (i._id !== parentId) return i;
      if (vIdx === -1) {
        // No-variant item — toggle parent available
        return { ...i, available: !i.available };
      }
      const updatedVariants = i.variants.map((v, idx) =>
        idx === vIdx ? { ...v, available: !v.available } : v
      );
      return { ...i, variants: updatedVariants };
    }));
    try {
      if (vIdx === -1) {
        await api.patch(`/menu/${parentId}/toggle-pause`);
      } else {
        await api.patch(`/menu/${parentId}/variant/${vIdx}/toggle`);
      }
    } catch (error) {
      // Revert on error
      setItems(prev => prev.map(i => {
        if (i._id !== parentId) return i;
        if (vIdx === -1) return { ...i, available: wasAvail };
        const revertedVariants = i.variants.map((v, idx) =>
          idx === vIdx ? { ...v, available: wasAvail } : v
        );
        return { ...i, variants: revertedVariants };
      }));
      Alert.alert('Error', 'Failed to toggle variant availability');
    }
  };

  // Long-press on parent title header — sold out / schedule options
  const showItemSoldOutOptions = (parentItem) => {
    const allVariantsOff = parentItem.variants?.length > 0
      ? parentItem.variants.every(v => v.available === false)
      : !parentItem.available;

    const options = allVariantsOff
      ? [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Mark Available', onPress: () => markItemSoldOut(parentItem, false) },
        ]
      : [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Sold Out Now', style: 'destructive', onPress: () => markItemSoldOut(parentItem, true) },
          { text: 'Schedule', onPress: () => showItemScheduleModal(parentItem) },
        ];

    Alert.alert(
      allVariantsOff ? 'Resume Item' : 'Mark Sold Out',
      allVariantsOff
        ? `"${parentItem.name}" is currently sold out. Mark as available?`
        : `Mark all variants of "${parentItem.name}" as sold out?`,
      options
    );
  };

  // Bulk mark all variants sold out or available + real-time Meta sync
  const markItemSoldOut = async (parentItem, soldOut) => {
    const parentId = parentItem._id;
    // Optimistic update
    setItems(prev => prev.map(i => {
      if (i._id !== parentId) return i;
      const updatedVariants = (i.variants || []).map(v => ({ ...v, available: !soldOut }));
      return { ...i, available: !soldOut, variants: updatedVariants };
    }));
    try {
      await api.patch(`/menu/${parentId}/variants-soldout`, { soldOut });
    } catch (error) {
      // Revert
      setItems(prev => prev.map(i => {
        if (i._id !== parentId) return i;
        return { ...i, ...parentItem };
      }));
      Alert.alert('Error', 'Failed to update sold out status');
    }
  };

  // Schedule sold-out modal state for menu items
  const [showItemSoldOutModal, setShowItemSoldOutModal] = useState(false);
  const [soldOutItem, setSoldOutItem] = useState(null);
  const [soldOutItemEndTime, setSoldOutItemEndTime] = useState('17:00');
  const [scheduleType, setScheduleType] = useState(null); // null = choice screen, 'daily', 'custom'
  const [dailyStartTime, setDailyStartTime] = useState('09:00');
  const [dailyEndTime, setDailyEndTime] = useState('17:00');
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const [customDays, setCustomDays] = useState(
    DAYS.map(d => ({ day: d, enabled: false, startTime: '09:00', endTime: '17:00' }))
  );

  // Native time picker state
  const [nativeTimePicker, setNativeTimePicker] = useState({ visible: false, field: null, dayIdx: null });

  const timeStringToDate = (timeStr) => {
    const [h, m] = (timeStr || '12:00').split(':').map(Number);
    const d = new Date();
    d.setHours(h, m, 0, 0);
    return d;
  };

  const openNativeTimePicker = (field, dayIdx = null) => {
    setNativeTimePicker({ visible: true, field, dayIdx });
  };

  const onNativeTimeChange = (event, selectedTime) => {
    setNativeTimePicker(prev => ({ ...prev, visible: false }));
    if (event.type === 'dismissed' || !selectedTime) return;
    const hours = selectedTime.getHours().toString().padStart(2, '0');
    const minutes = selectedTime.getMinutes().toString().padStart(2, '0');
    const timeStr = `${hours}:${minutes}`;
    const { field, dayIdx } = nativeTimePicker;

    if (field === 'soldOutEndTime') {
      setSoldOutEndTime(timeStr);
    } else if (field === 'dailyStartTime') {
      setDailyStartTime(timeStr);
    } else if (field === 'dailyEndTime') {
      setDailyEndTime(timeStr);
    } else if (field === 'customStartTime' && dayIdx !== null) {
      updateCustomDay(dayIdx, 'startTime', timeStr);
    } else if (field === 'customEndTime' && dayIdx !== null) {
      updateCustomDay(dayIdx, 'endTime', timeStr);
    }
  };

  const getNativeTimePickerValue = () => {
    const { field, dayIdx } = nativeTimePicker;
    if (field === 'soldOutEndTime') return timeStringToDate(soldOutEndTime);
    if (field === 'dailyStartTime') return timeStringToDate(dailyStartTime);
    if (field === 'dailyEndTime') return timeStringToDate(dailyEndTime);
    if (field === 'customStartTime' && dayIdx !== null) return timeStringToDate(customDays[dayIdx]?.startTime);
    if (field === 'customEndTime' && dayIdx !== null) return timeStringToDate(customDays[dayIdx]?.endTime);
    return new Date();
  };

  // Time dropdown state (inline, no nested modal)
  const [showTimeDropdown, setShowTimeDropdown] = useState(false);
  const [timeDropdownDayIdx, setTimeDropdownDayIdx] = useState(null);
  const [timeDropdownField, setTimeDropdownField] = useState(null); // 'startTime' or 'endTime'
  const TIME_OPTIONS = (() => {
    const opts = [];
    for (let h = 0; h < 24; h++) {
      for (let m = 0; m < 60; m += 30) {
        opts.push(`${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`);
      }
    }
    return opts;
  })();
  const openTimeDropdown = (dIdx, field) => {
    if (showTimeDropdown && timeDropdownDayIdx === dIdx && timeDropdownField === field) {
      setShowTimeDropdown(false);
      return;
    }
    setTimeDropdownDayIdx(dIdx);
    setTimeDropdownField(field);
    setShowTimeDropdown(true);
  };
  const selectTime = (time24) => {
    if (timeDropdownDayIdx !== null && timeDropdownField) {
      updateCustomDay(timeDropdownDayIdx, timeDropdownField, time24);
    }
    setShowTimeDropdown(false);
  };

  const showItemScheduleModal = (parentItem) => {
    setSoldOutItem(parentItem);
    // Pre-fill from existing schedule if any
    const existing = parentItem.soldOutSchedule;
    if (existing && existing.enabled) {
      setScheduleType(existing.type || 'daily');
      if (existing.type === 'daily') {
        setDailyStartTime(existing.dailyStartTime || '09:00');
        setDailyEndTime(existing.dailyEndTime || '17:00');
      } else if (existing.type === 'custom' && existing.days) {
        setCustomDays(DAYS.map(d => {
          const found = existing.days.find(ed => ed.day === d);
          return found ? { ...found } : { day: d, enabled: false, startTime: '09:00', endTime: '17:00' };
        }));
      }
    } else {
      setScheduleType(null);
      setDailyStartTime('09:00');
      setDailyEndTime('17:00');
      setCustomDays(DAYS.map(d => ({ day: d, enabled: false, startTime: '09:00', endTime: '17:00' })));
    }
    setShowItemSoldOutModal(true);
  };

  const saveItemSoldOutSchedule = async () => {
    if (!soldOutItem || !scheduleType) return;
    // Custom schedule must have at least one day enabled — otherwise the
    // schedule effectively means "always sold out" which is never the
    // intent. Block save and tell the user.
    if (scheduleType === 'custom' && !customDays.some(d => d.enabled)) {
      Alert.alert('Enable a day first', 'Toggle on at least one weekday before saving the custom schedule.');
      return;
    }
    const parentId = soldOutItem._id;
    try {
      setSavingCategory(true);
      const schedule = {
        type: scheduleType,
        dailyStartTime: scheduleType === 'daily' ? dailyStartTime : null,
        dailyEndTime: scheduleType === 'daily' ? dailyEndTime : null,
        days: scheduleType === 'custom' ? customDays : [],
      };
      await api.patch(`/menu/${parentId}/schedule-soldout`, { schedule });
      setShowItemSoldOutModal(false);
      fetchMenu();
      if (scheduleType === 'daily') {
        Alert.alert('Success', `Schedule saved for "${soldOutItem.name}"\nAvailable daily: ${formatTime12(dailyStartTime)} – ${formatTime12(dailyEndTime)}\nSold out outside this window`);
      } else {
        const enabledDays = customDays.filter(d => d.enabled).map(d => d.day).join(', ');
        Alert.alert('Success', `Custom schedule saved for "${soldOutItem.name}"\nAvailable on: ${enabledDays || 'None'}\nSold out on other days/times`);
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to save schedule');
      fetchMenu();
    } finally {
      setSavingCategory(false);
    }
  };

  // Helper to format 24h time to 12h
  const formatTime12 = (time) => {
    const [h, m] = time.split(':').map(Number);
    const period = h >= 12 ? 'PM' : 'AM';
    return `${(h % 12 || 12)}:${m.toString().padStart(2, '0')} ${period}`;
  };

  // Helper to update a custom day's time
  const updateCustomDay = (dayIndex, field, value) => {
    setCustomDays(prev => prev.map((d, i) => i === dayIndex ? { ...d, [field]: value } : d));
  };

  // Helper to cycle time up/down
  const cycleTime = (time, part, delta) => {
    const [h, m] = time.split(':').map(Number);
    if (part === 'hour') {
      const newH = (h + delta + 24) % 24;
      return `${newH.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
    } else {
      const totalMin = h * 60 + m + delta;
      const wrapped = ((totalMin % 1440) + 1440) % 1440;
      const newH = Math.floor(wrapped / 60);
      const newM = wrapped % 60;
      return `${newH.toString().padStart(2, '0')}:${newM.toString().padStart(2, '0')}`;
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

  // Delete a single variant (Cloudinary + Meta + MongoDB)
  const deleteVariant = (vItem) => {
    const parentId = vItem.parentId;
    const vIdx = vItem.variantIndex;
    const variantName = vItem.name || `Variant ${vIdx + 1}`;
    const parentName = vItem.parentName;

    Alert.alert(
      'Delete Variant',
      `Are you sure you want to delete "${variantName}" from "${parentName}"?\n\nThis will permanently remove the variant, its image from Cloudinary, and its listing from Meta catalog.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              setTogglingId(`${parentId}_v${vIdx}`);
              const response = await api.delete(`/menu/${parentId}/variant/${vIdx}`);
              // Update local state with the returned updated item
              setItems(prev => prev.map(i => {
                if (i._id !== parentId) return i;
                return response.data;
              }));
            } catch (error) {
              Alert.alert('Error', 'Failed to delete variant');
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
    setPickingCategoryImage(true);
    try {
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
    } finally {
      setPickingCategoryImage(false);
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
      days: category.schedule?.days || [],
      customDays: category.schedule?.customDays || []
    });
    setShowScheduleModal(true);
  };

  const saveSchedule = async () => {
    try {
      setSavingCategory(true);
      console.log('Saving schedule:', scheduleForm);
      
      const response = await api.patch(`/categories/${scheduleCategory._id}/schedule`, scheduleForm);
      console.log('Schedule save response:', response.data);
      console.log('Response isPaused:', response.data.isPaused);
      
      // Update the category in state immediately with the response
      setCategories(prev => prev.map(cat => 
        cat._id === scheduleCategory._id ? response.data : cat
      ));
      
      // Also fetch all categories after a delay to ensure consistency
      setTimeout(() => fetchCategories(), 500);
      
      setShowScheduleModal(false);
      Alert.alert('Success', `Schedule saved. Category is now ${response.data.isPaused ? 'paused' : 'active'}.`);
    } catch (error) {
      console.error('Schedule save error:', error);
      console.error('Error response:', error.response?.data);
      Alert.alert('Error', error.response?.data?.error || 'Failed to save schedule');
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

  // Toggle sold out status for category
  const toggleCategorySoldOut = async (category) => {
    try {
      setCategories(prev => prev.map(c =>
        c._id === category._id ? { ...c, isSoldOut: !c.isSoldOut } : c
      ));
      await api.patch(`/categories/${category._id}/toggle-soldout`);
      fetchCategories();
      fetchMenu(); // Refresh menu items too
    } catch (error) {
      setCategories(prev => prev.map(c =>
        c._id === category._id ? { ...c, isSoldOut: category.isSoldOut } : c
      ));
      Alert.alert('Error', 'Failed to toggle sold out status');
    }
  };

  // Show sold out options for category
  const showSoldOutOptions = (category) => {
    const isSoldOut = category.isSoldOut;
    
    Alert.alert(
      isSoldOut ? 'Resume Category' : 'Mark as Sold Out',
      isSoldOut 
        ? `"${category.name}" is currently sold out. Do you want to mark it as available again?`
        : `How would you like to mark "${category.name}" as sold out?`,
      isSoldOut ? [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Mark Available', onPress: () => toggleCategorySoldOut(category) },
      ] : [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sold Out Now', onPress: () => toggleCategorySoldOut(category) },
        { text: 'Schedule Time', onPress: () => showSoldOutScheduleModal(category) },
      ]
    );
  };

  // Sold out schedule modal state
  const [showSoldOutModal, setShowSoldOutModal] = useState(false);
  const [soldOutCategory, setSoldOutCategory] = useState(null);
  const [soldOutEndTime, setSoldOutEndTime] = useState('17:00');

  const showSoldOutScheduleModal = (category) => {
    setSoldOutCategory(category);
    // Default to 1 hour from now
    const now = new Date();
    const hours = (now.getHours() + 1) % 24;
    setSoldOutEndTime(`${hours.toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`);
    setShowSoldOutModal(true);
  };

  const saveSoldOutSchedule = async () => {
    if (!soldOutCategory) return;
    
    try {
      setSavingCategory(true);
      await api.patch(`/categories/${soldOutCategory._id}/schedule-soldout`, {
        enabled: true,
        endTime: soldOutEndTime
      });
      
      fetchCategories();
      fetchMenu();
      setShowSoldOutModal(false);
      
      // Format time for display
      const [hours, mins] = soldOutEndTime.split(':').map(Number);
      const period = hours >= 12 ? 'PM' : 'AM';
      const hours12 = hours % 12 || 12;
      Alert.alert('Success', `"${soldOutCategory.name}" marked sold out until ${hours12}:${mins.toString().padStart(2, '0')} ${period}`);
    } catch (error) {
      Alert.alert('Error', 'Failed to schedule sold out');
    } finally {
      setSavingCategory(false);
    }
  };

  // Helper to format time remaining for sold out
  const getSoldOutTimeRemaining = (category) => {
    if (!category.soldOutSchedule?.enabled || !category.soldOutSchedule?.endTime) {
      return null;
    }
    
    const [endHour, endMin] = category.soldOutSchedule.endTime.split(':').map(Number);
    const [hours, mins] = soldOutEndTime.split(':').map(Number);
    const period = endHour >= 12 ? 'PM' : 'AM';
    const hours12 = endHour % 12 || 12;
    
    return `Until ${hours12}:${endMin.toString().padStart(2, '0')} ${period}`;
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

  // Get unavailable category names (paused or sold out) - memoized
  // Non-scheduled categories are "available" unless manually paused or sold out
  const unavailableCategoryNames = useMemo(() => 
    categories.filter(c => c.isPaused || c.isSoldOut).map(c => c.name),
    [categories]
  );

  // Get scheduled locked category names (has schedule enabled AND currently paused due to schedule)
  const scheduledLockedCategoryNames = useMemo(() => 
    categories.filter(c => c.schedule?.enabled && c.isPaused && !c.isSoldOut).map(c => c.name),
    [categories]
  );

  // Get manually paused category names (paused but NOT scheduled, or sold out)
  const manuallyPausedCategoryNames = useMemo(() => 
    categories.filter(c => (c.isPaused && !c.schedule?.enabled) || c.isSoldOut).map(c => c.name),
    [categories]
  );

  // Check if item has at least one ACTIVE category (not locked/paused)
  // This includes non-scheduled categories that are not manually paused
  // Example: Item in "Dinner"(locked) + "Tiffin"(locked) + "South Indian"(active) → has active category
  const hasItemActiveCategory = useCallback((item) => {
    const itemCategories = Array.isArray(item.category) ? item.category : [item.category];
    // Item has active category if ANY category is NOT in unavailable list
    // Non-scheduled categories are always active unless manually paused/sold out
    return itemCategories.some(cat => !unavailableCategoryNames.includes(cat));
  }, [unavailableCategoryNames]);

  // Check if item is unavailable due to category status (ALL categories unavailable)
  const isItemCategoryUnavailable = useCallback((item) => {
    const itemCategories = Array.isArray(item.category) ? item.category : [item.category];
    // Item is unavailable if ALL its categories are unavailable
    return itemCategories.every(cat => unavailableCategoryNames.includes(cat));
  }, [unavailableCategoryNames]);

  // Check if currently viewing category is locked (scheduled or manual)
  const isSelectedCategoryLocked = useMemo(() => {
    if (selectedCategory === 'all') return false;
    return unavailableCategoryNames.includes(selectedCategory);
  }, [selectedCategory, unavailableCategoryNames]);

  // Check if currently viewing a scheduled category that is ACTIVE (within time)
  const isSelectedCategoryScheduledActive = useMemo(() => {
    if (selectedCategory === 'all') return false;
    const category = categories.find(c => c.name === selectedCategory);
    // Category is scheduled active if it has schedule enabled AND is NOT paused (within active time)
    return category?.schedule?.enabled && !category?.isPaused && !category?.isSoldOut;
  }, [selectedCategory, categories]);

  // Get scheduled categories that are currently ACTIVE (within time, not paused)
  const scheduledActiveCategoryNames = useMemo(() => 
    categories.filter(c => c.schedule?.enabled && !c.isPaused && !c.isSoldOut).map(c => c.name),
    [categories]
  );

  // Check if item has at least one scheduled category that is currently ACTIVE
  const hasItemScheduledActiveCategory = useCallback((item) => {
    const itemCategories = Array.isArray(item.category) ? item.category : [item.category];
    return itemCategories.some(cat => scheduledActiveCategoryNames.includes(cat));
  }, [scheduledActiveCategoryNames]);

  // Check if item should show scheduled lock icon
  // Show lock if item has ANY scheduled locked category
  // BUT don't show lock if:
  // 1. Viewing a scheduled category that is currently ACTIVE, OR
  // 2. Item has ANY scheduled category that is currently ACTIVE
  const isItemScheduledLocked = useCallback((item) => {
    // If viewing a scheduled category that is ACTIVE, don't show any locks
    if (isSelectedCategoryScheduledActive) {
      return false;
    }
    
    // If item has any scheduled category that is ACTIVE, don't show locks
    if (hasItemScheduledActiveCategory(item)) {
      return false;
    }
    
    const itemCategories = Array.isArray(item.category) ? item.category : [item.category];
    
    // Show lock if ANY of item's categories is scheduled locked
    return itemCategories.some(cat => scheduledLockedCategoryNames.includes(cat));
  }, [scheduledLockedCategoryNames, isSelectedCategoryScheduledActive, hasItemScheduledActiveCategory]);
  
  // Check if item should show manually paused lock icon
  // Show lock if item has ANY manually paused category (but not if already showing scheduled lock)
  // BUT don't show lock if item has ANY scheduled category that is currently ACTIVE
  const isItemManuallyPaused = useCallback((item) => {
    // If viewing a scheduled category that is ACTIVE, don't show any locks
    if (isSelectedCategoryScheduledActive) {
      return false;
    }
    
    // If item has any scheduled category that is ACTIVE, don't show locks
    if (hasItemScheduledActiveCategory(item)) {
      return false;
    }
    
    const itemCategories = Array.isArray(item.category) ? item.category : [item.category];
    
    // Don't show manual pause if already showing scheduled lock
    const hasScheduledLock = itemCategories.some(cat => scheduledLockedCategoryNames.includes(cat));
    if (hasScheduledLock) return false;
    
    // Show lock if ANY of item's categories is manually paused
    return itemCategories.some(cat => manuallyPausedCategoryNames.includes(cat));
  }, [manuallyPausedCategoryNames, scheduledLockedCategoryNames, isSelectedCategoryScheduledActive, hasItemScheduledActiveCategory]);
  
  // Get which categories are causing the item to be scheduled locked (for display)
  const getItemLockedCategories = useCallback((item) => {
    const itemCategories = Array.isArray(item.category) ? item.category : [item.category];
    return itemCategories.filter(cat => scheduledLockedCategoryNames.includes(cat));
  }, [scheduledLockedCategoryNames]);
  
  // Get which categories are causing the item to be manually paused (for display)
  const getItemManuallyPausedCategories = useCallback((item) => {
    const itemCategories = Array.isArray(item.category) ? item.category : [item.category];
    return itemCategories.filter(cat => manuallyPausedCategoryNames.includes(cat));
  }, [manuallyPausedCategoryNames]);

  // Unique titles (menu item names) for title filter - memoized
  const titleCards = useMemo(() => {
    const cards = items.map(item => {
      // Item is sold out if all variants are unavailable or item itself is unavailable
      const isSoldOut = item.variants && item.variants.length > 0
        ? item.variants.every(v => v.available === false)
        : item.available === false;
      return {
        id: item._id,
        name: item.name,
        image: item.image || (item.variants?.[0]?.image) || null,
        variantCount: item.variants?.length || 0,
        isSoldOut,
      };
    });
    // Sort: emoji-prefixed names first, then alphabetical
    const emojiRegex = /^[\p{Emoji_Presentation}\p{Extended_Pictographic}]/u;
    cards.sort((a, b) => {
      const aEmoji = emojiRegex.test(a.name);
      const bEmoji = emojiRegex.test(b.name);
      if (aEmoji && !bEmoji) return -1;
      if (!aEmoji && bEmoji) return 1;
      return a.name.localeCompare(b.name);
    });
    return cards;
  }, [items]);

  // Total variant count for "All" label
  const totalVariantCount = useMemo(() => {
    return items.reduce((sum, item) => sum + (item.variants?.length || 1), 0);
  }, [items]);

  // Flatten menu items into individual variant rows
  const flattenedVariants = useMemo(() => {
    const result = [];
    items.forEach(item => {
      const itemCategories = Array.isArray(item.category) ? item.category : [item.category];
      const matchesSearch = item.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        itemCategories.some(cat => cat?.toLowerCase().includes(searchTerm.toLowerCase())) ||
        item.variants?.some(v => v.label?.toLowerCase().includes(searchTerm.toLowerCase()));
      const matchesCategory = selectedCategory === 'all' || itemCategories.includes(selectedCategory);
      const matchesStatus = statusFilter === 'all' ||
        (statusFilter === 'available' && item.available) ||
        (statusFilter === 'unavailable' && !item.available);
      const matchesFoodType = foodTypeFilter === 'all' || item.foodType === foodTypeFilter;
      const matchesTitle = selectedTitle === 'all' || item._id === selectedTitle;
      if (!matchesSearch || !matchesCategory || !matchesStatus || !matchesFoodType || !matchesTitle) return;

      if (item.variants && item.variants.length > 0) {
        item.variants.forEach((v, vIdx) => {
          // Food type filter also applies at variant level
          if (foodTypeFilter !== 'all' && v.foodType && v.foodType !== foodTypeFilter) return;
          // When searching, only show variants whose label matches (or parent name/category matches)
          if (searchTerm) {
            const q = searchTerm.toLowerCase();
            const parentMatch = item.name?.toLowerCase().includes(q) || itemCategories.some(cat => cat?.toLowerCase().includes(q));
            const variantMatch = v.label?.toLowerCase().includes(q);
            if (!parentMatch && !variantMatch) return;
          }
          result.push({
            _id: `${item._id}_v${vIdx}`,
            parentId: item._id,
            parentItem: item,
            variantIndex: vIdx,
            name: v.label,
            parentName: item.name,
            image: v.image || item.image || null,
            foodType: v.foodType || item.foodType,
            price: v.price || (v.quantities?.[0]?.price) || item.price,
            offerPrice: v.offerPrice || (v.quantities?.[0]?.offerPrice) || null,
            available: v.available !== false && item.available && !item.isPaused,
            variantAvailable: v.available !== false,
            quantities: v.quantities || null,
            quantity: v.quantity,
            unit: v.unit,
            description: v.description || item.description,
            category: item.category,
            preparationTime: item.preparationTime,
            isPaused: item.isPaused,
            variant: v,
          });
        });
      } else {
        // No variants - show as single item
        result.push({
          _id: item._id,
          parentId: item._id,
          parentItem: item,
          variantIndex: -1,
          name: item.name,
          parentName: item.name,
          image: item.image || null,
          foodType: item.foodType,
          price: item.price,
          offerPrice: item.offerPrice,
          available: item.available && !item.isPaused,
          variantAvailable: item.available,
          quantities: null,
          quantity: item.quantity,
          unit: item.unit,
          description: item.description,
          category: item.category,
          preparationTime: item.preparationTime,
          isPaused: item.isPaused,
          variant: null,
        });
      }
    });
    return result;
  }, [items, searchTerm, selectedCategory, statusFilter, foodTypeFilter, selectedTitle]);

  // Group flattenedVariants into sections by parent item
  const sectionData = useMemo(() => {
    const map = new Map();
    flattenedVariants.forEach(vItem => {
      const pid = vItem.parentId;
      if (!map.has(pid)) {
        map.set(pid, { parentItem: vItem.parentItem, data: [] });
      }
      map.get(pid).data.push(vItem);
    });
    const sections = Array.from(map.values()).map(s => ({
      title: s.parentItem.name,
      parentItem: s.parentItem,
      data: s.data,
    }));
    // Sort: emoji-prefixed names first, then alphabetical
    const emojiRegex = /^[\p{Emoji_Presentation}\p{Extended_Pictographic}]/u;
    sections.sort((a, b) => {
      const aEmoji = emojiRegex.test(a.title);
      const bEmoji = emojiRegex.test(b.title);
      if (aEmoji && !bEmoji) return -1;
      if (!aEmoji && bEmoji) return 1;
      return a.title.localeCompare(b.title);
    });
    return sections;
  }, [flattenedVariants]);

  // Stats - memoized
  const stats = useMemo(() => {
    const totalItems = items.length;
    const availableCount = items.filter(i => i.available).length;
    const unavailableCount = items.filter(i => !i.available).length;
    const uniqueCategories = [...new Set(items.flatMap(i => Array.isArray(i.category) ? i.category : [i.category]))];
    return { totalItems, availableCount, unavailableCount, uniqueCategories };
  }, [items]);

  const renderVariantItem = useCallback(({ item: vItem }) => {
    const parentItem = vItem.parentItem;
    const isAvail = vItem.available;

    return (
      <Animated.View style={{ opacity: fadeAnim, transform: [{ scale: scaleAnim }] }}>
        <TouchableOpacity
          style={[styles.itemCard, !isAvail && styles.itemCardOutOfStock]}
          onPress={() => navigation.navigate('MenuItemForm', { item: parentItem, focusVariantIndex: vItem.variantIndex })}
          activeOpacity={0.7}
        >
          <View style={styles.itemImageContainer}>
            {vItem.image ? (
              <Image
                source={{ uri: vItem.image, cache: 'force-cache' }}
                style={styles.itemImage}
                defaultSource={require('../../../assets/icon.png')}
                resizeMode="cover"
              />
            ) : (
              <View style={[styles.itemImage, styles.placeholderImage]}>
                <Ionicons name="restaurant-outline" size={32} color="#d1d5db" />
              </View>
            )}
            {vItem.foodType && vItem.foodType !== 'none' && (
              <View style={[styles.foodTypeBadge, {
                borderColor: vItem.foodType === 'veg' ? '#22c55e' : vItem.foodType === 'egg' ? '#f59e0b' : '#ef4444'
              }]}>
                <View style={[styles.foodTypeDot, {
                  backgroundColor: vItem.foodType === 'veg' ? '#22c55e' : vItem.foodType === 'egg' ? '#f59e0b' : '#ef4444'
                }]} />
              </View>
            )}
          </View>

          <View style={styles.itemInfo}>
            <Text style={styles.itemName} numberOfLines={1}>{vItem.name}</Text>
            <Text style={styles.itemCategory} numberOfLines={1}>{vItem.parentName}</Text>
            {/* Quantity options */}
            {vItem.quantities && vItem.quantities.length > 0 ? (
              <View style={styles.variantQtyRow}>
                {vItem.quantities.map((q, qIdx) => (
                  <View key={qIdx} style={[styles.variantQtyChip, q.available === false && { backgroundColor: '#FEE2E2', borderColor: '#FECACA', borderWidth: 1 }]}>
                    <Text style={[styles.variantQtyText, q.available === false && { color: '#DC2626', textDecorationLine: 'line-through' }]}>{q.quantity} {q.unit} — ₹{q.price}</Text>
                  </View>
                ))}
              </View>
            ) : (
              <View style={styles.itemFooter}>
                <View style={styles.priceContainer}>
                  {vItem.offerPrice && vItem.offerPrice < vItem.price ? (
                    <View style={styles.priceRow}>
                      <Text style={styles.originalPrice}>₹{vItem.price}</Text>
                      <Text style={styles.offerPrice}>₹{vItem.offerPrice}</Text>
                    </View>
                  ) : (
                    <Text style={styles.itemPrice}>₹{vItem.price}{vItem.quantity && vItem.unit ? ` / ${vItem.quantity} ${vItem.unit}` : ''}</Text>
                  )}
                </View>
              </View>
            )}
          </View>

          <View style={styles.variantActionColumn}>
            <TouchableOpacity
              onPress={() => toggleVariantAvailability(vItem)}
              activeOpacity={0.6}
              style={{
                paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
                backgroundColor: isAvail ? '#22C55E' : '#EF4444',
                shadowColor: isAvail ? '#22C55E' : '#EF4444',
                shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 4,
                elevation: 3,
              }}
            >
              <Text style={{ fontSize: 11, fontWeight: '800', color: '#fff', letterSpacing: 0.5 }}>
                {isAvail ? 'Active' : 'Off'}
              </Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Animated.View>
    );
  }, [fadeAnim, scaleAnim, navigation]);

  const variantKeyExtractor = useCallback((item) => item._id, []);

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
              const isScheduledLocked = cat.schedule?.enabled && cat.isPaused && !cat.isSoldOut;

              return (
                <TouchableOpacity
                  key={cat._id}
                  style={styles.categoryItem}
                  onPress={() => setSelectedCategory(cat.name)}
                  onLongPress={() => {
                    setCategoryActionTarget(cat);
                    setShowCategoryActionModal(true);
                  }}
                  disabled={isDeleting}
                >
                  <View style={[
                    styles.categoryImageWrapper, 
                    selectedCategory === cat.name && styles.categoryImageWrapperActive, 
                    cat.isSoldOut && styles.categoryImageWrapperSoldOut,
                    isScheduledLocked && styles.categoryImageWrapperScheduled
                  ]}>
                    {cat.image ? (
                      <Image 
                        source={{ uri: cat.image, cache: 'force-cache' }} 
                        style={[styles.categoryImage, isDeleting && styles.categoryImageDeleting, (cat.isSoldOut || isScheduledLocked) && styles.categoryImageSoldOut]}
                        defaultSource={require('../../../assets/icon.png')}
                        resizeMode="cover"
                      />
                    ) : (
                      <View style={[styles.categoryPlaceholder, isDeleting && styles.categoryImageDeleting]}>
                        <Ionicons name="restaurant-outline" size={24} color={cat.isSoldOut ? '#ef4444' : (isScheduledLocked ? '#6366f1' : '#9ca3af')} />
                      </View>
                    )}
                    {cat.isSoldOut && !isDeleting && (
                      <View style={styles.categorySoldOutOverlay}>
                        <View style={styles.soldOutBadge}>
                          <Text style={styles.soldOutBadgeText}>SOLD OUT</Text>
                        </View>
                      </View>
                    )}
                    {isScheduledLocked && !isDeleting && (
                      <View style={styles.categoryScheduledOverlay}>
                        <View style={styles.scheduledBadge}>
                          <Ionicons name="lock-closed" size={12} color="#fff" />
                        </View>
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
                    cat.isSoldOut && styles.categoryNameSoldOut,
                    isScheduledLocked && styles.categoryNameScheduled,
                    isDeleting && styles.categoryNameDeleting
                  ]} numberOfLines={1}>{cat.name}</Text>
                  {cat.soldOutSchedule?.enabled && cat.soldOutSchedule?.endTime && (
                    <Text style={styles.categoryTimeoutText}>
                      {(() => {
                        const [h, m] = cat.soldOutSchedule.endTime.split(':').map(Number);
                        const p = h >= 12 ? 'PM' : 'AM';
                        const h12 = h % 12 || 12;
                        return `Until ${h12}:${m.toString().padStart(2, '0')} ${p}`;
                      })()}
                    </Text>
                  )}
                  {cat.schedule?.enabled && !cat.isSoldOut && (
                    <Text style={[
                      styles.categoryScheduleText,
                      !cat.isPaused && styles.categoryScheduleActiveText
                    ]}>
                      {cat.isPaused 
                        ? formatScheduleDisplay(cat.schedule)
                        : `Active ${formatScheduleDisplay(cat.schedule)}`
                      }
                    </Text>
                  )}
                  {selectedCategory === cat.name && <View style={styles.categoryUnderline} />}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      )}

      {/* Title Filter - Product Cards */}
      {items.length > 0 && (
        <View style={styles.titleFilterContainer}>
          <Text style={styles.titleFilterLabel}>Products</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.titleFilterList}>
            <TouchableOpacity
              style={styles.titleFilterItem}
              onPress={() => setSelectedTitle('all')}
            >
              <View style={[styles.titleImageWrapper, selectedTitle === 'all' && styles.titleImageWrapperActive]}>
                <LinearGradient
                  colors={[ZOMATO_RED, ZOMATO_DARK_RED]}
                  style={styles.titleAllIcon}
                >
                  <Ionicons name="grid-outline" size={22} color="#fff" />
                  <Text style={styles.titleAllText}>All</Text>
                </LinearGradient>
              </View>
              <Text style={[styles.titleName, selectedTitle === 'all' && styles.titleNameActive]}>All Items</Text>
              <Text style={styles.titleVariantCount}>{totalVariantCount} items</Text>
              {selectedTitle === 'all' && <View style={styles.titleUnderline} />}
            </TouchableOpacity>
            {titleCards.map(tc => (
              <TouchableOpacity
                key={tc.id}
                style={styles.titleFilterItem}
                onPress={() => {
                  const now = Date.now();
                  const last = lastTitleTap.current[tc.id] || 0;
                  if (now - last < 300) {
                    // Double tap — navigate to edit
                    const parentItem = items.find(i => i._id === tc.id);
                    if (parentItem) navigation.navigate('MenuItemForm', { item: parentItem });
                    lastTitleTap.current[tc.id] = 0;
                  } else {
                    lastTitleTap.current[tc.id] = now;
                    // Single tap — filter
                    setTimeout(() => {
                      if (lastTitleTap.current[tc.id] === now) {
                        setSelectedTitle(tc.id === selectedTitle ? 'all' : tc.id);
                      }
                    }, 300);
                  }
                }}
                onLongPress={() => {
                  const parentItem = items.find(i => i._id === tc.id);
                  if (parentItem) showItemSoldOutOptions(parentItem);
                }}
              >
                <View style={[styles.titleImageWrapper, selectedTitle === tc.id && styles.titleImageWrapperActive, tc.isSoldOut && { opacity: 0.4 }]}>
                  {tc.image ? (
                    <Image
                      source={{ uri: tc.image, cache: 'force-cache' }}
                      style={[styles.titleImage, tc.isSoldOut && { opacity: 0.6 }]}
                      resizeMode="cover"
                    />
                  ) : (
                    <View style={styles.titlePlaceholder}>
                      <Ionicons name="restaurant-outline" size={24} color="#9ca3af" />
                    </View>
                  )}
                  {tc.isSoldOut && (
                    <View style={{
                      position: 'absolute', bottom: 0, left: 0, right: 0,
                      backgroundColor: 'rgba(239,68,68,0.85)', paddingVertical: 2,
                      alignItems: 'center',
                    }}>
                      <Text style={{ fontSize: 7, fontWeight: '800', color: '#fff', letterSpacing: 0.5 }}>SOLD OUT</Text>
                    </View>
                  )}
                </View>
                <Text style={[styles.titleName, selectedTitle === tc.id && styles.titleNameActive, tc.isSoldOut && { color: '#d1d5db' }]} numberOfLines={1}>{tc.name}</Text>
                {tc.variantCount > 0 && (
                  <Text style={styles.titleVariantCount}>{tc.variantCount} variant{tc.variantCount > 1 ? 's' : ''}</Text>
                )}
                {selectedTitle === tc.id && <View style={styles.titleUnderline} />}
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={ZOMATO_RED} />
          <Text style={styles.loadingText}>Loading menu...</Text>
        </View>
      ) : (
        <SectionList
          sections={sectionData}
          renderItem={renderVariantItem}
          renderSectionHeader={() => null}
          keyExtractor={variantKeyExtractor}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[ZOMATO_RED]} tintColor={ZOMATO_RED} />}
          showsVerticalScrollIndicator={false}
          stickySectionHeadersEnabled={false}
          removeClippedSubviews={true}
          maxToRenderPerBatch={10}
          updateCellsBatchingPeriod={50}
          initialNumToRender={10}
          windowSize={10}
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
                        <TouchableOpacity 
                          style={styles.categoryImagePlaceholder} 
                          onPress={pickCategoryImage}
                          disabled={pickingCategoryImage}
                        >
                          {pickingCategoryImage ? (
                            <ActivityIndicator size="small" color="#E23744" />
                          ) : (
                            <>
                              <Ionicons name="camera-outline" size={32} color="#9ca3af" />
                              <Text style={styles.categoryImagePlaceholderText}>Add Image</Text>
                            </>
                          )}
                        </TouchableOpacity>
                      )}
                      {categoryImagePreview && (
                        <TouchableOpacity 
                          style={styles.changeCategoryImageButton} 
                          onPress={pickCategoryImage}
                          disabled={pickingCategoryImage}
                        >
                          {pickingCategoryImage ? (
                            <ActivityIndicator size="small" color="#696969" />
                          ) : (
                            <>
                              <Ionicons name="image-outline" size={18} color="#696969" />
                              <Text style={styles.changeCategoryImageText}>Change</Text>
                            </>
                          )}
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

      {/* Category Action Modal (Long Press) */}
      <Modal
        visible={showCategoryActionModal}
        animationType="fade"
        transparent={true}
        onRequestClose={() => setShowCategoryActionModal(false)}
      >
        <TouchableOpacity 
          style={styles.categoryActionOverlay} 
          activeOpacity={1} 
          onPress={() => setShowCategoryActionModal(false)}
        >
          <View style={styles.categoryActionContent}>
            {/* Header */}
            <View style={styles.categoryActionHeader}>
              <View style={styles.categoryActionHeaderLeft}>
                {categoryActionTarget?.image ? (
                  <Image 
                    source={{ uri: categoryActionTarget.image }} 
                    style={styles.categoryActionImage}
                    resizeMode="cover"
                  />
                ) : (
                  <View style={styles.categoryActionImagePlaceholder}>
                    <Ionicons name="restaurant-outline" size={20} color="#9ca3af" />
                  </View>
                )}
                <View style={styles.categoryActionHeaderText}>
                  <Text style={styles.categoryActionTitle}>{categoryActionTarget?.name}</Text>
                  {categoryActionTarget?.isSoldOut && (
                    <View style={styles.categoryActionBadgeSoldOut}>
                      <Text style={styles.categoryActionBadgeText}>SOLD OUT</Text>
                      {categoryActionTarget?.soldOutSchedule?.enabled && categoryActionTarget?.soldOutSchedule?.endTime && (
                        <Text style={styles.categoryActionBadgeTime}>
                          {(() => {
                            const [h, m] = categoryActionTarget.soldOutSchedule.endTime.split(':').map(Number);
                            const p = h >= 12 ? 'PM' : 'AM';
                            const h12 = h % 12 || 12;
                            return ` until ${h12}:${m.toString().padStart(2, '0')} ${p}`;
                          })()}
                        </Text>
                      )}
                    </View>
                  )}
                  {categoryActionTarget?.schedule?.enabled && categoryActionTarget?.isPaused && !categoryActionTarget?.isSoldOut && (
                    <View style={styles.categoryActionBadgeScheduled}>
                      <Ionicons name="time-outline" size={12} color="#6366f1" />
                      <Text style={styles.categoryActionBadgeScheduledText}>Scheduled</Text>
                    </View>
                  )}
                </View>
              </View>
              <TouchableOpacity 
                style={styles.categoryActionCloseBtn}
                onPress={() => setShowCategoryActionModal(false)}
              >
                <Ionicons name="close" size={22} color="#6b7280" />
              </TouchableOpacity>
            </View>

            {/* Actions */}
            <View style={styles.categoryActionList}>
              {/* Sold Out / Mark Available */}
              <TouchableOpacity 
                style={styles.categoryActionItem}
                onPress={() => {
                  setShowCategoryActionModal(false);
                  showSoldOutOptions(categoryActionTarget);
                }}
              >
                <View style={[styles.categoryActionIcon, { backgroundColor: categoryActionTarget?.isSoldOut ? '#dcfce7' : '#fef2f2' }]}>
                  <Ionicons 
                    name={categoryActionTarget?.isSoldOut ? 'checkmark-circle-outline' : 'close-circle-outline'} 
                    size={22} 
                    color={categoryActionTarget?.isSoldOut ? '#22c55e' : '#ef4444'} 
                  />
                </View>
                <View style={styles.categoryActionItemText}>
                  <Text style={styles.categoryActionItemTitle}>
                    {categoryActionTarget?.isSoldOut ? 'Mark Available' : 'Mark Sold Out'}
                  </Text>
                  <Text style={styles.categoryActionItemDesc}>
                    {categoryActionTarget?.isSoldOut ? 'Make category available for orders' : 'Temporarily mark as sold out'}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color="#9ca3af" />
              </TouchableOpacity>

              {/* Schedule */}
              <TouchableOpacity 
                style={styles.categoryActionItem}
                onPress={() => {
                  setShowCategoryActionModal(false);
                  openScheduleModal(categoryActionTarget);
                }}
              >
                <View style={[styles.categoryActionIcon, { backgroundColor: '#f0f9ff' }]}>
                  <Ionicons name="time-outline" size={22} color="#0ea5e9" />
                </View>
                <View style={styles.categoryActionItemText}>
                  <Text style={styles.categoryActionItemTitle}>Schedule</Text>
                  <Text style={styles.categoryActionItemDesc}>Set availability time slots</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color="#9ca3af" />
              </TouchableOpacity>

              {/* Edit */}
              <TouchableOpacity 
                style={styles.categoryActionItem}
                onPress={() => {
                  setShowCategoryActionModal(false);
                  openCategoryModal(categoryActionTarget);
                }}
              >
                <View style={[styles.categoryActionIcon, { backgroundColor: '#fef3c7' }]}>
                  <Ionicons name="create-outline" size={22} color="#f59e0b" />
                </View>
                <View style={styles.categoryActionItemText}>
                  <Text style={styles.categoryActionItemTitle}>Edit Category</Text>
                  <Text style={styles.categoryActionItemDesc}>Change name or image</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color="#9ca3af" />
              </TouchableOpacity>

              {/* Delete */}
              <TouchableOpacity 
                style={[styles.categoryActionItem, styles.categoryActionItemDanger]}
                onPress={() => {
                  setShowCategoryActionModal(false);
                  deleteCategory(categoryActionTarget);
                }}
              >
                <View style={[styles.categoryActionIcon, { backgroundColor: '#fef2f2' }]}>
                  <Ionicons name="trash-outline" size={22} color="#ef4444" />
                </View>
                <View style={styles.categoryActionItemText}>
                  <Text style={[styles.categoryActionItemTitle, { color: '#ef4444' }]}>Delete Category</Text>
                  <Text style={styles.categoryActionItemDesc}>Remove this category permanently</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color="#fca5a5" />
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Sold Out Schedule Modal */}
      <Modal
        visible={showSoldOutModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowSoldOutModal(false)}
      >
        <View style={styles.soldOutModalOverlay}>
          <View style={styles.soldOutModalContent}>
            <View style={styles.soldOutModalHeader}>
              <Text style={styles.soldOutModalTitle}>Schedule Sold Out</Text>
              <TouchableOpacity onPress={() => setShowSoldOutModal(false)} style={styles.soldOutCloseButton}>
                <Ionicons name="close" size={24} color="#6b7280" />
              </TouchableOpacity>
            </View>
            
            <View style={styles.soldOutModalBody}>
              <Text style={styles.soldOutCategoryName}>{soldOutCategory?.name}</Text>
              <Text style={styles.soldOutDescription}>
                Mark this category as sold out until a specific time. All items will be marked unavailable.
              </Text>
              
              <View style={styles.soldOutTimeSection}>
                <Text style={styles.soldOutTimeLabel}>Available again at:</Text>
                <TouchableOpacity
                  style={styles.nativeTimePickerButton}
                  onPress={() => openNativeTimePicker('soldOutEndTime')}
                  activeOpacity={0.7}
                >
                  <Ionicons name="time-outline" size={20} color={ZOMATO_RED} />
                  <Text style={styles.nativeTimePickerText}>{formatTime12(soldOutEndTime)}</Text>
                  <Ionicons name="chevron-down" size={16} color="#9CA3AF" />
                </TouchableOpacity>
              </View>
            </View>
            
            <View style={styles.soldOutModalFooter}>
              <TouchableOpacity 
                style={styles.soldOutCancelButton} 
                onPress={() => setShowSoldOutModal(false)}
              >
                <Text style={styles.soldOutCancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.soldOutSaveButton, savingCategory && styles.soldOutSaveButtonDisabled]} 
                onPress={saveSoldOutSchedule}
                disabled={savingCategory}
              >
                {savingCategory ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.soldOutSaveButtonText}>Mark Sold Out</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Item Schedule Modal */}
      <Modal
        visible={showItemSoldOutModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowItemSoldOutModal(false)}
      >
        <View style={styles.soldOutModalOverlay}>
          <View style={[styles.soldOutModalContent, { maxHeight: '85%' }]}>
            <View style={styles.soldOutModalHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                {scheduleType && (
                  <TouchableOpacity onPress={() => setScheduleType(null)} style={{ marginRight: 10 }}>
                    <Ionicons name="arrow-back" size={22} color="#1f2937" />
                  </TouchableOpacity>
                )}
                <Text style={styles.soldOutModalTitle}>
                  {!scheduleType ? 'Schedule Type' : scheduleType === 'daily' ? 'Daily Schedule' : 'Custom Schedule'}
                </Text>
              </View>
              <TouchableOpacity onPress={() => setShowItemSoldOutModal(false)} style={styles.soldOutCloseButton}>
                <Ionicons name="close" size={24} color="#6b7280" />
              </TouchableOpacity>
            </View>
            
            <ScrollView style={{ flexShrink: 1 }} showsVerticalScrollIndicator={false}>
              <View style={styles.soldOutModalBody}>
                <Text style={styles.soldOutCategoryName}>{soldOutItem?.name}</Text>

                {/* ─── Step 1: Choose schedule type ─── */}
                {!scheduleType && (
                  <View>
                    <Text style={styles.soldOutDescription}>
                      Choose how you want to schedule sold-out times for this item.
                    </Text>
                    <TouchableOpacity
                      activeOpacity={0.7}
                      onPress={() => setScheduleType('daily')}
                      style={{
                        flexDirection: 'row', alignItems: 'center', padding: 18, borderRadius: 16,
                        backgroundColor: '#F0F9FF', borderWidth: 1.5, borderColor: '#BAE6FD', marginBottom: 12,
                      }}
                    >
                      <View style={{
                        width: 48, height: 48, borderRadius: 14, backgroundColor: '#DBEAFE',
                        justifyContent: 'center', alignItems: 'center', marginRight: 14,
                      }}>
                        <Ionicons name="time-outline" size={24} color="#2563EB" />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 16, fontWeight: '700', color: '#1f2937' }}>Daily Schedule</Text>
                        <Text style={{ fontSize: 13, color: '#6b7280', marginTop: 3 }}>
                          Set one time — applies to all days
                        </Text>
                      </View>
                      <Ionicons name="chevron-forward" size={20} color="#9ca3af" />
                    </TouchableOpacity>
                    <TouchableOpacity
                      activeOpacity={0.7}
                      onPress={() => setScheduleType('custom')}
                      style={{
                        flexDirection: 'row', alignItems: 'center', padding: 18, borderRadius: 16,
                        backgroundColor: '#FFF7ED', borderWidth: 1.5, borderColor: '#FED7AA', marginBottom: 12,
                      }}
                    >
                      <View style={{
                        width: 48, height: 48, borderRadius: 14, backgroundColor: '#FFEDD5',
                        justifyContent: 'center', alignItems: 'center', marginRight: 14,
                      }}>
                        <Ionicons name="calendar-outline" size={24} color="#EA580C" />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 16, fontWeight: '700', color: '#1f2937' }}>Custom Schedule</Text>
                        <Text style={{ fontSize: 13, color: '#6b7280', marginTop: 3 }}>
                          Set different times for each day (Sun–Sat)
                        </Text>
                      </View>
                      <Ionicons name="chevron-forward" size={20} color="#9ca3af" />
                    </TouchableOpacity>

                    {/* Remove schedule option */}
                    {soldOutItem?.soldOutSchedule?.enabled && (
                      <TouchableOpacity
                        activeOpacity={0.7}
                        onPress={async () => {
                          try {
                            setSavingCategory(true);
                            await api.patch(`/menu/${soldOutItem._id}/schedule-soldout`, {
                              schedule: { type: 'daily', dailyStartTime: null, dailyEndTime: null, days: [] }
                            });
                            // Clear the enabled flag
                            await api.put(`/menu/${soldOutItem._id}`, { ...soldOutItem, soldOutSchedule: { enabled: false } });
                            setShowItemSoldOutModal(false);
                            fetchMenu();
                            Alert.alert('Success', 'Schedule removed');
                          } catch { Alert.alert('Error', 'Failed to remove schedule'); }
                          finally { setSavingCategory(false); }
                        }}
                        style={{
                          flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                          padding: 14, borderRadius: 12, backgroundColor: '#FEF2F2',
                          borderWidth: 1, borderColor: '#FECACA', marginTop: 4,
                        }}
                      >
                        <Ionicons name="trash-outline" size={18} color="#DC2626" style={{ marginRight: 8 }} />
                        <Text style={{ fontSize: 14, fontWeight: '600', color: '#DC2626' }}>Remove Schedule</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}

                {/* ─── Step 2a: Daily Schedule ─── */}
                {scheduleType === 'daily' && (
                  <View>
                    <Text style={styles.soldOutDescription}>
                      Item will be available only during this time window. Outside this time, it will be sold out.
                    </Text>

                    {/* Start Time */}
                    <Text style={{ fontSize: 14, fontWeight: '700', color: '#374151', marginBottom: 10 }}>
                      Available from:
                    </Text>
                    <TouchableOpacity
                      style={styles.nativeTimePickerButton}
                      onPress={() => openNativeTimePicker('dailyStartTime')}
                      activeOpacity={0.7}
                    >
                      <Ionicons name="time-outline" size={20} color={ZOMATO_RED} />
                      <Text style={styles.nativeTimePickerText}>{formatTime12(dailyStartTime)}</Text>
                      <Ionicons name="chevron-down" size={16} color="#9CA3AF" />
                    </TouchableOpacity>

                    {/* End Time */}
                    <Text style={{ fontSize: 14, fontWeight: '700', color: '#374151', marginTop: 20, marginBottom: 10 }}>
                      Available until:
                    </Text>
                    <TouchableOpacity
                      style={styles.nativeTimePickerButton}
                      onPress={() => openNativeTimePicker('dailyEndTime')}
                      activeOpacity={0.7}
                    >
                      <Ionicons name="time-outline" size={20} color={ZOMATO_RED} />
                      <Text style={styles.nativeTimePickerText}>{formatTime12(dailyEndTime)}</Text>
                      <Ionicons name="chevron-down" size={16} color="#9CA3AF" />
                    </TouchableOpacity>

                    {/* Preview */}
                    <View style={{
                      marginTop: 20, padding: 14, borderRadius: 12,
                      backgroundColor: '#FFF7ED', borderWidth: 1, borderColor: '#FED7AA',
                    }}>
                      <Text style={{ fontSize: 13, fontWeight: '600', color: '#92400E' }}>
                        ✅ Available daily: {formatTime12(dailyStartTime)} – {formatTime12(dailyEndTime)}
                        {"\n"}🚫 Sold out outside this window
                      </Text>
                    </View>
                  </View>
                )}

                {/* ─── Step 2b: Custom Schedule ─── */}
                {scheduleType === 'custom' && (
                  <View>
                    <Text style={styles.soldOutDescription}>
                      Enable specific days and set available times for each. Item will be sold out outside these times.
                    </Text>
                    {customDays.map((dayItem, dIdx) => (
                      <View key={dayItem.day} style={{
                        marginBottom: 10, borderRadius: 14, overflow: 'hidden',
                        borderWidth: 1.5, borderColor: dayItem.enabled ? '#BBF7D0' : '#E5E7EB',
                        backgroundColor: dayItem.enabled ? '#F0FDF4' : '#F9FAFB',
                      }}>
                        {/* Day header row */}
                        <TouchableOpacity
                          activeOpacity={0.7}
                          onPress={() => updateCustomDay(dIdx, 'enabled', !dayItem.enabled)}
                          style={{
                            flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                            paddingHorizontal: 16, paddingVertical: 14,
                          }}
                        >
                          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <View style={{
                              width: 36, height: 36, borderRadius: 10,
                              backgroundColor: dayItem.enabled ? '#DCFCE7' : '#F3F4F6',
                              justifyContent: 'center', alignItems: 'center', marginRight: 12,
                            }}>
                              <Text style={{
                                fontSize: 13, fontWeight: '800',
                                color: dayItem.enabled ? '#16A34A' : '#9CA3AF',
                              }}>{dayItem.day}</Text>
                            </View>
                            <Text style={{
                              fontSize: 15, fontWeight: '600',
                              color: dayItem.enabled ? '#1f2937' : '#9ca3af',
                            }}>
                              {dayItem.day === 'Sun' ? 'Sunday' : dayItem.day === 'Mon' ? 'Monday' :
                               dayItem.day === 'Tue' ? 'Tuesday' : dayItem.day === 'Wed' ? 'Wednesday' :
                               dayItem.day === 'Thu' ? 'Thursday' : dayItem.day === 'Fri' ? 'Friday' : 'Saturday'}
                            </Text>
                          </View>
                          <View style={{
                            width: 44, height: 26, borderRadius: 13,
                            backgroundColor: dayItem.enabled ? '#22C55E' : '#D1D5DB',
                            justifyContent: 'center',
                            paddingHorizontal: 2,
                          }}>
                            <View style={{
                              width: 22, height: 22, borderRadius: 11,
                              backgroundColor: '#fff',
                              alignSelf: dayItem.enabled ? 'flex-end' : 'flex-start',
                              shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
                              shadowOpacity: 0.15, shadowRadius: 2, elevation: 2,
                            }} />
                          </View>
                        </TouchableOpacity>

                        {/* Time pickers (collapsed if disabled) */}
                        {dayItem.enabled && (
                          <View style={{
                            flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                            paddingHorizontal: 16, paddingBottom: 14, gap: 10,
                          }}>
                            {/* Start time */}
                            <View style={{ alignItems: 'center', flex: 1 }}>
                              <Text style={{ fontSize: 10, fontWeight: '600', color: '#6b7280', marginBottom: 4 }}>FROM</Text>
                              <TouchableOpacity
                                onPress={() => openNativeTimePicker('customStartTime', dIdx)}
                                style={[styles.nativeTimePickerButton, { width: '100%' }]}
                              >
                                <Ionicons name="time-outline" size={20} color={ZOMATO_RED} />
                                <Text style={styles.nativeTimePickerText}>{formatTime12(dayItem.startTime)}</Text>
                              </TouchableOpacity>
                            </View>
                            <Text style={{ fontSize: 14, color: '#9ca3af', fontWeight: '600', marginTop: 14 }}>→</Text>
                            {/* End time */}
                            <View style={{ alignItems: 'center', flex: 1 }}>
                              <Text style={{ fontSize: 10, fontWeight: '600', color: '#6b7280', marginBottom: 4 }}>TO</Text>
                              <TouchableOpacity
                                onPress={() => openNativeTimePicker('customEndTime', dIdx)}
                                style={[styles.nativeTimePickerButton, { width: '100%' }]}
                              >
                                <Ionicons name="time-outline" size={20} color={ZOMATO_RED} />
                                <Text style={styles.nativeTimePickerText}>{formatTime12(dayItem.endTime)}</Text>
                              </TouchableOpacity>
                            </View>
                          </View>
                        )}
                      </View>
                    ))}
                  </View>
                )}
              </View>
            </ScrollView>

            {/* Footer — only show on daily/custom step */}
            {scheduleType && (
              <View style={styles.soldOutModalFooter}>
                <TouchableOpacity 
                  style={styles.soldOutCancelButton} 
                  onPress={() => setShowItemSoldOutModal(false)}
                >
                  <Text style={styles.soldOutCancelButtonText}>Cancel</Text>
                </TouchableOpacity>
                {(() => {
                  // Lock Save Schedule until the schedule actually has a
                  // day to be saved against. Daily mode is always valid (it
                  // just needs the start/end time), Custom mode needs at
                  // least one weekday toggled on.
                  const customNeedsDay = scheduleType === 'custom' && !customDays.some(d => d.enabled);
                  const saveDisabled = savingCategory || customNeedsDay;
                  return (
                    <TouchableOpacity 
                      style={[styles.soldOutSaveButton, saveDisabled && styles.soldOutSaveButtonDisabled]} 
                      onPress={saveItemSoldOutSchedule}
                      disabled={saveDisabled}
                    >
                      {savingCategory ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <Text style={styles.soldOutSaveButtonText}>
                          {customNeedsDay ? 'Enable a day to save' : 'Save Schedule'}
                        </Text>
                      )}
                    </TouchableOpacity>
                  );
                })()}
              </View>
            )}
          </View>
        </View>
      </Modal>

      {/* Quantity Toggle Modal */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={showQtyModal}
        onRequestClose={() => setShowQtyModal(false)}
      >
        <View style={styles.soldOutModalOverlay}>
          <View style={styles.soldOutModalContent}>
            {/* Header */}
            <View style={styles.soldOutModalHeader}>
              <Text style={styles.soldOutModalTitle}>Manage Sizes</Text>
              <TouchableOpacity onPress={() => setShowQtyModal(false)} style={styles.soldOutCloseButton}>
                <Ionicons name="close" size={24} color="#6b7280" />
              </TouchableOpacity>
            </View>

            <View style={styles.soldOutModalBody}>
              {/* Item name */}
              <Text style={styles.soldOutCategoryName}>{qtyModalItem?.name}</Text>
              <Text style={styles.soldOutDescription}>
                Toggle availability for individual sizes. Customers won't be able to order sizes marked as Off.
              </Text>

              {/* Quantity option rows */}
              {qtyModalItem?.quantities?.map((q, qIdx) => {
                const qAvail = q.available !== false;
                return (
                  <TouchableOpacity
                    key={qIdx}
                    activeOpacity={0.7}
                    onPress={() => toggleQuantityAvailability(qtyModalItem, qIdx)}
                    style={{
                      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                      paddingVertical: 16, paddingHorizontal: 18,
                      marginBottom: 10, borderRadius: 16,
                      backgroundColor: qAvail ? '#F0FDF4' : '#FEF2F2',
                      borderWidth: 1.5, borderColor: qAvail ? '#BBF7D0' : '#FECACA',
                    }}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                      <View style={{
                        width: 40, height: 40, borderRadius: 12,
                        backgroundColor: qAvail ? '#DCFCE7' : '#FEE2E2',
                        justifyContent: 'center', alignItems: 'center', marginRight: 14,
                      }}>
                        <Ionicons
                          name={qAvail ? 'checkmark-circle' : 'close-circle'}
                          size={22}
                          color={qAvail ? '#22C55E' : '#EF4444'}
                        />
                      </View>
                      <View>
                        <Text style={{ fontSize: 16, fontWeight: '700', color: '#1f2937' }}>
                          {q.quantity} {q.unit}
                        </Text>
                        <Text style={{ fontSize: 14, color: '#6b7280', marginTop: 2, fontWeight: '500' }}>
                          ₹{q.price}{q.offerPrice ? ` (Offer: ₹${q.offerPrice})` : ''}
                        </Text>
                      </View>
                    </View>
                    <View style={{
                      paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20,
                      backgroundColor: qAvail ? '#22C55E' : '#EF4444',
                      shadowColor: qAvail ? '#22C55E' : '#EF4444',
                      shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 4,
                      elevation: 3,
                    }}>
                      <Text style={{ fontSize: 12, fontWeight: '800', color: '#fff', letterSpacing: 0.5 }}>
                        {qAvail ? 'Active' : 'Off'}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}

              {/* Toggle All button */}
              {qtyModalItem?.quantities?.length > 1 && (
                <TouchableOpacity
                  activeOpacity={0.7}
                  onPress={() => {
                    if (!qtyModalItem?.quantities) return;
                    const allAvail = qtyModalItem.quantities.every(q => q.available !== false);
                    qtyModalItem.quantities.forEach((_, qIdx) => {
                      const isAvail = qtyModalItem.quantities[qIdx].available !== false;
                      if (allAvail ? isAvail : !isAvail) {
                        toggleQuantityAvailability(qtyModalItem, qIdx);
                      }
                    });
                  }}
                  style={{
                    marginTop: 14, paddingVertical: 16, borderRadius: 16,
                    alignItems: 'center', justifyContent: 'center', flexDirection: 'row',
                    backgroundColor: qtyModalItem?.quantities?.every(q => q.available !== false) ? '#FEF2F2' : '#F0FDF4',
                    borderWidth: 1.5,
                    borderColor: qtyModalItem?.quantities?.every(q => q.available !== false) ? '#FECACA' : '#BBF7D0',
                  }}
                >
                  <Ionicons
                    name={qtyModalItem?.quantities?.every(q => q.available !== false) ? 'pause-circle' : 'play-circle'}
                    size={20}
                    color={qtyModalItem?.quantities?.every(q => q.available !== false) ? '#EF4444' : '#22C55E'}
                    style={{ marginRight: 8 }}
                  />
                  <Text style={{
                    fontSize: 15, fontWeight: '700',
                    color: qtyModalItem?.quantities?.every(q => q.available !== false) ? '#DC2626' : '#16A34A',
                  }}>
                    {qtyModalItem?.quantities?.every(q => q.available !== false) ? 'Turn Off All Sizes' : 'Turn On All Sizes'}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </View>
      </Modal>
      {/* Native Time Picker */}
      {nativeTimePicker.visible && (
        <DateTimePicker
          value={getNativeTimePickerValue()}
          mode="time"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={onNativeTimeChange}
          is24Hour={false}
        />
      )}
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
  categoryNameSoldOut: {
    color: '#ef4444',
    fontWeight: '600',
  },
  categoryImageWrapperSoldOut: {
    borderColor: '#ef4444',
    borderWidth: 2,
  },
  categoryImageSoldOut: {
    opacity: 0.5,
  },
  categorySoldOutOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(239, 68, 68, 0.7)',
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
  },
  soldOutBadge: {
    backgroundColor: '#fff',
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 4,
  },
  soldOutBadgeText: {
    fontSize: 7,
    fontWeight: '800',
    color: '#ef4444',
    letterSpacing: 0.5,
  },
  categoryTimeoutText: {
    fontSize: 9,
    color: '#ef4444',
    fontWeight: '500',
    marginTop: 2,
  },
  categoryScheduleText: {
    fontSize: 9,
    color: '#6366f1',
    fontWeight: '500',
    marginTop: 2,
  },
  categoryScheduleActiveText: {
    color: '#22c55e',
  },
  categoryImageWrapperScheduled: {
    borderColor: '#6366f1',
    borderWidth: 2,
  },
  categoryScheduledOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(99, 102, 241, 0.7)',
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scheduledBadge: {
    backgroundColor: '#4f46e5',
    padding: 6,
    borderRadius: 20,
  },
  categoryNameScheduled: {
    color: '#6366f1',
    fontWeight: '600',
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
  itemCardScheduled: { backgroundColor: '#EEF2FF', borderWidth: 2, borderColor: '#C7D2FE' },
  itemCardOutOfStock: { backgroundColor: '#FEE2E2', borderWidth: 2, borderColor: '#FCA5A5' },

  // Section header (parent item title row)
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginTop: 16,
    marginBottom: 4,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 2,
  },
  sectionHeaderImage: {
    width: 36,
    height: 36,
    borderRadius: 10,
    marginRight: 10,
  },
  sectionHeaderTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1f2937',
    flex: 1,
  },
  sectionSoldOutBadge: {
    backgroundColor: '#FEE2E2',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    marginRight: 6,
  },
  sectionSoldOutText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#DC2626',
    letterSpacing: 0.5,
  },
  itemImageContainer: { position: 'relative' },
  itemImage: { width: 90, height: 90, borderRadius: 16 },
  itemImagePaused: { opacity: 0.6 },
  itemLockOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(99, 102, 241, 0.5)',
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  itemLockBadge: {
    backgroundColor: '#4f46e5',
    padding: 8,
    borderRadius: 20,
  },
  scheduledStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EEF2FF',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#C7D2FE',
    gap: 4,
  },
  scheduledStatusText: {
    fontSize: 10,
    color: '#6366f1',
    fontWeight: '600',
  },
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
  variantCountRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  variantCountText: { fontSize: 11, color: '#8b5cf6', fontWeight: '600' },
  variantSection: {
    backgroundColor: '#fafafa',
    borderRadius: 16,
    marginBottom: 14,
    marginTop: -6,
    padding: 14,
    borderWidth: 1,
    borderColor: '#f0f0f0',
  },
  variantSectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#6b7280',
    marginBottom: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  variantCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#f0f0f0',
  },
  variantCardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  variantThumb: {
    width: 44,
    height: 44,
    borderRadius: 10,
  },
  variantThumbPlaceholder: {
    backgroundColor: '#f5f5f5',
    justifyContent: 'center',
    alignItems: 'center',
  },
  variantCardInfo: {
    marginLeft: 10,
    flex: 1,
  },
  variantCardName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1C1C1C',
  },
  variantCardFoodType: {
    fontSize: 11,
    marginTop: 2,
  },
  variantCardPrice: {
    fontSize: 13,
    fontWeight: '700',
    color: ZOMATO_RED,
    marginTop: 4,
  },
  variantQtyRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 4,
  },
  variantQtyChip: {
    backgroundColor: '#f3f4f6',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  variantQtyText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#4b5563',
  },
  variantActionColumn: {
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
    gap: 6,
  },
  variantAvailBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  variantDeleteBtn: {
    padding: 4,
    borderRadius: 6,
    backgroundColor: '#FEE2E2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 },
  priceContainer: { flexDirection: 'row', alignItems: 'center' },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  itemPrice: { fontSize: 20, fontWeight: '800', color: ZOMATO_RED },
  originalPrice: { fontSize: 16, fontWeight: '500', color: '#9CA3AF', textDecorationLine: 'line-through' },
  offerPrice: { fontSize: 20, fontWeight: '800', color: '#22C55E' },
  pricePaused: { color: '#9CA3AF' },
  availabilityToggle: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, minWidth: 80, alignItems: 'center' },
  availabilityText: { fontSize: 12, fontWeight: '700' },
  pausedStatusBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, backgroundColor: '#FEE2E2', maxWidth: 100 },
  pausedStatusText: { fontSize: 10, fontWeight: '700', color: '#ef4444' },
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

  // Sold Out Modal Styles
  soldOutModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  soldOutModalContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '70%',
  },
  soldOutModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  soldOutModalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1C1C1C',
  },
  soldOutCloseButton: {
    padding: 4,
  },
  soldOutModalBody: {
    padding: 24,
  },
  soldOutCategoryName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#ef4444',
    marginBottom: 8,
  },
  soldOutDescription: {
    fontSize: 14,
    color: '#6b7280',
    lineHeight: 20,
    marginBottom: 24,
  },
  soldOutTimeSection: {
    backgroundColor: '#f9fafb',
    borderRadius: 16,
    padding: 20,
  },
  soldOutTimeLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 16,
    textAlign: 'center',
  },
  soldOutTimePicker: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  soldOutTimeUnit: {
    alignItems: 'center',
  },
  soldOutTimeButton: {
    padding: 8,
  },
  soldOutTimeValue: {
    fontSize: 32,
    fontWeight: '700',
    color: '#1C1C1C',
    minWidth: 50,
    textAlign: 'center',
  },
  soldOutTimeSeparator: {
    fontSize: 32,
    fontWeight: '700',
    color: '#1C1C1C',
    marginHorizontal: 4,
  },
  soldOutAmPmButton: {
    backgroundColor: ZOMATO_RED,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    marginLeft: 12,
  },
  soldOutAmPmText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
  soldOutModalFooter: {
    flexDirection: 'row',
    padding: 24,
    paddingTop: 16,
    paddingBottom: Platform.OS === 'ios' ? 34 : 24,
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
  },
  soldOutCancelButton: {
    flex: 1,
    height: 54,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f3f4f6',
  },
  soldOutCancelButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#6b7280',
  },
  soldOutSaveButton: {
    flex: 1,
    height: 54,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#ef4444',
    shadowColor: '#ef4444',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  soldOutSaveButtonDisabled: {
    opacity: 0.7,
  },
  soldOutSaveButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
  // Title Filter
  titleFilterContainer: {
    backgroundColor: '#fff',
    paddingTop: 12,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  titleFilterLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#9ca3af',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingHorizontal: 20,
    marginBottom: 10,
  },
  titleFilterList: {
    paddingHorizontal: 16,
    gap: 14,
  },
  titleFilterItem: {
    alignItems: 'center',
    width: 80,
  },
  titleImageWrapper: {
    width: 64,
    height: 64,
    borderRadius: 16,
    backgroundColor: '#F5F5F5',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
    borderWidth: 2.5,
    borderColor: 'transparent',
  },
  titleImageWrapperActive: {
    borderColor: ZOMATO_RED,
    shadowColor: ZOMATO_RED,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 4,
  },
  titleImage: {
    width: '100%',
    height: '100%',
    borderRadius: 14,
  },
  titlePlaceholder: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F5F5F5',
  },
  titleAllIcon: {
    width: '100%',
    height: '100%',
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  titleAllText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#fff',
    marginTop: 2,
  },
  titleName: {
    fontSize: 11,
    color: '#696969',
    fontWeight: '600',
    marginTop: 6,
    textAlign: 'center',
  },
  titleNameActive: {
    color: ZOMATO_RED,
    fontWeight: '700',
  },
  titleVariantCount: {
    fontSize: 9,
    color: '#9ca3af',
    fontWeight: '500',
    marginTop: 2,
  },
  titleUnderline: {
    width: 24,
    height: 3,
    backgroundColor: ZOMATO_RED,
    borderRadius: 1.5,
    marginTop: 4,
  },

  // Category Action Modal Styles
  categoryActionOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  categoryActionContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingBottom: Platform.OS === 'ios' ? 34 : 20,
    maxHeight: '70%',
  },
  categoryActionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  categoryActionHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  categoryActionImage: {
    width: 48,
    height: 48,
    borderRadius: 12,
  },
  categoryActionImagePlaceholder: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: '#f3f4f6',
    justifyContent: 'center',
    alignItems: 'center',
  },
  categoryActionHeaderText: {
    marginLeft: 12,
    flex: 1,
  },
  categoryActionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1f2937',
  },
  categoryActionBadgeSoldOut: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  categoryActionBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#ef4444',
    backgroundColor: '#fef2f2',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  categoryActionBadgeTime: {
    fontSize: 11,
    color: '#9ca3af',
    marginLeft: 4,
  },
  categoryActionBadgeScheduled: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    backgroundColor: '#eef2ff',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    alignSelf: 'flex-start',
  },
  categoryActionBadgeScheduledText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#6366f1',
    marginLeft: 4,
  },
  categoryActionCloseBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#f3f4f6',
    justifyContent: 'center',
    alignItems: 'center',
  },
  categoryActionList: {
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  categoryActionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  categoryActionItemDanger: {
    borderBottomWidth: 0,
  },
  categoryActionIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  categoryActionItemText: {
    flex: 1,
    marginLeft: 14,
  },
  categoryActionItemTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1f2937',
  },
  categoryActionItemDesc: {
    fontSize: 12,
    color: '#9ca3af',
    marginTop: 2,
  },
  nativeTimePickerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    minWidth: 140,
    borderWidth: 1.5,
    borderColor: '#E5E7EB',
  },
  nativeTimePickerText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1f2937',
  },
});
