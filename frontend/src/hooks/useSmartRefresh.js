import { useState, useEffect, useRef, useCallback } from 'react';
import api from '../api';

// Deep comparison to detect actual changes
const hasDataChanged = (oldData, newData) => {
  return JSON.stringify(oldData) !== JSON.stringify(newData);
};

/**
 * Smart refresh hook - only updates state when data actually changes
 * @param {string} endpoint - API endpoint to poll
 * @param {object} options - Configuration options
 * @param {number} options.interval - Polling interval in ms (default: 10000)
 * @param {function} options.transform - Transform response data
 * @param {boolean} options.enabled - Enable/disable polling (default: true)
 */
export function useSmartRefresh(endpoint, options = {}) {
  const { 
    interval = 10000, 
    transform = (res) => res.data,
    enabled = true 
  } = options;

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  
  const dataRef = useRef(null);
  const intervalRef = useRef(null);

  const fetchData = useCallback(async (isBackground = false) => {
    try {
      if (!isBackground) setLoading(true);
      
      const res = await api.get(endpoint);
      const newData = transform(res);
      
      // Only update if data has actually changed
      if (hasDataChanged(dataRef.current, newData)) {
        dataRef.current = newData;
        setData(newData);
        setLastUpdated(new Date());
      }
      
      setError(null);
    } catch (err) {
      // Only set error if no data exists (don't break UI on background refresh failures)
      if (!dataRef.current) {
        setError(err);
      }
      console.error(`Error fetching ${endpoint}:`, err);
    } finally {
      // Always stop loading regardless of success/failure
      setLoading(false);
    }
  }, [endpoint, transform]);

  // Initial fetch
  useEffect(() => {
    fetchData(false);
  }, [fetchData]);

  // Background polling
  useEffect(() => {
    if (!enabled) return;

    intervalRef.current = setInterval(() => {
      fetchData(true);
    }, interval);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [fetchData, interval, enabled]);

  // Manual refresh function
  const refresh = useCallback(() => {
    return fetchData(false);
  }, [fetchData]);

  return { data, loading, error, lastUpdated, refresh };
}

/**
 * Smart refresh for orders with filter support
 */
export function useOrdersRefresh(filter = '', interval = 5000) {
  const endpoint = `/orders${filter ? `?status=${filter}` : ''}`;
  
  return useSmartRefresh(endpoint, {
    interval,
    transform: (res) => res.data.orders
  });
}

/**
 * Smart refresh for dashboard stats
 */
export function useDashboardRefresh(interval = 10000) {
  return useSmartRefresh('/analytics/dashboard', { interval });
}

/**
 * Smart refresh for customers
 */
export function useCustomersRefresh(interval = 15000) {
  return useSmartRefresh('/customers', {
    interval,
    transform: (res) => res.data.customers
  });
}

/**
 * Smart refresh for menu items
 */
export function useMenuRefresh(interval = 30000) {
  return useSmartRefresh('/menu', { interval });
}
