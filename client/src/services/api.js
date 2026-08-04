import axios from 'axios';
import { Capacitor } from '@capacitor/core';

// Accessed in interceptors before the module-level default export below
const isNativePlatform = () =>
  typeof Capacitor !== 'undefined' && Capacitor.isNativePlatform?.();

// Determine the API base URL based on platform
const getBaseURL = () => {
  // 1) Explicit build-time override — set REACT_APP_API_URL at build time
  //    (e.g. REACT_APP_API_URL=https://trend-drop.onrender.com/api npm run build).
  //    On native iOS/Android the WebView hostname is ALWAYS "localhost",
  //    so a hostname check alone would send production phones to their own
  //    localhost. This env var is the ONLY reliable way to point a release
  //    build at the deployed backend.
  if (process.env.REACT_APP_API_URL) {
    return process.env.REACT_APP_API_URL.replace(/\/$/, '');
  }

  const isNative = Capacitor.isNativePlatform();

  if (isNative) {
    // For native iOS/Android:
    // - Local development (Capacitor Live Reload / `npx cap run`) is served
    //   from http://localhost:3000 (web) or capacitor://localhost (app).
    // - On the Android emulator the host machine is reachable at 10.0.2.2,
    //   NOT localhost — otherwise the app on the emulator would try to talk
    //   to its own http://localhost:5001 and every API call would fail.
    // - A release build stores the app bundle locally and the hostname is
    //   always "localhost", so we additionally require a non-HTTPS origin
    //   before treating it as local dev. The deployed backend is always
    //   HTTPS, so this cleanly separates the two.
    const isLocalServer = window.location.protocol === 'http:'
                       && (window.location.hostname === 'localhost'
                        || window.location.hostname === '127.0.0.1'
                        || window.location.hostname === '10.0.2.2');

    if (isLocalServer) {
      // Local development - point to local backend on the updated port 5001.
      // Android emulator reaches the host machine via 10.0.2.2.
      if (window.location.hostname === '10.0.2.2') {
        return 'http://10.0.2.2:5001/api';
      }
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
      // Broadcast so React (AuthContext) can clear state and reroute.
      window.dispatchEvent(new Event('auth-unauthorized'));
      // On web, hard redirect. On native, React Router handles it to avoid
      // navigating to a non-existent WebView path.
      if (!isNativePlatform() && window.location.pathname !== '/login') {
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

// ====== Referral Program (v30.0) ======
export const getReferralSettings = () => api.get('/referrals/settings');
export const getReferralStats = () => api.get('/referrals/my');
export const generateReferralCode = () => api.post('/referrals/generate');
export const applyReferralCode = (data) => api.post('/referrals/apply', data);
export const claimReferralReward = () => api.post('/referrals/claim');
export const validateReferralCode = (code) => api.get(`/referrals/${code}`);

// ====== Returns Center ======
export const getReturns = () => api.get('/returns');
export const getReturn = (id) => api.get(`/returns/${id}`);
export const createReturn = (data) => api.post('/returns', data);
export const approveReturn = (id) => api.put(`/returns/${id}/approve`);
export const denyReturn = (id, reason) => api.put(`/returns/${id}/deny`, { reason });
export const shipReturn = (id, trackingNumber) => api.put(`/returns/${id}/ship`, { trackingNumber });
export const receiveReturn = (id) => api.put(`/returns/${id}/receive`);

// ====== Escrow Service (v26.0) ======
export const initiateEscrow = (data) => api.post('/escrow/initiate', data);
export const confirmEscrowBuyer = (transactionId) => api.post('/escrow/confirm-buyer', { transactionId });
export const confirmEscrowSeller = (transactionId) => api.post('/escrow/confirm-seller', { transactionId });
export const disputeEscrow = (data) => api.post('/escrow/dispute', data);
export const resolveEscrowDispute = (data) => api.post('/escrow/resolve-dispute', data);
export const getEscrowSettings = () => api.get('/escrow/settings');

// ====== Shipping Insurance (v31.0) ======
export const purchaseShippingInsurance = (data) => api.post('/shipping-insurance/purchase', data);
export const getMyInsurancePolicies = () => api.get('/shipping-insurance/my');
export const fileInsuranceClaim = (policyId, data) => api.post(`/shipping-insurance/${policyId}/claim`, data);

// ====== Cart (v29.0) ======
export const getCart = () => api.get('/cart');
export const addItemToCart = (data) => api.post('/cart/items', data);
// Backend POST /cart/items replaces quantity (no separate PUT endpoint)
export const updateCartItem = (listingId, quantity) => api.post('/cart/items', { listingId, quantity });
export const removeCartItem = (listingId) => api.delete(`/cart/items/${listingId}`);
export const cartCheckout = (shippingAddress) => api.post('/cart/checkout', { shippingAddress });

// ====== Fraud Detection ======
export const checkFraud = (data) => api.post('/fraud/check', data);
export const getFraudSettings = () => api.get('/fraud/settings');
export const flagFraud = (data) => api.post('/fraud/flag', data);

// ====== Auctions (v27.0) ======
export const getAuctions = (params) => api.get('/auctions', { params });
export const getAuction = (id) => api.get(`/auctions/${id}`);
export const createAuction = (data) => api.post('/auctions', data);
export const placeBid = (auctionId, amount) => api.post(`/auctions/${auctionId}/bids`, { amount });
export const endAuction = (auctionId) => api.post(`/auctions/${auctionId}/end`);
export const cancelAuction = (auctionId) => api.post(`/auctions/${auctionId}/cancel`);
export const getMyAuctions = () => api.get('/auctions/my');

// ====== Price Suggestion AI (v28.0) ======
export const getPriceSuggestionSettings = () => api.get('/price-suggestions/settings');
export const getPriceSuggestion = (data) => api.post('/price-suggestions/suggest', data);
export const getSimilarSold = (data) => api.post('/price-suggestions/similar', data);
export const getPriceTrends = (category) => api.get(`/price-suggestions/trends?category=${category || ''}`);

// ====== Seller Badges / Verification (v39.0) ======
export const getMySellerBadge = () => api.get('/seller-badges/me');
export const getSellerBadge = (userId) => api.get(`/seller-badges/${userId}`);
export const requestSellerVerification = () => api.put('/seller-badges/verify');
export const updateSellerBadgeStats = (data) => api.put('/seller-badges/update-stats', data);

export default api;
