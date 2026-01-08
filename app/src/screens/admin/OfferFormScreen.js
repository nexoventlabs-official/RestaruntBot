import React, { useState } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView, ScrollView, TextInput,
  TouchableOpacity, Image, Alert, ActivityIndicator, Switch
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import api from '../../config/api';

export default function OfferFormScreen({ route, navigation }) {
  const existingOffer = route.params?.offer;
  const isEditing = !!existingOffer;

  const [title, setTitle] = useState(existingOffer?.title || '');
  const [description, setDescription] = useState(existingOffer?.description || '');
  const [code, setCode] = useState(existingOffer?.code || '');
  const [discountType, setDiscountType] = useState(existingOffer?.discountType || 'none');
  const [discountValue, setDiscountValue] = useState(existingOffer?.discountValue?.toString() || '');
  const [isActive, setIsActive] = useState(existingOffer?.isActive !== false);
  const [image, setImage] = useState(existingOffer?.image || null);
  const [newImage, setNewImage] = useState(null);
  const [loading, setLoading] = useState(false);

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [16, 9],
      quality: 0.8,
    });

    if (!result.canceled) {
      setNewImage(result.assets[0]);
      setImage(result.assets[0].uri);
    }
  };

  const handleSubmit = async () => {
    if (!image && !newImage) {
      Alert.alert('Error', 'Please add an image');
      return;
    }

    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('title', title);
      formData.append('description', description);
      formData.append('code', code);
      formData.append('discountType', discountType);
      formData.append('discountValue', discountValue || '0');
      formData.append('isActive', isActive.toString());

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
        Alert.alert('Success', 'Offer updated');
      } else {
        await api.post('/offers', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        Alert.alert('Success', 'Offer created');
      }
      navigation.goBack();
    } catch (error) {
      Alert.alert('Error', error.response?.data?.error || 'Failed to save offer');
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
        <Text style={styles.title}>{isEditing ? 'Edit Offer' : 'Create Offer'}</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView style={styles.content}>
        <TouchableOpacity style={styles.imageContainer} onPress={pickImage}>
          {image ? (
            <Image source={{ uri: image }} style={styles.image} />
          ) : (
            <View style={styles.imagePlaceholder}>
              <Ionicons name="image-outline" size={40} color="#9ca3af" />
              <Text style={styles.imagePlaceholderText}>Add Banner Image *</Text>
            </View>
          )}
        </TouchableOpacity>

        <View style={styles.form}>
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Title</Text>
            <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="Offer title" />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Description</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              value={description}
              onChangeText={setDescription}
              placeholder="Offer description"
              multiline
              numberOfLines={3}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Promo Code</Text>
            <TextInput
              style={styles.input}
              value={code}
              onChangeText={(text) => setCode(text.toUpperCase())}
              placeholder="e.g., SAVE20"
              autoCapitalize="characters"
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Discount Type</Text>
            <View style={styles.discountTypeContainer}>
              {['none', 'percentage', 'fixed'].map((type) => (
                <TouchableOpacity
                  key={type}
                  style={[styles.discountTypeButton, discountType === type && styles.discountTypeButtonActive]}
                  onPress={() => setDiscountType(type)}
                >
                  <Text style={[styles.discountTypeText, discountType === type && styles.discountTypeTextActive]}>
                    {type === 'none' ? 'None' : type === 'percentage' ? '%' : '₹'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {discountType !== 'none' && (
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Discount Value</Text>
              <TextInput
                style={styles.input}
                value={discountValue}
                onChangeText={setDiscountValue}
                placeholder="0"
                keyboardType="numeric"
              />
            </View>
          )}

          <View style={styles.switchRow}>
            <Text style={styles.label}>Active</Text>
            <Switch
              value={isActive}
              onValueChange={setIsActive}
              trackColor={{ false: '#d1d5db', true: '#86efac' }}
              thumbColor={isActive ? '#22c55e' : '#9ca3af'}
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
            <Text style={styles.submitButtonText}>{isEditing ? 'Update Offer' : 'Create Offer'}</Text>
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
  imageContainer: { marginBottom: 24 },
  image: { width: '100%', height: 180, borderRadius: 12 },
  imagePlaceholder: {
    width: '100%', height: 180, borderRadius: 12, backgroundColor: '#f3f4f6',
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
  discountTypeContainer: { flexDirection: 'row', gap: 8 },
  discountTypeButton: {
    flex: 1, paddingVertical: 12, borderRadius: 8, backgroundColor: '#f3f4f6',
    alignItems: 'center',
  },
  discountTypeButtonActive: { backgroundColor: '#e63946' },
  discountTypeText: { fontSize: 14, fontWeight: '500', color: '#61636b' },
  discountTypeTextActive: { color: '#fff' },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  footer: { padding: 16, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#e5e7eb' },
  submitButton: { backgroundColor: '#e63946', height: 50, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  submitButtonDisabled: { opacity: 0.7 },
  submitButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
