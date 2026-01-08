import React, { useState } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView, ScrollView,
  TouchableOpacity, Image, TextInput, Alert, ActivityIndicator
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../context/AuthContext';
import api from '../../config/api';

export default function DeliveryProfileScreen() {
  const { user, logout, setUser } = useAuth();
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleChangePassword = async () => {
    if (!currentPassword || !newPassword || !confirmPassword) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }

    if (newPassword !== confirmPassword) {
      Alert.alert('Error', 'New passwords do not match');
      return;
    }

    if (newPassword.length < 6) {
      Alert.alert('Error', 'Password must be at least 6 characters');
      return;
    }

    setLoading(true);
    try {
      await api.post('/delivery/change-password', { currentPassword, newPassword });
      Alert.alert('Success', 'Password changed successfully');
      setShowPasswordForm(false);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (error) {
      Alert.alert('Error', error.response?.data?.error || 'Failed to change password');
    } finally {
      setLoading(false);
    }
  };

  const ProfileItem = ({ icon, label, value }) => (
    <View style={styles.profileItem}>
      <View style={styles.profileItemIcon}>
        <Ionicons name={icon} size={20} color="#61636b" />
      </View>
      <View style={styles.profileItemContent}>
        <Text style={styles.profileItemLabel}>{label}</Text>
        <Text style={styles.profileItemValue}>{value || 'N/A'}</Text>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Profile</Text>
      </View>

      <ScrollView style={styles.content}>
        <View style={styles.profileCard}>
          <View style={styles.avatarSection}>
            {user?.photo ? (
              <Image source={{ uri: user.photo }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, styles.avatarPlaceholder]}>
                <Ionicons name="person" size={40} color="#9ca3af" />
              </View>
            )}
            <Text style={styles.name}>{user?.name || 'Delivery Partner'}</Text>
            <View style={styles.ratingContainer}>
              <Ionicons name="star" size={18} color="#f59e0b" />
              <Text style={styles.rating}>{user?.avgRating?.toFixed(1) || '0.0'}</Text>
              <Text style={styles.ratingCount}>({user?.totalRatings || 0} ratings)</Text>
            </View>
          </View>

          <View style={styles.profileDetails}>
            <ProfileItem icon="mail-outline" label="Email" value={user?.email} />
            <ProfileItem icon="call-outline" label="Phone" value={user?.phone} />
            <ProfileItem
              icon="calendar-outline"
              label="Date of Birth"
              value={user?.dob ? new Date(user.dob).toLocaleDateString('en-IN') : 'N/A'}
            />
            <ProfileItem icon="person-outline" label="Age" value={user?.age ? `${user.age} years` : 'N/A'} />
          </View>
        </View>

        <View style={styles.section}>
          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => setShowPasswordForm(!showPasswordForm)}
          >
            <View style={styles.menuItemLeft}>
              <Ionicons name="key-outline" size={24} color="#1c1d21" />
              <Text style={styles.menuItemText}>Change Password</Text>
            </View>
            <Ionicons name={showPasswordForm ? 'chevron-up' : 'chevron-down'} size={20} color="#9ca3af" />
          </TouchableOpacity>

          {showPasswordForm && (
            <View style={styles.passwordForm}>
              <TextInput
                style={styles.input}
                placeholder="Current Password"
                value={currentPassword}
                onChangeText={setCurrentPassword}
                secureTextEntry
              />
              <TextInput
                style={styles.input}
                placeholder="New Password"
                value={newPassword}
                onChangeText={setNewPassword}
                secureTextEntry
              />
              <TextInput
                style={styles.input}
                placeholder="Confirm New Password"
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                secureTextEntry
              />
              <TouchableOpacity
                style={[styles.changePasswordButton, loading && styles.buttonDisabled]}
                onPress={handleChangePassword}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.changePasswordButtonText}>Update Password</Text>
                )}
              </TouchableOpacity>
            </View>
          )}
        </View>

        <TouchableOpacity style={styles.logoutButton} onPress={logout}>
          <Ionicons name="log-out-outline" size={24} color="#ef4444" />
          <Text style={styles.logoutButtonText}>Logout</Text>
        </TouchableOpacity>

        <Text style={styles.version}>Version 1.0.0</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8f9fb' },
  header: { padding: 20, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#e5e7eb' },
  title: { fontSize: 24, fontWeight: 'bold', color: '#1c1d21' },
  content: { flex: 1, padding: 16 },
  profileCard: { backgroundColor: '#fff', borderRadius: 12, overflow: 'hidden', marginBottom: 16 },
  avatarSection: { alignItems: 'center', padding: 24, backgroundColor: '#2a9d8f' },
  avatar: { width: 100, height: 100, borderRadius: 50, borderWidth: 4, borderColor: '#fff' },
  avatarPlaceholder: { backgroundColor: '#f3f4f6', justifyContent: 'center', alignItems: 'center' },
  name: { fontSize: 22, fontWeight: 'bold', color: '#fff', marginTop: 12 },
  ratingContainer: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  rating: { fontSize: 18, fontWeight: 'bold', color: '#fff', marginLeft: 4 },
  ratingCount: { fontSize: 14, color: 'rgba(255,255,255,0.8)', marginLeft: 4 },
  profileDetails: { padding: 16 },
  profileItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  profileItemIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#f3f4f6', justifyContent: 'center', alignItems: 'center' },
  profileItemContent: { marginLeft: 12 },
  profileItemLabel: { fontSize: 12, color: '#9ca3af' },
  profileItemValue: { fontSize: 16, color: '#1c1d21', marginTop: 2 },
  section: { backgroundColor: '#fff', borderRadius: 12, marginBottom: 16 },
  menuItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16 },
  menuItemLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  menuItemText: { fontSize: 16, color: '#1c1d21' },
  passwordForm: { padding: 16, paddingTop: 0, gap: 12 },
  input: {
    backgroundColor: '#f3f4f6', borderRadius: 8, paddingHorizontal: 16, height: 48,
    fontSize: 16,
  },
  changePasswordButton: { backgroundColor: '#2a9d8f', height: 48, borderRadius: 8, justifyContent: 'center', alignItems: 'center' },
  buttonDisabled: { opacity: 0.7 },
  changePasswordButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  logoutButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#fff', padding: 16, borderRadius: 12, marginBottom: 16,
  },
  logoutButtonText: { fontSize: 16, fontWeight: '600', color: '#ef4444' },
  version: { textAlign: 'center', color: '#9ca3af', marginBottom: 24 },
});
