import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  SafeAreaView, Alert, ActivityIndicator, KeyboardAvoidingView,
  Platform, Animated, Dimensions, StatusBar
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../context/AuthContext';
import { colors, spacing, radius, typography, shadows } from '../../theme';

const { width, height } = Dimensions.get('window');

export default function AdminLoginScreen({ navigation }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [focusedInput, setFocusedInput] = useState(null);
  const { loginAdmin } = useAuth();

  // Animations
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;
  const logoScale = useRef(new Animated.Value(0.8)).current;
  const formSlide = useRef(new Animated.Value(50)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 600,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 600,
        useNativeDriver: true,
      }),
      Animated.spring(logoScale, {
        toValue: 1,
        friction: 8,
        tension: 40,
        useNativeDriver: true,
      }),
      Animated.timing(formSlide, {
        toValue: 0,
        duration: 700,
        delay: 200,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  const handleLogin = async () => {
    if (!username.trim() || !password.trim()) {
      Alert.alert('Missing Information', 'Please enter username and password');
      return;
    }

    setLoading(true);
    try {
      await loginAdmin(username, password);
    } catch (error) {
      Alert.alert('Login Failed', error.response?.data?.error || 'Invalid credentials');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

      {/* Premium Header with Gradient */}
      <LinearGradient
        colors={[colors.zomato.red, colors.zomato.darkRed]}
        style={styles.headerGradient}
      >
        {/* Back Button */}
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>

        {/* Logo Section */}
        <Animated.View style={[
          styles.logoSection,
          {
            opacity: fadeAnim,
            transform: [{ scale: logoScale }]
          }
        ]}>
          <View style={styles.logoCircle}>
            <Ionicons name="shield-checkmark" size={44} color={colors.zomato.red} />
          </View>
          <Text style={styles.headerTitle}>Admin Portal</Text>
          <Text style={styles.headerSubtitle}>Manage your restaurant with ease</Text>
        </Animated.View>

        {/* Decorative Elements */}
        <View style={styles.decorCircle1} />
        <View style={styles.decorCircle2} />
      </LinearGradient>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.content}
      >
        <Animated.View style={[
          styles.formContainer,
          {
            opacity: fadeAnim,
            transform: [{ translateY: formSlide }]
          }
        ]}>
          {/* Welcome Text */}
          <View style={styles.welcomeSection}>
            <Text style={styles.welcomeTitle}>Welcome Back</Text>
            <Text style={styles.welcomeSubtitle}>Sign in to continue</Text>
          </View>

          {/* Username Input */}
          <View style={[
            styles.inputContainer,
            focusedInput === 'username' && styles.inputContainerFocused
          ]}>
            <View style={[
              styles.inputIconContainer,
              focusedInput === 'username' && styles.inputIconContainerFocused
            ]}>
              <Ionicons
                name="person-outline"
                size={20}
                color={focusedInput === 'username' ? colors.zomato.red : colors.light.text.tertiary}
              />
            </View>
            <TextInput
              style={styles.input}
              placeholder="Username"
              placeholderTextColor={colors.light.text.tertiary}
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
              autoCorrect={false}
              onFocus={() => setFocusedInput('username')}
              onBlur={() => setFocusedInput(null)}
            />
          </View>

          {/* Password Input */}
          <View style={[
            styles.inputContainer,
            focusedInput === 'password' && styles.inputContainerFocused
          ]}>
            <View style={[
              styles.inputIconContainer,
              focusedInput === 'password' && styles.inputIconContainerFocused
            ]}>
              <Ionicons
                name="lock-closed-outline"
                size={20}
                color={focusedInput === 'password' ? colors.zomato.red : colors.light.text.tertiary}
              />
            </View>
            <TextInput
              style={styles.input}
              placeholder="Password"
              placeholderTextColor={colors.light.text.tertiary}
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
              onFocus={() => setFocusedInput('password')}
              onBlur={() => setFocusedInput(null)}
            />
            <TouchableOpacity
              style={styles.eyeButton}
              onPress={() => setShowPassword(!showPassword)}
            >
              <Ionicons
                name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                size={20}
                color={colors.light.text.tertiary}
              />
            </TouchableOpacity>
          </View>

          {/* Forgot Password */}
          <TouchableOpacity style={styles.forgotPassword}>
            <Text style={styles.forgotPasswordText}>Forgot Password?</Text>
          </TouchableOpacity>

          {/* Login Button */}
          <TouchableOpacity
            style={[styles.loginButton, loading && styles.loginButtonDisabled]}
            onPress={handleLogin}
            disabled={loading}
            activeOpacity={0.9}
          >
            <LinearGradient
              colors={loading ? [colors.primary[200], colors.primary[200]] : [colors.zomato.red, colors.zomato.darkRed]}
              style={styles.loginButtonGradient}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
            >
              {loading ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <>
                  <Text style={styles.loginButtonText}>Sign In</Text>
                  <View style={styles.loginButtonArrow}>
                    <Ionicons name="arrow-forward" size={18} color={colors.zomato.red} />
                  </View>
                </>
              )}
            </LinearGradient>
          </TouchableOpacity>

          {/* Security Note */}
          <View style={styles.securityNote}>
            <View style={styles.securityIcon}>
              <Ionicons name="shield-checkmark" size={16} color={colors.zomato.green} />
            </View>
            <Text style={styles.securityText}>
              Your data is protected with enterprise-grade security
            </Text>
          </View>
        </Animated.View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.light.background,
  },
  headerGradient: {
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight + 20 : 60,
    paddingBottom: 50,
    paddingHorizontal: spacing.screenHorizontal,
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
    overflow: 'hidden',
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  logoSection: {
    alignItems: 'center',
  },
  logoCircle: {
    width: 88,
    height: 88,
    borderRadius: 24,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.base,
    ...shadows.xl,
  },
  headerTitle: {
    fontSize: typography.display.small.fontSize,
    fontWeight: '700',
    color: '#fff',
  },
  headerSubtitle: {
    fontSize: typography.body.medium.fontSize,
    color: 'rgba(255,255,255,0.85)',
    marginTop: spacing.xs,
  },
  decorCircle1: {
    position: 'absolute',
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: 'rgba(255,255,255,0.05)',
    top: -50,
    right: -50,
  },
  decorCircle2: {
    position: 'absolute',
    width: 150,
    height: 150,
    borderRadius: 75,
    backgroundColor: 'rgba(255,255,255,0.05)',
    bottom: -30,
    left: -30,
  },
  content: {
    flex: 1,
    padding: spacing.screenHorizontal,
    marginTop: -spacing.lg,
  },
  formContainer: {
    backgroundColor: colors.light.surface,
    borderRadius: 24,
    padding: spacing.xl,
    ...shadows.lg,
  },
  welcomeSection: {
    marginBottom: spacing.xl,
  },
  welcomeTitle: {
    fontSize: typography.headline.large.fontSize,
    fontWeight: '700',
    color: colors.light.text.primary,
  },
  welcomeSubtitle: {
    fontSize: typography.body.medium.fontSize,
    color: colors.light.text.secondary,
    marginTop: spacing.xs,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.light.surfaceSecondary,
    borderRadius: radius.lg,
    marginBottom: spacing.base,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  inputContainerFocused: {
    borderColor: colors.zomato.red,
    backgroundColor: colors.light.surface,
  },
  inputIconContainer: {
    width: 52,
    height: 56,
    justifyContent: 'center',
    alignItems: 'center',
  },
  inputIconContainerFocused: {
    backgroundColor: colors.primary[50],
    borderTopLeftRadius: radius.lg - 2,
    borderBottomLeftRadius: radius.lg - 2,
  },
  input: {
    flex: 1,
    fontSize: typography.body.large.fontSize,
    color: colors.light.text.primary,
    paddingVertical: spacing.base,
    paddingRight: spacing.base,
  },
  eyeButton: {
    padding: spacing.base,
  },
  forgotPassword: {
    alignSelf: 'flex-end',
    marginBottom: spacing.lg,
  },
  forgotPasswordText: {
    fontSize: typography.label.large.fontSize,
    fontWeight: '600',
    color: colors.zomato.red,
  },
  loginButton: {
    borderRadius: radius.lg,
    overflow: 'hidden',
    ...shadows.md,
  },
  loginButtonDisabled: {
    opacity: 0.7,
  },
  loginButtonGradient: {
    flexDirection: 'row',
    height: 56,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.md,
  },
  loginButtonText: {
    color: '#fff',
    fontSize: typography.title.large.fontSize,
    fontWeight: '600',
  },
  loginButtonArrow: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  securityNote: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.xl,
    gap: spacing.sm,
  },
  securityIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.zomato.lightGreen,
    justifyContent: 'center',
    alignItems: 'center',
  },
  securityText: {
    fontSize: typography.body.small.fontSize,
    color: colors.light.text.secondary,
    flex: 1,
  },
});
