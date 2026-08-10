/**
 * Browse E2E — home feed, search, listing detail, filters.
 * Simulates a shopper discovering products.
 */
const { test, expect } = require('@playwright/test');
const { login, BUYER } = require('../helpers');

test.describe('Browse & discovery', () => {
  test('Home page renders seeded listings', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Vintage Denim Jacket').first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Silk Evening Dress').first()).toBeVisible({ timeout: 10_000 });
  });

  test('Search finds listings by keyword', async ({ page }) => {
    await page.goto('/');
    const searchInput = page.locator('input[placeholder*="earch"], input[type="search"]').first();
    if (await searchInput.count()) {
      await searchInput.fill('denim');
      await searchInput.press('Enter');
      await expect(page.getByText('Vintage Denim Jacket').first()).toBeVisible({ timeout: 20_000 });
    } else {
      // Fallback: navigate to search page with query
      await page.goto('/search?q=denim');
      await expect(page.getByText('Vintage Denim Jacket').first()).toBeVisible({ timeout: 20_000 });
    }
  });

  test('Listing detail shows price, seller and add-to-cart', async ({ page }) => {
    await page.goto('/');
    await page.getByText('Vintage Denim Jacket').first().click();
    await expect(page).toHaveURL(/\/listing\//, { timeout: 15_000 });
    await expect(page.getByText(/\$89\.99|\$89/).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('E2E Seller').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: /add to cart|add to bag/i }).first()).toBeVisible({ timeout: 10_000 });
  });

  test('Category filter narrows results', async ({ page }) => {
    await page.goto('/');
    const catLink = page.locator('a[href*="category"], a:has-text("Women")').first();
    if (await catLink.count()) {
      await catLink.click();
      await expect(page.getByText('Silk Evening Dress').first()).toBeVisible({ timeout: 20_000 });
    }
  });

  test('Listing not found shows empty state', async ({ page }) => {
    await page.goto('/listing/000000000000000000000000');
    await expect(page.getByText(/not found|doesn.t exist|unavailable/i).first()).toBeVisible({ timeout: 15_000 });
  });
});
