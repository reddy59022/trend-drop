const mongoose = require('mongoose');

/**
 * Coerce a query/body value to a plain string for use in $regex / string
 * filters. Express query parsing yields objects/arrays for hostile inputs
 * like `?q[$gt]=` or `?q[]=x`; passing those straight into Mongoose throws
 * CastError -> 500. Arrays join with space; objects and other non-strings
 * collapse to '' (which callers treat as absent).
 */
const asText = (value) => {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.filter((v) => typeof v === 'string').join(' ');
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
};

/**
 * Coerce a query/body value to a finite number, falling back to `fallback`
 * when the value is missing, an object/array, or not numeric. Guards
 * `Number({})` -> NaN paths that later throw CastError -> 500 (e.g.
 * `?minPrice[$gt]=1` landing in a price range filter as NaN).
 */
const asNumber = (value, fallback) => {
  if (Array.isArray(value)) value = value[0];
  if (typeof value === 'object' && value !== null) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

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

/**
 * Escape regex metacharacters so a user-supplied string can be embedded in a
 * MongoDB $regex safely. A hostile q like '*' or '(' makes $regex throw ->
 * 500; escaping turns it into a harmless literal match.
 */
const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Global hostile-query sanitizer. Express' default ("extended") query parser
 * turns inputs like `?q[$gt]=x` or `?limit[]=1` into objects/arrays on
 * req.query; routes that forward those values into Mongoose ($regex, numeric
 * filters, skip/limit) then throw CastError -> 500. Defense-in-depth: this
 * middleware, mounted in server.js before every router, collapses any
 * object/array query value to its first scalar (objects without scalars are
 * deleted), so no route can ever see a hostile query shape regardless of
 * whether it coerces defensively itself. Legitimate clients always send
 * scalar query values, so collapsing is behavior-preserving for real
 * traffic; nested filter operators via query string were never a supported
 * API (filters travel in POST/PUT bodies).
 */
const sanitizeQuery = (req, _res, next) => {
  try {
    const q = req.query;
    if (q && typeof q === 'object') {
      for (const key of Object.keys(q)) {
        const v = q[key];
        if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') continue;
        if (Array.isArray(v)) {
          const first = v.find((e) => ['string', 'number', 'boolean'].includes(typeof e));
          if (first === undefined) delete q[key];
          else q[key] = first;
          continue;
        }
        if (v !== null && typeof v === 'object') {
          const scalars = Object.values(v).filter((e) => ['string', 'number', 'boolean'].includes(typeof e));
          if (scalars.length === 0) delete q[key];
          else q[key] = scalars[0];
          continue;
        }
        // null/undefined/functions/symbols: not legitimate query values.
        delete q[key];
      }
    }
  } catch (e) { /* sanitizer is best-effort — never fail a request over it */ }
  next();
};

module.exports = { assertObjectId, isValidObjectId, asText, asNumber, escapeRegex, sanitizeQuery };
