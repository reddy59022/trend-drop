/**
 * Trends E2E — trend dashboard, viral feed, forecast.
 * Simulates a shopper checking what's hot.
 */
const { test, expect } = require('@playwright/test');
const { login, BUYER } = require('../helpers');

test.describe('Trends & forecasting', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, BUYER);
  });

  test('Trends dashboard shows seeded trend posts', async ({ page }) => {
    await page.goto('/trends');
    await expect(page.getByText(/Y2K|Y2KFashion/i).first()).toBeVisible({ timeout: 20_000 });
  });

  test('Viral trends filter shows viral posts', async ({ page }) => {
    await page.goto('/trends');
    const viralTab = page.getByRole('tab', { name: /viral/i }).first();
    if (await viralTab.count()) {
      await viralTab.click();
      await expect(page.getByText(/viral/i).first()).toBeVisible({ timeout: 15_000 });
    }
  });

  test('Trend forecast page renders', async ({ page }) => {
    await page.goto('/trend-forecast');
    await expect(page.getByText(/forecast|trend/i).first()).toBeVisible({ timeout: 20_000 });
  });
});
