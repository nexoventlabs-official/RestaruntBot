import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput,
  TouchableOpacity, Image, Alert, ActivityIndicator, Animated, Platform,
  KeyboardAvoidingView, StatusBar
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import api from '../../config/api';

// Zomato Theme Colors
const ZOMATO_RED = '#E23744';
const ZOMATO_DARK_RED = '#CB1A27';

export default function OfferFormScreen({ route, navigation }) {
  const existingOffer = route.params?.offer;
  const isEditing = !!existingOffer;

  const [offerType, setOfferType] = useState(existingOffer?.offerType || '');
  const [image, setImage] = useState(existingOffer?.image || null);
  const [newImage, setNewImage] = useState(null);
  const [loading, setLoading] = useState(false);
  const [menuItems, setMenuItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [activeOffers, setActiveOffers] = useState([]);
  const [loadingItems, setLoadingItems] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState(null);
  
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 400, useNativeDriver: true }),
    ]).start();
    
    loadCategories();
    loadMenuItems();
    loadActiveOffers();
  }, []);

  const loadActiveOffers = async () => {
    try {
      const response = await api.get('/offers');
      setActiveOffers(response.data);
    } catch (error) {
      console.error('Error loading offers:', error);
    }
  };

  const loadCategories = async () => {
    try {
      const response = await api.get('/categories');
      setCategories(response.data.filter(cat => cat.isActive));
    } catch (error) {
      console.error('Error loading categories:', error);
    }
  };

  const loadMenuItems = async () => {
    try {
      const response = await api.get('/menu');
      setMenuItems(response.data);
    } catch (error) {
      console.error('Error loading menu items:', error);
    } finally {
      setLoadingItems(false);
    }
  };

  const toggleItemOfferType = async (item) => {
    try {
      const currentOfferTypes = Array.isArray(item.offerType) ? item.offerType : (item.offerType ? [item.offerType] : []);
      const hasOffer = currentOfferTypes.includes(offerType);
      
      let updatedOfferTypes;
      if (hasOffer) {
        updatedOfferTypes = currentOfferTypes.filter(type => type !== offerType);
      } else {
        updatedOfferTypes = [...currentOfferTypes, offerType];
      }

      const formData = new FormData();
      formData.append('name', item.name);
      formData.append('description', item.description || '');
      formData.append('price', item.price.toString());
      formData.append('category', JSON.stringify(item.category));
      formData.append('unit', item.unit || 'piece');
      formData.append('quantity', item.quantity?.toString() || '1');
      formData.append('foodType', item.foodType || 'none');
      formData.append('offerType', JSON.stringify(updatedOfferTypes));
      formData.append('available', item.available?.toString() || 'true');
      formData.append('preparationTime', item.preparationTime?.toString() || '15');
      formData.append('tags', item.tags?.join(',') || '');
      if (item.originalPrice) {
        formData.append('originalPrice', item.originalPrice.toString());
      }

      await api.put(`/menu/${item._id}`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      setMenuItems(menuItems.map(i => 
        i._id === item._id ? { ...i, offerType: updatedOfferTypes } : i
      ));
    } catch (error) {
      Alert.alert('Error', 'Failed to update item offer type');
      console.error('Error updating item:', error);
    }
  };

  const pickImage = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Please allow access to your photo library to upload images.');
        return;
      }

      // 16:9 aspect ratio for universal banner
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        allowsMultipleSelection: false,
        aspect: [16, 9], // Universal 16:9 ratio
        quality: 0.9,
        exif: false,
      });
      
      if (!result.canceled) {
        const imageData = result.assets[0];
        setNewImage(imageData);
        setImage(imageData.uri);
      }
    } catch (error) {
      console.error('Error picking image:', error);
      Alert.alert('Error', 'Failed to pick image. Please try again.');
    }
  };

  const handleSubmit = async () => {
    if (!image && !newImage) {
      Alert.alert('Error', 'Please add a banner image (16:9 ratio)');
      return;
    }

    if (!offerType || !offerType.trim()) {
      Alert.alert('Error', 'Please enter an offer type');
      return;
    }

    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('isActive', 'true');
      formData.append('offerType', offerType.trim());

      if (newImage) {
        const filename = newImage.uri.split('/').pop();
        const match = /\.(\w+)$/.exec(filename);
        const type = match ? `image/${match[1]}` : 'image/jpeg';
        formData.append('image', { uri: newImage.uri, name: filename, type });
      }

      if (isEditing) {
        await api.put(`/offers/${existingOffer._id}`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        Alert.alert('Success', 'Offer updated successfully');
      } else {
        await api.post('/offers', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        Alert.alert('Success', 'Offer created successfully');
      }
      navigation.goBack();
    } catch (error) {
      Alert.alert('Error', error.response?.data?.error || 'Failed to save offer');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />
      
      {/* Header */}
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
          <Text style={styles.headerTitle}>{isEditing ? 'Edit Offer' : 'New Offer'}</Text>
          <View style={{ width: 44 }} />
        </LinearGradient>
      </Animated.View>

      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
          <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>
            
            {/* Info Banner */}
            <View style={styles.infoBanner}>
              <Ionicons name="information-circle" size={20} color={ZOMATO_RED} />
              <Text style={styles.infoBannerText}>
                Upload one banner image in 16:9 ratio (1920×1080px recommended). Works perfectly on all devices - mobile, tablet, and desktop.
              </Text>
            </View>

            {/* Image Upload Section */}
            <View style={styles.imageSection}>
              <View style={styles.imageSectionHeader}>
                <Ionicons name="image" size={20} color={ZOMATO_RED} />
                <Text style={styles.imageSectionTitle}>Banner Image (16:9)</Text>
              </View>
              <Text style={styles.imageSectionHint}>Universal landscape format for all screens</Text>
              <Text style={styles.imageSectionRecommended}>Recommended: 1920×1080px (16:9 ratio)</Text>
              
              {/* Preview */}
              {image && (
                <View style={styles.previewContainer}>
                  <Text style={styles.previewLabel}>Preview</Text>
                  <View style={styles.previewFrame}>
                    <Image 
                      source={{ uri: image }} 
                      style={styles.previewImage}
                      resizeMode="cover" 
                    />
                  </View>
                </View>
              )}
              
              {/* Upload Button */}
              <TouchableOpacity 
                style={styles.uploadButton} 
                onPress={pickImage} 
                activeOpacity={0.8}
              >
                {image ? (
                  <>
                    <Ionicons name="camera" size={20} color={ZOMATO_RED} />
                    <Text style={styles.uploadButtonText}>Change Banner Image</Text>
                  </>
                ) : (
                  <>
                    <Ionicons name="cloud-upload-outline" size={20} color={ZOMATO_RED} />
                    <Text style={styles.uploadButtonText}>Upload Banner (16:9)</Text>
                  </>
                )}
              </TouchableOpacity>
              
              {image && (
                <View style={styles.previewInfo}>
                  <Ionicons name="checkmark-circle" size={16} color="#22C55E" />
                  <Text style={styles.previewInfoTextSuccess}>
                    Image uploaded • Will display perfectly on all devices
                  </Text>
                </View>
              )}
            </View>

            {/* Offer Type Input */}
            <View style={styles.form}>
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Offer Type <Text style={styles.required}>*</Text></Text>
                <Text style={styles.hint}>e.g., "1+1 Offer", "Buy 2 Get 1", "50% Off"</Text>
                <TextInput
                  style={styles.input}
                  value={offerType}
                  onChangeText={setOfferType}
                  placeholder="Enter offer type"
                  placeholderTextColor="#9CA3AF"
                />
              </View>

              {/* Assign Items to Offer */}
              {offerType.trim() && (
                <View style={styles.itemsSection}>
                  <View style={styles.itemsSectionHeader}>
                    <Ionicons name="restaurant" size={20} color={ZOMATO_RED} />
                    <Text style={styles.itemsSectionTitle}>Assign Menu Items</Text>
                  </View>
                  <Text style={styles.itemsSectionHint}>
                    Select items that should have this "{offerType}" offer
                  </Text>

                  {loadingItems ? (
                    <View style={styles.itemsLoading}>
                      <ActivityIndicator size="small" color={ZOMATO_RED} />
                      <Text style={styles.itemsLoadingText}>Loading menu items...</Text>
                    </View>
                  ) : selectedCategory ? (
                    <>
                      <TouchableOpacity 
                        style={styles.categoryBackButton}
                        onPress={() => setSelectedCategory(null)}
                        activeOpacity={0.7}
                      >
                        <Ionicons name="arrow-back" size={20} color={ZOMATO_RED} />
                        <Text style={styles.categoryBackButtonText}>Back to Categories</Text>
                      </TouchableOpacity>

                      <View style={styles.itemsList}>
                        {menuItems
                          .filter(item => {
                            const itemCategories = Array.isArray(item.category) ? item.category : [item.category];
                            return itemCategories.includes(selectedCategory);
                          })
                          .map((item) => {
                            const itemOfferTypes = Array.isArray(item.offerType) 
                              ? item.offerType 
                              : (item.offerType ? [item.offerType] : []);
                            
                            const activeOfferTypes = activeOffers.map(o => o.offerType);
                            const validOfferTypes = itemOfferTypes.filter(type => 
                              activeOfferTypes.includes(type) || type === offerType
                            );
                            
                            const hasThisOffer = validOfferTypes.includes(offerType);

                            return (
                              <TouchableOpacity
                                key={item._id}
                                style={[styles.itemCard, hasThisOffer && styles.itemCardSelected]}
                                onPress={() => toggleItemOfferType(item)}
                                activeOpacity={0.7}
                              >
                                <View style={styles.itemCardContent}>
                                  {item.image ? (
                                    <Image source={{ uri: item.image }} style={styles.itemImage} />
                                  ) : (
                                    <View style={styles.itemImagePlaceholder}>
                                      <Ionicons name="fast-food" size={20} color="#9CA3AF" />
                                    </View>
                                  )}
                                  
                                  <View style={styles.itemInfo}>
                                    <Text style={styles.itemName} numberOfLines={1}>{item.name}</Text>
                                    <Text style={styles.itemPrice}>₹{item.price}</Text>
                                    {validOfferTypes.length > 0 && (
                                      <View style={styles.itemOfferTags}>
                                        {validOfferTypes.map((type, index) => (
                                          <View 
                                            key={index} 
                                            style={[
                                              styles.itemOfferTag,
                                              type === offerType && styles.itemOfferTagCurrent
                                            ]}
                                          >
                                            <Text style={[
                                              styles.itemOfferTagText,
                                              type === offerType && styles.itemOfferTagTextCurrent
                                            ]}>
                                              {type}
                                            </Text>
                                          </View>
                                        ))}
                                      </View>
                                    )}
                                  </View>

                                  <View style={[
                                    styles.itemCheckbox,
                                    hasThisOffer && styles.itemCheckboxSelected
                                  ]}>
                                    {hasThisOffer && (
                                      <Ionicons name="checkmark" size={16} color="#fff" />
                                    )}
                                  </View>
                                </View>
                              </TouchableOpacity>
                            );
                          })}
                      </View>
                    </>
                  ) : (
                    <View style={styles.categoriesList}>
                      {categories.length === 0 ? (
                        <View style={styles.emptyItems}>
                          <Ionicons name="grid-outline" size={32} color="#9CA3AF" />
                          <Text style={styles.emptyItemsText}>No categories available</Text>
                        </View>
                      ) : (
                        categories.map((category) => {
                          const categoryItemCount = menuItems.filter(item => {
                            const itemCategories = Array.isArray(item.category) ? item.category : [item.category];
                            return itemCategories.includes(category.name);
                          }).length;

                          return (
                            <TouchableOpacity
                              key={category._id}
                              style={styles.categoryCard}
                              onPress={() => setSelectedCategory(category.name)}
                              activeOpacity={0.7}
                            >
                              <View style={styles.categoryCardContent}>
                                {category.image ? (
                                  <Image source={{ uri: category.image }} style={styles.categoryImage} />
                                ) : (
                                  <View style={styles.categoryImagePlaceholder}>
                                    <Ionicons name="grid" size={24} color="#9CA3AF" />
                                  </View>
                                )}
                                
                                <View style={styles.categoryInfo}>
                                  <Text style={styles.categoryName}>{category.name}</Text>
                                  <Text style={styles.categoryItemCount}>
                                    {categoryItemCount} {categoryItemCount === 1 ? 'item' : 'items'}
                                  </Text>
                                </View>

                                <Ionicons name="chevron-forward" size={20} color="#9CA3AF" />
                              </View>
                            </TouchableOpacity>
                          );
                        })
                      )}
                    </View>
                  )}
                </View>
              )}
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
              <Text style={styles.submitButtonText}>{isEditing ? 'Update Offer' : 'Create Offer'}</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      {/* Loading Overlay */}
      {loading && (
        <View style={styles.loadingOverlay}>
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={ZOMATO_RED} />
            <Text style={styles.loadingText}>
              {isEditing ? 'Updating offer...' : 'Creating offer...'}
            </Text>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F8F8' },
  
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
  
  infoBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#FEF2F2',
    padding: 16,
    borderRadius: 16,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#FEE2E2',
  },
  infoBannerText: {
    flex: 1,
    fontSize: 13,
    color: '#991B1B',
    lineHeight: 18,
    fontWeight: '500',
  },
  
  imageSection: { marginBottom: 24 },
  imageSectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  imageSectionTitle: { fontSize: 16, fontWeight: '700', color: '#1C1C1C' },
  imageSectionHint: { fontSize: 13, color: '#9CA3AF', marginBottom: 2 },
  imageSectionRecommended: { fontSize: 12, color: ZOMATO_RED, marginBottom: 16, fontWeight: '600' },
  
  previewContainer: {
    marginBottom: 16,
    alignItems: 'center',
  },
  previewLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6B7280',
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  previewFrame: {
    width: '100%',
    aspectRatio: 16/9,
    backgroundColor: '#000',
    borderRadius: 12,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  previewImage: {
    width: '100%',
    height: '100%',
  },
  
  uploadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: ZOMATO_RED,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  uploadButtonText: {
    color: ZOMATO_RED,
    fontSize: 15,
    fontWeight: '700',
  },
  
  previewInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#F3F4F6',
    padding: 12,
    borderRadius: 12,
  },
  previewInfoTextSuccess: {
    flex: 1,
    fontSize: 12,
    color: '#059669',
    lineHeight: 16,
    fontWeight: '500',
  },
  
  form: { gap: 20 },
  inputGroup: { gap: 8 },
  label: { fontSize: 14, fontWeight: '700', color: '#1C1C1C' },
  required: { color: ZOMATO_RED },
  hint: { fontSize: 12, color: '#9CA3AF', marginTop: -4, marginBottom: 4 },
  input: {
    backgroundColor: '#fff', borderRadius: 14, paddingHorizontal: 18, height: 54,
    borderWidth: 1.5, borderColor: '#E8E8E8', fontSize: 15, color: '#1C1C1C', fontWeight: '500',
  },

  itemsSection: {
    marginTop: 24,
    backgroundColor: '#F9FAFB',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  itemsSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  itemsSectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1C1C1C',
  },
  itemsSectionHint: {
    fontSize: 13,
    color: '#6B7280',
    marginBottom: 16,
  },
  itemsLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingVertical: 24,
  },
  itemsLoadingText: {
    fontSize: 14,
    color: '#6B7280',
  },
  emptyItems: {
    alignItems: 'center',
    paddingVertical: 32,
  },
  emptyItemsText: {
    fontSize: 14,
    color: '#9CA3AF',
    marginTop: 8,
  },
  
  categoryBackButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: '#fff',
    borderRadius: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: ZOMATO_RED,
  },
  categoryBackButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: ZOMATO_RED,
  },

  categoriesList: {
    gap: 12,
  },
  categoryCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  categoryCardContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  categoryImage: {
    width: 60,
    height: 60,
    borderRadius: 12,
  },
  categoryImagePlaceholder: {
    width: 60,
    height: 60,
    borderRadius: 12,
    backgroundColor: '#F3F4F6',
    justifyContent: 'center',
    alignItems: 'center',
  },
  categoryInfo: {
    flex: 1,
  },
  categoryName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1C1C1C',
    marginBottom: 4,
  },
  categoryItemCount: {
    fontSize: 13,
    color: '#6B7280',
  },

  itemsList: {
    gap: 12,
  },
  itemCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    borderWidth: 2,
    borderColor: '#E5E7EB',
  },
  itemCardSelected: {
    borderColor: ZOMATO_RED,
    backgroundColor: '#FEF2F2',
  },
  itemCardContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  itemImage: {
    width: 50,
    height: 50,
    borderRadius: 8,
  },
  itemImagePlaceholder: {
    width: 50,
    height: 50,
    borderRadius: 8,
    backgroundColor: '#F3F4F6',
    justifyContent: 'center',
    alignItems: 'center',
  },
  itemInfo: {
    flex: 1,
  },
  itemName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1C1C1C',
    marginBottom: 2,
  },
  itemPrice: {
    fontSize: 13,
    fontWeight: '700',
    color: ZOMATO_RED,
    marginBottom: 4,
  },
  itemOfferTags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  itemOfferTag: {
    backgroundColor: '#E5E7EB',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  itemOfferTagCurrent: {
    backgroundColor: ZOMATO_RED,
  },
  itemOfferTagText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#6B7280',
  },
  itemOfferTagTextCurrent: {
    color: '#fff',
  },
  itemCheckbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#D1D5DB',
    justifyContent: 'center',
    alignItems: 'center',
  },
  itemCheckboxSelected: {
    backgroundColor: ZOMATO_RED,
    borderColor: ZOMATO_RED,
  },
  
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
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    minWidth: 200,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    fontWeight: '600',
    color: '#1C1C1C',
  },
});
