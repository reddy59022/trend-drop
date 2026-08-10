/**
 * Playwright E2E configuration — TrendDrop
 *
 * Spins up the full app (server + seeded in-memory MongoDB + built client)
 * via server/e2eServer.js, then runs real-user browser flows.
 *
 * Run:  npx playwright test
 */
const { defineConfig } = require('@playwright/test');

const PORT = process.env.E2E_PORT || '5001';
const BASE_URL = `http://localhost:${PORT}`;

module.exports = defineConfig({
  testDir: './e2e/tests',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { outputFolder: 'e2e/reports', open: 'never' }]],
  outputDir: 'e2e/test-results',

  use: {
    baseURL: BASE_URL,
    headless: true,
    viewport: { width: 1440, height: 900 },
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },

  webServer: {
    command: `node server/e2eServer.js`,
    port: Number(PORT),
    reuseExistingServer: false,
    timeout: 120_000,
  },

  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
});
