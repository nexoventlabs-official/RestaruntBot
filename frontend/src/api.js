import axios from 'axios';

const api = axios.create({ 
  baseURL: import.meta.env.VITE_API_URL || 'https://restaruntbot.onrender.com/api',
  timeout: 15000 // 15 second timeout to prevent infinite loading
});

api.interceptors.request.use(config => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  res => res,
  err => {
    if (err.response?.status === 401) {
      localStorage.removeItem('token');
      // Redirect to the appropriate login page based on current URL
      const path = window.location.pathname;
      const loginPath = path.startsWith('/admin') ? '/admin/login' : '/super-admin/login';
      window.location.href = loginPath;
    }
    return Promise.reject(err);
  }
);

export default api;
