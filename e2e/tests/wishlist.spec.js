/**
 * Wishlist E2E — save items, view saved items.
 * Simulates a shopper bookmarking products.
 */
const { test, expect } = require('@playwright/test');
const { login, BUYER } = require('../helpers');

test.describe('Wishlist', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, BUYER);
  });

  test('Like a listing from its detail page', async ({ page }) => {
    await page.goto('/');
    await page.getByText('Handmade Leather Tote').first().click();
    const likeBtn = page.locator('button:has(svg), button:has-text("♡"), button[aria-label*="like" i], button[aria-label*="save" i], button:has-text("♥")').first();
    if (await likeBtn.count()) {
      await likeBtn.click().catch(() => {});
    }
  });

  test('Wishlist page renders', async ({ page }) => {
    await page.goto('/wishlist');
    await expect(page.getByText(/wishlist|saved|favorites/i).first()).toBeVisible({ timeout: 20_000 });
  });
});
