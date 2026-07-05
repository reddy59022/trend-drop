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
      // Local development - point to local backend on the updated port 5001
      return 'http://localhost:5001/api';
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
// Delete a rating (fix syntax error: missing backtick and closing parenthesis)
export const deleteRating = (id) => api.delete(`/ratings/${id}`);
// Create a new rating for a listing or transaction
export const createRating = (data) => api.post('/ratings', data);
export const getRatingsBySeller = (sellerId) => api.get(`/ratings/seller/${sellerId}`);
export const getRatingsByListing = (listingId) => api.get(`/ratings/listing/${listingId}`);

// Notifications (client helpers for user notification endpoints)
// Fetch all notifications for a given user ID
export const getUserNotifications = (userId) => api.get(`/users/${userId}/notifications`);
// Mark all notifications as read for a user
export const markAllNotificationsRead = (userId) => api.put(`/users/${userId}/notifications/read`);

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
export const resolveReport = (id, status) => api.patch(`/reports/${id}/status`, { status });

// Price History
export const trackPrice = (data) => api.post('/pricehistory', data);
export const getPriceHistory = (listingId) => api.get(`/pricehistory/${listingId}`);

// Payouts
export const getPayoutDashboard = () => api.get('/payouts/dashboard');
export const processPayout = (transactionId) => api.post(`/payouts/process/${transactionId}`);
export const getSellerBalance = () => api.get('/payouts/balance');
export const getCommissionInfo = () => api.get('/payouts/commission-info');

// Payments (Stripe + RevenueCat)
export const createPaymentIntent = (data) => api.post('/payments/create-intent', data);
export const confirmPayment = (data) => api.post('/payments/confirm', data);
export const getPaymentBreakdown = (data) => api.post('/payments/breakdown', data);
export const getCommissions = () => api.get('/payments/commissions');
export const requestPayout = () => api.post('/payments/payout');
export const getPlatformFee = (country) => api.get(`/payments/platform-fee?country=${country}`);
// RevenueCat endpoint removed - payments handled via Stripe only

// Order Lifecycle
export const getOrderStatus = (transactionId) => api.get(`/orders/${transactionId}/status`);
export const cancelOrder = (transactionId, data) => api.post(`/orders/${transactionId}/cancel`, data);
export const confirmReceived = (transactionId, data) => api.post(`/orders/${transactionId}/confirm-received`, data);
export const requestReturn = (transactionId, data) => api.post(`/orders/${transactionId}/request-return`, data);
export const acceptReturn = (transactionId, data) => api.post(`/orders/${transactionId}/accept-return`, data);
export const rejectReturn = (transactionId, data) => api.post(`/orders/${transactionId}/reject-return`, data);
export const confirmReturnReceived = (transactionId, data) => api.post(`/orders/${transactionId}/confirm-return-received`, data);
export const fileDispute = (transactionId, data) => api.post(`/orders/${transactionId}/dispute`, data);
export const getOrderLifecycle = (transactionId) => api.get(`/orders/${transactionId}/lifecycle`);

// Inventory & Boost
export const boostListing = (listingId, data) => api.post(`/listings/${listingId}/boost`, data);
export const deactivateBoost = (listingId) => api.post(`/listings/${listingId}/deactivate-boost`);
// New: fetch boost configuration (tiers, fees, limits)
export const getBoostConfig = () => api.get('/boost/config');

// ====== Saved Searches ======
export const saveSearch = (data) => api.post('/saved-searches', data);
export const getSavedSearches = () => api.get('/saved-searches');
export const getSavedSearchResults = (id) => api.get(`/saved-searches/${id}/results`);
export const updateSavedSearch = (id, data) => api.put(`/saved-searches/${id}`, data);
export const deleteSavedSearch = (id) => api.delete(`/saved-searches/${id}`);

// ====== Collections / Storefront ======
export const createCollection = (data) => api.post('/collections', data);
export const getSellerCollections = (sellerId) => api.get(`/collections/seller/${sellerId}`);
export const getCollection = (id) => api.get(`/collections/${id}`);
export const updateCollection = (id, data) => api.put(`/collections/${id}`, data);
export const addToListingToCollection = (id, data) => api.post(`/collections/${id}/listings`, data);
export const removeListingFromCollection = (id, listingId) => api.delete(`/collections/${id}/listings/${listingId}`);
export const deleteCollection = (id) => api.delete(`/collections/${id}`);

