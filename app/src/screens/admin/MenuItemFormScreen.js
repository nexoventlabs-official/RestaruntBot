import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput,
  TouchableOpacity, Image, Alert, ActivityIndicator, Switch, Modal, FlatList,
  Animated, Platform, KeyboardAvoidingView, StatusBar, LayoutAnimation, UIManager, Dimensions
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import api from '../../config/api';

// Enable LayoutAnimation on Android
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const { width: SCREEN_WIDTH } = Dimensions.get('window');

let _variantIdCounter = Date.now();

// Zomato Theme Colors
const ZOMATO_RED = '#E23744';
const ZOMATO_DARK_RED = '#CB1A27';

const FOOD_TYPES = [
  { value: 'veg', label: 'Veg', color: '#22C55E', icon: 'leaf' },
  { value: 'nonveg', label: 'Non-Veg', color: '#EF4444', icon: 'flame' },
  { value: 'egg', label: 'Egg', color: '#F59E0B', icon: 'egg' },
];

const UNITS = ['piece', 'plate', 'bowl', 'cup', 'slice', 'full', 'half', 'small', 'kg', 'gram', 'liter', 'ml', 'inch'];

export default function MenuItemFormScreen({ route, navigation }) {
  const existingItem = route.params?.item;
  const isEditing = !!existingItem;

  const [name, setName] = useState(existingItem?.name || '');
  const [description, setDescription] = useState(existingItem?.description || '');
  const [price, setPrice] = useState(existingItem?.price?.toString() || '');
  const [selectedCategories, setSelectedCategories] = useState(
    Array.isArray(existingItem?.category) ? existingItem.category : (existingItem?.category ? [existingItem.category] : [])
  );
  const [unit, setUnit] = useState(existingItem?.unit || 'piece');
  const [quantity, setQuantity] = useState(existingItem?.quantity?.toString() || '1');
  const [foodType, setFoodType] = useState(existingItem?.foodType || 'veg');
  const [available, setAvailable] = useState(existingItem?.available !== false);
  const [preparationTime, setPreparationTime] = useState(existingItem?.preparationTime?.toString() || '15');
  const [tags, setTags] = useState(existingItem?.tags?.join(', ') || '');
  const [image, setImage] = useState(existingItem?.image || null);
  const [newImage, setNewImage] = useState(null);
  const [loading, setLoading] = useState(false);
  const [pickingImage, setPickingImage] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [tagsAiLoading, setTagsAiLoading] = useState(false);
  
  // Variants state - enhanced with description, foodType, tags, quantities
  // Each variant gets a stable _uid to prevent re-ordering on re-render
  const [variants, setVariants] = useState(
    existingItem?.variants?.map((v, i) => ({ 
      ...v, 
      _uid: `existing_${v._id || i}_${Date.now()}`,
      price: v.price?.toString() || '', 
      quantity: v.quantity?.toString() || '1', 
      unit: v.unit || 'piece', 
      description: v.description || '',
      foodType: v.foodType || 'veg',
      tags: v.tags?.join(', ') || '',
      quantities: v.quantities?.map(q => ({ 
        quantity: q.quantity?.toString() || '1', 
        unit: q.unit || 'piece', 
        price: q.price?.toString() || '', 
        offerPrice: q.offerPrice?.toString() || '' 
      })) || [],
      newImageFile: null,
      _collapsed: true
    })) || []
  );
  
  const [categories, setCategories] = useState([]);
  const [offers, setOffers] = useState([]);
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  const [showUnitPicker, setShowUnitPicker] = useState(false);
  const [variantUnitPickerIndex, setVariantUnitPickerIndex] = useState(null);
  const [showVariantTypePicker, setShowVariantTypePicker] = useState(null); // index of variant being edited
  
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 400, useNativeDriver: true }),
    ]).start();
    fetchCategories();
    
    // Add listener to refresh when screen comes into focus
    const unsubscribe = navigation.addListener('focus', () => {
      fetchCategories();
    });
    
    return unsubscribe;
  }, [navigation]);

  const fetchCategories = async () => {
    try {
      const [catResponse, offerResponse] = await Promise.all([
        api.get('/categories'),
        api.get('/offers')
      ]);
      setCategories(catResponse.data || []);
      // Filter offers that have offerType
      const activeOffers = offerResponse.data?.filter(o => o.isActive && o.offerType && o.offerType.trim() !== '') || [];
      setOffers(activeOffers);
    } catch (error) {
      console.error('Error fetching data:', error);
    }
  };

  const pickImage = async () => {
    try {
      setPickingImage(true);
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.5, // Reduced from 0.8 for faster uploads
      });
      if (!result.canceled) {
        setNewImage(result.assets[0]);
        setImage(result.assets[0].uri);
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to pick image');
    } finally {
      setPickingImage(false);
    }
  };

  const removeImage = () => {
    setImage(null);
    setNewImage(null);
  };

  const generateDescription = async () => {
    if (!name.trim() || selectedCategories.length === 0) {
      Alert.alert('Required', 'Enter item name and select at least one category first');
      return;
    }
    setAiLoading(true);
    try {
      const response = await api.post('/ai/generate-description', { name, category: selectedCategories });
      setDescription(response.data.description);
    } catch (error) {
      Alert.alert('Error', 'Failed to generate description');
    } finally {
      setAiLoading(false);
    }
  };

  const generateTags = async () => {
    if (!name.trim() || selectedCategories.length === 0) {
      Alert.alert('Required', 'Enter item name and select at least one category first');
      return;
    }
    setTagsAiLoading(true);
    try {
      const response = await api.post('/ai/generate-tags', { 
        name, 
        category: selectedCategories,
        foodType,
        quantity: quantity || '1',
        unit: unit || 'piece'
      });
      setTags(response.data.tags);
    } catch (error) {
      Alert.alert('Error', 'Failed to generate tags');
    } finally {
      setTagsAiLoading(false);
    }
  };

  const toggleCategory = (categoryName) => {
    if (selectedCategories.includes(categoryName)) {
      setSelectedCategories(selectedCategories.filter(c => c !== categoryName));
    } else {
      setSelectedCategories([...selectedCategories, categoryName]);
    }
  };

  // ── Variant helpers ──
  const addVariant = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    _variantIdCounter++;
    setVariants([...variants, { 
      _uid: `new_${_variantIdCounter}`,
      label: '', variantType: 'size', price: '', quantity: '1', unit: 'piece',
      image: null, newImageFile: null, available: true,
      description: '', foodType: 'veg', tags: '',
      quantities: [],
      _collapsed: true
    }]);
  };

  const removeVariant = (index) => {
    Alert.alert('Remove Variant', `Remove "${variants[index]?.label || `Item ${index + 1}`}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        setVariants(variants.filter((_, i) => i !== index));
      }},
    ]);
  };

  const toggleVariantCollapse = (index) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    const updated = [...variants];
    updated[index] = { ...updated[index], _collapsed: !updated[index]._collapsed };
    setVariants(updated);
  };

  const updateVariant = (index, field, value) => {
    const updated = [...variants];
    updated[index] = { ...updated[index], [field]: value };
    setVariants(updated);
  };

  const pickVariantImage = async (index) => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.5,
      });
      if (!result.canceled) {
        const asset = result.assets[0];
        const updated = [...variants];
        updated[index] = { ...updated[index], image: asset.uri, newImageFile: asset };
        setVariants(updated);
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to pick variant image');
    }
  };

  const removeVariantImage = (index) => {
    const updated = [...variants];
    updated[index] = { ...updated[index], image: null, newImageFile: null };
    setVariants(updated);
  };

  // ── Quantity option helpers ──
  const addQuantityOption = (variantIndex) => {
    const updated = [...variants];
    const v = updated[variantIndex];
    updated[variantIndex] = {
      ...v,
      quantities: [...(v.quantities || []), { quantity: '1', unit: 'piece', price: '', offerPrice: '' }]
    };
    setVariants(updated);
  };

  const removeQuantityOption = (variantIndex, qtyIndex) => {
    const updated = [...variants];
    const v = updated[variantIndex];
    updated[variantIndex] = {
      ...v,
      quantities: v.quantities.filter((_, i) => i !== qtyIndex)
    };
    setVariants(updated);
  };

  const updateQuantityOption = (variantIndex, qtyIndex, field, value) => {
    const updated = [...variants];
    const v = updated[variantIndex];
    const qtys = [...(v.quantities || [])];
    qtys[qtyIndex] = { ...qtys[qtyIndex], [field]: value };
    updated[variantIndex] = { ...v, quantities: qtys };
    setVariants(updated);
  };

  // State for quantity unit picker: { variantIndex, qtyIndex }
  const [qtyUnitPicker, setQtyUnitPicker] = useState(null);

  // ── AI generate for variant description ──
  const generateVariantDescription = async (variantIndex) => {
    const v = variants[variantIndex];
    if (!v.label?.trim()) {
      Alert.alert('Required', 'Enter item name first');
      return;
    }
    // Set loading flag on the variant
    const updated = [...variants];
    updated[variantIndex] = { ...updated[variantIndex], _aiDescLoading: true };
    setVariants(updated);
    try {
      const response = await api.post('/ai/generate-description', { 
        name: v.label, 
        category: selectedCategories.length > 0 ? selectedCategories : [name || 'Food'] 
      });
      const updated2 = [...variants];
      updated2[variantIndex] = { ...updated2[variantIndex], description: response.data.description, _aiDescLoading: false };
      setVariants(updated2);
    } catch (error) {
      const updated2 = [...variants];
      updated2[variantIndex] = { ...updated2[variantIndex], _aiDescLoading: false };
      setVariants(updated2);
      Alert.alert('Error', 'Failed to generate description');
    }
  };

  // ── AI generate for variant tags ──
  const generateVariantTags = async (variantIndex) => {
    const v = variants[variantIndex];
    if (!v.label?.trim()) {
      Alert.alert('Required', 'Enter item name first');
      return;
    }
    const updated = [...variants];
    updated[variantIndex] = { ...updated[variantIndex], _aiTagsLoading: true };
    setVariants(updated);
    try {
      const response = await api.post('/ai/generate-tags', { 
        name: v.label, 
        category: selectedCategories.length > 0 ? selectedCategories : [name || 'Food'],
        foodType: v.foodType || 'veg',
        quantity: v.quantity || '1',
        unit: v.unit || 'piece'
      });
      const updated2 = [...variants];
      updated2[variantIndex] = { ...updated2[variantIndex], tags: response.data.tags, _aiTagsLoading: false };
      setVariants(updated2);
    } catch (error) {
      const updated2 = [...variants];
      updated2[variantIndex] = { ...updated2[variantIndex], _aiTagsLoading: false };
      setVariants(updated2);
      Alert.alert('Error', 'Failed to generate tags');
    }
  };

  const handleSubmit = async () => {
    // When variants exist, base price can be auto-derived
    const hasVariants = variants.length > 0;
    if (!name.trim()) {
      Alert.alert('Error', 'Please fill in the title / item name');
      return;
    }
    if (!hasVariants) {
      Alert.alert('Error', 'Please add at least one variant');
      return;
    }
    if (hasVariants) {
      // Validate: each variant needs a label and either a direct price or quantity options with prices
      for (let i = 0; i < variants.length; i++) {
        const v = variants[i];
        if (!v.label || v.label.trim() === '') {
          Alert.alert('Error', `Variant ${i + 1}: Item name is required`);
          return;
        }
        if (v.quantities && v.quantities.length > 0) {
          // Has quantity options - each needs a price
          const emptyQtyPrice = v.quantities.some(q => !q.price || q.price.toString().trim() === '' || parseFloat(q.price) <= 0);
          if (emptyQtyPrice) {
            Alert.alert('Error', `Variant ${i + 1}: Every quantity option must have a valid price`);
            return;
          }
        } else {
          // Single variant - needs a direct price
          if (!v.price || v.price.toString().trim() === '' || parseFloat(v.price) <= 0) {
            Alert.alert('Error', `Variant ${i + 1}: Price is required`);
            return;
          }
        }
      }
    }
    


    // Auto-trim whitespace from name and variant labels
    const trimmedName = name.trim();
    setName(trimmedName);
    const trimmedVariants = variants.map(v => ({ ...v, label: v.label?.trim() || '' }));
    setVariants(trimmedVariants);

    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('name', trimmedName);
      formData.append('description', description);
      // Auto-derive base price/qty/unit from variants
      const lowestPrice = Math.min(...trimmedVariants.map(v => {
        if (v.quantities && v.quantities.length > 0) {
          return Math.min(...v.quantities.map(q => parseFloat(q.price) || 0));
        }
        return parseFloat(v.price) || 0;
      }));
      formData.append('price', lowestPrice.toString());
      if (trimmedVariants[0].quantities && trimmedVariants[0].quantities.length > 0) {
        formData.append('quantity', trimmedVariants[0].quantities[0].quantity || '1');
        formData.append('unit', trimmedVariants[0].quantities[0].unit || 'piece');
      } else {
        formData.append('quantity', trimmedVariants[0].quantity || '1');
        formData.append('unit', trimmedVariants[0].unit || 'piece');
      }
      formData.append('category', JSON.stringify(selectedCategories));
      formData.append('foodType', foodType);
      formData.append('available', available.toString());
      formData.append('preparationTime', preparationTime);
      formData.append('tags', tags || '');

      if (newImage) {
        const filename = newImage.uri.split('/').pop();
        const match = /\.(\w+)$/.exec(filename);
        const type = match ? `image/${match[1]}` : 'image/jpeg';
        formData.append('image', { uri: newImage.uri, name: filename, type });
      } else if (!image && existingItem?.image) {
        formData.append('removeImage', 'true');
      }

      // ── Variants ──
      if (trimmedVariants.length > 0) {
        const variantsPayload = trimmedVariants.map(v => ({
          label: v.label,
          variantType: 'size',
          price: v.quantities?.length > 0 ? Math.min(...v.quantities.map(q => parseFloat(q.price) || 0)).toString() : v.price,
          quantity: v.quantity || '1',
          unit: v.unit || 'piece',
          available: v.available,
          description: v.description || '',
          foodType: v.foodType || 'veg',
          tags: v.tags || '',
          quantities: (v.quantities || []).map(q => ({
            quantity: q.quantity || '1',
            unit: q.unit || 'piece',
            price: q.price || '0',
            offerPrice: q.offerPrice || ''
          })),
          // keep existing image url if no new file picked
          image: v.newImageFile ? '' : (v.image || ''),
        }));
        formData.append('variants', JSON.stringify(variantsPayload));

        // Append new variant image files with index tracking
        const newImageIndices = [];
        trimmedVariants.forEach((v, index) => {
          if (v.newImageFile) {
            newImageIndices.push(index);
            const fname = v.newImageFile.uri.split('/').pop();
            const ext = /\.(\w+)$/.exec(fname);
            const mimeType = ext ? `image/${ext[1]}` : 'image/jpeg';
            formData.append('variantImages', { uri: v.newImageFile.uri, name: fname, type: mimeType });
          }
        });
        // Tell the backend which variant index each uploaded file belongs to
        formData.append('variantImageIndices', JSON.stringify(newImageIndices));
      } else {
        // Send empty array to clear variants if all removed
        formData.append('variants', JSON.stringify([]));
      }

      if (isEditing) {
        await api.put(`/menu/${existingItem._id}`, formData, { 
          headers: { 'Content-Type': 'multipart/form-data' },
          timeout: 90000 // 90 seconds for image uploads
        });
        Alert.alert('Success', 'Menu item updated');
      } else {
        await api.post('/menu', formData, { 
          headers: { 'Content-Type': 'multipart/form-data' },
          timeout: 90000 // 90 seconds for image uploads
        });
        Alert.alert('Success', 'Menu item created');
      }
      navigation.goBack();
    } catch (error) {
      console.error('Submit error:', error);
      let errorMessage = 'Failed to save item';
      
      if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
        errorMessage = 'Upload timed out. Please check your internet connection and try again.';
      } else if (error.response?.data?.error) {
        errorMessage = error.response.data.error;
      } else if (!error.response) {
        errorMessage = 'Network error. Please check your internet connection.';
      }
      
      Alert.alert('Error', errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />
      {/* Premium Header */}
      <Animated.View style={{ opacity: fadeAnim }}>
        <LinearGradient
          colors={[ZOMATO_RED, ZOMATO_DARK_RED]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.header}
        >
          <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
            <Ionicons name="arrow-back" size={24} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{isEditing ? 'Edit Item' : 'New Item'}</Text>
          <View style={{ width: 44 }} />
        </LinearGradient>
      </Animated.View>

      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
          <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>
            {/* Image Section */}
            <View style={styles.imageSection}>
              <TouchableOpacity 
                style={styles.imageContainer} 
                onPress={pickImage} 
                activeOpacity={0.8}
                disabled={pickingImage}
              >
                {image ? (
                  <Image source={{ uri: image }} style={styles.image} />
                ) : (
                  <View style={styles.imagePlaceholder}>
                    {pickingImage ? (
                      <>
                        <ActivityIndicator size="large" color={ZOMATO_RED} />
                        <Text style={styles.imagePlaceholderText}>Opening gallery...</Text>
                      </>
                    ) : (
                      <>
                        <View style={styles.imagePlaceholderIcon}>
                          <Ionicons name="camera-outline" size={32} color={ZOMATO_RED} />
                        </View>
                        <Text style={styles.imagePlaceholderText}>Add Photo</Text>
                        <Text style={styles.imagePlaceholderHint}>Tap to upload</Text>
                      </>
                    )}
                  </View>
                )}
                {pickingImage && image && (
                  <View style={styles.imageLoadingOverlay}>
                    <ActivityIndicator size="large" color="#fff" />
                  </View>
                )}
              </TouchableOpacity>
              {image && !pickingImage && (
                <TouchableOpacity style={styles.removeImageButton} onPress={removeImage}>
                  <Ionicons name="close-circle" size={32} color="#EF4444" />
                </TouchableOpacity>
              )}
            </View>

            <View style={styles.form}>
              {/* Title */}
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Title <Text style={styles.required}>*</Text></Text>
                <TextInput 
                  style={styles.input} 
                  value={name} 
                  onChangeText={setName} 
                  placeholder={variants.length > 0 ? "e.g., Biryani, Pizza" : "e.g., Margherita Pizza"}
                  placeholderTextColor="#9CA3AF"
                />
              </View>



              {/* ── Variants Section ── */}
              <View style={styles.variantsSection}>
                <View style={styles.variantsSectionHeader}>
                  <View style={styles.variantsTitleRow}>
                    <View style={styles.variantsIconContainer}>
                      <Ionicons name="layers-outline" size={20} color={ZOMATO_RED} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.variantsSectionTitle}>Item Variants</Text>
                      <Text style={styles.variantsSectionHint}>Add items with their own image, name, price & sizes</Text>
                    </View>
                  </View>
                  <TouchableOpacity style={styles.addVariantButton} onPress={addVariant} activeOpacity={0.7}>
                    <Ionicons name="add" size={18} color="#fff" />
                    <Text style={styles.addVariantButtonText}>Add</Text>
                  </TouchableOpacity>
                </View>

                {/* Variant count badge */}
                {variants.length > 0 && (
                  <View style={styles.variantCountRow}>
                    <View style={styles.variantCountBadge}>
                      <Text style={styles.variantCountText}>{variants.length} variant{variants.length !== 1 ? 's' : ''}</Text>
                    </View>
                    {variants.length > 1 && (
                      <TouchableOpacity 
                        style={styles.collapseAllButton}
                        onPress={() => {
                          LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                          const allCollapsed = variants.every(v => v._collapsed);
                          setVariants(variants.map(v => ({ ...v, _collapsed: !allCollapsed })));
                        }}
                      >
                        <Ionicons name={variants.every(v => v._collapsed) ? "chevron-down" : "chevron-up"} size={14} color="#6B7280" />
                        <Text style={styles.collapseAllText}>
                          {variants.every(v => v._collapsed) ? 'Expand All' : 'Collapse All'}
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}

                {variants.length === 0 && (
                  <TouchableOpacity style={styles.noVariantsContainer} onPress={addVariant} activeOpacity={0.7}>
                    <View style={styles.noVariantsIconCircle}>
                      <Ionicons name="add-circle-outline" size={32} color={ZOMATO_RED} />
                    </View>
                    <Text style={styles.noVariantsText}>No variants added yet</Text>
                    <Text style={styles.noVariantsHint}>Tap to add item variants (e.g., Chicken Biryani, Mutton Biryani)</Text>
                  </TouchableOpacity>
                )}

                {variants.map((variant, index) => (
                  <View key={variant._uid} style={[
                    styles.variantCard,
                    !variant.available && styles.variantCardDisabled,
                  ]}>
                    {/* Variant Header - always visible */}
                    <TouchableOpacity 
                      style={styles.variantCardHeader}
                      onPress={() => toggleVariantCollapse(index)}
                      activeOpacity={0.7}
                    >
                      <View style={styles.variantHeaderLeft}>
                        <View style={[styles.variantNumberBadge, !variant.available && { backgroundColor: '#F3F4F6' }]}>
                          <Text style={[styles.variantNumberText, !variant.available && { color: '#9CA3AF' }]}>{index + 1}</Text>
                        </View>
                        <View style={styles.variantHeaderInfo}>
                          <Text style={styles.variantCardTitle} numberOfLines={1}>
                            {variant.label || `Item ${index + 1}`}
                          </Text>
                          <View style={styles.variantHeaderMeta}>
                            {variant.image && <Ionicons name="image" size={11} color="#22C55E" />}
                            {variant.price ? (
                              <Text style={styles.variantHeaderPrice}>₹{variant.price}</Text>
                            ) : variant.quantities?.length > 0 ? (
                              <Text style={styles.variantHeaderPrice}>
                                {variant.quantities.length} size{variant.quantities.length !== 1 ? 's' : ''}
                              </Text>
                            ) : null}
                            <View style={[styles.variantFoodDot, { 
                              backgroundColor: variant.foodType === 'veg' ? '#22C55E' : variant.foodType === 'egg' ? '#F59E0B' : '#EF4444' 
                            }]} />
                            {!variant.available && (
                              <View style={styles.soldOutMini}>
                                <Text style={styles.soldOutMiniText}>Sold Out</Text>
                              </View>
                            )}
                          </View>
                        </View>
                      </View>
                      <View style={styles.variantHeaderRight}>
                        <TouchableOpacity 
                          onPress={() => removeVariant(index)}
                          style={styles.variantDeleteBtn}
                          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                        >
                          <Ionicons name="trash-outline" size={18} color="#EF4444" />
                        </TouchableOpacity>
                        <Ionicons 
                          name={variant._collapsed ? "chevron-down" : "chevron-up"} 
                          size={20} color="#9CA3AF" 
                        />
                      </View>
                    </TouchableOpacity>

                    {/* Collapsible Content */}
                    {!variant._collapsed && (
                      <View style={styles.variantCardBody}>
                        {/* Variant Image */}
                        <View style={styles.variantImageRow}>
                          <TouchableOpacity style={styles.variantImagePicker} onPress={() => pickVariantImage(index)} activeOpacity={0.7}>
                            {variant.image ? (
                              <Image source={{ uri: variant.image }} style={styles.variantImagePreview} />
                            ) : (
                              <View style={styles.variantImagePlaceholder}>
                                <Ionicons name="camera-outline" size={22} color={ZOMATO_RED} />
                              </View>
                            )}
                          </TouchableOpacity>
                          {variant.image ? (
                            <View style={styles.variantImageActions}>
                              <TouchableOpacity style={styles.variantImageChangeBtn} onPress={() => pickVariantImage(index)}>
                                <Ionicons name="swap-horizontal" size={14} color={ZOMATO_RED} />
                                <Text style={styles.variantImageChangeBtnText}>Change</Text>
                              </TouchableOpacity>
                              <TouchableOpacity style={styles.variantImageRemoveBtn} onPress={() => removeVariantImage(index)}>
                                <Ionicons name="close" size={14} color="#EF4444" />
                                <Text style={styles.variantImageRemoveBtnText}>Remove</Text>
                              </TouchableOpacity>
                            </View>
                          ) : (
                            <View style={styles.variantImageHintContainer}>
                              <Text style={styles.variantImageHintText}>Tap to add image</Text>
                              <Text style={styles.variantImageSubHint}>Square image recommended</Text>
                            </View>
                          )}
                        </View>

                        {/* Divider */}
                        <View style={styles.variantDivider} />

                        {/* Item Name (Label) */}
                        <View style={styles.variantField}>
                          <Text style={styles.variantFieldLabel}>Item Name <Text style={styles.required}>*</Text></Text>
                          <TextInput
                            style={styles.variantInput}
                            value={variant.label}
                            onChangeText={(val) => updateVariant(index, 'label', val)}
                            placeholder="e.g., Chicken Biryani"
                            placeholderTextColor="#C4C4C4"
                          />
                        </View>

                        {/* Description with AI */}
                        <View style={styles.variantField}>
                          <View style={styles.variantFieldLabelRow}>
                            <Text style={styles.variantFieldLabel}>Description</Text>
                            <TouchableOpacity 
                              style={styles.aiSmallButton}
                              onPress={() => generateVariantDescription(index)}
                              disabled={variant._aiDescLoading}
                              activeOpacity={0.7}
                            >
                              {variant._aiDescLoading ? (
                                <ActivityIndicator size="small" color="#8B5CF6" />
                              ) : (
                                <>
                                  <Ionicons name="sparkles" size={12} color="#8B5CF6" />
                                  <Text style={styles.aiSmallButtonText}>AI Generate</Text>
                                </>
                              )}
                            </TouchableOpacity>
                          </View>
                          <TextInput
                            style={[styles.variantInput, styles.variantTextArea]}
                            value={variant.description || ''}
                            onChangeText={(val) => updateVariant(index, 'description', val)}
                            placeholder="Describe this item..."
                            placeholderTextColor="#C4C4C4"
                            multiline
                            numberOfLines={2}
                          />
                        </View>

                        {/* Food Type */}
                        <View style={styles.variantField}>
                          <Text style={styles.variantFieldLabel}>Food Type</Text>
                          <View style={styles.variantFoodTypeRow}>
                            {FOOD_TYPES.map((type) => {
                              const isActive = variant.foodType === type.value;
                              return (
                                <TouchableOpacity
                                  key={type.value}
                                  style={[styles.variantFoodTypeBtn, isActive && { backgroundColor: type.color, borderColor: type.color }]}
                                  onPress={() => updateVariant(index, 'foodType', type.value)}
                                  activeOpacity={0.7}
                                >
                                  <View style={[styles.foodTypeIcon, { borderColor: isActive ? '#fff' : type.color }]}>
                                    <View style={[styles.foodTypeDot, { backgroundColor: isActive ? '#fff' : type.color }]} />
                                  </View>
                                  <Text style={[styles.variantFoodTypeText, isActive && { color: '#fff' }]}>{type.label}</Text>
                                </TouchableOpacity>
                              );
                            })}
                          </View>
                        </View>

                        {/* Tags with AI */}
                        <View style={styles.variantField}>
                          <View style={styles.variantFieldLabelRow}>
                            <Text style={styles.variantFieldLabel}>Tags</Text>
                            <TouchableOpacity 
                              style={[styles.aiSmallButton, { backgroundColor: '#FEF2F2' }]}
                              onPress={() => generateVariantTags(index)}
                              disabled={variant._aiTagsLoading}
                              activeOpacity={0.7}
                            >
                              {variant._aiTagsLoading ? (
                                <ActivityIndicator size="small" color={ZOMATO_RED} />
                              ) : (
                                <>
                                  <Ionicons name="sparkles" size={12} color={ZOMATO_RED} />
                                  <Text style={[styles.aiSmallButtonText, { color: ZOMATO_RED }]}>AI Generate</Text>
                                </>
                              )}
                            </TouchableOpacity>
                          </View>
                          <TextInput
                            style={styles.variantInput}
                            value={variant.tags || ''}
                            onChangeText={(val) => updateVariant(index, 'tags', val)}
                            placeholder="spicy, popular, bestseller"
                            placeholderTextColor="#C4C4C4"
                          />
                        </View>

                        {/* Divider */}
                        <View style={styles.variantDivider} />

                        {/* Price Section Header */}
                        <View style={styles.variantPriceSectionHeader}>
                          <Ionicons name="pricetag-outline" size={14} color="#6B7280" />
                          <Text style={styles.variantPriceSectionTitle}>Pricing</Text>
                        </View>

                        {/* Price (when no quantity options) */}
                        {(!variant.quantities || variant.quantities.length === 0) && (
                          <View style={styles.variantField}>
                            <Text style={styles.variantFieldLabel}>Price <Text style={styles.required}>*</Text></Text>
                            <View style={styles.variantPriceInput}>
                              <Text style={styles.variantCurrency}>₹</Text>
                              <TextInput
                                style={styles.variantPriceTextInput}
                                value={variant.price?.toString() || ''}
                                onChangeText={(val) => updateVariant(index, 'price', val)}
                                placeholder="0"
                                placeholderTextColor="#C4C4C4"
                                keyboardType="numeric"
                              />
                            </View>
                          </View>
                        )}

                        {/* Quantity & Unit (when no quantity options) */}
                        {(!variant.quantities || variant.quantities.length === 0) && (
                          <View style={styles.variantPriceRow}>
                            <View style={[styles.variantField, { flex: 1 }]}>
                              <Text style={styles.variantFieldLabel}>Quantity</Text>
                              <TextInput
                                style={styles.variantInput}
                                value={variant.quantity?.toString() || '1'}
                                onChangeText={(val) => updateVariant(index, 'quantity', val)}
                                placeholder="1"
                                placeholderTextColor="#C4C4C4"
                                keyboardType="numeric"
                                selectTextOnFocus={true}
                              />
                            </View>
                            <View style={[styles.variantField, { flex: 1 }]}>
                              <Text style={styles.variantFieldLabel}>Unit</Text>
                              <TouchableOpacity style={styles.pickerButton} onPress={() => setVariantUnitPickerIndex(index)}>
                                <Text style={styles.pickerValue}>{variant.unit || 'piece'}</Text>
                                <Ionicons name="chevron-down" size={18} color="#9CA3AF" />
                              </TouchableOpacity>
                            </View>
                          </View>
                        )}

                        {/* ── Quantity Options (Sizes) ── */}
                        <View style={styles.variantField}>
                          <View style={styles.variantFieldLabelRow}>
                            <Text style={styles.variantFieldLabel}>Quantity Options (Sizes)</Text>
                            <TouchableOpacity 
                              style={styles.addSizeButton}
                              onPress={() => addQuantityOption(index)}
                              activeOpacity={0.7}
                            >
                              <Ionicons name="add" size={14} color="#fff" />
                              <Text style={styles.addSizeButtonText}>Add Size</Text>
                            </TouchableOpacity>
                          </View>
                          
                          {(!variant.quantities || variant.quantities.length === 0) && (
                            <Text style={styles.noSizesHint}>
                              No sizes added. Add quantity options like 0.5 kg, 1 kg etc.
                            </Text>
                          )}

                          {variant.quantities && variant.quantities.map((q, qIdx) => (
                            <View key={qIdx} style={styles.qtyOptionRow}>
                              <View style={styles.qtyOptionField}>
                                <Text style={styles.qtyOptionLabel}>Qty</Text>
                                <TextInput
                                  style={styles.qtyOptionInput}
                                  value={q.quantity?.toString() || '1'}
                                  onChangeText={(val) => updateQuantityOption(index, qIdx, 'quantity', val)}
                                  keyboardType="numeric"
                                  placeholder="1"
                                  placeholderTextColor="#D1D5DB"
                                  selectTextOnFocus={true}
                                />
                              </View>
                              <View style={styles.qtyOptionField}>
                                <Text style={styles.qtyOptionLabel}>Unit</Text>
                                <TouchableOpacity 
                                  style={styles.qtyOptionUnitPicker}
                                  onPress={() => setQtyUnitPicker({ variantIndex: index, qtyIndex: qIdx })}
                                >
                                  <Text style={styles.qtyOptionUnitText}>{q.unit || 'piece'}</Text>
                                  <Ionicons name="chevron-down" size={12} color="#9CA3AF" />
                                </TouchableOpacity>
                              </View>
                              <View style={styles.qtyOptionField}>
                                <Text style={styles.qtyOptionLabel}>Price <Text style={{ color: ZOMATO_RED }}>*</Text></Text>
                                <View style={styles.qtyOptionPriceInput}>
                                  <Text style={styles.qtyOptionCurrency}>₹</Text>
                                  <TextInput
                                    style={styles.qtyOptionPriceTextInput}
                                    value={q.price?.toString() || ''}
                                    onChangeText={(val) => updateQuantityOption(index, qIdx, 'price', val)}
                                    keyboardType="numeric"
                                    placeholder="0"
                                    placeholderTextColor="#D1D5DB"
                                  />
                                </View>
                              </View>
                              <TouchableOpacity onPress={() => removeQuantityOption(index, qIdx)} style={styles.qtyOptionRemove}>
                                <Ionicons name="close-circle" size={20} color="#EF4444" />
                              </TouchableOpacity>
                            </View>
                          ))}
                        </View>

                        {/* Divider */}
                        <View style={styles.variantDivider} />

                        {/* Available Toggle */}
                        <View style={styles.variantAvailableRow}>
                          <View style={styles.variantAvailableInfo}>
                            <Ionicons name="checkmark-circle" size={18} color={variant.available !== false ? '#22C55E' : '#D1D5DB'} />
                            <Text style={styles.variantFieldLabel}>Available for Order</Text>
                          </View>
                          <Switch
                            value={variant.available !== false}
                            onValueChange={(val) => updateVariant(index, 'available', val)}
                            trackColor={{ false: '#E5E7EB', true: '#BBF7D0' }}
                            thumbColor={variant.available !== false ? '#22C55E' : '#9CA3AF'}
                          />
                        </View>
                      </View>
                    )}
                  </View>
                ))}

                {/* Add variant button at bottom when items exist */}
                {variants.length > 0 && (
                  <TouchableOpacity style={styles.addVariantBottomButton} onPress={addVariant} activeOpacity={0.7}>
                    <Ionicons name="add-circle-outline" size={20} color={ZOMATO_RED} />
                    <Text style={styles.addVariantBottomText}>Add Another Variant</Text>
                  </TouchableOpacity>
                )}
              </View>



              {/* Applied Offers (Read-only) */}
              {existingItem?.offerType && (Array.isArray(existingItem.offerType) ? existingItem.offerType.length > 0 : existingItem.offerType) && (() => {
                const itemOfferTypes = Array.isArray(existingItem.offerType) ? existingItem.offerType : [existingItem.offerType];
                const validOfferTypes = itemOfferTypes.filter(offerType => 
                  offers.some(offer => offer.offerType === offerType)
                );
                if (validOfferTypes.length === 0) return null;
                return (
                  <View style={styles.appliedOffersSection}>
                    <View style={styles.appliedOffersHeader}>
                      <Ionicons name="pricetag" size={20} color="#22C55E" />
                      <Text style={styles.appliedOffersTitle}>Applied Offers</Text>
                    </View>
                    <Text style={styles.appliedOffersHint}>These offers are applied from the Offers page</Text>
                    <View style={styles.appliedOffersList}>
                      {validOfferTypes.map((offerType, index) => {
                        const offer = offers.find(o => o.offerType === offerType);
                        return (
                          <View key={index} style={styles.appliedOfferTag}>
                            <Ionicons name="checkmark-circle" size={16} color="#22C55E" />
                            <Text style={styles.appliedOfferTagText}>{offerType}</Text>
                            {offer?.percentage && (
                              <Text style={styles.appliedOfferPercentage}> ({offer.percentage}% OFF)</Text>
                            )}
                          </View>
                        );
                      })}
                    </View>
                    {existingItem?.offerPrice && (
                      <View style={styles.offerPriceInfo}>
                        <Text style={styles.offerPriceLabel}>Offer Price:</Text>
                        <Text style={styles.offerPriceValue}>₹{existingItem.offerPrice}</Text>
                        <View style={styles.discountBadge}>
                          <Ionicons name="trending-down" size={14} color="#22C55E" />
                          <Text style={styles.discountText}>
                            {Math.round(((existingItem.price - existingItem.offerPrice) / existingItem.price) * 100)}% OFF
                          </Text>
                        </View>
                      </View>
                    )}
                  </View>
                );
              })()}

              {/* Available Switch */}
              <View style={styles.switchCard}>
                <View style={styles.switchInfo}>
                  <View style={styles.switchIconContainer}>
                    <Ionicons name="checkmark-circle" size={24} color={available ? '#22C55E' : '#9CA3AF'} />
                  </View>
                  <View>
                    <Text style={styles.switchLabel}>Available for Order</Text>
                    <Text style={styles.switchHint}>Item will be visible to customers</Text>
                  </View>
                </View>
                <Switch
                  value={available}
                  onValueChange={setAvailable}
                  trackColor={{ false: '#E5E7EB', true: '#BBF7D0' }}
                  thumbColor={available ? '#22C55E' : '#9CA3AF'}
                />
              </View>
            </View>
          </Animated.View>
          <View style={{ height: 120 }} />
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Footer */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.submitButton, loading && styles.submitButtonDisabled]}
          onPress={handleSubmit}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Ionicons name={isEditing ? 'checkmark-circle' : 'add-circle'} size={22} color="#fff" />
              <Text style={styles.submitButtonText}>{isEditing ? 'Update Item' : 'Add Item'}</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      {/* Variant Unit Picker Modal */}
      <Modal visible={variantUnitPickerIndex !== null} animationType="slide" transparent={true} onRequestClose={() => setVariantUnitPickerIndex(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHandle} />
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select Unit (Variant {variantUnitPickerIndex !== null ? variantUnitPickerIndex + 1 : ''})</Text>
              <TouchableOpacity style={styles.modalCloseButton} onPress={() => setVariantUnitPickerIndex(null)}>
                <Ionicons name="close" size={24} color="#696969" />
              </TouchableOpacity>
            </View>
            <FlatList
              data={UNITS}
              keyExtractor={(item) => item}
              renderItem={({ item }) => {
                const currentUnit = variantUnitPickerIndex !== null ? (variants[variantUnitPickerIndex]?.unit || 'piece') : '';
                return (
                  <TouchableOpacity
                    style={[styles.unitOption, currentUnit === item && styles.unitOptionSelected]}
                    onPress={() => { updateVariant(variantUnitPickerIndex, 'unit', item); setVariantUnitPickerIndex(null); }}
                  >
                    <Text style={[styles.unitOptionText, currentUnit === item && styles.unitOptionTextSelected]}>{item}</Text>
                    {currentUnit === item && <Ionicons name="checkmark-circle" size={22} color={ZOMATO_RED} />}
                  </TouchableOpacity>
                );
              }}
              contentContainerStyle={styles.modalList}
            />
          </View>
        </View>
      </Modal>

      {/* Quantity Option Unit Picker Modal */}
      <Modal visible={qtyUnitPicker !== null} animationType="slide" transparent={true} onRequestClose={() => setQtyUnitPicker(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHandle} />
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select Unit</Text>
              <TouchableOpacity style={styles.modalCloseButton} onPress={() => setQtyUnitPicker(null)}>
                <Ionicons name="close" size={24} color="#696969" />
              </TouchableOpacity>
            </View>
            <FlatList
              data={UNITS}
              keyExtractor={(item) => item}
              renderItem={({ item }) => {
                const currentUnit = qtyUnitPicker ? (variants[qtyUnitPicker.variantIndex]?.quantities?.[qtyUnitPicker.qtyIndex]?.unit || 'piece') : '';
                return (
                  <TouchableOpacity
                    style={[styles.unitOption, currentUnit === item && styles.unitOptionSelected]}
                    onPress={() => { 
                      updateQuantityOption(qtyUnitPicker.variantIndex, qtyUnitPicker.qtyIndex, 'unit', item); 
                      setQtyUnitPicker(null); 
                    }}
                  >
                    <Text style={[styles.unitOptionText, currentUnit === item && styles.unitOptionTextSelected]}>{item}</Text>
                    {currentUnit === item && <Ionicons name="checkmark-circle" size={22} color={ZOMATO_RED} />}
                  </TouchableOpacity>
                );
              }}
              contentContainerStyle={styles.modalList}
            />
          </View>
        </View>
      </Modal>

      {/* Loading Overlay */}
      {loading && (
        <View style={styles.loadingOverlay}>
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={ZOMATO_RED} />
            <Text style={styles.loadingText}>
              {isEditing ? 'Updating item...' : 'Adding item...'}
            </Text>
          </View>
        </View>
      )}
    </View>
  );
}


const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F8F8' },
  
  // Header
  header: {
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight + 20 : 60,
    paddingBottom: 20,
    paddingHorizontal: 16,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backButton: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center', alignItems: 'center',
  },
  headerTitle: { fontSize: 20, fontWeight: '700', color: '#fff' },
  content: { flex: 1, padding: 16 },
  
  // Image
  imageSection: { alignItems: 'center', marginBottom: 24, position: 'relative' },
  imageContainer: { alignItems: 'center' },
  image: { 
    width: 150, height: 150, borderRadius: 20, borderWidth: 3, borderColor: '#fff',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.15, shadowRadius: 12, elevation: 6,
  },
  imagePlaceholder: {
    width: 150, height: 150, borderRadius: 20, backgroundColor: '#fff',
    justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#E8E8E8', borderStyle: 'dashed',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
  },
  imagePlaceholderIcon: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: '#FEF2F2',
    justifyContent: 'center', alignItems: 'center', marginBottom: 8,
  },
  imagePlaceholderText: { color: '#1C1C1C', fontSize: 14, fontWeight: '600' },
  imagePlaceholderHint: { color: '#9CA3AF', fontSize: 12, marginTop: 2 },
  removeImageButton: { position: 'absolute', top: -8, right: '25%' },
  imageLoadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  
  // Form
  form: { gap: 20 },
  inputGroup: { gap: 8 },
  label: { fontSize: 14, fontWeight: '700', color: '#1C1C1C' },
  required: { color: ZOMATO_RED },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  input: {
    backgroundColor: '#fff', borderRadius: 14, paddingHorizontal: 18, height: 54,
    borderWidth: 1.5, borderColor: '#E8E8E8', fontSize: 15, color: '#1C1C1C', fontWeight: '500',
  },
  textArea: { height: 100, textAlignVertical: 'top', paddingTop: 16 },
  inputHint: { fontSize: 12, color: '#9CA3AF', marginTop: 4 },

  // AI Button
  aiButton: { 
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#F3E8FF', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
  },
  aiButtonText: { fontSize: 12, color: '#8B5CF6', fontWeight: '700' },
  aiTagsButton: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#8B5CF6', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16,
  },
  aiTagsButtonText: { fontSize: 11, color: '#fff', fontWeight: '700' },
  
  // Price
  priceInputContainer: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 14,
    borderWidth: 1.5, borderColor: '#E8E8E8', paddingHorizontal: 18, height: 54,
  },
  currencySymbol: { fontSize: 20, fontWeight: '700', color: ZOMATO_RED, marginRight: 8 },
  priceInput: { flex: 1, fontSize: 18, color: '#1C1C1C', fontWeight: '600' },
  
  // Picker
  pickerButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#fff', borderRadius: 14, paddingHorizontal: 18, minHeight: 54,
    paddingVertical: 12,
    borderWidth: 1.5, borderColor: '#E8E8E8',
  },
  pickerPlaceholder: { color: '#9CA3AF', fontSize: 15 },
  pickerValue: { color: '#1C1C1C', fontSize: 15, fontWeight: '600' },
  selectedTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, flex: 1, alignItems: 'center' },
  selectedTag: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: ZOMATO_RED, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20,
  },
  selectedTagText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  
  // Row inputs
  rowInputs: { flexDirection: 'row', gap: 14 },
  
  // Prep time
  prepTimeContainer: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  prepTimeButton: {
    width: 48, height: 48, borderRadius: 14, backgroundColor: '#FEF2F2',
    justifyContent: 'center', alignItems: 'center',
  },
  prepTimeInputWrapper: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  prepTimeInput: {
    width: 60, height: 48, backgroundColor: '#fff', borderRadius: 14,
    borderWidth: 1.5, borderColor: '#E8E8E8', fontSize: 18, color: '#1C1C1C', fontWeight: '700',
  },
  prepTimeUnit: { fontSize: 14, color: '#696969', marginLeft: 8, fontWeight: '600' },
  
  // Food type
  foodTypeContainer: { flexDirection: 'row', gap: 12 },
  foodTypeButton: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 16, borderRadius: 14, backgroundColor: '#fff',
    borderWidth: 2, borderColor: '#E8E8E8',
  },
  foodTypeIcon: { width: 18, height: 18, borderRadius: 5, borderWidth: 2, justifyContent: 'center', alignItems: 'center' },
  foodTypeDot: { width: 10, height: 10, borderRadius: 5 },
  foodTypeText: { fontSize: 14, fontWeight: '700', color: '#696969' },

  // Switch
  switchCard: { 
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: '#fff', padding: 18, borderRadius: 16, borderWidth: 1.5, borderColor: '#E8E8E8',
  },
  switchInfo: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  switchIconContainer: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#F0FDF4', justifyContent: 'center', alignItems: 'center' },
  switchLabel: { fontSize: 15, fontWeight: '700', color: '#1C1C1C' },
  switchHint: { fontSize: 12, color: '#9CA3AF', marginTop: 2 },
  
  // Applied Offers Section
  appliedOffersSection: {
    backgroundColor: '#F0FDF4',
    padding: 16,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#BBF7D0',
    gap: 12,
  },
  appliedOffersHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  appliedOffersTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1C1C1C',
  },
  appliedOffersHint: {
    fontSize: 12,
    color: '#059669',
    marginTop: -4,
  },
  appliedOffersList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  appliedOfferTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#fff',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#BBF7D0',
  },
  appliedOfferTagText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#059669',
  },
  appliedOfferPercentage: {
    fontSize: 12,
    fontWeight: '500',
    color: '#10B981',
  },
  offerPriceInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#fff',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#BBF7D0',
  },
  offerPriceLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6B7280',
  },
  offerPriceValue: {
    fontSize: 18,
    fontWeight: '700',
    color: '#22C55E',
  },
  discountBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    marginLeft: 'auto',
  },
  discountText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#22C55E',
  },
  
  // Footer
  footer: { 
    padding: 16, paddingBottom: Platform.OS === 'ios' ? 32 : 16,
    backgroundColor: '#fff', borderTopWidth: 0,
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.06, shadowRadius: 12, elevation: 10,
  },
  submitButton: { 
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: ZOMATO_RED, height: 56, borderRadius: 16,
    shadowColor: ZOMATO_RED, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 4,
  },
  submitButtonDisabled: { opacity: 0.7 },
  submitButtonText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  
  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#fff', borderTopLeftRadius: 28, borderTopRightRadius: 28, maxHeight: '75%' },
  modalHandle: { width: 40, height: 4, backgroundColor: '#E8E8E8', borderRadius: 2, alignSelf: 'center', marginTop: 12 },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 24, paddingTop: 16, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: '#F0F0F0',
  },
  modalTitle: { fontSize: 20, fontWeight: '800', color: '#1C1C1C' },
  modalCloseButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#F5F5F5', justifyContent: 'center', alignItems: 'center' },
  modalList: { padding: 16 },
  modalFooter: { padding: 16, borderTopWidth: 1, borderTopColor: '#F0F0F0' },
  
  categoryOption: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#F5F5F5' },
  checkbox: {
    width: 26, height: 26, borderRadius: 8, borderWidth: 2, borderColor: '#D1D5DB',
    justifyContent: 'center', alignItems: 'center',
  },
  checkboxChecked: { backgroundColor: ZOMATO_RED, borderColor: ZOMATO_RED },
  categoryOptionText: { fontSize: 16, color: '#1C1C1C', fontWeight: '500' },
  
  unitOption: { 
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#F5F5F5',
  },
  unitOptionSelected: { backgroundColor: '#FEF2F2' },
  unitOptionText: { fontSize: 16, color: '#1C1C1C', fontWeight: '500' },
  unitOptionTextSelected: { color: ZOMATO_RED, fontWeight: '700' },
  
  modalDoneButton: { 
    backgroundColor: ZOMATO_RED, height: 54, borderRadius: 14, justifyContent: 'center', alignItems: 'center',
    shadowColor: ZOMATO_RED, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 4,
  },
  modalDoneButtonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  emptyText: { textAlign: 'center', color: '#9CA3AF', padding: 24, fontSize: 14 },
  emptySubText: { textAlign: 'center', color: '#D1D5DB', fontSize: 12, marginTop: 4 },
  
  // Offer Type
  clearOfferButton: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  clearOfferText: { fontSize: 12, color: '#EF4444', fontWeight: '600' },
  offerOptionContent: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  offerOptionImage: { width: 50, height: 28, borderRadius: 6, resizeMode: 'cover' },
  emptyOfferContainer: { alignItems: 'center', paddingVertical: 40 },
  
  // Discount badge
  discountBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    alignSelf: 'flex-start',
    marginTop: -8,
    marginBottom: 8,
  },
  discountText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#22C55E',
  },

  // ── Variants ──
  variantsSection: {
    gap: 12,
  },
  variantsSectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  variantsTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  variantsIconContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FEF2F2',
    justifyContent: 'center',
    alignItems: 'center',
  },
  variantsSectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1C1C1C',
  },
  variantsSectionHint: {
    fontSize: 11,
    color: '#9CA3AF',
    marginTop: 1,
  },
  addVariantButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: ZOMATO_RED,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 22,
    shadowColor: ZOMATO_RED,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 3,
  },
  addVariantButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#fff',
  },
  variantCountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  variantCountBadge: {
    backgroundColor: '#FEF2F2',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  variantCountText: {
    fontSize: 12,
    fontWeight: '600',
    color: ZOMATO_RED,
  },
  collapseAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  collapseAllText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#6B7280',
  },
  noVariantsContainer: {
    alignItems: 'center',
    paddingVertical: 28,
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 2,
    borderColor: '#F3F4F6',
    borderStyle: 'dashed',
  },
  noVariantsIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#FEF2F2',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  noVariantsText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#6B7280',
    marginTop: 4,
  },
  noVariantsHint: {
    fontSize: 12,
    color: '#9CA3AF',
    marginTop: 4,
    textAlign: 'center',
    paddingHorizontal: 32,
  },
  variantCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#E8E8E8',
    overflow: 'hidden',
  },
  variantCardDisabled: {
    opacity: 0.7,
    borderColor: '#F3F4F6',
  },
  variantCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: '#FAFAFA',
  },
  variantHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  variantNumberBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#FEF2F2',
    justifyContent: 'center',
    alignItems: 'center',
  },
  variantNumberText: {
    fontSize: 13,
    fontWeight: '700',
    color: ZOMATO_RED,
  },
  variantHeaderInfo: {
    flex: 1,
  },
  variantCardTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1C1C1C',
  },
  variantHeaderMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 2,
  },
  variantHeaderPrice: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6B7280',
  },
  variantFoodDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  soldOutMini: {
    backgroundColor: '#FEF2F2',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  soldOutMiniText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#EF4444',
  },
  variantHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  variantDeleteBtn: {
    padding: 4,
  },
  variantCardBody: {
    padding: 14,
    gap: 14,
  },
  variantCardNumber: {
    fontSize: 14,
    fontWeight: '700',
    color: ZOMATO_RED,
  },
  variantImageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  variantImagePicker: {
    width: 64,
    height: 64,
    borderRadius: 14,
    overflow: 'hidden',
  },
  variantImagePreview: {
    width: 64,
    height: 64,
    borderRadius: 14,
  },
  variantImagePlaceholder: {
    width: 64,
    height: 64,
    borderRadius: 14,
    backgroundColor: '#FEF2F2',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#FECDD3',
    borderStyle: 'dashed',
  },
  variantImageActions: {
    gap: 6,
  },
  variantImageChangeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: '#FEF2F2',
    borderRadius: 8,
  },
  variantImageChangeBtnText: {
    fontSize: 11,
    fontWeight: '600',
    color: ZOMATO_RED,
  },
  variantImageRemoveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: '#FEF2F2',
    borderRadius: 8,
  },
  variantImageRemoveBtnText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#EF4444',
  },
  variantImageHintContainer: {
    flex: 1,
  },
  variantImageHintText: {
    fontSize: 13,
    color: '#6B7280',
    fontWeight: '500',
  },
  variantImageSubHint: {
    fontSize: 11,
    color: '#9CA3AF',
    marginTop: 2,
  },
  variantDivider: {
    height: 1,
    backgroundColor: '#F3F4F6',
    marginVertical: 2,
  },
  variantField: {
    gap: 6,
  },
  variantFieldLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  variantFieldLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#4B5563',
  },
  aiSmallButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#F3E8FF',
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  aiSmallButtonText: {
    color: '#8B5CF6',
    fontSize: 11,
    fontWeight: '600',
  },
  variantInput: {
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 44,
    borderWidth: 1,
    borderColor: '#E8E8E8',
    fontSize: 14,
    color: '#1C1C1C',
    fontWeight: '500',
  },
  variantTextArea: {
    height: 70,
    textAlignVertical: 'top',
    paddingTop: 12,
  },
  variantFoodTypeRow: {
    flexDirection: 'row',
    gap: 8,
  },
  variantFoodTypeBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: '#F9FAFB',
    borderWidth: 1.5,
    borderColor: '#E8E8E8',
  },
  variantFoodTypeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#696969',
  },
  variantPriceSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  variantPriceSectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6B7280',
  },
  addSizeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: ZOMATO_RED,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  addSizeButtonText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
  },
  noSizesHint: {
    fontSize: 11,
    color: '#9CA3AF',
    fontStyle: 'italic',
  },
  qtyOptionRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: '#F9FAFB',
    borderRadius: 10,
    padding: 10,
    marginTop: 6,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    gap: 6,
  },
  qtyOptionField: {
    flex: 1,
  },
  qtyOptionLabel: {
    fontSize: 10,
    color: '#6B7280',
    marginBottom: 3,
    fontWeight: '500',
  },
  qtyOptionInput: {
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    paddingHorizontal: 8,
    paddingVertical: 6,
    fontSize: 13,
    color: '#1C1C1C',
  },
  qtyOptionUnitPicker: {
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    paddingHorizontal: 8,
    paddingVertical: 7,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  qtyOptionUnitText: {
    fontSize: 13,
    color: '#1F2937',
  },
  qtyOptionPriceInput: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    paddingHorizontal: 6,
  },
  qtyOptionCurrency: {
    fontSize: 12,
    color: '#9CA3AF',
    fontWeight: '600',
  },
  qtyOptionPriceTextInput: {
    flex: 1,
    paddingHorizontal: 4,
    paddingVertical: 6,
    fontSize: 13,
    color: '#1C1C1C',
  },
  qtyOptionRemove: {
    padding: 4,
    marginBottom: 2,
  },
  variantPriceRow: {
    flexDirection: 'row',
    gap: 10,
  },
  variantPriceInput: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 44,
    borderWidth: 1,
    borderColor: '#E8E8E8',
  },
  variantCurrency: {
    fontSize: 16,
    fontWeight: '700',
    color: ZOMATO_RED,
    marginRight: 6,
  },
  variantPriceTextInput: {
    flex: 1,
    fontSize: 15,
    color: '#1C1C1C',
    fontWeight: '600',
  },
  variantAvailableRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  variantAvailableInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  addVariantBottomButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: '#FECDD3',
    borderStyle: 'dashed',
    backgroundColor: '#FFF5F5',
  },
  addVariantBottomText: {
    fontSize: 14,
    fontWeight: '600',
    color: ZOMATO_RED,
  },
  
  // Loading Overlay
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 9999,
  },
  loadingContainer: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 30,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    fontWeight: '600',
    color: '#1C1C1C',
  },
});
