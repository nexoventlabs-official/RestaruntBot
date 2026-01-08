import React, { useState } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView, ScrollView, TextInput,
  TouchableOpacity, Image, Alert, ActivityIndicator, Switch
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import api from '../../config/api';

const FOOD_TYPES = [
  { value: 'veg', label: 'Veg', color: '#22c55e' },
  { value: 'nonveg', label: 'Non-Veg', color: '#ef4444' },
  { value: 'egg', label: 'Egg', color: '#f59e0b' },
  { value: 'none', label: 'None', color: '#9ca3af' },
];

export default function MenuItemFormScreen({ route, navigation }) {
  const existingItem = route.params?.item;
  const isEditing = !!existingItem;

  const [name, setName] = useState(existingItem?.name || '');
  const [description, setDescription] = useState(existingItem?.description || '');
  const [price, setPrice] = useState(existingItem?.price?.toString() || '');
  const [category, setCategory] = useState(existingItem?.category?.join(', ') || '');
  const [foodType, setFoodType] = useState(existingItem?.foodType || 'none');
  const [available, setAvailable] = useState(existingItem?.available !== false);
  const [image, setImage] = useState(existingItem?.image || null);
  const [newImage, setNewImage] = useState(null);
  const [loading, setLoading] = useState(false);

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

  const handleSubmit = async () => {
    if (!name.trim() || !price.trim() || !category.trim()) {
      Alert.alert('Error', 'Please fill in name, price, and category');
      return;
    }

    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('name', name);
      formData.append('description', description);
      formData.append('price', price);
      formData.append('category', JSON.stringify(category.split(',').map(c => c.trim())));
      formData.append('foodType', foodType);
      formData.append('available', available.toString());

      if (newImage) {
        const filename = newImage.uri.split('/').pop();
        const match = /\.(\w+)$/.exec(filename);
        const type = match ? `image/${match[1]}` : 'image/jpeg';
        formData.append('image', { uri: newImage.uri, name: filename, type });
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

      <ScrollView style={styles.content}>
        <TouchableOpacity style={styles.imageContainer} onPress={pickImage}>
          {image ? (
            <Image source={{ uri: image }} style={styles.image} />
          ) : (
            <View style={styles.imagePlaceholder}>
              <Ionicons name="camera-outline" size={40} color="#9ca3af" />
              <Text style={styles.imagePlaceholderText}>Add Image</Text>
            </View>
          )}
        </TouchableOpacity>

        <View style={styles.form}>
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Name *</Text>
            <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Item name" />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Description</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              value={description}
              onChangeText={setDescription}
              placeholder="Item description"
              multiline
              numberOfLines={3}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Price *</Text>
            <TextInput
              style={styles.input}
              value={price}
              onChangeText={setPrice}
              placeholder="0"
              keyboardType="numeric"
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Category * (comma separated)</Text>
            <TextInput
              style={styles.input}
              value={category}
              onChangeText={setCategory}
              placeholder="e.g., Main Course, Indian"
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Food Type</Text>
            <View style={styles.foodTypeContainer}>
              {FOOD_TYPES.map((type) => (
                <TouchableOpacity
                  key={type.value}
                  style={[styles.foodTypeButton, foodType === type.value && { backgroundColor: type.color }]}
                  onPress={() => setFoodType(type.value)}
                >
                  <Text style={[styles.foodTypeText, foodType === type.value && { color: '#fff' }]}>
                    {type.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={styles.switchRow}>
            <Text style={styles.label}>Available</Text>
            <Switch
              value={available}
              onValueChange={setAvailable}
              trackColor={{ false: '#d1d5db', true: '#86efac' }}
              thumbColor={available ? '#22c55e' : '#9ca3af'}
            />
          </View>
        </View>
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
  imageContainer: { alignItems: 'center', marginBottom: 24 },
  image: { width: 150, height: 150, borderRadius: 12 },
  imagePlaceholder: {
    width: 150, height: 150, borderRadius: 12, backgroundColor: '#f3f4f6',
    justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#e5e7eb', borderStyle: 'dashed',
  },
  imagePlaceholderText: { color: '#9ca3af', marginTop: 8 },
  form: { gap: 16 },
  inputGroup: { gap: 8 },
  label: { fontSize: 14, fontWeight: '500', color: '#1c1d21' },
  input: {
    backgroundColor: '#fff', borderRadius: 12, paddingHorizontal: 16, height: 50,
    borderWidth: 1, borderColor: '#e5e7eb', fontSize: 16,
  },
  textArea: { height: 100, textAlignVertical: 'top', paddingTop: 12 },
  foodTypeContainer: { flexDirection: 'row', gap: 8 },
  foodTypeButton: {
    flex: 1, paddingVertical: 12, borderRadius: 8, backgroundColor: '#f3f4f6',
    alignItems: 'center',
  },
  foodTypeText: { fontSize: 14, fontWeight: '500', color: '#61636b' },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  footer: { padding: 16, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#e5e7eb' },
  submitButton: { backgroundColor: '#e63946', height: 50, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  submitButtonDisabled: { opacity: 0.7 },
  submitButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
