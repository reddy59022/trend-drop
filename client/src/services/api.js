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

// ====== New Feature APIs ======

// Ratings
export const createRating = (data) => api.post('/ratings', data);
export const getRatingsBySeller = (sellerId) => api.get(`/ratings/seller/${sellerId}`);
export const getRatingsByListing = (listingId) => api.get(`/ratings/listing/${listingId}`);
export const deleteRating = (id) => api.delete(`/ratings/${id}`);

// Messages
export const startConversation = (data) => api.post('/messages', data);
export const getConversations = () => api.get('/messages/conversations');
export const getConversation = (userId, listingId) => api.get(`/messages/conversation/${userId}/${listingId}`);
export const sendMessage = (conversationId, data) => api.post(`/messages/${conversationId}`, data);
export const markAsRead = (conversationId) => api.put(`/messages/read/${conversationId}`);

// Wishlist
export const getWishlist = () => api.get('/wishlist');
export const addToWishlist = (listingId) => api.post('/wishlist', { listingId });
export const removeFromWishlist = (listingId) => api.delete(`/wishlist/${listingId}`);
export const checkInWishlist = (listingId) => api.get(`/wishlist/check/${listingId}`);

// Reports
export const reportListing = (data) => api.post('/reports', data);
export const getReports = () => api.get('/reports');
export const updateReportStatus = (id, status) => api.patch(`/reports/${id}/status`, { status });

// Price History
export const trackPrice = (data) => api.post('/pricehistory', data);
export const getPriceHistory = (listingId) => api.get(`/pricehistory/${listingId}`);

// Payouts
export const getPayoutDashboard = () => api.get('/payouts/dashboard');
export const processPayout = (transactionId) => api.post(`/payouts/process/${transactionId}`);
export const getSellerBalance = () => api.get('/payouts/balance');
export const getCommissionInfo = () => api.get('/payouts/commission-info');

export default api;
