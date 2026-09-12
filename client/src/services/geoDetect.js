// IP-based country/currency auto-selection for the top-right selectors.
//
// Single source of truth = the server's offline IP geo layer. ONE call to
// GET /api/marketplace/status returns BOTH the IP-resolved country and its
// display currency. Web browsers, Capacitor iOS and Capacitor Android all
// speak HTTPS to the same API, so the server sees the device's real public
// IP (or the CDN geo header behind our edge) — identical behavior on all
// three platforms with zero native modules and zero third-party services.
//
// Precedence rules (tested):
//   1. An explicit user choice (manual source) is NEVER overridden.
//   2. Auto-sourced values re-detect on every app load, so a changed IP
//      (travel/VPN) self-heals instead of being frozen by the first visit.
//   3. Legacy saved values without a source marker are treated as manual
//      (they were written by user choice in earlier app versions).
//   4. Anything the server cannot resolve falls back to USD (fail-safe).
//
// Pure functions are exported for testability; storage access is guarded so
// private-mode WebViews that throw on localStorage never break the app.
import { getCurrencyByCountry, SUPPORTED_CURRENCY_CODES } from '../utils/helpers';

export const AUTO_SOURCE = 'auto';
export const MANUAL_SOURCE = 'manual';
export const DEFAULT_CURRENCY = 'USD';

export const STORAGE_KEYS = {
  currency: 'currency',
  currencySource: 'currencySource',
  country: 'country',
  countrySource: 'countrySource',
};

// Safe localStorage read (private-mode Safari/older WebViews can throw).
const safeGet = (key) => {
  try {
    return localStorage.getItem(key);
  } catch (e) {
    return null;
  }
};

// Safe localStorage write (same guards; persistence is best-effort).
const safeSet = (key, value) => {
  try {
    localStorage.setItem(key, value);
  } catch (e) { /* ignore — the in-memory state still works */ }
};

// ' gb ' → 'GB'; anything that is not a 2-letter A-Z STRING → null.
// (typeof guard matters: String(['GB']) === 'GB' would otherwise accept
// arrays, and String(42) could be smuggled through as a 2-digit code.)
export const normalizeCountry = (raw) => {
  try {
    if (typeof raw !== 'string') return null;
    const code = raw.trim().toUpperCase();
    return /^[A-Z]{2}$/.test(code) ? code : null;
  } catch (e) {
    return null;
  }
};

// ' gbp ' → 'GBP'; only codes the app can format survive → otherwise null.
export const normalizeCurrency = (raw) => {
  try {
    if (raw === null || raw === undefined) return null;
    const code = String(raw).trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(code)) return null;
    return SUPPORTED_CURRENCY_CODES.indexOf(code) !== -1 ? code : null;
  } catch (e) {
    return null;
  }
};

// Extract { country, currency } from a /marketplace/status payload.
// Server values win (it is the geo source of truth); missing currency is
// derived from the country; unknown country → USD. Never throws; garbage
// in → { country: null, currency: USD } out.
export const extractGeo = (data) => {
  const fallback = { country: null, currency: DEFAULT_CURRENCY };
  try {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return fallback;
    const country = normalizeCountry(data.country);
    let currency = normalizeCurrency(data.currency);
    if (!currency && country) currency = normalizeCurrency(getCurrencyByCountry(country));
    if (!currency) currency = DEFAULT_CURRENCY;
    return { country, currency };
  } catch (e) {
    return fallback;
  }
};

// Read the persisted preferences (with legacy-safe source inference).
export const readSavedPreferences = () => {
  const currency = normalizeCurrency(safeGet(STORAGE_KEYS.currency));
  const country = normalizeCountry(safeGet(STORAGE_KEYS.country));
  let currencySource = safeGet(STORAGE_KEYS.currencySource);
  let countrySource = safeGet(STORAGE_KEYS.countrySource);
  // Legacy values written before markers existed were always user choices.
  currencySource = currencySource === AUTO_SOURCE ? AUTO_SOURCE : (currency ? MANUAL_SOURCE : null);
  countrySource = countrySource === AUTO_SOURCE ? AUTO_SOURCE : (country ? MANUAL_SOURCE : null);
  return { currency, currencySource, country, countrySource };
};

export const persistPreference = (key, value, source) => {
  safeSet(key, value == null ? '' : value);
  safeSet(key === STORAGE_KEYS.currency ? STORAGE_KEYS.currencySource : STORAGE_KEYS.countrySource, source);
};

// Decide what to auto-detect for this app load.
//  - detectCountry/detectCurrency: may be replaced by IP-based detection
//  - apiNeeded: a /marketplace/status call is required
//  - localCurrency: currency derivable client-side from a manual country
//    (no API roundtrip needed)
export const decideAutoDetect = (saved = {}) => {
  const hasManualCurrency = !!saved.currency && saved.currencySource !== AUTO_SOURCE;
  const hasManualCountry = !!saved.country && saved.countrySource !== AUTO_SOURCE;
  const detectCurrency = !hasManualCurrency;
  const detectCountry = !hasManualCountry;
  let localCurrency = null;
  if (detectCurrency && !detectCountry && hasManualCountry) {
    localCurrency = normalizeCurrency(getCurrencyByCountry(saved.country)) || DEFAULT_CURRENCY;
  }
  const apiNeeded = detectCountry || (detectCurrency && !localCurrency);
  return { detectCountry, detectCurrency, apiNeeded, localCurrency };
};

// Merge a detection result into the current state honoring the decision.
export const applyDetectedGeo = (current, detected, decision) => {
  try {
    const next = { country: current.country || null, currency: current.currency || DEFAULT_CURRENCY };
    if (!detected) return next;
    if (decision && decision.detectCountry && detected.country) next.country = detected.country;
    if (!decision || decision.detectCurrency) next.currency = detected.currency || next.currency;
    return next;
  } catch (e) {
    return { country: current.country || null, currency: current.currency || DEFAULT_CURRENCY };
  }
};

// Module-level inflight dedupe: React 18 StrictMode (and any double-effect
// pattern) triggers the detection twice synchronously — exactly ONE request
// must fire. A NEW detection after resolution issues a fresh request so the
// per-load refresh semantics stay intact.
let inflight = null;

export const detectGeo = async (apiInstance) => {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      // NO country hint: the server must resolve the visitor's IP itself
      // (works for web, iOS and Android — the request originates on-device).
      console.log('[DBG] detectGeo calling api.get, inflight was:', inflight);
      const res = await apiInstance.get('/marketplace/status');
      const extracted = extractGeo(res && res.data);
      console.log('[DBG] detectGeo result:', JSON.stringify(extracted));
      return extracted;
    } catch (e) {
      return null; // caller keeps its defaults — never crash the shell
    } finally {
      inflight = null;
    }
  })();
  return inflight;
};

const geoDetect = {
  AUTO_SOURCE,
  MANUAL_SOURCE,
  DEFAULT_CURRENCY,
  STORAGE_KEYS,
  normalizeCountry,
  normalizeCurrency,
  extractGeo,
  readSavedPreferences,
  persistPreference,
  decideAutoDetect,
  applyDetectedGeo,
  detectGeo,
};

export default geoDetect;
