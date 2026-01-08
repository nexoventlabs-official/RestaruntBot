import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export default function RoleSelectScreen({ navigation }) {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Ionicons name="restaurant" size={80} color="#e63946" />
        <Text style={styles.title}>FoodAdmin</Text>
        <Text style={styles.subtitle}>Restaurant Management App</Text>
      </View>

      <View style={styles.buttonContainer}>
        <TouchableOpacity
          style={[styles.button, styles.adminButton]}
          onPress={() => navigation.navigate('AdminLogin')}
        >
          <Ionicons name="shield-checkmark" size={32} color="#fff" />
          <Text style={styles.buttonText}>Admin Login</Text>
          <Text style={styles.buttonSubtext}>Manage orders, menu & more</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, styles.deliveryButton]}
          onPress={() => navigation.navigate('DeliveryLogin')}
        >
          <Ionicons name="bicycle" size={32} color="#fff" />
          <Text style={styles.buttonText}>Delivery Partner</Text>
          <Text style={styles.buttonSubtext}>View & deliver orders</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fb',
  },
  header: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 60,
  },
  title: {
    fontSize: 36,
    fontWeight: 'bold',
    color: '#1c1d21',
    marginTop: 16,
  },
  subtitle: {
    fontSize: 16,
    color: '#61636b',
    marginTop: 8,
  },
  buttonContainer: {
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: 'center',
    gap: 16,
  },
  button: {
    padding: 24,
    borderRadius: 16,
    alignItems: 'center',
  },
  adminButton: {
    backgroundColor: '#e63946',
  },
  deliveryButton: {
    backgroundColor: '#2a9d8f',
  },
  buttonText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
    marginTop: 12,
  },
  buttonSubtext: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 14,
    marginTop: 4,
  },
});
