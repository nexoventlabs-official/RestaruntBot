import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput,
  TouchableOpacity, Image, Alert, ActivityIndicator, Switch, Modal, FlatList,
  Animated, Platform, KeyboardAvoidingView, StatusBar
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import api from '../../config/api';

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
  const [variants, setVariants] = useState(
    existingItem?.variants?.map(v => ({ 
      ...v, 
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
      newImageFile: null 
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
    setVariants([...variants, { 
      label: '', variantType: 'size', price: '', quantity: '1', unit: 'piece',
      image: null, newImageFile: null, available: true,
      description: '', foodType: 'veg', tags: '',
      quantities: []
    }]);
  };

  const removeVariant = (index) => {
    Alert.alert('Remove Variant', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => {
        setVariants(variants.filter((_, i) => i !== index));
      }},
    ]);
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

  const handleSubmit = async () => {
    // When variants exist, base price can be auto-derived
    const hasVariants = variants.length > 0;
    if (!name.trim() || selectedCategories.length === 0) {
      Alert.alert('Error', 'Please fill in name and select at least one category');
      return;
    }
    if (!hasVariants && !price.trim()) {
      Alert.alert('Error', 'Please set a price or add product variants');
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
    
    // Validate tags - required when no variants; variant-level tags used otherwise
    const cleanedTags = tags.trim();
    if (!hasVariants && !cleanedTags) {
      Alert.alert('Error', 'Please add tags for the item. Use AI Generate button to auto-generate tags.');
      return;
    }

    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('name', name);
      formData.append('description', description);
      // When variants exist, auto-set base price to lowest variant price
      if (hasVariants) {
        const lowestPrice = Math.min(...variants.map(v => {
          if (v.quantities && v.quantities.length > 0) {
            return Math.min(...v.quantities.map(q => parseFloat(q.price) || 0));
          }
          return parseFloat(v.price) || 0;
        }));
        formData.append('price', lowestPrice.toString());
        // Use first variant's quantity/unit as base fallback
        if (variants[0].quantities && variants[0].quantities.length > 0) {
          formData.append('quantity', variants[0].quantities[0].quantity || '1');
          formData.append('unit', variants[0].quantities[0].unit || 'piece');
        } else {
          formData.append('quantity', variants[0].quantity || '1');
          formData.append('unit', variants[0].unit || 'piece');
        }
      } else {
        formData.append('price', price);
        formData.append('quantity', quantity);
        formData.append('unit', unit);
      }
      formData.append('category', JSON.stringify(selectedCategories));
      formData.append('foodType', foodType);
      formData.append('available', available.toString());
      formData.append('preparationTime', preparationTime);
      formData.append('tags', tags);

      if (newImage) {
        const filename = newImage.uri.split('/').pop();
        const match = /\.(\w+)$/.exec(filename);
        const type = match ? `image/${match[1]}` : 'image/jpeg';
        formData.append('image', { uri: newImage.uri, name: filename, type });
      } else if (!image && existingItem?.image) {
        formData.append('removeImage', 'true');
      }

      // ── Variants ──
      if (variants.length > 0) {
        const variantsPayload = variants.map(v => ({
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

        // Append new variant image files
        variants.forEach((v) => {
          if (v.newImageFile) {
            const fname = v.newImageFile.uri.split('/').pop();
            const ext = /\.(\w+)$/.exec(fname);
            const mimeType = ext ? `image/${ext[1]}` : 'image/jpeg';
            formData.append('variantImages', { uri: v.newImageFile.uri, name: fname, type: mimeType });
          }
        });
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
              {/* Title (Group Name) */}
              <View style={styles.inputGroup}>
                <Text style={styles.label}>{variants.length > 0 ? 'Title' : 'Item Name'} <Text style={styles.required}>*</Text></Text>
                <TextInput 
                  style={styles.input} 
                  value={name} 
                  onChangeText={setName} 
                  placeholder={variants.length > 0 ? "e.g., Biryani, Pizza" : "e.g., Margherita Pizza"}
                  placeholderTextColor="#9CA3AF"
                />
              </View>

              {/* Categories */}
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Category <Text style={styles.required}>*</Text></Text>
                <TouchableOpacity style={styles.pickerButton} onPress={() => setShowCategoryPicker(true)}>
                  <View style={styles.selectedTags}>
                    {selectedCategories.length === 0 ? (
                      <Text style={styles.pickerPlaceholder}>Select categories</Text>
                    ) : (
                      selectedCategories.map(cat => (
                        <View key={cat} style={styles.selectedTag}>
                          <Text style={styles.selectedTagText}>{cat}</Text>
                          <TouchableOpacity onPress={() => toggleCategory(cat)}>
                            <Ionicons name="close" size={14} color="#fff" />
                          </TouchableOpacity>
                        </View>
                      ))
                    )}
                  </View>
                  <Ionicons name="chevron-down" size={20} color="#9CA3AF" />
                </TouchableOpacity>
              </View>

              {/* Description, Food Type, Tags – only when no variants (variant-level fields used otherwise) */}
              {variants.length === 0 && (
              <>
              {/* Description with AI */}
              <View style={styles.inputGroup}>
                <View style={styles.labelRow}>
                  <Text style={styles.label}>Description</Text>
                  <TouchableOpacity style={styles.aiButton} onPress={generateDescription} disabled={aiLoading}>
                    {aiLoading ? (
                      <ActivityIndicator size="small" color="#8B5CF6" />
                    ) : (
                      <>
                        <Ionicons name="sparkles" size={14} color="#8B5CF6" />
                        <Text style={styles.aiButtonText}>AI Generate</Text>
                      </>
                    )}
                  </TouchableOpacity>
                </View>
                <TextInput
                  style={[styles.input, styles.textArea]}
                  value={description}
                  onChangeText={setDescription}
                  placeholder="Describe your item..."
                  placeholderTextColor="#9CA3AF"
                  multiline
                  numberOfLines={3}
                />
              </View>

              {/* Food Type */}
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Food Type</Text>
                <View style={styles.foodTypeContainer}>
                  {FOOD_TYPES.map((type) => (
                    <TouchableOpacity
                      key={type.value}
                      style={[styles.foodTypeButton, foodType === type.value && { backgroundColor: type.color, borderColor: type.color }]}
                      onPress={() => setFoodType(type.value)}
                    >
                      <View style={[styles.foodTypeIcon, { borderColor: foodType === type.value ? '#fff' : type.color }]}>
                        <View style={[styles.foodTypeDot, { backgroundColor: foodType === type.value ? '#fff' : type.color }]} />
                      </View>
                      <Text style={[styles.foodTypeText, foodType === type.value && { color: '#fff' }]}>{type.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* Tags */}
              <View style={styles.inputGroup}>
                <View style={styles.labelRow}>
                  <Text style={styles.label}>Tags <Text style={styles.required}>*</Text></Text>
                  <TouchableOpacity 
                    style={styles.aiTagsButton} 
                    onPress={generateTags}
                    disabled={tagsAiLoading}
                  >
                    {tagsAiLoading ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <>
                        <Ionicons name="sparkles" size={14} color="#fff" />
                        <Text style={styles.aiTagsButtonText}>AI Generate</Text>
                      </>
                    )}
                  </TouchableOpacity>
                </View>
                <TextInput
                  style={styles.input}
                  value={tags}
                  onChangeText={setTags}
                  placeholder="Click AI Generate for accurate tags"
                  placeholderTextColor="#9CA3AF"
                />
                <Text style={styles.inputHint}>Up to 10 tags, separated by commas (use AI Generate for best results)</Text>
              </View>
              </>
              )}

              {/* ── Variants Section ── */}
              <View style={styles.variantsSection}>
                <View style={styles.variantsSectionHeader}>
                  <View style={styles.variantsTitleRow}>
                    <View style={styles.variantsIconContainer}>
                      <Ionicons name="layers-outline" size={20} color={ZOMATO_RED} />
                    </View>
                    <View>
                      <Text style={styles.variantsSectionTitle}>Item Variants</Text>
                      <Text style={styles.variantsSectionHint}>Each variant = an item with its own image, name, price & sizes</Text>
                    </View>
                  </View>
                  <TouchableOpacity style={styles.addVariantButton} onPress={addVariant}>
                    <Ionicons name="add" size={18} color="#fff" />
                    <Text style={styles.addVariantButtonText}>Add</Text>
                  </TouchableOpacity>
                </View>

                {variants.length === 0 && (
                  <View style={styles.noVariantsContainer}>
                    <Ionicons name="cube-outline" size={28} color="#D1D5DB" />
                    <Text style={styles.noVariantsText}>No variants added</Text>
                    <Text style={styles.noVariantsHint}>Add item variants (e.g., Chicken Biryani, Mutton Biryani)</Text>
                  </View>
                )}

                {variants.map((variant, index) => (
                  <View key={index} style={styles.variantCard}>
                    {/* Variant Header */}
                    <View style={styles.variantCardHeader}>
                      <Text style={styles.variantCardNumber}>Item {index + 1}</Text>
                      <TouchableOpacity onPress={() => removeVariant(index)}>
                        <Ionicons name="trash-outline" size={20} color="#EF4444" />
                      </TouchableOpacity>
                    </View>

                    {/* Variant Image */}
                    <View style={styles.variantImageRow}>
                      <TouchableOpacity style={styles.variantImagePicker} onPress={() => pickVariantImage(index)}>
                        {variant.image ? (
                          <Image source={{ uri: variant.image }} style={styles.variantImagePreview} />
                        ) : (
                          <View style={styles.variantImagePlaceholder}>
                            <Ionicons name="camera-outline" size={20} color="#9CA3AF" />
                          </View>
                        )}
                      </TouchableOpacity>
                      {variant.image && (
                        <TouchableOpacity style={styles.variantImageRemove} onPress={() => removeVariantImage(index)}>
                          <Ionicons name="close-circle" size={20} color="#EF4444" />
                        </TouchableOpacity>
                      )}
                      <View style={styles.variantImageHintContainer}>
                        <Text style={styles.variantImageHintText}>Tap to set item image</Text>
                      </View>
                    </View>

                    {/* Item Name (Label) */}
                    <View style={styles.variantField}>
                      <Text style={styles.variantFieldLabel}>Item Name <Text style={styles.required}>*</Text></Text>
                      <TextInput
                        style={styles.variantInput}
                        value={variant.label}
                        onChangeText={(val) => updateVariant(index, 'label', val)}
                        placeholder="e.g., Chicken Biryani"
                        placeholderTextColor="#9CA3AF"
                      />
                    </View>

                    {/* Description */}
                    <View style={styles.variantField}>
                      <Text style={styles.variantFieldLabel}>Description</Text>
                      <TextInput
                        style={[styles.variantInput, { height: 60, textAlignVertical: 'top' }]}
                        value={variant.description || ''}
                        onChangeText={(val) => updateVariant(index, 'description', val)}
                        placeholder="Describe this item..."
                        placeholderTextColor="#9CA3AF"
                        multiline
                        numberOfLines={2}
                      />
                    </View>

                    {/* Food Type */}
                    <View style={styles.variantField}>
                      <Text style={styles.variantFieldLabel}>Food Type</Text>
                      <View style={styles.foodTypeContainer}>
                        {FOOD_TYPES.map((type) => (
                          <TouchableOpacity
                            key={type.value}
                            style={[styles.foodTypeButton, { flex: 1, paddingVertical: 6 }, variant.foodType === type.value && { backgroundColor: type.color, borderColor: type.color }]}
                            onPress={() => updateVariant(index, 'foodType', type.value)}
                          >
                            <View style={[styles.foodTypeIcon, { borderColor: variant.foodType === type.value ? '#fff' : type.color }]}>
                              <View style={[styles.foodTypeDot, { backgroundColor: variant.foodType === type.value ? '#fff' : type.color }]} />
                            </View>
                            <Text style={[styles.foodTypeText, { fontSize: 11 }, variant.foodType === type.value && { color: '#fff' }]}>{type.label}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </View>

                    {/* Tags */}
                    <View style={styles.variantField}>
                      <Text style={styles.variantFieldLabel}>Tags</Text>
                      <TextInput
                        style={styles.variantInput}
                        value={variant.tags || ''}
                        onChangeText={(val) => updateVariant(index, 'tags', val)}
                        placeholder="spicy, popular, bestseller"
                        placeholderTextColor="#9CA3AF"
                      />
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
                            placeholderTextColor="#9CA3AF"
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
                            placeholderTextColor="#9CA3AF"
                            keyboardType="numeric"
                          />
                        </View>
                        <View style={[styles.variantField, { flex: 1 }]}>
                          <Text style={styles.variantFieldLabel}>Unit</Text>
                          <TouchableOpacity style={styles.pickerButton} onPress={() => setVariantUnitPickerIndex(index)}>
                            <Text style={styles.pickerValue}>{variant.unit || 'piece'}</Text>
                            <Ionicons name="chevron-down" size={20} color="#9CA3AF" />
                          </TouchableOpacity>
                        </View>
                      </View>
                    )}

                    {/* ── Quantity Options (Sizes) ── */}
                    <View style={[styles.variantField, { marginTop: 8 }]}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                        <Text style={[styles.variantFieldLabel, { marginBottom: 0 }]}>Quantity Options (Sizes)</Text>
                        <TouchableOpacity 
                          style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: ZOMATO_RED, borderRadius: 12, paddingHorizontal: 8, paddingVertical: 3 }}
                          onPress={() => addQuantityOption(index)}
                        >
                          <Ionicons name="add" size={14} color="#fff" />
                          <Text style={{ color: '#fff', fontSize: 11, fontWeight: '600', marginLeft: 2 }}>Add Size</Text>
                        </TouchableOpacity>
                      </View>
                      
                      {(!variant.quantities || variant.quantities.length === 0) && (
                        <Text style={{ fontSize: 11, color: '#9CA3AF', fontStyle: 'italic', marginBottom: 4 }}>
                          No sizes added. Add quantity options like 0.5 kg, 1 kg etc.
                        </Text>
                      )}

                      {variant.quantities && variant.quantities.map((q, qIdx) => (
                        <View key={qIdx} style={{ 
                          flexDirection: 'row', alignItems: 'center', 
                          backgroundColor: '#F9FAFB', borderRadius: 8, padding: 8, marginBottom: 6,
                          borderWidth: 1, borderColor: '#E5E7EB'
                        }}>
                          <View style={{ flex: 1, marginRight: 4 }}>
                            <Text style={{ fontSize: 10, color: '#6B7280', marginBottom: 2 }}>Qty</Text>
                            <TextInput
                              style={{ backgroundColor: '#fff', borderRadius: 6, borderWidth: 1, borderColor: '#E5E7EB', paddingHorizontal: 6, paddingVertical: 4, fontSize: 13 }}
                              value={q.quantity?.toString() || ''}
                              onChangeText={(val) => updateQuantityOption(index, qIdx, 'quantity', val)}
                              keyboardType="numeric"
                              placeholder="1"
                              placeholderTextColor="#D1D5DB"
                            />
                          </View>
                          <View style={{ flex: 1, marginRight: 4 }}>
                            <Text style={{ fontSize: 10, color: '#6B7280', marginBottom: 2 }}>Unit</Text>
                            <TouchableOpacity 
                              style={{ backgroundColor: '#fff', borderRadius: 6, borderWidth: 1, borderColor: '#E5E7EB', paddingHorizontal: 6, paddingVertical: 6, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
                              onPress={() => setQtyUnitPicker({ variantIndex: index, qtyIndex: qIdx })}
                            >
                              <Text style={{ fontSize: 13, color: '#1F2937' }}>{q.unit || 'piece'}</Text>
                              <Ionicons name="chevron-down" size={14} color="#9CA3AF" />
                            </TouchableOpacity>
                          </View>
                          <View style={{ flex: 1, marginRight: 4 }}>
                            <Text style={{ fontSize: 10, color: '#6B7280', marginBottom: 2 }}>Price <Text style={{ color: ZOMATO_RED }}>*</Text></Text>
                            <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 6, borderWidth: 1, borderColor: '#E5E7EB', paddingHorizontal: 4 }}>
                              <Text style={{ fontSize: 12, color: '#9CA3AF' }}>₹</Text>
                              <TextInput
                                style={{ flex: 1, paddingHorizontal: 4, paddingVertical: 4, fontSize: 13 }}
                                value={q.price?.toString() || ''}
                                onChangeText={(val) => updateQuantityOption(index, qIdx, 'price', val)}
                                keyboardType="numeric"
                                placeholder="0"
                                placeholderTextColor="#D1D5DB"
                              />
                            </View>
                          </View>
                          <TouchableOpacity onPress={() => removeQuantityOption(index, qIdx)} style={{ padding: 4 }}>
                            <Ionicons name="close-circle" size={20} color="#EF4444" />
                          </TouchableOpacity>
                        </View>
                      ))}
                    </View>

                    {/* Available Toggle */}
                    <View style={styles.variantAvailableRow}>
                      <Text style={styles.variantFieldLabel}>Available</Text>
                      <Switch
                        value={variant.available !== false}
                        onValueChange={(val) => updateVariant(index, 'available', val)}
                        trackColor={{ false: '#E5E7EB', true: '#BBF7D0' }}
                        thumbColor={variant.available !== false ? '#22C55E' : '#9CA3AF'}
                      />
                    </View>
                  </View>
                ))}
              </View>

              {/* Price, Qty, Unit – only when no variants */}
              {variants.length === 0 && (
                <>
                  <View style={styles.inputGroup}>
                    <Text style={styles.label}>Price <Text style={styles.required}>*</Text></Text>
                    <View style={styles.priceInputContainer}>
                      <Text style={styles.currencySymbol}>₹</Text>
                      <TextInput
                        style={styles.priceInput}
                        value={price}
                        onChangeText={setPrice}
                        placeholder="0"
                        placeholderTextColor="#9CA3AF"
                        keyboardType="numeric"
                      />
                    </View>
                  </View>

                  <View style={styles.rowInputs}>
                    <View style={[styles.inputGroup, { flex: 1 }]}>
                      <Text style={styles.label}>Quantity</Text>
                      <TextInput
                        style={styles.input}
                        value={quantity}
                        onChangeText={setQuantity}
                        placeholder="1"
                        placeholderTextColor="#9CA3AF"
                        keyboardType="numeric"
                      />
                    </View>
                    <View style={[styles.inputGroup, { flex: 1 }]}>
                      <Text style={styles.label}>Unit</Text>
                      <TouchableOpacity style={styles.pickerButton} onPress={() => setShowUnitPicker(true)}>
                        <Text style={styles.pickerValue}>{unit}</Text>
                        <Ionicons name="chevron-down" size={20} color="#9CA3AF" />
                      </TouchableOpacity>
                    </View>
                  </View>
                </>
              )}

              {/* Preparation Time */}
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Preparation Time</Text>
                <View style={styles.prepTimeContainer}>
                  <TouchableOpacity 
                    style={styles.prepTimeButton}
                    onPress={() => setPreparationTime(Math.max(0, parseInt(preparationTime || 0) - 5).toString())}
                  >
                    <Ionicons name="remove" size={22} color={ZOMATO_RED} />
                  </TouchableOpacity>
                  <View style={styles.prepTimeInputWrapper}>
                    <TextInput
                      style={styles.prepTimeInput}
                      value={preparationTime}
                      onChangeText={setPreparationTime}
                      keyboardType="numeric"
                      textAlign="center"
                    />
                    <Text style={styles.prepTimeUnit}>min</Text>
                  </View>
                  <TouchableOpacity 
                    style={styles.prepTimeButton}
                    onPress={() => setPreparationTime((parseInt(preparationTime || 0) + 5).toString())}
                  >
                    <Ionicons name="add" size={22} color={ZOMATO_RED} />
                  </TouchableOpacity>
                </View>
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

      {/* Category Picker Modal */}
      <Modal visible={showCategoryPicker} animationType="slide" transparent={true} onRequestClose={() => setShowCategoryPicker(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHandle} />
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select Categories</Text>
              <TouchableOpacity style={styles.modalCloseButton} onPress={() => setShowCategoryPicker(false)}>
                <Ionicons name="close" size={24} color="#696969" />
              </TouchableOpacity>
            </View>
            <FlatList
              data={categories}
              keyExtractor={(item) => item._id}
              renderItem={({ item }) => (
                <TouchableOpacity style={styles.categoryOption} onPress={() => toggleCategory(item.name)}>
                  <View style={[styles.checkbox, selectedCategories.includes(item.name) && styles.checkboxChecked]}>
                    {selectedCategories.includes(item.name) && <Ionicons name="checkmark" size={16} color="#fff" />}
                  </View>
                  <Text style={styles.categoryOptionText}>{item.name}</Text>
                </TouchableOpacity>
              )}
              ListEmptyComponent={<Text style={styles.emptyText}>No categories found. Add categories from Menu screen.</Text>}
              contentContainerStyle={styles.modalList}
            />
            <View style={styles.modalFooter}>
              <TouchableOpacity style={styles.modalDoneButton} onPress={() => setShowCategoryPicker(false)}>
                <Text style={styles.modalDoneButtonText}>Done</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Unit Picker Modal */}
      <Modal visible={showUnitPicker} animationType="slide" transparent={true} onRequestClose={() => setShowUnitPicker(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHandle} />
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select Unit</Text>
              <TouchableOpacity style={styles.modalCloseButton} onPress={() => setShowUnitPicker(false)}>
                <Ionicons name="close" size={24} color="#696969" />
              </TouchableOpacity>
            </View>
            <FlatList
              data={UNITS}
              keyExtractor={(item) => item}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.unitOption, unit === item && styles.unitOptionSelected]}
                  onPress={() => { setUnit(item); setShowUnitPicker(false); }}
                >
                  <Text style={[styles.unitOptionText, unit === item && styles.unitOptionTextSelected]}>{item}</Text>
                  {unit === item && <Ionicons name="checkmark-circle" size={22} color={ZOMATO_RED} />}
                </TouchableOpacity>
              )}
              contentContainerStyle={styles.modalList}
            />
          </View>
        </View>
      </Modal>

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
    gap: 14,
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
    fontSize: 15,
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
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
  },
  addVariantButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#fff',
  },
  noVariantsContainer: {
    alignItems: 'center',
    paddingVertical: 20,
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#E8E8E8',
    borderStyle: 'dashed',
  },
  noVariantsText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#9CA3AF',
    marginTop: 8,
  },
  noVariantsHint: {
    fontSize: 12,
    color: '#D1D5DB',
    marginTop: 2,
  },
  variantCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1.5,
    borderColor: '#E8E8E8',
    gap: 12,
  },
  variantCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  variantCardNumber: {
    fontSize: 14,
    fontWeight: '700',
    color: ZOMATO_RED,
  },
  variantImageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  variantImagePicker: {
    width: 56,
    height: 56,
    borderRadius: 12,
    overflow: 'hidden',
  },
  variantImagePreview: {
    width: 56,
    height: 56,
    borderRadius: 12,
  },
  variantImagePlaceholder: {
    width: 56,
    height: 56,
    borderRadius: 12,
    backgroundColor: '#F3F4F6',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#E8E8E8',
    borderStyle: 'dashed',
  },
  variantImageRemove: {
    marginLeft: -16,
    marginTop: -10,
  },
  variantImageHintContainer: {
    flex: 1,
  },
  variantImageHintText: {
    fontSize: 12,
    color: '#9CA3AF',
  },
  variantField: {
    gap: 6,
  },
  variantFieldLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#696969',
  },
  variantInput: {
    backgroundColor: '#F9FAFB',
    borderRadius: 10,
    paddingHorizontal: 14,
    height: 44,
    borderWidth: 1,
    borderColor: '#E8E8E8',
    fontSize: 14,
    color: '#1C1C1C',
    fontWeight: '500',
  },
  variantTypeRow: {
    flexDirection: 'row',
    gap: 10,
  },
  variantTypeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: '#F3F4F6',
    borderWidth: 1.5,
    borderColor: '#E8E8E8',
  },
  variantTypeChipActive: {
    backgroundColor: ZOMATO_RED,
    borderColor: ZOMATO_RED,
  },
  variantTypeChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#696969',
  },
  variantTypeChipTextActive: {
    color: '#fff',
  },
  variantPriceRow: {
    flexDirection: 'row',
    gap: 12,
  },
  variantPriceInput: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
    borderRadius: 10,
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
    paddingTop: 4,
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
