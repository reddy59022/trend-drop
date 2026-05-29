import axios from 'axios';
import { Capacitor } from '@capacitor/core';

// Determine the API base URL based on platform
const getBaseURL = () => {
  const isNative = Capacitor.isNativePlatform();

  if (isNative) {
    // For native iOS/Android:
    // - In local development (start.sh), point to local backend
    // - In production, point to deployed Render backend
    // When using Capacitor Live Reload with `npx cap run`, the app
    // runs in a webview pointing to localhost, so use localhost
    const isLocalDev = window.location.hostname === 'localhost'
                     || window.location.hostname === '127.0.0.1';

    if (isLocalDev) {
      // Local development - point to local backend on port 5000
      return 'http://localhost:5000/api';
    }

    // Production - point to deployed Render backend
    // After deploying on Render, this will be your live URL
    return 'https://trend-drop.onrender.com/api';
  }

  // For web, use relative URL (served by Express in production)
  // In development, the proxy in package.json handles this
  return '/api';
};

const api = axios.create({
  baseURL: getBaseURL(),
});

// Request interceptor to add auth token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor for error handling
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

export default api;
