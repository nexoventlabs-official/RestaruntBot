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
  
  // Three separate images for different screen sizes
  const [imageMobile, setImageMobile] = useState(existingOffer?.imageMobile || null);
  const [imageTablet, setImageTablet] = useState(existingOffer?.imageTablet || null);
  const [imageDesktop, setImageDesktop] = useState(existingOffer?.imageDesktop || null);
  
  const [newImageMobile, setNewImageMobile] = useState(null);
  const [newImageTablet, setNewImageTablet] = useState(null);
  const [newImageDesktop, setNewImageDesktop] = useState(null);
  
  const [loading, setLoading] = useState(false);
  
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 400, useNativeDriver: true }),
    ]).start();
  }, []);

  const pickImage = async (imageType) => {
    try {
      // Request permissions
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Please allow access to your photo library to upload images.');
        return;
      }

      // Default aspect ratios for each device type (no user prompt)
      const defaultRatios = {
        mobile: [4, 3],    // 4:3 (Instagram Post) - Default for mobile
        tablet: [16, 9],   // 16:9 (Landscape) - Default for tablet
        desktop: [3, 1]    // 3:1 (Twitter Header) - Default for desktop
      };

      const aspectRatio = defaultRatios[imageType];

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        allowsMultipleSelection: false,
        aspect: aspectRatio,
        quality: 0.9,
        exif: false,
      });
      
      if (!result.canceled) {
        const imageData = result.assets[0];
        
        if (imageType === 'mobile') {
          setNewImageMobile(imageData);
          setImageMobile(imageData.uri);
        } else if (imageType === 'tablet') {
          setNewImageTablet(imageData);
          setImageTablet(imageData.uri);
        } else if (imageType === 'desktop') {
          setNewImageDesktop(imageData);
          setImageDesktop(imageData.uri);
        }
      }
    } catch (error) {
      console.error('Error picking image:', error);
      Alert.alert('Error', 'Failed to pick image. Please try again.');
    }
  };

  const pickImageWithRatio = async (imageType, aspectRatio) => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        allowsMultipleSelection: false,
        aspect: aspectRatio,
        quality: 0.9,
        exif: false,
      });
      
      if (!result.canceled) {
        const imageData = result.assets[0];
        
        if (imageType === 'mobile') {
          setNewImageMobile(imageData);
          setImageMobile(imageData.uri);
        } else if (imageType === 'tablet') {
          setNewImageTablet(imageData);
          setImageTablet(imageData.uri);
        } else if (imageType === 'desktop') {
          setNewImageDesktop(imageData);
          setImageDesktop(imageData.uri);
        }
      }
    } catch (error) {
      console.error('Error picking image:', error);
      Alert.alert('Error', 'Failed to pick image. Please try again.');
    }
  };

  const handleSubmit = async () => {
    // At least one image is required
    if (!imageMobile && !imageTablet && !imageDesktop && !newImageMobile && !newImageTablet && !newImageDesktop) {
      Alert.alert('Error', 'Please add at least one banner image');
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

      // Add mobile image if new one selected
      if (newImageMobile) {
        const filename = newImageMobile.uri.split('/').pop();
        const match = /\.(\w+)$/.exec(filename);
        const type = match ? `image/${match[1]}` : 'image/jpeg';
        formData.append('imageMobile', { uri: newImageMobile.uri, name: filename, type });
      }

      // Add tablet image if new one selected
      if (newImageTablet) {
        const filename = newImageTablet.uri.split('/').pop();
        const match = /\.(\w+)$/.exec(filename);
        const type = match ? `image/${match[1]}` : 'image/jpeg';
        formData.append('imageTablet', { uri: newImageTablet.uri, name: filename, type });
      }

      // Add desktop image if new one selected
      if (newImageDesktop) {
        const filename = newImageDesktop.uri.split('/').pop();
        const match = /\.(\w+)$/.exec(filename);
        const type = match ? `image/${match[1]}` : 'image/jpeg';
        formData.append('imageDesktop', { uri: newImageDesktop.uri, name: filename, type });
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

  const renderImageUpload = (imageType, image, title, subtitle, recommendedSize) => {
    // Device frame styles based on type
    const getDeviceFrameStyle = () => {
      switch(imageType) {
        case 'mobile':
          return {
            container: styles.mobileFrame,
            screen: styles.mobileScreen,
            label: 'Mobile Preview',
            icon: 'phone-portrait',
            showHeader: true,
            showButton: true
          };
        case 'tablet':
          return {
            container: styles.tabletFrame,
            screen: styles.tabletScreen,
            label: 'Tablet Preview',
            icon: 'tablet-landscape',
            showHeader: true,
            showButton: true
          };
        case 'desktop':
          return {
            container: styles.desktopFrame,
            screen: styles.desktopScreen,
            label: 'Desktop Preview',
            icon: 'desktop',
            showHeader: true,
            showButton: true
          };
      }
    };

    const deviceFrame = getDeviceFrameStyle();

    return (
      <View style={styles.imageSection}>
        <View style={styles.imageSectionHeader}>
          <Ionicons 
            name={deviceFrame.icon} 
            size={20} 
            color={ZOMATO_RED} 
          />
          <Text style={styles.imageSectionTitle}>{title}</Text>
        </View>
        <Text style={styles.imageSectionHint}>{subtitle}</Text>
        <Text style={styles.imageSectionRecommended}>Recommended: {recommendedSize}</Text>
        
        {/* Device Preview Frame */}
        {image && (
          <View style={styles.devicePreviewContainer}>
            <Text style={styles.devicePreviewLabel}>{deviceFrame.label}</Text>
            <View style={deviceFrame.container}>
              {/* Device Screen */}
              <View style={deviceFrame.screen}>
                <ScrollView 
                  style={styles.deviceScrollView}
                  showsVerticalScrollIndicator={false}
                  bounces={false}
                >
                  {/* Mock Website Header */}
                  <View style={styles.mockWebsiteHeader}>
                    <View style={styles.mockLogo}>
                      <Ionicons name="restaurant" size={imageType === 'mobile' ? 12 : 14} color="#fff" />
                      <Text style={[styles.mockLogoText, imageType === 'mobile' && styles.mockLogoTextSmall]}>
                        FoodieSpot
                      </Text>
                    </View>
                    <View style={styles.mockHeaderIcons}>
                      <Ionicons name="search" size={imageType === 'mobile' ? 12 : 14} color="#fff" />
                      <Ionicons name="heart" size={imageType === 'mobile' ? 12 : 14} color="#fff" />
                      <Ionicons name="cart" size={imageType === 'mobile' ? 12 : 14} color="#fff" />
                    </View>
                  </View>
                  
                  {/* Offer Banner Image */}
                  <View style={styles.mockBannerContainer}>
                    <Image 
                      source={{ uri: image }} 
                      style={[
                        styles.mockBannerImage,
                        imageType === 'mobile' && styles.mockBannerImageMobile,
                        imageType === 'tablet' && styles.mockBannerImageTablet,
                        imageType === 'desktop' && styles.mockBannerImageDesktop
                      ]} 
                      resizeMode="cover" 
                    />
                    
                    {/* Mock Offer Badge */}
                    <View style={[styles.mockOfferBadge, imageType === 'mobile' && styles.mockOfferBadgeSmall]}>
                      <Ionicons name="pricetag" size={imageType === 'mobile' ? 8 : 10} color="#fff" />
                      <Text style={[styles.mockOfferBadgeText, imageType === 'mobile' && styles.mockOfferBadgeTextSmall]}>
                        Special Offers
                      </Text>
                    </View>
                    
                    {/* Mock Get This Offer Button */}
                    <View style={[styles.mockGetOfferButton, imageType === 'mobile' && styles.mockGetOfferButtonSmall]}>
                      <Ionicons name="pricetag" size={imageType === 'mobile' ? 10 : 12} color="#1F2937" />
                      <Text style={[styles.mockGetOfferButtonText, imageType === 'mobile' && styles.mockGetOfferButtonTextSmall]}>
                        Get This Offer
                      </Text>
                    </View>
                  </View>
                  
                  {/* Mock Content Below */}
                  <View style={styles.mockContentBelow}>
                    <View style={styles.mockContentPlaceholder} />
                    <View style={styles.mockContentPlaceholder} />
                  </View>
                </ScrollView>
                
                {/* Device Status Bar */}
                <View style={styles.mockStatusBar}>
                  <View style={styles.mockTime}>
                    <Text style={styles.mockTimeText}>9:41</Text>
                  </View>
                  <View style={styles.mockIcons}>
                    <Ionicons name="wifi" size={10} color="#fff" />
                    <Ionicons name="battery-full" size={10} color="#fff" />
                  </View>
                </View>
              </View>
              {/* Device Frame Border */}
              {imageType === 'mobile' && (
                <>
                  <View style={styles.mobileNotch} />
                  <View style={styles.mobileHomeIndicator} />
                </>
              )}
            </View>
          </View>
        )}
        
        {/* Upload Button */}
        <TouchableOpacity 
          style={styles.uploadButton} 
          onPress={() => pickImage(imageType)} 
          activeOpacity={0.8}
        >
          {image ? (
            <>
              <Ionicons name="camera" size={20} color={ZOMATO_RED} />
              <Text style={styles.uploadButtonText}>Change & Crop Image</Text>
            </>
          ) : (
            <>
              <Ionicons name="cloud-upload-outline" size={20} color={ZOMATO_RED} />
              <Text style={styles.uploadButtonText}>Upload {title}</Text>
            </>
          )}
        </TouchableOpacity>
        
        {image && (
          <View style={styles.previewInfo}>
            <Ionicons name="checkmark-circle" size={16} color="#22C55E" />
            <Text style={styles.previewInfoTextSuccess}>
              Image uploaded • Will display on {imageType} devices
            </Text>
          </View>
        )}
      </View>
    );
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
            
            {/* Info Banner */}
            <View style={styles.infoBanner}>
              <Ionicons name="information-circle" size={20} color={ZOMATO_RED} />
              <Text style={styles.infoBannerText}>
                Default ratios: Mobile 4:3, Tablet 16:9, Desktop 3:1 (Twitter Header). Full image displays without cropping.
              </Text>
            </View>

            {/* Mobile Image */}
            {renderImageUpload('mobile', imageMobile, 'Mobile View', 'For smartphones and small screens', '4:3 (Instagram Post)')}

            {/* Tablet Image */}
            {renderImageUpload('tablet', imageTablet, 'Tablet View', 'For tablets and medium screens', '16:9 (Landscape)')}

            {/* Desktop Image */}
            {renderImageUpload('desktop', imageDesktop, 'Desktop View', 'For laptops and large screens', '3:1 (Twitter Header)')}

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
  
  // Info Banner
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
  
  // Image Section
  imageSection: { marginBottom: 24 },
  imageSectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  imageSectionTitle: { fontSize: 16, fontWeight: '700', color: '#1C1C1C' },
  imageSectionHint: { fontSize: 13, color: '#9CA3AF', marginBottom: 2 },
  imageSectionRecommended: { fontSize: 12, color: ZOMATO_RED, marginBottom: 16, fontWeight: '600' },
  
  // Device Preview Frames
  devicePreviewContainer: {
    marginBottom: 16,
    alignItems: 'center',
  },
  devicePreviewLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6B7280',
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  
  // Mobile Frame (iPhone style)
  mobileFrame: {
    width: 180,
    height: 320,
    backgroundColor: '#1F2937',
    borderRadius: 28,
    padding: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 8,
  },
  mobileScreen: {
    flex: 1,
    backgroundColor: '#000',
    borderRadius: 24,
    overflow: 'hidden',
    position: 'relative',
  },
  mobileNotch: {
    position: 'absolute',
    top: 8,
    left: '50%',
    marginLeft: -40,
    width: 80,
    height: 20,
    backgroundColor: '#1F2937',
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
  },
  mobileHomeIndicator: {
    position: 'absolute',
    bottom: 8,
    left: '50%',
    marginLeft: -30,
    width: 60,
    height: 4,
    backgroundColor: '#4B5563',
    borderRadius: 2,
  },
  
  // Tablet Frame (iPad style)
  tabletFrame: {
    width: 280,
    height: 120,
    backgroundColor: '#1F2937',
    borderRadius: 20,
    padding: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 8,
  },
  tabletScreen: {
    flex: 1,
    backgroundColor: '#000',
    borderRadius: 12,
    overflow: 'hidden',
    position: 'relative',
  },
  
  // Desktop Frame (MacBook style)
  desktopFrame: {
    width: '100%',
    maxWidth: 320,
    height: 137,
    backgroundColor: '#1F2937',
    borderRadius: 12,
    padding: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 8,
  },
  desktopScreen: {
    flex: 1,
    backgroundColor: '#000',
    borderRadius: 6,
    overflow: 'hidden',
    position: 'relative',
  },
  
  // Device Preview Image
  deviceScrollView: {
    flex: 1,
  },
  
  // Mock Website Header
  mockWebsiteHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 6,
    backgroundColor: '#1F2937',
    borderBottomWidth: 1,
    borderBottomColor: '#374151',
  },
  mockLogo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  mockLogoText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  mockLogoTextSmall: {
    fontSize: 9,
  },
  mockHeaderIcons: {
    flexDirection: 'row',
    gap: 8,
  },
  
  // Mock Banner Container
  mockBannerContainer: {
    position: 'relative',
    backgroundColor: '#000',
  },
  mockBannerImage: {
    width: '100%',
    height: 100,
  },
  mockBannerImageMobile: {
    height: 100,
  },
  mockBannerImageTablet: {
    height: 60,
  },
  mockBannerImageDesktop: {
    height: 80,
  },
  
  // Mock Offer Badge
  mockOfferBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  mockOfferBadgeSmall: {
    top: 6,
    left: 6,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 8,
  },
  mockOfferBadgeText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '700',
  },
  mockOfferBadgeTextSmall: {
    fontSize: 7,
  },
  
  // Mock Get Offer Button
  mockGetOfferButton: {
    position: 'absolute',
    bottom: 12,
    left: '50%',
    marginLeft: -50,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FCD34D',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  mockGetOfferButtonSmall: {
    bottom: 8,
    marginLeft: -40,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  mockGetOfferButtonText: {
    color: '#1F2937',
    fontSize: 9,
    fontWeight: '700',
  },
  mockGetOfferButtonTextSmall: {
    fontSize: 7,
  },
  
  // Mock Content Below
  mockContentBelow: {
    padding: 8,
    backgroundColor: '#F9FAFB',
    gap: 6,
  },
  mockContentPlaceholder: {
    height: 20,
    backgroundColor: '#E5E7EB',
    borderRadius: 4,
  },
  
  // Mock UI Elements
  mockStatusBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 24,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  mockTime: {
    flex: 1,
  },
  mockTimeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '600',
  },
  mockIcons: {
    flexDirection: 'row',
    gap: 4,
  },
  
  // Upload Button
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
  
  // Preview Info
  previewInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#F3F4F6',
    padding: 12,
    borderRadius: 12,
  },
  previewInfoText: {
    flex: 1,
    fontSize: 12,
    color: '#6B7280',
    lineHeight: 16,
  },
  previewInfoTextSuccess: {
    flex: 1,
    fontSize: 12,
    color: '#059669',
    lineHeight: 16,
    fontWeight: '500',
  },
  
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