// ====== Admin Panel ======
export const getAdminDashboard = () => api.get('/admin/dashboard');
export const getAdminUsers = (params) => api.get('/admin/users', { params });
export const getAdminUser = (id) => api.get(`/admin/users/${id}`);
export const updateUserRole = (id, role) => api.put(`/admin/users/${id}/role`, { role });
export const suspendUser = (id) => api.post(`/admin/users/${id}/suspend`);
export const unsuspendUser = (id) => api.post(`/admin/users/${id}/unsuspend`);
export const getAdminListings = (params) => api.get('/admin/listings', { params });
export const deleteAdminListing = (id) => api.delete(`/admin/listings/${id}`);
export const getAdminReports = (params) => api.get('/admin/reports', { params });
export const updateAdminReportStatus = (id, status) => api.put(`/admin/reports/${id}/status`, { status });
export const getAdminTransactions = (params) => api.get('/admin/transactions', { params });
export const adminRefundTransaction = (id) => api.post(`/admin/transactions/${id}/refund`);
export const autoSuspendUsers = () => api.post('/admin/auto-suspend');

// ====== Bundle Discounts (Section 28a) ======
export const createBundleRule = (data) => api.post('/offers/bundle', data);
export const getBundleRules = () => api.get('/offers/bundle');
export const updateBundleRule = (id, data) => api.put(`/offers/bundle/${id}`, data);
export const deleteBundleRule = (id) => api.delete(`/offers/bundle/${id}`);
export const applyBundleDiscount = (data) => api.post('/offers/bundle/apply', data);

// ====== Offers to Likers (Section 28b) ======
export const sendOfferToLikers = (data) => api.post('/offers/to-likers', data);
export const getBulkOffers = (listingId) => api.get(`/offers/bulk/${listingId}`);
export const claimBulkOffer = (offerId) => api.post(`/offers/to-likers/${offerId}/claim`);

// ====== Offer & Bundle Sharing (v45.0) ======
export const getOfferSharingStats = () => api.get('/offer-sharing/stats');
export const shareOfferToLikers = (listingId, data) => api.post(`/offer-sharing/to-likers/${listingId}`, data);
export const createBundleOffer = (data) => api.post('/offer-sharing/bundle', data);
export const shareOfferWithFriends = (offerId, data) => api.post(`/offer-sharing/share/${offerId}`, data);

// ====== Advanced Search & Filtering (v44.0) ======

// ====== AI Stylist Recommendations (v46.0) ======
export const getAIPreferences = () => api.get('/ai-stylist/preferences');
export const updateAIPreferences = (preferences) => api.put('/ai-stylist/preferences', { preferences });
export const getAIRecommendations = () => api.get('/ai-stylist/recommendations');
export const generateAIRecommendations = () => api.post('/ai-stylist/generate');
export const getAITrends = () => api.get('/ai-stylist/trends');
export const getOutfitSuggestions = (data) => api.post('/ai-stylist/outfit-suggestion', data);
export const getUserOutfits = () => api.get('/ai-stylist/outfits');
export const createOutfit = (data) => api.post('/ai-stylist/outfits', data);
export const getSearchBrands = () => api.get('/search/brands');
export const getSearchColors = (category) => api.get(`/search/colors?category=${category}`);
export const getSearchSizes = (category) => api.get(`/search/sizes?category=${category}`);
export const saveSearchFilter = (data) => api.post('/search/save', data);
export const getSavedSearchFilters = () => api.get('/search/saved');

// ====== Promotions / Coupon Codes (Section 28c) ======
export const createPromo = (data) => api.post('/promos', data);
export const getPromos = () => api.get('/promos');
export const updatePromo = (id, data) => api.put(`/promos/${id}`, data);
export const deletePromo = (id) => api.delete(`/promos/${id}`);
export const validatePromo = (data) => api.post('/promos/validate', data);
export const usePromo = (id) => api.post(`/promos/${id}/use`);

export default api;
