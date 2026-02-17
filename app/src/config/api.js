import axios from 'axios';
import * as SecureStore from 'expo-secure-store';

// Change this to your backend URL
export const API_BASE_URL = 'https://restaruntbot.onrender.com';

// Event emitter for auth events
let authLogoutCallback = null;

export const setAuthLogoutCallback = (callback) => {
  authLogoutCallback = callback;
};

const api = axios.create({
  baseURL: `${API_BASE_URL}/api`,
  timeout: 60000, // Increased to 60 seconds for image uploads
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor to add auth token
api.interceptors.request.use(
  async (config) => {
    const token = await SecureStore.getItemAsync('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor for error handling with automatic token refresh
let isRefreshing = false;
let isLoggingOut = false;
let failedQueue = [];

const processQueue = (error, token = null) => {
  failedQueue.forEach(prom => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token);
    }
  });
  failedQueue = [];
};

const doForceLogout = async () => {
  if (isLoggingOut) return; // Prevent recursive logout loop
  isLoggingOut = true;
  try {
    await SecureStore.deleteItemAsync('token');
    await SecureStore.deleteItemAsync('refreshToken');
    await SecureStore.deleteItemAsync('user');
    await SecureStore.deleteItemAsync('role');
    if (authLogoutCallback) authLogoutCallback();
  } finally {
    // Reset after a short delay to allow state to settle
    setTimeout(() => { isLoggingOut = false; }, 2000);
  }
};

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // If we're already logging out, don't process 401s — just reject
    if (isLoggingOut) {
      return Promise.reject(error);
    }

    // Only attempt refresh on 401 and if not already retrying
    if (error.response?.status === 401 && !originalRequest._retry) {
      // Don't try to refresh if the failing request was itself a refresh or login
      const isAuthRoute = originalRequest.url?.includes('/auth/refresh') || 
                          originalRequest.url?.includes('/auth/login') ||
                          originalRequest.url?.includes('/delivery/login');
      if (isAuthRoute) {
        await doForceLogout();
        return Promise.reject(error);
      }

      if (isRefreshing) {
        // Queue this request until token refresh completes
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        }).then(token => {
          originalRequest.headers.Authorization = `Bearer ${token}`;
          return api(originalRequest);
        }).catch(err => Promise.reject(err));
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const refreshToken = await SecureStore.getItemAsync('refreshToken');
        if (!refreshToken) {
          throw new Error('No refresh token');
        }

        const response = await axios.post(`${API_BASE_URL}/api/auth/refresh`, { refreshToken });
        const { token: newToken, refreshToken: newRefreshToken } = response.data;

        await SecureStore.setItemAsync('token', newToken);
        if (newRefreshToken) {
          await SecureStore.setItemAsync('refreshToken', newRefreshToken);
        }

        originalRequest.headers.Authorization = `Bearer ${newToken}`;
        processQueue(null, newToken);
        return api(originalRequest);
      } catch (refreshError) {
        processQueue(refreshError, null);
        await doForceLogout();
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  }
);

export default api;
