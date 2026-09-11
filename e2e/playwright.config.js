/**
 * TrendDrop E2E Playwright config — TWO modes:
 *
 * 1. IN-MEMORY (default, npm run test:e2e):
 *    Starts server/e2eServer.js as a webServer. That script spins up an
 *    in-memory MongoDB (mongodb-memory-server), seeds test users/listings/trends,
 *    and boots the real Express app on PORT 5001. Playwright hits
 *    http://localhost:5001 — fully hermetic, no network, no production DB.
 *
 * 2. PRODUCTION SMOKE (npm run test:e2e:prod):
 *    Hits the live Render deployment (https://trend-drop.onrender.com) using the
 *    seeded production accounts. Used sparingly for pre-deploy verification.
 *    Config: e2e/playwright.prod.config.js
 *
 * The shared helpers (e2e/tests/prod/helpers.js) read BASE_URL from the env so
 * the same 22 spec files run against EITHER target without modification.
 */
const { defineConfig } = require('@playwright/test');
const path = require('path');

const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:5001';

module.exports = defineConfig({
  testDir: './tests/prod',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { outputFolder: 'e2e/reports/e2e', open: 'never' }]],
  outputDir: 'e2e/test-results/e2e',

  // Spin up the in-memory app BEFORE the first test and tear it down after the
  // last. The server seeds its own data on startup, so no separate setup step
  // is needed. webServer.reuse is false so a fresh seeded DB is used every run.
  webServer: {
    command: `node ${path.resolve(__dirname, 'server/e2eServer.js')}`,
    port: 5001,
    timeout: 60_000,
    reuse: false,
    env: {
      // Keep the in-memory server hermetic: no real external services.
      NODE_ENV: 'production',
      DISABLE_RATE_LIMIT: 'true',
      JWT_SECRET: 'e2e-test-secret-do-not-use-in-prod',
      STRIPE_SECRET_KEY: 'sk_test_placeholder',
      STRIPE_PUBLISHABLE_KEY: 'pk_test_placeholder',
      STRIPE_WEBHOOK_SECRET: 'whsec_placeholder',
      CLOUDINARY_CLOUD_NAME: 'placeholder',
      CLOUDINARY_API_KEY: 'placeholder',
      CLOUDINARY_API_SECRET: 'placeholder',
      BREVO_API_KEY: 'xkeysib-placeholder',
      GOOGLE_CLIENT_ID: 'placeholder.apps.googleusercontent.com',
      REACT_APP_GOOGLE_CLIENT_ID: 'placeholder.apps.googleusercontent.com',
      MONGOMS_VERSION: '7.0.14',
    },
  },

  use: {
    baseURL: BASE_URL,
    headless: true,
    actionTimeout: 20_000,
    navigationTimeout: 30_000,
    // Share the baseURL with the API context so helpers don't hardcode it.
    httpCredentials: undefined,
  },

  projects: [
    { name: 'e2e-memory', use: { browserName: 'chromium' } },
  ],
});
