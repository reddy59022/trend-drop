/**
 * Wraps an async Express route handler so rejected promises are
 * forwarded to the central error handler instead of crashing or
 * hanging the request.
 */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = asyncHandler;
