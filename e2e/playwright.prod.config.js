/**
 * Production E2E Playwright config — runs API-driven real-user flows against
 * the DEPLOYED production app (https://trend-drop.onrender.com) using the
 * seeded production accounts. No local webServer; hits real Stripe TEST mode.
 *
 * Run:  npm run test:e2e:prod
 */
const { defineConfig } = require('@playwright/test');

const BASE_URL = process.env.E2E_PROD_BASE_URL || (process.env.IN_MEMORY_E2E === '1' ? 'http://localhost:5001' : 'https://trend-drop.onrender.com');

module.exports = defineConfig({
  testDir: './tests/prod',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,           // serial: scenario order matters (listings → cart → checkout → lifecycle)
  retries: process.env.CI ? 1 : 0,
  // Config-relative (see playwright.inmem.config.js): "./reports/…" lands in
  // e2e/reports/…, which .gitignore already excludes.
  reporter: [['list'], ['html', { outputFolder: './reports/prod', open: 'never' }]],
  outputDir: './test-results/prod',

  use: {
    baseURL: BASE_URL,
    headless: true,
    actionTimeout: 20_000,
    navigationTimeout: 30_000,
  },

  projects: [{ name: 'prod-api', use: { browserName: 'chromium' } }],
});
