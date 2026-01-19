import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput,
  TouchableOpacity, Image, Alert, ActivityIndicator, Switch, Animated, Platform,
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

  const [isActive, setIsActive] = useState(existingOffer?.isActive !== false);
  const [offerType, setOfferType] = useState(existingOffer?.offerType || '');
  const [image, setImage] = useState(existingOffer?.image || null);
  const [newImage, setNewImage] = useState(null);
  const [loading, setLoading] = useState(false);
  
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 400, useNativeDriver: true }),
    ]).start();
  }, []);

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: false,
      quality: 0.8,
    });
    if (!result.canceled) {
      setNewImage(result.assets[0]);
      setImage(result.assets[0].uri);
    }
  };

  const handleSubmit = async () => {
    if (!image && !newImage) {
      Alert.alert('Error', 'Please add a banner image');
      return;
    }

    if (!offerType || !offerType.trim()) {
      Alert.alert('Error', 'Please enter an offer type');
      return;
    }

    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('isActive', isActive.toString());
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
            {/* Banner Image */}
            <TouchableOpacity style={styles.imageContainer} onPress={pickImage} activeOpacity={0.8}>
              {image ? (
                <Image source={{ uri: image }} style={styles.image} />
              ) : (
                <View style={styles.imagePlaceholder}>
                  <View style={styles.imagePlaceholderIcon}>
                    <Ionicons name="image-outline" size={36} color={ZOMATO_RED} />
                  </View>
                  <Text style={styles.imagePlaceholderText}>Add Banner Image</Text>
                  <Text style={styles.imagePlaceholderHint}>Recommended: 16:9 ratio</Text>
                </View>
              )}
              {image && (
                <View style={styles.imageOverlay}>
                  <View style={styles.changeImageButton}>
                    <Ionicons name="camera" size={18} color="#fff" />
                    <Text style={styles.changeImageText}>Change</Text>
                  </View>
                </View>
              )}
            </TouchableOpacity>

            <View style={styles.form}>
              {/* Offer Type */}
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

              {/* Active Switch */}
              <View style={styles.switchCard}>
                <View style={styles.switchInfo}>
                  <View style={[styles.switchIconContainer, { backgroundColor: isActive ? '#DCFCE7' : '#FEE2E2' }]}>
                    <Ionicons name={isActive ? 'megaphone' : 'megaphone-outline'} size={22} color={isActive ? '#22C55E' : '#EF4444'} />
                  </View>
                  <View>
                    <Text style={styles.switchLabel}>Offer Status</Text>
                    <Text style={styles.switchHint}>{isActive ? 'Visible to customers' : 'Hidden from customers'}</Text>
                  </View>
                </View>
                <Switch
                  value={isActive}
                  onValueChange={setIsActive}
                  trackColor={{ false: '#FEE2E2', true: '#BBF7D0' }}
                  thumbColor={isActive ? '#22C55E' : '#EF4444'}
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
              <Text style={styles.submitButtonText}>{isEditing ? 'Update Offer' : 'Create Offer'}</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
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
  imageContainer: { marginBottom: 24, borderRadius: 18, overflow: 'hidden' },
  image: { 
    width: '100%', aspectRatio: 16/9, borderRadius: 18, resizeMode: 'cover',
  },
  imagePlaceholder: {
    width: '100%', aspectRatio: 16/9, borderRadius: 18, backgroundColor: '#fff',
    justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#E8E8E8', borderStyle: 'dashed',
  },
  imagePlaceholderIcon: {
    width: 64, height: 64, borderRadius: 32, backgroundColor: '#FEF2F2',
    justifyContent: 'center', alignItems: 'center', marginBottom: 12,
  },
  imagePlaceholderText: { color: '#1C1C1C', fontSize: 15, fontWeight: '600' },
  imagePlaceholderHint: { color: '#9CA3AF', fontSize: 12, marginTop: 4 },
  imageOverlay: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: 'rgba(0,0,0,0.4)', padding: 12, alignItems: 'center',
  },
  changeImageButton: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  changeImageText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  
  // Form
  form: { gap: 20 },
  inputGroup: { gap: 8 },
  label: { fontSize: 14, fontWeight: '700', color: '#1C1C1C' },
  required: { color: ZOMATO_RED },
  hint: { fontSize: 12, color: '#9CA3AF', marginTop: -4, marginBottom: 4 },
  input: {
    backgroundColor: '#fff', borderRadius: 14, paddingHorizontal: 18, height: 54,
    borderWidth: 1.5, borderColor: '#E8E8E8', fontSize: 15, color: '#1C1C1C', fontWeight: '500',
  },
  textArea: { height: 100, textAlignVertical: 'top', paddingTop: 16 },

  // Code Input
  codeInputWrapper: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#fff', borderRadius: 14, paddingHorizontal: 16, height: 54,
    borderWidth: 1.5, borderColor: '#E8E8E8',
  },
  codeInput: { flex: 1, fontSize: 15, color: '#1C1C1C', fontWeight: '600', letterSpacing: 1 },
  codeBadge: {
    backgroundColor: '#FEF2F2', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8,
    borderWidth: 1, borderColor: ZOMATO_RED, borderStyle: 'dashed',
  },
  codeBadgeText: { color: ZOMATO_RED, fontSize: 12, fontWeight: '800', letterSpacing: 1 },
  
  // Discount Type
  discountTypeContainer: { flexDirection: 'row', gap: 12 },
  discountTypeButton: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 16, borderRadius: 14, backgroundColor: '#fff',
    borderWidth: 2, borderColor: '#E8E8E8',
  },
  discountTypeButtonActive: { backgroundColor: ZOMATO_RED, borderColor: ZOMATO_RED },
  discountTypeText: { fontSize: 15, fontWeight: '700', color: '#696969' },
  discountTypeTextActive: { color: '#fff' },
  
  // Discount Value
  discountValueWrapper: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#fff', borderRadius: 14, paddingHorizontal: 18, height: 54,
    borderWidth: 1.5, borderColor: '#E8E8E8',
  },
  discountSymbol: { fontSize: 22, fontWeight: '800', color: ZOMATO_RED, marginRight: 8 },
  discountValueInput: { flex: 1, fontSize: 20, color: '#1C1C1C', fontWeight: '700' },
  
  // Switch
  switchCard: { 
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: '#fff', padding: 18, borderRadius: 16, borderWidth: 1.5, borderColor: '#E8E8E8',
  },
  switchInfo: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  switchIconContainer: { width: 48, height: 48, borderRadius: 24, justifyContent: 'center', alignItems: 'center' },
  switchLabel: { fontSize: 15, fontWeight: '700', color: '#1C1C1C' },
  switchHint: { fontSize: 12, color: '#9CA3AF', marginTop: 2 },
  
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
});
