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

module.exports = { login, logout, BUYER, SELLER, expect };
