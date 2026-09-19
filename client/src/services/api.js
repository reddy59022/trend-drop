import axios from 'axios';
import { Capacitor } from '@capacitor/core';

// Accessed in interceptors before the module-level default export below
const isNativePlatform = () =>
  typeof Capacitor !== 'undefined' && Capacitor.isNativePlatform?.();

const readToken = () => {
  try { return localStorage.getItem('token'); } catch { return null; }
};
const removeToken = () => {
  try { localStorage.removeItem('token'); } catch { /* restricted storage */ }
};

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

// Guard against accidentally interpolating undefined/null/NaN into URLs
// (e.g. /users/undefined). Fail fast client-side instead of sending
// garbage requests to the API (which used to surface as 500s server-side).
api.interceptors.request.use((config) => {
  if (config.url && /(?:undefined|null|NaN)(?:\/|$)/.test(config.url)) {
    return Promise.reject(new Error(`Invalid request URL: ${config.url}`));
  }
  return config;
});

// Request interceptor to add auth token
api.interceptors.request.use(
  (config) => {
    const token = readToken();
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
      removeToken();
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

// Legal documents and consent. Documents are public; acceptance is authenticated.
export const getLegalDocuments = (country) => api.get(`/legal/documents${country ? `?country=${encodeURIComponent(country)}` : ''}`);
export const getLegalDocument = (type, country) => api.get(`/legal/documents/${type}${country ? `?country=${encodeURIComponent(country)}` : ''}`);
export const getLegalConsentStatus = () => api.get('/legal/consent-status');
export const acceptLegalDocuments = (data) => api.post('/legal/accept', data);
export const listLegalPolicyPacks = (params) => api.get('/admin/legal/policy-packs', { params });
export const listLegalPolicyTargets = () => api.get('/admin/legal/policy-targets');
export const getLegalPolicyReadiness = () => api.get('/admin/legal/readiness');
export const bootstrapLegalPolicyTargets = (version) => api.post('/admin/legal/policy-packs/bootstrap-targets', { version });
export const getLegalPolicyEvents = (id) => api.get(`/admin/legal/policy-packs/${id}/events`);
export const updateLegalPolicyTranslations = (id, documents) => api.put(`/admin/legal/policy-packs/${id}/translations`, { documents });
export const signOffLegalPolicyLanguage = (id, language, attestation) => api.post(`/admin/legal/policy-packs/${id}/signoffs`, { language, attestation });
export const createLegalPolicyPack = (data) => api.post('/admin/legal/policy-packs', data);
export const submitLegalPolicyPack = (id) => api.post(`/admin/legal/policy-packs/${id}/submit`);
export const approveLegalPolicyPack = (id) => api.post(`/admin/legal/policy-packs/${id}/approve`);
export const rejectLegalPolicyPack = (id, reason) => api.post(`/admin/legal/policy-packs/${id}/reject`, { reason });
export const publishLegalPolicyPack = (id) => api.post(`/admin/legal/policy-packs/${id}/publish`);
export const rollbackLegalPolicyPack = (id, data) => api.post(`/admin/legal/policy-packs/${id}/rollback`, data);

// ====== New Feature APIs ======

// Client-side ID validation prevents malformed route parameters from reaching
// the network. The server also validates IDs, but rejecting here gives callers
// a deterministic error and avoids wasted requests.
const withValidResourceId = (id, resource, request) => {
  if (!isValidMongoId(id)) {
    return Promise.reject(new Error(`Invalid ${resource} ID`));
  }
  return request();
};

// Ratings
export const deleteRating = (id) => withValidResourceId(id, 'rating', () => api.delete(`/ratings/${id}`));
export const createRating = (data) => api.post('/ratings', data);
export const getRatingsBySeller = (sellerId) => withValidResourceId(sellerId, 'seller', () => api.get(`/ratings/seller/${sellerId}`));
export const getRatingsByListing = (listingId) => withValidResourceId(listingId, 'listing', () => api.get(`/ratings/listing/${listingId}`));

// Notifications (client helpers for user notification endpoints)
export const getUserNotifications = (userId) => withValidResourceId(userId, 'user', () => api.get(`/users/${userId}/notifications`));
export const markAllNotificationsRead = (userId) => withValidResourceId(userId, 'user', () => api.put(`/users/${userId}/notifications/read`));

// Messages
export const startConversation = (data) => api.post('/messages', data);
export const getConversations = () => api.get('/messages/conversations');
export const getConversation = (userId, listingId) => withValidResourceId(userId, 'user', () => withValidResourceId(listingId, 'listing', () => api.get(`/messages/conversation/${userId}/${listingId}`)));
export const getConversationWithUser = (userId) => withValidResourceId(userId, 'user', () => api.get(`/messages/conversation/${userId}`));
export const sendMessage = (conversationId, data) => withValidResourceId(conversationId, 'conversation', () => api.post(`/messages/${conversationId}`, data));
export const markAsRead = (conversationId) => withValidResourceId(conversationId, 'conversation', () => api.put(`/messages/read/${conversationId}`));

// Wishlist
export const getWishlist = () => api.get('/wishlist');
export const addToWishlist = (listingId) => withValidResourceId(listingId, 'listing', () => api.post('/wishlist', { listingId }));
export const removeFromWishlist = (listingId) => withValidResourceId(listingId, 'listing', () => api.delete(`/wishlist/${listingId}`));
export const checkInWishlist = (listingId) => withValidResourceId(listingId, 'listing', () => api.get(`/wishlist/check/${listingId}`));

// Reports
export const reportListing = (data) => api.post('/reports', data);
export const getReports = () => api.get('/admin/reports');
export const resolveReport = (id, status) => withValidResourceId(id, 'report', () => api.put(`/admin/reports/${id}/status`, { status }));

// Price History
export const trackPrice = (data) => api.post('/pricehistory', data);
export const getPriceHistory = (listingId) => withValidResourceId(listingId, 'listing', () => api.get(`/pricehistory/${listingId}`));

// Payouts
export const getPayoutDashboard = () => api.get('/payouts/dashboard');
export const processPayout = (transactionId) => withValidResourceId(transactionId, 'transaction', () => api.post(`/payouts/process/${transactionId}`));
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
const withValidTransactionId = (transactionId, request) => {
  if (!isValidMongoId(transactionId)) {
    return Promise.reject(new Error('Invalid transaction ID'));
  }
  return request();
};

export const getOrderStatus = (transactionId) => withValidTransactionId(transactionId, () => api.get(`/orders/${transactionId}/status`));
export const cancelOrder = (transactionId, data) => withValidTransactionId(transactionId, () => api.post(`/orders/${transactionId}/cancel`, data));
export const confirmReceived = (transactionId, data) => withValidTransactionId(transactionId, () => api.post(`/orders/${transactionId}/confirm-received`, data));
export const requestReturn = (transactionId, data) => withValidTransactionId(transactionId, () => api.post(`/orders/${transactionId}/request-return`, data));
export const acceptReturn = (transactionId, data) => withValidTransactionId(transactionId, () => api.post(`/orders/${transactionId}/accept-return`, data));
export const rejectReturn = (transactionId, data) => withValidTransactionId(transactionId, () => api.post(`/orders/${transactionId}/reject-return`, data));
export const confirmReturnReceived = (transactionId, data) => withValidTransactionId(transactionId, () => api.post(`/orders/${transactionId}/confirm-return-received`, data));
export const fileDispute = (transactionId, data) => withValidTransactionId(transactionId, () => api.post(`/orders/${transactionId}/dispute`, data));
export const getOrderLifecycle = (transactionId) => withValidTransactionId(transactionId, () => api.get(`/orders/${transactionId}/lifecycle`));

// Inventory & Boost
export const boostListing = (listingId, data) => withValidResourceId(listingId, 'listing', () => api.post(`/listings/${listingId}/boost`, data));
export const deactivateBoost = (listingId) => withValidResourceId(listingId, 'listing', () => api.post(`/listings/${listingId}/deactivate-boost`));
// New: fetch boost configuration (tiers, fees, limits)
export const getBoostConfig = () => api.get('/boost/config');

// ====== Saved Searches ======
export const saveSearch = (data) => api.post('/saved-searches', data);
export const getSavedSearches = () => api.get('/saved-searches');
export const getSavedSearchResults = (id) => withValidResourceId(id, 'saved search', () => api.get(`/saved-searches/${id}/results`));
export const updateSavedSearch = (id, data) => withValidResourceId(id, 'saved search', () => api.put(`/saved-searches/${id}`, data));
export const deleteSavedSearch = (id) => withValidResourceId(id, 'saved search', () => api.delete(`/saved-searches/${id}`));

// ====== Collections / Storefront ======
export const createCollection = (data) => api.post('/collections', data);
export const getSellerCollections = (sellerId) => withValidResourceId(sellerId, 'seller', () => api.get(`/collections/seller/${sellerId}`));
export const getCollection = (id) => withValidResourceId(id, 'collection', () => api.get(`/collections/${id}`));
export const updateCollection = (id, data) => withValidResourceId(id, 'collection', () => api.put(`/collections/${id}`, data));
export const addToListingToCollection = (id, data) => withValidResourceId(id, 'collection', () => api.post(`/collections/${id}/listings`, data));
export const removeListingFromCollection = (id, listingId) => withValidResourceId(id, 'collection', () => withValidResourceId(listingId, 'listing', () => api.delete(`/collections/${id}/listings/${listingId}`)));
export const deleteCollection = (id) => withValidResourceId(id, 'collection', () => api.delete(`/collections/${id}`));

// ====== Admin Panel ======
export const getAdminDashboard = () => api.get('/admin/dashboard');
export const getAdminUsers = (params) => api.get('/admin/users', { params });
export const getAdminUser = (id) => withValidResourceId(id, 'admin user', () => api.get(`/admin/users/${id}`));
export const updateUserRole = (id, role) => withValidResourceId(id, 'admin user', () => api.put(`/admin/users/${id}/role`, { role }));
export const suspendUser = (id) => withValidResourceId(id, 'admin user', () => api.post(`/admin/users/${id}/suspend`));
export const unsuspendUser = (id) => withValidResourceId(id, 'admin user', () => api.post(`/admin/users/${id}/unsuspend`));
export const getAdminListings = (params) => api.get('/admin/listings', { params });
export const deleteAdminListing = (id) => withValidResourceId(id, 'admin listing', () => api.delete(`/admin/listings/${id}`));
export const getAdminReports = (params) => api.get('/admin/reports', { params });
export const updateAdminReportStatus = (id, status) => withValidResourceId(id, 'admin report', () => api.put(`/admin/reports/${id}/status`, { status }));
export const getAdminTransactions = (params) => api.get('/admin/transactions', { params });
export const adminRefundTransaction = (id) => withValidResourceId(id, 'transaction', () => api.post(`/admin/transactions/${id}/refund`));
export const autoSuspendUsers = () => api.post('/admin/auto-suspend');
export const getPendingSellerVerifications = () => api.get('/admin/seller-badges/pending');
export const reviewSellerBadge = (userId, data) => withValidResourceId(userId, 'user', () => api.put(`/admin/seller-badges/${userId}/verification`, data));

// ====== Transactions ======
const isValidMongoId = (value) => typeof value === 'string' && /^[a-f\d]{24}$/i.test(value);

export const getTransactions = (params) => api.get('/transactions', { params });
export const getTransaction = (id) => {
  if (!isValidMongoId(id)) {
    return Promise.reject(new Error('Invalid transaction ID'));
  }
  return api.get(`/transactions/${id}`);
};

// ====== Bundle Discounts (Section 28a) ======
export const createBundleRule = (data) => api.post('/offers/bundle', data);
export const getBundleRules = () => api.get('/offers/bundle');
export const updateBundleRule = (id, data) => withValidResourceId(id, 'bundle rule', () => api.put(`/offers/bundle/${id}`, data));
export const deleteBundleRule = (id) => withValidResourceId(id, 'bundle rule', () => api.delete(`/offers/bundle/${id}`));
export const applyBundleDiscount = (data) => api.post('/offers/bundle/apply', data);

// ====== Offers to Likers (Section 28b) ======
const withValidOfferId = (id, request) => {
  if (!isValidMongoId(id)) {
    return Promise.reject(new Error('Invalid offer ID'));
  }
  return request();
};

export const sendOfferToLikers = (data) => api.post('/offers/to-likers', data);
export const getBulkOffers = (listingId) => withValidResourceId(listingId, 'listing', () => api.get(`/offers/bulk/${listingId}`));
export const claimBulkOffer = (offerId) => withValidOfferId(offerId, () => api.post(`/offers/to-likers/${offerId}/claim`));

// ====== Offer & Bundle Sharing (v45.0) ======
export const getOfferSharingStats = () => api.get('/offer-sharing/stats');
export const shareOfferToLikers = (listingId, data) => withValidResourceId(listingId, 'listing', () => api.post(`/offer-sharing/to-likers/${listingId}`, data));
export const createBundleOffer = (data) => api.post('/offer-sharing/bundle', data);
export const shareOfferWithFriends = (offerId, data) => withValidOfferId(offerId, () => api.post(`/offer-sharing/share/${offerId}`, data));

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
export const updatePromo = (id, data) => withValidResourceId(id, 'promo', () => api.put(`/promos/${id}`, data));
export const deletePromo = (id) => withValidResourceId(id, 'promo', () => api.delete(`/promos/${id}`));
export const validatePromo = (data) => api.post('/promos/validate', data);
export const usePromo = (id) => withValidResourceId(id, 'promo', () => api.post(`/promos/${id}/use`));

// ====== Referral Program (v30.0) ======
export const getReferralSettings = () => api.get('/referrals/settings');
export const getReferralStats = () => api.get('/referrals/my');
export const generateReferralCode = () => api.post('/referrals/generate');
export const applyReferralCode = (data) => api.post('/referrals/apply', data);
export const claimReferralReward = () => api.post('/referrals/claim');
export const validateReferralCode = (code) => api.get(`/referrals/${code}`);

// ====== Returns Center ======
const withValidReturnId = (id, request) => {
  if (!isValidMongoId(id)) {
    return Promise.reject(new Error('Invalid return ID'));
  }
  return request();
};

export const getReturns = () => api.get('/returns');
export const getReturn = (id) => withValidReturnId(id, () => api.get(`/returns/${id}`));
export const createReturn = (data) => api.post('/returns', data);
export const approveReturn = (id) => withValidReturnId(id, () => api.put(`/returns/${id}/approve`));
export const denyReturn = (id, reason) => withValidReturnId(id, () => api.put(`/returns/${id}/deny`, { reason }));
export const shipReturn = (id, trackingNumber) => withValidReturnId(id, () => api.put(`/returns/${id}/ship`, { trackingNumber }));
export const receiveReturn = (id) => withValidReturnId(id, () => api.put(`/returns/${id}/receive`));

// ====== Escrow Service (v26.0) ======
export const initiateEscrow = (data) => api.post('/escrow/initiate', data);
export const confirmEscrowBuyer = (transactionId) => api.post('/escrow/confirm-buyer', { transactionId });
export const confirmEscrowSeller = (transactionId) => api.post('/escrow/confirm-seller', { transactionId });
export const disputeEscrow = (data) => api.post('/escrow/dispute', data);
export const resolveEscrowDispute = (data) => api.post('/escrow/resolve-dispute', data);
export const getEscrowSettings = () => api.get('/escrow/settings');

// ====== Shipping Insurance (v31.0) ======
export const getShippingInsuranceSettings = () => api.get('/shipping-insurance/settings');
export const calculateShippingInsurance = (data) => api.post('/shipping-insurance/calculate', data);
export const purchaseShippingInsurance = (data) => api.post('/shipping-insurance/purchase', data);
export const getMyInsurancePolicies = () => api.get('/shipping-insurance/my');
export const fileInsuranceClaim = (policyId, data) => withValidResourceId(policyId, 'insurance policy', () => api.post(`/shipping-insurance/${policyId}/claim`, data));
export const refundShippingInsurance = (policyId) => withValidResourceId(policyId, 'insurance policy', () => api.post(`/shipping-insurance/${policyId}/refund`));

// ====== Cart (v29.0) ======
export const getCart = () => api.get('/cart');
export const addItemToCart = (data) => api.post('/cart/items', data);
// Backend POST /cart/items replaces quantity (no separate PUT endpoint)
export const updateCartItem = (listingId, quantity) => api.post('/cart/items', { listingId, quantity });
export const removeCartItem = (listingId) => api.delete(`/cart/items/${listingId}`);
export const cartCheckout = (shippingAddress, paymentIntentId) => api.post('/cart/checkout', { shippingAddress, paymentIntentId });

// ====== Fraud Detection ======
export const checkFraud = (data) => api.post('/fraud/check', data);
export const getFraudSettings = () => api.get('/fraud/settings');
export const flagFraud = (data) => api.post('/fraud/flag', data);

// ====== Auctions (v27.0) ======
export const getAuctions = (params) => api.get('/auctions', { params });
export const getAuction = (id) => withValidResourceId(id, 'auction', () => api.get(`/auctions/${id}`));
export const createAuction = (data) => api.post('/auctions', data);
export const placeBid = (auctionId, amount) => withValidResourceId(auctionId, 'auction', () => api.post(`/auctions/${auctionId}/bids`, { amount }));
export const endAuction = (auctionId) => withValidResourceId(auctionId, 'auction', () => api.post(`/auctions/${auctionId}/close`));
export const cancelAuction = (auctionId) => withValidResourceId(auctionId, 'auction', () => api.delete(`/auctions/${auctionId}`));
export const getMyAuctions = () => api.get('/auctions', { params: { mine: 'true' } });

// ====== Price Suggestion AI (v28.0) ======
export const getPriceSuggestionSettings = () => api.get('/price-suggestions/settings');
export const getPriceSuggestion = (data) => api.post('/price-suggestions/suggest', data);
export const getSimilarSold = (data) => api.post('/price-suggestions/similar', data);
export const getPriceTrends = (category) => api.get(`/price-suggestions/trends?category=${category || ''}`);

// ====== Loyalty Program ======
export const getLoyaltyStatus = () => api.get('/loyalty');
export const earnLoyaltyPoints = (data) => api.post('/loyalty/earn', data);
export const redeemLoyaltyPoints = (amount) => api.post('/loyalty/redeem', { amount });
export const getLoyaltyHistory = () => api.get('/loyalty/history');

// ====== Seller Badges / Verification (v39.0) ======
export const getMySellerBadge = () => api.get('/seller-badges/me');
export const getSellerBadge = (userId) => {
  if (!/^[a-f\d]{24}$/i.test(String(userId || ''))) {
    return Promise.reject(new Error('Invalid seller id'));
  }
  return api.get(`/seller-badges/${userId}`);
};
export const requestSellerVerification = () => api.put('/seller-badges/verify');
export const updateSellerBadgeStats = (data) => api.put('/seller-badges/update-stats', data);

export default api;
