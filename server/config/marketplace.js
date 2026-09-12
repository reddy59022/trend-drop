// Marketplace availability configuration (Feature 1).
//
// TrendDrop is currently available in the USA and European countries only.
// The supported-market list is intentionally centralized here so future
// markets (APAC, LATAM, …) can be added without touching middleware, routes
// or the client.
const { countries, getCountry } = require('./countries');
const { countryCurrencyMap } = require('./currencies');

// ISO 3166-1 codes for European markets. Kept adjacent to the EU continent
// list in config/shipping.js; the launch set is USA + Europe.
const EUROPEAN_CODES = [
  'GB', 'DE', 'FR', 'IT', 'ES', 'NL', 'BE', 'AT', 'PT', 'IE', 'FI', 'GR',
  'LU', 'SE', 'NO', 'DK', 'CH', 'PL', 'CZ', 'HU', 'RO', 'BG', 'HR', 'RS',
  'UA', 'IS', 'TR',
];

// USA + Europe
const SUPPORTED_MARKET_CODES = ['US', ...EUROPEAN_CODES];

// Enterprise-standard message shown to users outside supported markets.
const BLOCKED_REGION_MESSAGE =
  "TrendDrop isn't available in your area yet. We're expanding soon — " +
  'currently supporting the United States and European countries. ' +
  'Sign up for updates to be notified when we launch in your region.';

// Resolve the country object from the universal country list, so currency
// and name flags come free from the existing config.
function getSupportedCountries() {
  return SUPPORTED_MARKET_CODES
    .map((code) => getCountry(code))
    .filter(Boolean)
    .map((c) => ({ code: c.code, name: c.name, currency: c.currency, flag: c.flag }));
}

function isCountrySupported(code) {
  if (!code) return false;
  return SUPPORTED_MARKET_CODES.includes(code.toUpperCase());
}

// Resolve the display currency for a country — used by the top-right
// country/currency auto-selection (web, iOS and Android all consume this
// through GET /api/marketplace/status). Union of the currency config's
// country→currency map and the countries config, USD fallback for codes
// unknown to both. Never throws.
function getCurrencyForCountry(code) {
  try {
    const norm = String(code || '').trim().toUpperCase();
    if (countryCurrencyMap[norm]) return countryCurrencyMap[norm];
    const cfg = getCountry(norm);
    if (cfg && cfg.currency) return cfg.currency;
    return 'USD';
  } catch (e) {
    return 'USD';
  }
}

module.exports = {
  SUPPORTED_MARKET_CODES,
  BLOCKED_REGION_MESSAGE,
  getSupportedCountries,
  isCountrySupported,
  getCurrencyForCountry,
};
