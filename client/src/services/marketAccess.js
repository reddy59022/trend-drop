// Client-side market/region availability helper (Feature 1).
//
// The app currently operates in the USA + European countries. This helper
// lets the client ask the API whether a given country is supported and
// remembers the last-known region (so the block screen is instant on
// subsequent visits).
import api from './api';

const STORAGE_KEY = 'td_region_country';
const SUPPORTED_KEY = 'td_region_supported';

export const getStoredCountry = () => localStorage.getItem(STORAGE_KEY);

export const getStoredSupported = () => localStorage.getItem(SUPPORTED_KEY) === 'true';

export const setRegionCountry = (country) => {
  if (country && typeof country === 'string' && country.trim()) {
    localStorage.setItem(STORAGE_KEY, country.trim().toUpperCase());
  }
};

// Resolve the country to check: stored region > user profile > US default.
// Defaulting to US keeps the public catalog reachable for anonymous users
// (the server still enforces the region gate server-side).
export const getRegionCountry = (user) => {
  const stored = getStoredCountry();
  if (stored) return stored;
  if (user && typeof user.country === 'string' && user.country.trim()) {
    return user.country.trim().toUpperCase();
  }
  return 'US';
};

// Ask the API whether a country is supported. Caches the result so the
// block screen renders instantly on repeat visits. Fails open (supported)
// on network errors so a flaky check can never lock real users out — the
// server enforces the region gate authoritatively.
export const checkRegionStatus = async (user) => {
  const country = getRegionCountry(user);
  try {
    const res = await api.get(`/marketplace/status?country=${encodeURIComponent(country)}`);
    const data = res.data || {};
    if (data.country) localStorage.setItem(STORAGE_KEY, data.country.toUpperCase());
    localStorage.setItem(SUPPORTED_KEY, data.supported ? 'true' : 'false');
    return { ...data, country: data.country || country };
  } catch (error) {
    return { country, supported: true, message: 'Available', error: true };
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