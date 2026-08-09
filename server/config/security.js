/**
 * Centralized security configuration.
 * Single source of truth for the JWT secret so every consumer
 * (auth routes, auth middleware, websocket) signs/verifies with the
 * same value. Fail-fast in production when the secret is missing.
 */

const DEV_FALLBACK_SECRET = 'dev_insecure_jwt_secret_change_me';
// Legacy placeholder previously hardcoded in routes/websocket.
const LEGACY_PLACEHOLDER = 'fallback_secret_change_me';

let warned = false;

const getJwtSecret = () => {
  const secret = process.env.JWT_SECRET;

  if (secret && secret !== LEGACY_PLACEHOLDER) {
    return secret;
  }

  // The legacy placeholder is treated as unset.
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'JWT_SECRET environment variable is required in production. ' +
      'Set a strong, unique secret before starting the server.'
    );
  }

  // Test mode: jest.setup.js intentionally pins JWT_SECRET to the legacy
  // placeholder so test suites can mint tokens that the auth middleware
  // verifies. Accept it there for parity.
  if (process.env.NODE_ENV === 'test' && secret) {
    return secret;
  }

  if (!warned) {
    console.warn(
      '[security] JWT_SECRET is not set. Using a development-only fallback secret. ' +
      'Set JWT_SECRET in your environment for any non-local deployment.'
    );
    warned = true;
  }
  return DEV_FALLBACK_SECRET;
};

module.exports = { getJwtSecret, DEV_FALLBACK_SECRET };
