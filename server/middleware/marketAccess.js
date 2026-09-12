// Market / region access middleware (Feature 1) + IP-based geo detection.
//
// Country resolution order (first decisive evidence wins):
//   1. IP evidence — CDN/proxy geo headers (CF-IPCountry, CloudFront, …) or
//      offline geoip-lite lookup of the real client IP (server/config/geo.js).
//      Zero API key, zero billing, O(1) in-process. Identical for web, iOS
//      and Android (phones just call the API over HTTPS).
//   2. Authenticated user's profile country (Bearer token).
//   3. Explicit client hint (X-Country-Code header — native apps may send
//      SIM/locale region). Accepted only when NO IP evidence exists; when IP
//      evidence says otherwise, IP wins (anti-spoof).
//
// Fail-open: if no country can be determined (private/localhost IP, lookup
// miss), the request proceeds — the public catalog stays reachable and the
// client renders the block screen from /marketplace/status instead.
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { getJwtSecret } = require('../config/security');
const { isCountrySupported, BLOCKED_REGION_MESSAGE } = require('../config/marketplace');
const { detectCountry } = require('../config/geo');

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
  // Layer 1 — IP evidence (CDN header or offline DB lookup). A spoofed
  // X-Country-Code / ?country= hint can NEVER override this: detectCountry
  // flags the mismatch and IP wins.
  try {
    const detected = detectCountry(req);
    if (detected && detected.country) return detected.country;
  } catch (e) { /* fall through to token/hint — fail open */ }

  // Layer 2 — authenticated user profile country.
  const tokenCountry = await resolveTokenUserCountry(req);
  if (tokenCountry) return tokenCountry;

  // Layer 3 — explicit client hint (only reached when no IP evidence).
  // Kept for native apps on networks where IP lookup fails (e.g. carrier
  // NAT) and for backward compatibility with existing clients/tests.
  const header = req.headers['x-country-code'];
  if (header && typeof header === 'string' && header.trim()) {
    return header.trim().toUpperCase();
  }
  return null;
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