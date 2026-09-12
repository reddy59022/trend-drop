// Client-side feature-flag helper (Feature 2).
//
// Fetches the public flag set from GET /api/config/features once and caches
// it for 5 minutes (flags rarely change mid-session). If the API is
// unreachable we fail SAFE: international shipping is treated as DISABLED
// so a client can never advertise cross-country shipping the server would
// reject.
import api from './api';

const TTL_MS = 5 * 60 * 1000;

let cache = null;
let cachedAt = 0;

export const clearFeatureCache = () => {
  cache = null;
  cachedAt = 0;
};

export const getFeatureFlags = async ({ force = false } = {}) => {
  const now = Date.now();
  if (!force && cache && now - cachedAt < TTL_MS) {
    return cache;
  }
  try {
    const res = await api.get('/config/features');
    cache = res.data && typeof res.data === 'object' ? res.data : {};
  } catch (error) {
    if (cache) return cache;
    // Fail SAFE: unknown flags default to their conservative value.
    cache = { internationalShippingEnabled: false };
  }
  cachedAt = now;
  return cache;
};

// Convenience accessor for the international-shipping flag.
export const isInternationalShippingEnabled = (flags) =>
  flags ? flags.internationalShippingEnabled === true : false;

export const featureFlags = { getFeatureFlags, clearFeatureCache, isInternationalShippingEnabled };

export default featureFlags;