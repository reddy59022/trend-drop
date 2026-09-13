/**
 * Manual Jest mock for services/api (auto-applied when a test calls jest.mock(...services/api...)).
 * Mirrors every named export of the real module as a jest.fn() plus the default axios-like client.
 * Per-test implementations are set via api.get.mockResolvedValue(...) etc.
 */
const api = {
  get: jest.fn(),
  post: jest.fn(),
  put: jest.fn(),
  delete: jest.fn(),
  patch: jest.fn(),
  interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
};

const __named = {};
const __names = ["deleteRating", "createRating", "getRatingsBySeller", "getRatingsByListing", "getUserNotifications", "markAllNotificationsRead", "startConversation", "getConversations", "getConversation", "getConversationWithUser", "sendMessage", "markAsRead", "getWishlist", "addToWishlist", "removeFromWishlist", "checkInWishlist", "reportListing", "getReports", "resolveReport", "trackPrice", "getPriceHistory", "getPayoutDashboard", "processPayout", "getSellerBalance", "getCommissionInfo", "createPaymentIntent", "confirmPayment", "getPaymentBreakdown", "getCommissions", "requestPayout", "getPlatformFee", "getOrderStatus", "cancelOrder", "confirmReceived", "requestReturn", "acceptReturn", "rejectReturn", "confirmReturnReceived", "fileDispute", "getOrderLifecycle", "boostListing", "deactivateBoost", "getBoostConfig", "saveSearch", "getSavedSearches", "getSavedSearchResults", "updateSavedSearch", "deleteSavedSearch", "createCollection", "getSellerCollections", "getCollection", "updateCollection", "addToListingToCollection", "removeListingFromCollection", "deleteCollection", "getAdminDashboard", "getAdminUsers", "getAdminUser", "updateUserRole", "suspendUser", "unsuspendUser", "getAdminListings", "deleteAdminListing", "getAdminReports", "updateAdminReportStatus", "getAdminTransactions", "adminRefundTransaction", "autoSuspendUsers", "createBundleRule", "getBundleRules", "updateBundleRule", "deleteBundleRule", "applyBundleDiscount", "sendOfferToLikers", "getBulkOffers", "claimBulkOffer", "getOfferSharingStats", "shareOfferToLikers", "createBundleOffer", "shareOfferWithFriends", "getAIPreferences", "updateAIPreferences", "getAIRecommendations", "generateAIRecommendations", "getAITrends", "getOutfitSuggestions", "getUserOutfits", "createOutfit", "getSearchBrands", "getSearchColors", "getSearchSizes", "saveSearchFilter", "getSavedSearchFilters", "createPromo", "getPromos", "updatePromo", "deletePromo", "validatePromo", "usePromo", "getReferralSettings", "getReferralStats", "generateReferralCode", "applyReferralCode", "claimReferralReward", "validateReferralCode", "getReturns", "getReturn", "createReturn", "approveReturn", "denyReturn", "shipReturn", "receiveReturn", "initiateEscrow", "confirmEscrowBuyer", "confirmEscrowSeller", "disputeEscrow", "resolveEscrowDispute", "getEscrowSettings", "purchaseShippingInsurance", "getMyInsurancePolicies", "fileInsuranceClaim", "getCart", "addItemToCart", "updateCartItem", "removeCartItem", "cartCheckout", "checkFraud", "getFraudSettings", "flagFraud", "getAuctions", "getAuction", "createAuction", "placeBid", "endAuction", "cancelAuction", "getMyAuctions", "getPriceSuggestionSettings", "getPriceSuggestion", "getSimilarSold", "getPriceTrends", "getMySellerBadge", "getSellerBadge", "requestSellerVerification", "updateSellerBadgeStats"];
__names.forEach((n) => { __named[n] = jest.fn(); api[n] = __named[n]; });

module.exports = { __esModule: true, default: api, ...__named };

