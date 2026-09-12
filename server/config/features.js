// Feature flag registry (Feature 2). Read lazily from env so deployments
// and test suites can toggle flags at runtime without a process restart.
//
// Available flags:
//   INTERNATIONAL_SHOPPING_ENABLED
//     true  → items may ship between countries
//     false → items may only ship WITHIN the seller's own country (default)

const BOOLEAN_FLAGS = {
  internationalShippingEnabled: 'INTERNATIONAL_SHOPPING_ENABLED',
};

// Resolve a single flag by its camelCase name (defaults false).
const getFeature = (name) => {
  const envKey = BOOLEAN_FLAGS[name];
  if (!envKey) return false;
  const raw = process.env[envKey];
  return raw !== undefined && String(raw).toLowerCase() === 'true';
};

const isInternationalShippingEnabled = () => getFeature('internationalShippingEnabled');

// Public flag set — safe to expose to the client (no secrets, no infra).
const getPublicFeatures = () => ({
  internationalShippingEnabled: isInternationalShippingEnabled(),
});

module.exports = {
  BOOLEAN_FLAGS,
  getFeature,
  isInternationalShippingEnabled,
  getPublicFeatures,
};