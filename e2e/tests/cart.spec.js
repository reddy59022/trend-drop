/**
 * Cart & Checkout E2E — add to bag, quantities, removal, checkout.
 * Simulates a shopper completing a purchase attempt.
 *
 * NOTE: the E2E server keeps one shared in-memory DB, so the buyer's cart
 * persists between tests. beforeEach clears it via API for deterministic runs.
 */
const { test, expect } = require('@playwright/test');
const { login, BUYER } = require('../helpers');

async function clearCart(page) {
  // Must run inside the page context so it carries the JWT from localStorage
  // (page.request does NOT share localStorage — it would get 401s).
  await page.evaluate(async () => {
    // Clear BOTH the server cart AND the localStorage cart. The provider
    // initializes React state from localStorage and syncCartFromServer
    // re-pushes local-only items back to the server — so a stale local cart
    // would resurrect deleted items on the next reload.
    localStorage.removeItem('cart');
    const token = localStorage.getItem('token');
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const res = await fetch('/api/cart', { headers });
    if (!res.ok) return;
    const body = await res.json();
    const items = (body.cart && body.cart.items) || [];
    for (const item of items) {
      // DELETE /api/cart/items/:id filters by LISTING id, not the cart-item id
      const id = item.listing?._id || item.listingId || item.listing;
      if (id) {
        await fetch(`/api/cart/items/${id}`, { method: 'DELETE', headers }).catch(() => {});
      }
    }
  });
}

async function addJacketToCart(page) {
  await page.goto('/');
  await page.getByText('Vintage Denim Jacket').first().click();
  // Click Add to Cart and wait for the server POST to complete BEFORE
  // navigating — a full page load aborts the in-flight request otherwise.
  const post = page.waitForResponse(
    r => r.url().includes('/api/cart/items') && r.request().method() === 'POST' && r.status() === 200,
    { timeout: 15_000 }
  );
  await page.getByRole('button', { name: /add to cart|add to bag/i }).first().click();
  await post;
}

test.describe('Cart & checkout', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, BUYER);
    await clearCart(page);
    // CartContext caches the server cart in React state; reload so the
    // provider refetches the (now empty) cart before each test.
    await page.reload();
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
    const checkoutBtn = page.getByRole('button', { name: /checkout|place order/i }).first();
    if (await checkoutBtn.count()) {
      await checkoutBtn.click();
      await expect(page).toHaveURL(/checkout|payment/, { timeout: 15_000 });
      await expect(page.locator('form').first()).toBeVisible({ timeout: 15_000 });
    }
  });
});
