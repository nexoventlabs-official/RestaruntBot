import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StatusBar,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import api from '../../config/api';

const PRIMARY = '#E23744';
const PRIMARY_DARK = '#CB1A27';

export default function ChangePasswordScreen({ navigation }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [focusedInput, setFocusedInput] = useState(null);

  const newRef = useRef(null);
  const confirmRef = useRef(null);

  const handleSubmit = async () => {
    if (!currentPassword.trim() || !newPassword.trim() || !confirmPassword.trim()) {
      Alert.alert('Missing Information', 'Please fill in all password fields');
      return;
    }
    if (newPassword.length < 6) {
      Alert.alert('Weak Password', 'New password must be at least 6 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      Alert.alert('Passwords Don\'t Match', 'New password and confirm password must be the same');
      return;
    }
    if (currentPassword === newPassword) {
      Alert.alert('Same Password', 'New password must be different from current password');
      return;
    }

    setLoading(true);
    try {
      await api.patch('/auth/change-password', { currentPassword, newPassword });
      Alert.alert('Success', 'Your password has been updated', [
        {
          text: 'OK',
          onPress: () => navigation.goBack(),
        },
      ]);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (error) {
      const msg = error.response?.data?.error || 'Failed to change password';
      Alert.alert('Error', msg);
    } finally {
      setLoading(false);
    }
  };

  const renderPasswordField = ({
    label,
    value,
    onChangeText,
    placeholder,
    show,
    toggleShow,
    inputKey,
    inputRef,
    onSubmitEditing,
    returnKeyType = 'next',
  }) => (
    <View style={styles.inputGroup}>
      <Text style={styles.label}>{label}</Text>
      <View
        style={[
          styles.inputWrapper,
          focusedInput === inputKey && styles.inputWrapperFocused,
        ]}
      >
        <Ionicons
          name="lock-closed-outline"
          size={20}
          color={focusedInput === inputKey ? '#000' : '#999'}
          style={styles.inputIcon}
        />
        <TextInput
          ref={inputRef}
          style={styles.input}
          placeholder={placeholder}
          placeholderTextColor="#AAAAAA"
          value={value}
          onChangeText={onChangeText}
          secureTextEntry={!show}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType={returnKeyType}
          onSubmitEditing={onSubmitEditing}
          onFocus={() => setFocusedInput(inputKey)}
          onBlur={() => setFocusedInput(null)}
          blurOnSubmit={returnKeyType === 'go'}
        />
        <TouchableOpacity
          style={styles.eyeButton}
          onPress={toggleShow}
          activeOpacity={0.7}
        >
          <Ionicons
            name={show ? 'eye-off-outline' : 'eye-outline'}
            size={22}
            color="#999"
          />
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#fff" />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
          activeOpacity={0.7}
        >
          <Ionicons name="arrow-back" size={24} color="#000" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Change Password</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Icon */}
          <View style={styles.iconContainer}>
            <View style={styles.iconCircle}>
              <Ionicons name="key" size={40} color={PRIMARY} />
            </View>
            <Text style={styles.title}>Update Your Password</Text>
            <Text style={styles.subtitle}>
              Enter your current password and choose a new one
            </Text>
          </View>

          {/* Form */}
          <View style={styles.formSection}>
            {renderPasswordField({
              label: 'Current Password',
              value: currentPassword,
              onChangeText: setCurrentPassword,
              placeholder: 'Enter current password',
              show: showCurrent,
              toggleShow: () => setShowCurrent(!showCurrent),
              inputKey: 'current',
              onSubmitEditing: () => newRef.current?.focus(),
              returnKeyType: 'next',
            })}

            {renderPasswordField({
              label: 'New Password',
              value: newPassword,
              onChangeText: setNewPassword,
              placeholder: 'At least 6 characters',
              show: showNew,
              toggleShow: () => setShowNew(!showNew),
              inputKey: 'new',
              inputRef: newRef,
              onSubmitEditing: () => confirmRef.current?.focus(),
              returnKeyType: 'next',
            })}

            {renderPasswordField({
              label: 'Confirm New Password',
              value: confirmPassword,
              onChangeText: setConfirmPassword,
              placeholder: 'Re-enter new password',
              show: showConfirm,
              toggleShow: () => setShowConfirm(!showConfirm),
              inputKey: 'confirm',
              inputRef: confirmRef,
              onSubmitEditing: handleSubmit,
              returnKeyType: 'go',
            })}

            {/* Submit Button */}
            <TouchableOpacity
              style={[styles.submitButton, loading && styles.submitButtonDisabled]}
              onPress={handleSubmit}
              disabled={loading}
              activeOpacity={0.8}
            >
              {loading ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <View style={styles.submitButtonContent}>
                  <Ionicons name="checkmark-circle" size={20} color="#fff" />
                  <Text style={styles.submitButtonText}>Update Password</Text>
                </View>
              )}
            </TouchableOpacity>

            {/* Hint */}
            <View style={styles.hintBox}>
              <Ionicons name="information-circle-outline" size={16} color="#666" />
              <Text style={styles.hintText}>
                Your password must be at least 6 characters long. After updating, you will stay logged in.
              </Text>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  keyboardView: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F5F5F5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#000',
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: 40,
  },
  iconContainer: {
    alignItems: 'center',
    paddingVertical: 32,
    paddingHorizontal: 24,
  },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#FEF2F2',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#000',
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    lineHeight: 20,
  },
  formSection: {
    paddingHorizontal: 24,
  },
  inputGroup: {
    marginBottom: 18,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F5F5F5',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#F5F5F5',
    paddingHorizontal: 14,
    height: 54,
  },
  inputWrapperFocused: {
    backgroundColor: '#fff',
    borderColor: '#000',
  },
  inputIcon: {
    marginRight: 10,
  },
  input: {
    flex: 1,
    fontSize: 15,
    color: '#000',
  },
  eyeButton: {
    padding: 4,
  },
  submitButton: {
    backgroundColor: PRIMARY,
    height: 54,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
    shadowColor: PRIMARY,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  submitButtonDisabled: {
    opacity: 0.6,
  },
  submitButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  submitButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  hintBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#F9FAFB',
    borderRadius: 10,
    padding: 12,
    marginTop: 20,
    gap: 8,
  },
  hintText: {
    flex: 1,
    fontSize: 12,
    color: '#666',
    lineHeight: 18,
  },
});
