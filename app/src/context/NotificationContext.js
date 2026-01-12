import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import * as SecureStore from 'expo-secure-store';
import api from '../config/api';

const NotificationContext = createContext();

const STORAGE_KEY = 'admin_notifications';
const LAST_CHECK_KEY = 'admin_last_notification_check';

export function NotificationProvider({ children }) {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [lastOrderIds, setLastOrderIds] = useState(new Set());
  const [lastStatusMap, setLastStatusMap] = useState({});
  const isInitialized = useRef(false);

  // Load notifications from storage on mount
  useEffect(() => {
    loadNotifications();
  }, []);

  const loadNotifications = async () => {
    try {
      const stored = await SecureStore.getItemAsync(STORAGE_KEY);
      const lastCheck = await SecureStore.getItemAsync(LAST_CHECK_KEY);
      
      if (stored) {
        const parsed = JSON.parse(stored);
        setNotifications(parsed);
        setUnreadCount(parsed.filter(n => !n.read).length);
      }
      
      if (lastCheck) {
        const { orderIds, statusMap } = JSON.parse(lastCheck);
        setLastOrderIds(new Set(orderIds || []));
        setLastStatusMap(statusMap || {});
      }
      
      isInitialized.current = true;
    } catch (error) {
      console.error('Error loading notifications:', error);
      isInitialized.current = true;
    }
  };

  const saveNotifications = async (newNotifications) => {
    try {
      // Keep only last 30 notifications (SecureStore has size limits)
      const trimmed = newNotifications.slice(0, 30);
      await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(trimmed));
    } catch (error) {
      console.error('Error saving notifications:', error);
    }
  };

  const saveLastCheck = async (orderIds, statusMap) => {
    try {
      // Only keep last 50 order IDs to avoid storage limits
      const limitedOrderIds = Array.from(orderIds).slice(0, 50);
      const limitedStatusMap = {};
      limitedOrderIds.forEach(id => {
        if (statusMap[id]) limitedStatusMap[id] = statusMap[id];
      });
      
      await SecureStore.setItemAsync(LAST_CHECK_KEY, JSON.stringify({
        orderIds: limitedOrderIds,
        statusMap: limitedStatusMap
      }));
    } catch (error) {
      console.error('Error saving last check:', error);
    }
  };

  // Check for new orders and status changes
  const checkForUpdates = useCallback(async () => {
    if (!isInitialized.current) return;
    
    try {
      const response = await api.get('/orders?limit=50');
      const orders = response.data.orders || [];
      
      const newNotifications = [];
      const currentOrderIds = new Set();
      const currentStatusMap = {};
      
      orders.forEach(order => {
        currentOrderIds.add(order.orderId);
        currentStatusMap[order.orderId] = order.status;
        
        // Check for new orders (not in lastOrderIds)
        if (!lastOrderIds.has(order.orderId) && lastOrderIds.size > 0) {
          newNotifications.push({
            id: `new_${order.orderId}_${Date.now()}`,
            type: 'new_order',
            title: 'New Order Received',
            message: `Order #${order.orderId} - ₹${order.totalAmount}`,
            orderId: order.orderId,
            amount: order.totalAmount,
            timestamp: new Date().toISOString(),
            read: false,
            icon: 'cart',
            color: '#F59E0B'
          });
        }
        
        // Check for status changes
        if (lastStatusMap[order.orderId] && lastStatusMap[order.orderId] !== order.status) {
          if (order.status === 'delivered') {
            newNotifications.push({
              id: `delivered_${order.orderId}_${Date.now()}`,
              type: 'delivered',
              title: 'Order Delivered',
              message: `Order #${order.orderId} has been delivered`,
              orderId: order.orderId,
              timestamp: new Date().toISOString(),
              read: false,
              icon: 'checkmark-circle',
              color: '#22C55E'
            });
          } else if (order.status === 'cancelled') {
            newNotifications.push({
              id: `cancelled_${order.orderId}_${Date.now()}`,
              type: 'cancelled',
              title: 'Order Cancelled',
              message: `Order #${order.orderId} has been cancelled`,
              orderId: order.orderId,
              timestamp: new Date().toISOString(),
              read: false,
              icon: 'close-circle',
              color: '#EF4444'
            });
          }
        }
      });
      
      // Update state
      setLastOrderIds(currentOrderIds);
      setLastStatusMap(currentStatusMap);
      saveLastCheck(currentOrderIds, currentStatusMap);
      
      // Add new notifications
      if (newNotifications.length > 0) {
        setNotifications(prev => {
          const updated = [...newNotifications, ...prev];
          saveNotifications(updated);
          return updated;
        });
        setUnreadCount(prev => prev + newNotifications.length);
      }
    } catch (error) {
      console.error('Error checking for updates:', error);
    }
  }, [lastOrderIds, lastStatusMap]);

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

  return (
    <NotificationContext.Provider value={{
      notifications,
      unreadCount,
      checkForUpdates,
      markAllAsRead,
      markAsRead,
      clearAll
    }}>
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotifications must be used within a NotificationProvider');
  }
  return context;
}
