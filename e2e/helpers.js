/**
 * E2E test helpers — shared utilities for real-user flow simulation.
 */
const { expect } = require('@playwright/test');

const BUYER = { email: 'e2e-buyer@trenddrop.test', password: 'E2ePass123!', name: 'E2E Buyer' };
const SELLER = { email: 'e2e-seller@trenddrop.test', password: 'E2ePass123!', name: 'E2E Seller' };

async function login(page, { email, password }) {
  await page.goto('/login');
  await page.locator('input[placeholder="you@example.com"]').fill(email);
  await page.locator('input[placeholder="Enter your password"]').fill(password);
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  // Wait for the auth state to flip (navbar shows the user dropdown trigger)
  await expect(page.locator('.nav-dropdown-trigger').first()).toBeVisible({ timeout: 15_000 });
}

async function logout(page) {
  // Open user dropdown then click the Logout item
  await page.locator('.nav-dropdown-trigger').first().click();
  await page.locator('.logout-btn').first().click();
  await expect(page.locator('.nav-dropdown-trigger').first()).toBeHidden({ timeout: 15_000 }).catch(() => {});
}

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

module.exports = { login, logout, clearCart, addJacketToCart, BUYER, SELLER, expect };
