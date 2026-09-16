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
 * Strict ObjectId check for values that arrive in a request (body or params).
 *
 * `mongoose.Types.ObjectId.isValid()` is NOT a safe gate for user input: it
 * returns true for any number (e.g. 123) and for ANY 12-character string, yet
 * Mongoose cannot cast a number into an ObjectId. Routes that guarded with it
 * therefore still reached `findById(123)` and threw a CastError -> 500.
 * Only the canonical 24-char hex form (what Mongoose produces and what clients
 * send back) and real ObjectId instances are accepted — both always cast.
 */
const isValidObjectId = (value) =>
  value instanceof mongoose.Types.ObjectId
  || (typeof value === 'string' && /^[0-9a-fA-F]{24}$/.test(value));

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
    if (!isValidObjectId(value)) {
      return res.status(400).json({ message: 'Invalid ID', param: key });
    }
  }
  next();
};

module.exports = { assertObjectId, isValidObjectId };
