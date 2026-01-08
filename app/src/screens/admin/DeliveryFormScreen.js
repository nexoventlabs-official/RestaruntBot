import React, { useState } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView, ScrollView, TextInput,
  TouchableOpacity, Image, Alert, ActivityIndicator, Switch
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import api from '../../config/api';

export default function DeliveryFormScreen({ route, navigation }) {
  const existingDeliveryBoy = route.params?.deliveryBoy;
  const isEditing = !!existingDeliveryBoy;

  const [name, setName] = useState(existingDeliveryBoy?.name || '');
  const [email, setEmail] = useState(existingDeliveryBoy?.email || '');
  const [phone, setPhone] = useState(existingDeliveryBoy?.phone || '');
  const [dob, setDob] = useState(existingDeliveryBoy?.dob ? new Date(existingDeliveryBoy.dob).toISOString().split('T')[0] : '');
  const [isActive, setIsActive] = useState(existingDeliveryBoy?.isActive !== false);
  const [photo, setPhoto] = useState(existingDeliveryBoy?.photo || null);
  const [newPhoto, setNewPhoto] = useState(null);
  const [loading, setLoading] = useState(false);

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });

    if (!result.canceled) {
      setNewPhoto(result.assets[0]);
      setPhoto(result.assets[0].uri);
    }
  };

  const handleSubmit = async () => {
    if (!name.trim() || !phone.trim() || !dob.trim()) {
      Alert.alert('Error', 'Please fill in name, phone, and date of birth');
      return;
    }

    if (!isEditing && !email.trim()) {
      Alert.alert('Error', 'Email is required for new delivery partners');
      return;
    }

    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('name', name);
      formData.append('phone', phone);
      formData.append('dob', dob);
      formData.append('isActive', isActive.toString());

      if (!isEditing) {
        formData.append('email', email);
      }

      if (newPhoto) {
        const filename = newPhoto.uri.split('/').pop();
        const match = /\.(\w+)$/.exec(filename);
        const type = match ? `image/${match[1]}` : 'image/jpeg';
        formData.append('photo', { uri: newPhoto.uri, name: filename, type });
      }

      if (isEditing) {
        await api.put(`/delivery/${existingDeliveryBoy._id}`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        Alert.alert('Success', 'Delivery partner updated');
      } else {
        await api.post('/delivery', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        Alert.alert('Success', 'Delivery partner added. Password sent to email.');
      }
      navigation.goBack();
    } catch (error) {
      Alert.alert('Error', error.response?.data?.error || 'Failed to save');
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
        <Text style={styles.title}>{isEditing ? 'Edit Partner' : 'Add Partner'}</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView style={styles.content}>
        <TouchableOpacity style={styles.photoContainer} onPress={pickImage}>
          {photo ? (
            <Image source={{ uri: photo }} style={styles.photo} />
          ) : (
            <View style={styles.photoPlaceholder}>
              <Ionicons name="camera-outline" size={40} color="#9ca3af" />
              <Text style={styles.photoPlaceholderText}>Add Photo</Text>
            </View>
          )}
        </TouchableOpacity>

        <View style={styles.form}>
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Name *</Text>
            <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Full name" />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Email {!isEditing && '*'}</Text>
            <TextInput
              style={[styles.input, isEditing && styles.inputDisabled]}
              value={email}
              onChangeText={setEmail}
              placeholder="email@example.com"
              keyboardType="email-address"
              autoCapitalize="none"
              editable={!isEditing}
            />
            {isEditing && <Text style={styles.hint}>Email cannot be changed</Text>}
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Phone *</Text>
            <TextInput
              style={styles.input}
              value={phone}
              onChangeText={setPhone}
              placeholder="Phone number"
              keyboardType="phone-pad"
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Date of Birth * (YYYY-MM-DD)</Text>
            <TextInput
              style={styles.input}
              value={dob}
              onChangeText={setDob}
              placeholder="1990-01-15"
            />
          </View>

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
            <Text style={styles.submitButtonText}>{isEditing ? 'Update Partner' : 'Add Partner'}</Text>
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
  photoContainer: { alignItems: 'center', marginBottom: 24 },
  photo: { width: 120, height: 120, borderRadius: 60 },
  photoPlaceholder: {
    width: 120, height: 120, borderRadius: 60, backgroundColor: '#f3f4f6',
    justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#e5e7eb', borderStyle: 'dashed',
  },
  photoPlaceholderText: { color: '#9ca3af', marginTop: 8 },
  form: { gap: 16 },
  inputGroup: { gap: 8 },
  label: { fontSize: 14, fontWeight: '500', color: '#1c1d21' },
  input: {
    backgroundColor: '#fff', borderRadius: 12, paddingHorizontal: 16, height: 50,
    borderWidth: 1, borderColor: '#e5e7eb', fontSize: 16,
  },
  inputDisabled: { backgroundColor: '#f3f4f6', color: '#9ca3af' },
  hint: { fontSize: 12, color: '#9ca3af' },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  footer: { padding: 16, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#e5e7eb' },
  submitButton: { backgroundColor: '#e63946', height: 50, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  submitButtonDisabled: { opacity: 0.7 },
  submitButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
