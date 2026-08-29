/**
 * Deep links E2E (TD-2.4) — every URL a user might receive in an email or
 * notification must open the right page in-app. The native app receives
 * these via appUrlOpen and routes to the same SPA paths, so verifying that
 * each path renders (or auth-redirects) on a fresh page load proves the
 * deep-link targets work end to end.
 */
const { test, expect } = require('@playwright/test');
const { login, BUYER } = require('../helpers');

test.describe('Deep links (TD-2.4)', () => {
  test('listing deep link opens the listing detail page', async ({ page }) => {
    // Discover a seeded listing id the same way a link generator would.
    await page.goto('/');
    await page.getByText('Vintage Denim Jacket').first().click();
    await expect(page).toHaveURL(/\/listing\//, { timeout: 15_000 });
    const listingUrl = page.url();
    expect(listingUrl).toMatch(/\/listing\/[A-Za-z0-9]+/);

    // A user who taps a listing link in an email is authenticated, so the
    // purchase action must be available. Log in, then cold-open the deep
    // link (fresh page load, as after app launch).
    await login(page, BUYER);
    await page.goto(listingUrl);
    await expect(page.getByText(/\$89\.99|\$89/).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('E2E Seller').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: /add to cart|add to bag/i }).first()).toBeVisible({ timeout: 10_000 });
  });

  test('messages deep link redirects unauthenticated users to login', async ({ page }) => {
    await page.goto('/messages');
    await expect(page).toHaveURL(/\/login/, { timeout: 20_000 });
  });

  test('order deep link redirects unauthenticated users to login', async ({ page }) => {
    await page.goto('/orders/000000000000000000000000');
    await expect(page).toHaveURL(/\/login/, { timeout: 20_000 });
  });

  test('unknown deep link path falls back to the app shell (no crash)', async ({ page }) => {
    // The SPA fallback serves index.html for any path; React Router renders
    // the 404 page instead of a blank screen or server error.
    const response = await page.goto('/some/unknown/deep/link');
    expect(response.status()).toBeLessThan(500);
    await expect(page.locator('body')).toBeVisible({ timeout: 10_000 });
  });
});
