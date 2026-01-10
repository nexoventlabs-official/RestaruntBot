import React, { createContext, useContext, useState, useEffect } from 'react';
import * as SecureStore from 'expo-secure-store';
import api from '../config/api';
import pushNotifications from '../services/pushNotifications';

const AuthContext = createContext({});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStoredAuth();
  }, []);

  const loadStoredAuth = async () => {
    try {
      const token = await SecureStore.getItemAsync('token');
      const storedUser = await SecureStore.getItemAsync('user');
      const storedRole = await SecureStore.getItemAsync('role');

      if (token && storedUser && storedRole) {
        setUser(JSON.parse(storedUser));
        setRole(storedRole);
        
        // Verify token is still valid
        try {
          if (storedRole === 'admin') {
            await api.get('/auth/verify');
          } else {
            await api.get('/delivery/verify');
            // Re-register push token for delivery partner
            registerPushToken();
          }
        } catch (error) {
          await logout();
        }
      }
    } catch (error) {
      console.error('Error loading auth:', error);
    } finally {
      setLoading(false);
    }
  };

  // Register push notifications for delivery partner
  const registerPushToken = async () => {
    try {
      const pushToken = await pushNotifications.registerForPushNotifications();
      if (pushToken) {
        await pushNotifications.updatePushToken(pushToken);
      }
    } catch (error) {
      console.error('Error registering push token:', error);
    }
  };

  const loginAdmin = async (username, password) => {
    const response = await api.post('/auth/login', { username, password });
    const { token, user: userData } = response.data;
    
    await SecureStore.setItemAsync('token', token);
    await SecureStore.setItemAsync('user', JSON.stringify(userData));
    await SecureStore.setItemAsync('role', 'admin');
    
    setUser(userData);
    setRole('admin');
    return userData;
  };

  const loginDelivery = async (email, password) => {
    const response = await api.post('/delivery/login', { email, password });
    const { token, user: userData } = response.data;
    
    await SecureStore.setItemAsync('token', token);
    await SecureStore.setItemAsync('user', JSON.stringify(userData));
    await SecureStore.setItemAsync('role', 'delivery');
    
    setUser(userData);
    setRole('delivery');
    
    // Register push notifications for delivery partner
    registerPushToken();
    
    return userData;
  };

  const logout = async () => {
    try {
      if (role === 'delivery') {
        await api.post('/delivery/status', { isOnline: false });
      }
    } catch (error) {
      console.error('Error updating status:', error);
    }
    
    await SecureStore.deleteItemAsync('token');
    await SecureStore.deleteItemAsync('user');
    await SecureStore.deleteItemAsync('role');
    
    setUser(null);
    setRole(null);
  };

  return (
    <AuthContext.Provider value={{ user, role, loading, loginAdmin, loginDelivery, logout, setUser }}>
      {children}
    </AuthContext.Provider>
  );
};
