/**
 * In-memory E2E Playwright config — runs the FULL suite against a locally
 * booted server backed by MongoMemoryServer. Zero dependence on the
 * production database or any external service (Stripe, Cloudinary, etc. are
 * mocked/placeholder). The webServer starts server/e2eServer.js which:
 *   1. Spins up an in-memory MongoDB (mongodb-memory-server)
 *   2. Seeds a faithful replica of production state (users, listings,
 *      transactions, orders, payouts, badges, auctions, promos, ...)
 *   3. Boots the real Express app on port 5001
 *
 * Run:  npm run test:e2e  (uses this config)  OR  npx playwright test --config=e2e/playwright.inmem.config.js
 */
const { defineConfig } = require('@playwright/test');
const path = require('path');

const PORT = 5001;

module.exports = defineConfig({
  testDir: './tests/prod',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,           // serial: scenario order matters (listings → cart → checkout → lifecycle)
  retries: 0,
  reporter: [['list'], ['html', { outputFolder: 'e2e/reports/inmem', open: 'never' }]],
  outputDir: 'e2e/test-results/inmem',

  webServer: {
    command: `node ${path.resolve(__dirname, '../server/e2eServer.js')}`,
    port: PORT,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      E2E_PORT: String(PORT),
      E2E_RUN_ID: process.env.E2E_RUN_ID || `inmem-${Date.now()}`,
    },
  },

  use: {
    baseURL: `http://localhost:${PORT}`,
    headless: true,
    actionTimeout: 20_000,
    navigationTimeout: 30_000,
  },

  projects: [{ name: 'inmem-e2e', use: { browserName: 'chromium' } }],
});