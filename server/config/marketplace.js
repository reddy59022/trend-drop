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
  'AD', 'AL', 'AT', 'BA', 'BE', 'BG', 'BY', 'CH', 'CY', 'CZ', 'DE', 'DK', 'EE',
  'ES', 'FI', 'FR', 'GB', 'GR', 'HR', 'HU', 'IE', 'IS', 'IT', 'LI', 'LT', 'LU',
  'LV', 'MC', 'MD', 'ME', 'MK', 'MT', 'NL', 'NO', 'PL', 'PT', 'RO', 'RS', 'RU',
  'SE', 'SI', 'SK', 'SM', 'TR', 'UA', 'VA', 'XK',
];

// Initial legal-policy rollout: USA, every European target, Australia,
// Canada, India, and Japan. A country is operational only after its pack is
// published by counsel; this list is the maximum rollout boundary.
const POLICY_PACK_TARGET_CODES = ['US', ...EUROPEAN_CODES, 'AU', 'CA', 'IN', 'JP'];
const SUPPORTED_MARKET_CODES = POLICY_PACK_TARGET_CODES;

// Enterprise-standard message shown to users outside supported markets.
const BLOCKED_REGION_MESSAGE =
  "TrendDrop isn't available in your area yet. We're expanding carefully — " +
  'your country is not inside the current legal-policy rollout boundary or its policy pack is not published. ' +
  'Sign up for updates to be notified when availability changes.';

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
  EUROPEAN_CODES,
  POLICY_PACK_TARGET_CODES,
  BLOCKED_REGION_MESSAGE,
  getSupportedCountries,
  isCountrySupported,
  getCurrencyForCountry,
};
