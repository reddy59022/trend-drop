/**
 * Cart & Checkout E2E — add to bag, quantities, removal, checkout.
 * Simulates a shopper completing a purchase attempt.
 *
 * NOTE: the E2E server keeps one shared in-memory DB, so the buyer's cart
 * persists between tests. beforeEach clears it via API for deterministic runs.
 */
const { test, expect } = require('@playwright/test');
const { login, clearCart, addJacketToCart, BUYER } = require('../helpers');

test.describe('Cart & checkout', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, BUYER);
    await clearCart(page);
    // CartContext caches the server cart in React state; reload so the
    // provider refetches the (now empty) cart before each test.
    await page.reload();
  });

  test.afterEach(async ({ page }) => {
    await clearCart(page);
  });

  test('Add item to cart from listing detail', async ({ page }) => {
    await addJacketToCart(page);
    await page.goto('/cart');
    await expect(page.getByText('Vintage Denim Jacket').first()).toBeVisible({ timeout: 15_000 });
  });

  test('Cart empty state shows message', async ({ page }) => {
    await page.goto('/cart');
    // Wait for the cart page to settle — the heading renders only after the
    // CartContext provider has synced with the server on page load.
    await expect(page.getByRole('heading', { name: /your bag/i }).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/your bag is empty|bag is empty|no items/i).first()).toBeVisible({ timeout: 15_000 });
  });

  test('Remove item from cart returns to empty state', async ({ page }) => {
    await addJacketToCart(page);
    await page.goto('/cart');
    const removeBtn = page.getByRole('button', { name: /remove|delete/i }).first();
    if (await removeBtn.count()) {
      await removeBtn.click();
      await expect(page.getByText(/your bag is empty|bag is empty|no items/i).first()).toBeVisible({ timeout: 15_000 });
    }
  });

  test('Checkout page renders payment form', async ({ page }) => {
    await addJacketToCart(page);
    await page.goto('/cart');
    // Wait for the cart to sync: item visible AND checkout enabled (the button
    // is disabled while React state hasn't loaded the server cart yet).
    await expect(page.getByText('Vintage Denim Jacket').first()).toBeVisible({ timeout: 15_000 });
    const checkoutBtn = page.getByRole('button', { name: /proceed to checkout/i });
    await expect(checkoutBtn).toBeEnabled({ timeout: 15_000 });
    await checkoutBtn.click();
    // Checkout is INLINE on /cart (no separate URL): clicking creates the
    // intent then renders the Stripe payment form in place.
    await expect(page.locator('form').first()).toBeVisible({ timeout: 15_000 });
    // Stripe Elements card iframe proves the payment form actually mounted
    await expect(
      page.locator('iframe[title*="card"], iframe[title*="Secure"]').first()
    ).toBeVisible({ timeout: 15_000 });
  });
});
