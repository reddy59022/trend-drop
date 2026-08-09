const mongoose = require('mongoose');

// Magic-string route segments that are intentionally not ObjectIds
// (e.g. GET /api/users/me, /api/users/self). Express matches these
// against `:id`-style params before the numeric/24-hex check would
// otherwise reject them with 400.
const MAGIC_PARAM_VALUES = new Set([
  'me', 'self', 'current', 'new', 'saved', 'featured', 'trending',
  'all', 'top', 'search', 'feed', 'recent', 'liked', 'profile',
  'stats', 'settings', 'balance', 'wallet', 'activity', 'reviews',
  'orders', 'payouts', 'wishlist', 'cart', 'history', 'inbox',
  'drafts', 'staff', 'mine', 'popular', 'followers', 'following',
]);

/**
 * Express middleware that validates every ObjectId-style route param
 * (:id, :userId, :listingId, :orderId, :offerId, :conversationId,
 * :transactionId, :commentId, :sellerId, :categoryId, etc.) found on
 * req.params. If a param is present but not a valid MongoDB ObjectId,
 * respond 400 instead of letting Mongoose throw a CastError (500).
 * Mounted globally in server.js (`app.use('/api', assertObjectId)`).
 */
const assertObjectId = (req, res, next) => {
  for (const [key, value] of Object.entries(req.params || {})) {
    if (value === undefined || value === null || value === '') continue;
    // Only validate params that are used as document IDs.
    if (!/Id$|^id$/i.test(key)) continue;
    // Magic strings (e.g. 'me') are legitimate non-ObjectId values.
    if (MAGIC_PARAM_VALUES.has(String(value).toLowerCase())) continue;
    if (!mongoose.Types.ObjectId.isValid(value)) {
      return res.status(400).json({ message: 'Invalid ID', param: key });
    }
  }
  next();
};

/**
 * Same as assertObjectId but for a single named param (for inline use
 * in routes where a full middleware isn't convenient).
 */
const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

module.exports = { assertObjectId, isValidObjectId };
