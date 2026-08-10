/**
 * Seller E2E — dashboard, create listing, manage inventory.
 * Simulates a seller running their shop.
 */
const { test, expect } = require('@playwright/test');
const { login, SELLER } = require('../helpers');

test.describe('Seller business flows', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, SELLER);
  });

  test('Seller dashboard loads with stats', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByText(/dashboard|overview/i).first()).toBeVisible({ timeout: 20_000 });
  });

  test('Sell page form renders required fields', async ({ page }) => {
    await page.goto('/sell');
    await expect(page.getByText(/sell|list your/i).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('form input').first()).toBeVisible({ timeout: 15_000 });
  });

  test('Create a listing end-to-end', async ({ page }) => {
    const title = `E2E Sneakers ${Date.now()}`;
    await page.goto('/sell');
    await expect(page.locator('form').first()).toBeVisible({ timeout: 20_000 });
    // Fill core fields by label/placeholder heuristics
    const titleInput = page.locator('input[placeholder*="itle"], input[name="title"]').first();
    if (await titleInput.count()) {
      await titleInput.fill(title);
    }
    const priceInput = page.locator('input[placeholder*="rice"], input[name="price"]').first();
    if (await priceInput.count()) {
      await priceInput.fill('75');
    }
    const submit = page.getByRole('button', { name: /publish|list item|create listing|submit/i }).first();
    if (await submit.count()) {
      await submit.click();
      // Either a success toast or redirect to the listing/dashboard
      await expect(
        page.getByText(/success|published|created|listed/i).first().or(page.getByText(title).first())
      ).toBeVisible({ timeout: 20_000 });
    }
  });

  test('Seller dashboard lists their seeded listings', async ({ page }) => {
    await page.goto('/seller-dashboard');
    // Listings render in the "Offers to Likers" tab select (fetched via /listings/user/:id)
    await page.getByRole('button', { name: /offers to likers/i }).first().click();
    const option = page.locator('select option', { hasText: 'Vintage Denim Jacket' }).first();
    await expect(option).toHaveCount(1, { timeout: 20_000 });
  });
});
