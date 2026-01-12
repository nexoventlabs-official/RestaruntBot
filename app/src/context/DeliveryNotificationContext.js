import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import * as SecureStore from 'expo-secure-store';
import api from '../config/api';

const DeliveryNotificationContext = createContext();

const STORAGE_KEY = 'delivery_notifications';
const LAST_CHECK_KEY = 'delivery_last_check_time';
const SEEN_ORDERS_KEY = 'delivery_seen_orders';

export function DeliveryNotificationProvider({ children }) {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const lastCheckTime = useRef(null);
  const seenOrderStatuses = useRef({});
  const seenAssignedOrders = useRef(new Set());
  const isInitialized = useRef(false);

  // Load data from storage on mount
  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [storedNotifications, storedLastCheck, storedSeenOrders] = await Promise.all([
        SecureStore.getItemAsync(STORAGE_KEY),
        SecureStore.getItemAsync(LAST_CHECK_KEY),
        SecureStore.getItemAsync(SEEN_ORDERS_KEY)
      ]);
      
      if (storedNotifications) {
        const parsed = JSON.parse(storedNotifications);
        setNotifications(parsed);
        setUnreadCount(parsed.filter(n => !n.read).length);
      }
      
      if (storedLastCheck) {
        lastCheckTime.current = new Date(storedLastCheck);
      } else {
        lastCheckTime.current = new Date();
        await SecureStore.setItemAsync(LAST_CHECK_KEY, new Date().toISOString());
      }
      
      if (storedSeenOrders) {
        const parsed = JSON.parse(storedSeenOrders);
        seenOrderStatuses.current = parsed.statuses || {};
        seenAssignedOrders.current = new Set(parsed.assigned || []);
      }
      
      isInitialized.current = true;
    } catch (error) {
      console.error('Error loading delivery notification data:', error);
      lastCheckTime.current = new Date();
      isInitialized.current = true;
    }
  };

  const saveNotifications = async (newNotifications) => {
    try {
      const trimmed = newNotifications.slice(0, 30);
      await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(trimmed));
    } catch (error) {
      console.error('Error saving delivery notifications:', error);
    }
  };

  const saveSeenOrders = async () => {
    try {
      const data = {
        statuses: seenOrderStatuses.current,
        assigned: Array.from(seenAssignedOrders.current).slice(-50)
      };
      await SecureStore.setItemAsync(SEEN_ORDERS_KEY, JSON.stringify(data));
    } catch (error) {
      console.error('Error saving seen orders:', error);
    }
  };

  // Check for new assigned orders and status changes
  const checkForUpdates = useCallback(async () => {
    if (!isInitialized.current) return;
    
    try {
      // Get delivery partner's orders
      const response = await api.get('/delivery/orders');
      const orders = response.data || [];
      
      const newNotifications = [];
      const now = new Date();
      
      for (const order of orders) {
        const orderId = order.orderId;
        const previousStatus = seenOrderStatuses.current[orderId];
        const wasAssigned = seenAssignedOrders.current.has(orderId);
        
        // Check for NEW ASSIGNED orders (not seen before)
        if (!wasAssigned && order.status !== 'delivered' && order.status !== 'cancelled') {
          newNotifications.push({
            id: `assigned_${orderId}_${Date.now()}`,
            type: 'new_assignment',
            title: 'New Order Assigned! 🚴',
            message: `Order #${orderId} - ₹${order.totalAmount}`,
            orderId: orderId,
            amount: order.totalAmount,
            address: order.deliveryAddress?.address || '',
            timestamp: new Date().toISOString(),
            read: false,
            icon: 'bicycle',
            color: '#F59E0B'
          });
          seenAssignedOrders.current.add(orderId);
        }
        
        // Check for STATUS CHANGES (cancelled by customer)
        if (previousStatus && previousStatus !== order.status) {
          if (order.status === 'cancelled' || order.status === 'refunded') {
            newNotifications.push({
              id: `cancelled_${orderId}_${Date.now()}`,
              type: 'order_cancelled',
              title: 'Order Cancelled ❌',
              message: `Order #${orderId} was cancelled by customer`,
              orderId: orderId,
              timestamp: new Date().toISOString(),
              read: false,
              icon: 'close-circle',
              color: '#EF4444'
            });
          }
        }
        
        // Update seen status
        seenOrderStatuses.current[orderId] = order.status;
      }
      
      // Save the current check time and seen orders
      lastCheckTime.current = now;
      await SecureStore.setItemAsync(LAST_CHECK_KEY, now.toISOString());
      await saveSeenOrders();
      
      // Add new notifications if any
      if (newNotifications.length > 0) {
        console.log('📱 New delivery notifications:', newNotifications.length);
        setNotifications(prev => {
          const updated = [...newNotifications, ...prev];
          saveNotifications(updated);
          return updated;
        });
        setUnreadCount(prev => prev + newNotifications.length);
      }
    } catch (error) {
      console.error('Error checking for delivery updates:', error);
    }
  }, []);

  // Mark all as read
  const markAllAsRead = useCallback(() => {
    setNotifications(prev => {
      const updated = prev.map(n => ({ ...n, read: true }));
      saveNotifications(updated);
      return updated;
    });
    setUnreadCount(0);
  }, []);

  // Mark single notification as read
  const markAsRead = useCallback((notificationId) => {
    setNotifications(prev => {
      const updated = prev.map(n => 
        n.id === notificationId ? { ...n, read: true } : n
      );
      saveNotifications(updated);
      return updated;
    });
    setUnreadCount(prev => Math.max(0, prev - 1));
  }, []);

  // Clear all notifications
  const clearAll = useCallback(async () => {
    setNotifications([]);
    setUnreadCount(0);
    await SecureStore.deleteItemAsync(STORAGE_KEY);
  }, []);

  // Reset tracking
  const resetTracking = useCallback(async () => {
    lastCheckTime.current = new Date();
    seenOrderStatuses.current = {};
    seenAssignedOrders.current = new Set();
    await SecureStore.deleteItemAsync(LAST_CHECK_KEY);
    await SecureStore.deleteItemAsync(SEEN_ORDERS_KEY);
    setNotifications([]);
    setUnreadCount(0);
    await SecureStore.deleteItemAsync(STORAGE_KEY);
  }, []);

  return (
    <DeliveryNotificationContext.Provider value={{
      notifications,
      unreadCount,
      checkForUpdates,
      markAllAsRead,
      markAsRead,
      clearAll,
      resetTracking
    }}>
      {children}
    </DeliveryNotificationContext.Provider>
  );
}

export function useDeliveryNotifications() {
  const context = useContext(DeliveryNotificationContext);
  if (!context) {
    throw new Error('useDeliveryNotifications must be used within a DeliveryNotificationProvider');
  }
  return context;
}
