// Client-side market/region availability helper (Feature 1).
//
// The app currently operates in the USA + European countries. This helper
// lets the client ask the API whether a given country is supported and
// remembers the last-known region (so the block screen is instant on
// subsequent visits).
import api from './api';

const STORAGE_KEY = 'td_region_country';
const SUPPORTED_KEY = 'td_region_supported';

// localStorage can throw in restricted WebViews / private browsing. Region
// checks run during boot, so storage access must never crash the app or
// mask the server's authoritative response.
const safeGet = (key) => {
  try { return localStorage.getItem(key); } catch { return null; }
};
const safeSet = (key, value) => {
  try { localStorage.setItem(key, value); } catch { /* best effort */ }
};

export const getStoredCountry = () => safeGet(STORAGE_KEY);

export const getStoredSupported = () => safeGet(SUPPORTED_KEY) === 'true';

export const setRegionCountry = (country) => {
  if (country && typeof country === 'string' && country.trim()) {
    safeSet(STORAGE_KEY, country.trim().toUpperCase());
  }
};

// Resolve the country to check: stored region > user profile > null.
// Returning null means "no reliable country known" — the caller then asks
// the server to auto-detect from the request IP (works for web and for
// Capacitor iOS/Android, whose XHR reaches the API directly from the
// device, so the server sees the device's real public IP).
export const getRegionCountry = (user) => {
  const stored = getStoredCountry();
  if (stored) return stored;
  if (user && typeof user.country === 'string' && user.country.trim()) {
    return user.country.trim().toUpperCase();
  }
  return null;
};

// Ask the API whether a country is supported. When no country is known the
// server detects it from the client IP (CDN geo header or offline geo DB).
// Caches the result so the block screen renders instantly on repeat visits.
// Fails open (supported) on network errors so a flaky check can never lock
// real users out — the server enforces the region gate authoritatively.
export const checkRegionStatus = async (user) => {
  const country = getRegionCountry(user);
  const query = country ? `?country=${encodeURIComponent(country)}` : '';
  try {
    const res = await api.get(`/marketplace/status${query}`);
    const data = res.data || {};
    if (data.country) safeSet(STORAGE_KEY, data.country.toUpperCase());
    safeSet(SUPPORTED_KEY, data.supported ? 'true' : 'false');
    return { ...data, country: data.country || country || 'US' };
  } catch (error) {
    return { country: country || 'US', supported: true, message: 'Available', error: true };
  }
};

const marketAccess = {
  getStoredCountry,
  getStoredSupported,
  setRegionCountry,
  getRegionCountry,
  checkRegionStatus,
};

export default marketAccess;