import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView, ScrollView, TextInput,
  TouchableOpacity, Image, Alert, ActivityIndicator, Switch, Modal, FlatList
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import api from '../../config/api';

const FOOD_TYPES = [
  { value: 'veg', label: 'Veg', color: '#22c55e' },
  { value: 'nonveg', label: 'Non-Veg', color: '#ef4444' },
  { value: 'egg', label: 'Egg', color: '#f59e0b' },
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
  const [aiLoading, setAiLoading] = useState(false);
  
  // Categories
  const [categories, setCategories] = useState([]);
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  const [showUnitPicker, setShowUnitPicker] = useState(false);

  useEffect(() => {
    fetchCategories();
  }, []);

  const fetchCategories = async () => {
    try {
      const response = await api.get('/categories');
      setCategories(response.data || []);
    } catch (error) {
      console.error('Error fetching categories:', error);
    }
  };

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });

    if (!result.canceled) {
      setNewImage(result.assets[0]);
      setImage(result.assets[0].uri);
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
      const response = await api.post('/ai/generate-description', { 
        name, 
        category: selectedCategories 
      });
      setDescription(response.data.description);
    } catch (error) {
      Alert.alert('Error', 'Failed to generate description');
    } finally {
      setAiLoading(false);
    }
  };

  const toggleCategory = (categoryName) => {
    if (selectedCategories.includes(categoryName)) {
      setSelectedCategories(selectedCategories.filter(c => c !== categoryName));
    } else {
      setSelectedCategories([...selectedCategories, categoryName]);
    }
  };

  const handleSubmit = async () => {
    if (!name.trim() || !price.trim() || selectedCategories.length === 0) {
      Alert.alert('Error', 'Please fill in name, price, and select at least one category');
      return;
    }

    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('name', name);
      formData.append('description', description);
      formData.append('price', price);
      formData.append('category', JSON.stringify(selectedCategories));
      formData.append('unit', unit);
      formData.append('quantity', quantity);
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

      if (isEditing) {
        await api.put(`/menu/${existingItem._id}`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        Alert.alert('Success', 'Menu item updated');
      } else {
        await api.post('/menu', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        Alert.alert('Success', 'Menu item created');
      }
      navigation.goBack();
    } catch (error) {
      Alert.alert('Error', error.response?.data?.error || 'Failed to save item');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={24} color="#1c1d21" />
        </TouchableOpacity>
        <Text style={styles.title}>{isEditing ? 'Edit Item' : 'Add Item'}</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Image */}
        <View style={styles.imageSection}>
          <TouchableOpacity style={styles.imageContainer} onPress={pickImage}>
            {image ? (
              <Image source={{ uri: image }} style={styles.image} />
            ) : (
              <View style={styles.imagePlaceholder}>
                <Ionicons name="camera-outline" size={36} color="#9ca3af" />
                <Text style={styles.imagePlaceholderText}>Add Image</Text>
              </View>
            )}
          </TouchableOpacity>
          {image && (
            <TouchableOpacity style={styles.removeImageButton} onPress={removeImage}>
              <Ionicons name="close-circle" size={28} color="#ef4444" />
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.form}>
          {/* Name */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Item Name *</Text>
            <TextInput 
              style={styles.input} 
              value={name} 
              onChangeText={setName} 
              placeholder="e.g., Margherita Pizza" 
              placeholderTextColor="#9ca3af"
            />
          </View>

          {/* Description with AI */}
          <View style={styles.inputGroup}>
            <View style={styles.labelRow}>
              <Text style={styles.label}>Description</Text>
              <TouchableOpacity 
                style={styles.aiButton} 
                onPress={generateDescription}
                disabled={aiLoading}
              >
                {aiLoading ? (
                  <ActivityIndicator size="small" color="#8b5cf6" />
                ) : (
                  <>
                    <Ionicons name="sparkles" size={14} color="#8b5cf6" />
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
              placeholderTextColor="#9ca3af"
              multiline
              numberOfLines={3}
            />
          </View>

          {/* Price */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Price (₹) *</Text>
            <TextInput
              style={styles.input}
              value={price}
              onChangeText={setPrice}
              placeholder="0"
              placeholderTextColor="#9ca3af"
              keyboardType="numeric"
            />
          </View>

          {/* Categories */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Categories *</Text>
            <TouchableOpacity 
              style={styles.pickerButton}
              onPress={() => setShowCategoryPicker(true)}
            >
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
              <Ionicons name="chevron-down" size={20} color="#9ca3af" />
            </TouchableOpacity>
          </View>

          {/* Unit & Quantity */}
          <View style={styles.rowInputs}>
            <View style={[styles.inputGroup, { flex: 1 }]}>
              <Text style={styles.label}>Quantity</Text>
              <TextInput
                style={styles.input}
                value={quantity}
                onChangeText={setQuantity}
                placeholder="1"
                placeholderTextColor="#9ca3af"
                keyboardType="numeric"
              />
            </View>
            <View style={[styles.inputGroup, { flex: 1 }]}>
              <Text style={styles.label}>Unit</Text>
              <TouchableOpacity 
                style={styles.pickerButton}
                onPress={() => setShowUnitPicker(true)}
              >
                <Text style={styles.pickerValue}>{unit}</Text>
                <Ionicons name="chevron-down" size={20} color="#9ca3af" />
              </TouchableOpacity>
            </View>
          </View>

          {/* Preparation Time */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Preparation Time (minutes)</Text>
            <View style={styles.prepTimeContainer}>
              <TouchableOpacity 
                style={styles.prepTimeButton}
                onPress={() => setPreparationTime(Math.max(0, parseInt(preparationTime || 0) - 5).toString())}
              >
                <Ionicons name="remove" size={20} color="#61636b" />
              </TouchableOpacity>
              <TextInput
                style={styles.prepTimeInput}
                value={preparationTime}
                onChangeText={setPreparationTime}
                keyboardType="numeric"
                textAlign="center"
              />
              <TouchableOpacity 
                style={styles.prepTimeButton}
                onPress={() => setPreparationTime((parseInt(preparationTime || 0) + 5).toString())}
              >
                <Ionicons name="add" size={20} color="#61636b" />
              </TouchableOpacity>
              <Text style={styles.prepTimeLabel}>min</Text>
            </View>
          </View>

          {/* Food Type */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Food Type</Text>
            <View style={styles.foodTypeContainer}>
              {FOOD_TYPES.map((type) => (
                <TouchableOpacity
                  key={type.value}
                  style={[
                    styles.foodTypeButton, 
                    foodType === type.value && { backgroundColor: type.color, borderColor: type.color }
                  ]}
                  onPress={() => setFoodType(type.value)}
                >
                  <View style={[
                    styles.foodTypeIcon, 
                    { borderColor: foodType === type.value ? '#fff' : type.color }
                  ]}>
                    <View style={[
                      styles.foodTypeDot, 
                      { backgroundColor: foodType === type.value ? '#fff' : type.color }
                    ]} />
                  </View>
                  <Text style={[
                    styles.foodTypeText, 
                    foodType === type.value && { color: '#fff' }
                  ]}>
                    {type.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Tags */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Tags (comma separated)</Text>
            <TextInput
              style={styles.input}
              value={tags}
              onChangeText={setTags}
              placeholder="e.g., spicy, bestseller, new"
              placeholderTextColor="#9ca3af"
            />
          </View>

          {/* Available */}
          <View style={styles.switchRow}>
            <View>
              <Text style={styles.label}>Available</Text>
              <Text style={styles.switchHint}>Item will be visible to customers</Text>
            </View>
            <Switch
              value={available}
              onValueChange={setAvailable}
              trackColor={{ false: '#d1d5db', true: '#86efac' }}
              thumbColor={available ? '#22c55e' : '#9ca3af'}
            />
          </View>
        </View>

        <View style={{ height: 100 }} />
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.submitButton, loading && styles.submitButtonDisabled]}
          onPress={handleSubmit}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.submitButtonText}>{isEditing ? 'Update Item' : 'Add Item'}</Text>
          )}
        </TouchableOpacity>
      </View>

      {/* Category Picker Modal */}
      <Modal
        visible={showCategoryPicker}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowCategoryPicker(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select Categories</Text>
              <TouchableOpacity onPress={() => setShowCategoryPicker(false)}>
                <Ionicons name="close" size={24} color="#61636b" />
              </TouchableOpacity>
            </View>
            <FlatList
              data={categories}
              keyExtractor={(item) => item._id}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.categoryOption}
                  onPress={() => toggleCategory(item.name)}
                >
                  <View style={[
                    styles.checkbox,
                    selectedCategories.includes(item.name) && styles.checkboxChecked
                  ]}>
                    {selectedCategories.includes(item.name) && (
                      <Ionicons name="checkmark" size={16} color="#fff" />
                    )}
                  </View>
                  <Text style={styles.categoryOptionText}>{item.name}</Text>
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                <Text style={styles.emptyText}>No categories found. Add categories from Menu screen.</Text>
              }
              contentContainerStyle={styles.modalList}
            />
            <TouchableOpacity 
              style={styles.modalDoneButton}
              onPress={() => setShowCategoryPicker(false)}
            >
              <Text style={styles.modalDoneButtonText}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Unit Picker Modal */}
      <Modal
        visible={showUnitPicker}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowUnitPicker(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select Unit</Text>
              <TouchableOpacity onPress={() => setShowUnitPicker(false)}>
                <Ionicons name="close" size={24} color="#61636b" />
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
                  <Text style={[styles.unitOptionText, unit === item && styles.unitOptionTextSelected]}>
                    {item}
                  </Text>
                  {unit === item && <Ionicons name="checkmark" size={20} color="#e63946" />}
                </TouchableOpacity>
              )}
              contentContainerStyle={styles.modalList}
            />
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
  
  // Image
  imageSection: { alignItems: 'center', marginBottom: 20, position: 'relative' },
  imageContainer: { alignItems: 'center' },
  image: { width: 140, height: 140, borderRadius: 16 },
  imagePlaceholder: {
    width: 140, height: 140, borderRadius: 16, backgroundColor: '#f3f4f6',
    justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#e5e7eb', borderStyle: 'dashed',
  },
  imagePlaceholderText: { color: '#9ca3af', marginTop: 8, fontSize: 13 },
  removeImageButton: { position: 'absolute', top: -8, right: '30%' },
  
  // Form
  form: { gap: 18 },
  inputGroup: { gap: 8 },
  label: { fontSize: 14, fontWeight: '600', color: '#1c1d21' },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  input: {
    backgroundColor: '#fff', borderRadius: 12, paddingHorizontal: 16, height: 50,
    borderWidth: 1, borderColor: '#e5e7eb', fontSize: 15, color: '#1c1d21',
  },
  textArea: { height: 90, textAlignVertical: 'top', paddingTop: 14 },
  
  // AI Button
  aiButton: { 
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#f3e8ff', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8,
  },
  aiButtonText: { fontSize: 12, color: '#8b5cf6', fontWeight: '600' },
  
  // Picker
  pickerButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#fff', borderRadius: 12, paddingHorizontal: 16, height: 50,
    borderWidth: 1, borderColor: '#e5e7eb',
  },
  pickerPlaceholder: { color: '#9ca3af', fontSize: 15 },
  pickerValue: { color: '#1c1d21', fontSize: 15 },
  selectedTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, flex: 1 },
  selectedTag: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#e63946', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 16,
  },
  selectedTagText: { color: '#fff', fontSize: 13, fontWeight: '500' },
  
  // Row inputs
  rowInputs: { flexDirection: 'row', gap: 12 },
  
  // Prep time
  prepTimeContainer: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  prepTimeButton: {
    width: 44, height: 44, borderRadius: 12, backgroundColor: '#f3f4f6',
    justifyContent: 'center', alignItems: 'center',
  },
  prepTimeInput: {
    width: 60, height: 44, backgroundColor: '#fff', borderRadius: 12,
    borderWidth: 1, borderColor: '#e5e7eb', fontSize: 16, color: '#1c1d21',
  },
  prepTimeLabel: { fontSize: 14, color: '#61636b' },
  
  // Food type
  foodTypeContainer: { flexDirection: 'row', gap: 10 },
  foodTypeButton: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 14, borderRadius: 12, backgroundColor: '#fff',
    borderWidth: 1.5, borderColor: '#e5e7eb',
  },
  foodTypeIcon: { width: 16, height: 16, borderRadius: 4, borderWidth: 2, justifyContent: 'center', alignItems: 'center' },
  foodTypeDot: { width: 8, height: 8, borderRadius: 4 },
  foodTypeText: { fontSize: 14, fontWeight: '600', color: '#61636b' },
  
  // Switch
  switchRow: { 
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: '#fff', padding: 16, borderRadius: 12, borderWidth: 1, borderColor: '#e5e7eb',
  },
  switchHint: { fontSize: 12, color: '#9ca3af', marginTop: 2 },
  
  // Footer
  footer: { padding: 16, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#e5e7eb' },
  submitButton: { backgroundColor: '#e63946', height: 52, borderRadius: 14, justifyContent: 'center', alignItems: 'center' },
  submitButtonDisabled: { opacity: 0.7 },
  submitButtonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  
  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '70%' },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 20, borderBottomWidth: 1, borderBottomColor: '#e5e7eb',
  },
  modalTitle: { fontSize: 18, fontWeight: 'bold', color: '#1c1d21' },
  modalList: { padding: 16 },
  categoryOption: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 },
  checkbox: {
    width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: '#d1d5db',
    justifyContent: 'center', alignItems: 'center',
  },
  checkboxChecked: { backgroundColor: '#e63946', borderColor: '#e63946' },
  categoryOptionText: { fontSize: 16, color: '#1c1d21' },
  unitOption: { 
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#f3f4f6',
  },
  unitOptionSelected: { backgroundColor: '#fef2f2' },
  unitOptionText: { fontSize: 16, color: '#1c1d21' },
  unitOptionTextSelected: { color: '#e63946', fontWeight: '600' },
  modalDoneButton: { 
    margin: 16, backgroundColor: '#e63946', height: 50, borderRadius: 12, 
    justifyContent: 'center', alignItems: 'center' 
  },
  modalDoneButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  emptyText: { textAlign: 'center', color: '#9ca3af', padding: 20 },
});
