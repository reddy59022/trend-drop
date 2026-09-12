// Market / region access middleware (Feature 1).
//
// Resolves the requester's country from (in priority order):
//   1. X-Country-Code header  — client-provided region (mobile/web gate)
//   2. Bearer token user       — authenticated user profile country
// If a country is known and is NOT in the supported markets (USA + Europe),
// the request is rejected with a 403 + enterprise-standard region message.
// When no country can be determined the request proceeds (catalog stays
// publicly reachable for geo-unknown clients).
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { getJwtSecret } = require('../config/security');
const { isCountrySupported, BLOCKED_REGION_MESSAGE } = require('../config/marketplace');

// Lightweight country lookup for the Bearer token (when present). Runs
// BEFORE route-level auth so the region gate applies uniformly, including
// on public/optionalAuth routes.
const resolveTokenUserCountry = async (req) => {
  const header = req.headers['authorization'];
  if (!header || typeof header !== 'string') return null;
  const token = header.replace('Bearer ', '');
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, getJwtSecret());
    if (!decoded || !decoded.id) return null;
    const user = await User.findById(decoded.id).select('country');
    return user && user.country ? String(user.country).toUpperCase() : null;
  } catch (error) {
    // Invalid/expired token — let the route-level auth middleware respond 401.
    return null;
  }
};

const resolveRequestCountry = async (req) => {
  const header = req.headers['x-country-code'];
  if (header && typeof header === 'string' && header.trim()) {
    return header.trim().toUpperCase();
  }
  return resolveTokenUserCountry(req);
};

const requireSupportedRegion = async (req, res, next) => {
  try {
    const country = await resolveRequestCountry(req);
    if (country && !isCountrySupported(country)) {
      return res.status(403).json({
        supported: false,
        country,
        message: BLOCKED_REGION_MESSAGE,
        code: 'REGION_NOT_SUPPORTED',
      });
    }
    next();
  } catch (error) {
    // Never block commerce on a region-lookup failure — let routes error normally.
    next();
  }
};

module.exports = { requireSupportedRegion, resolveRequestCountry };