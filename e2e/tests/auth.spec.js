/**
 * Auth E2E — registration, login, logout, protected routes.
 * Simulates real user account lifecycle.
 */
const { test, expect } = require('@playwright/test');
const { login, logout, BUYER } = require('../helpers');

test.describe('Auth flows', () => {
  test('Register → verification screen (new user simulation)', async ({ page }) => {
    const unique = Date.now();
    await page.goto('/register');
    await page.locator('input[type="email"], input[placeholder*="mail"]').first().fill(`newuser${unique}@trenddrop.test`);
    await page.locator('input[type="password"], input[placeholder*="assword"]').first().fill('NewUserPass123!');
    // Fill remaining fields that exist (name, confirm password)
    const inputs = page.locator('form input');
    const count = await inputs.count();
    if (count > 2) {
      const nameField = page.locator('input[placeholder*="ame"], input[placeholder*="Full"]').first();
      if (await nameField.count()) await nameField.fill(`New User ${unique}`);
      const confirm = page.locator('input[placeholder*="onfirm"], input[placeholder*="epeat"]').first();
      if (await confirm.count()) await confirm.fill('NewUserPass123!');
    }
    await page.getByRole('button', { name: /sign up|register|create account/i }).first().click();
    // Real flow: pending user → verification email screen
    await expect(page.getByText(/verify|verification|check your email/i).first()).toBeVisible({ timeout: 15_000 });
    await expect(page).not.toHaveURL(/\/login$/);
  });

  test('Buyer login succeeds and persists session', async ({ page }) => {
    await login(page, BUYER);
    // Signed-in state: user dropdown trigger with avatar is visible
    await expect(page.locator('.nav-dropdown-trigger').first()).toBeVisible({ timeout: 15_000 });
  });

  test('Wrong password shows error', async ({ page }) => {
    await page.goto('/login');
    await page.locator('input[placeholder="you@example.com"]').fill(BUYER.email);
    await page.locator('input[placeholder="Enter your password"]').fill('definitely-wrong');
    await page.getByRole('button', { name: 'Sign In', exact: true }).click();
    // Server rejects with "Invalid email or password" → shown as toast
    await expect(page.locator('.Toastify__toast, [class*="toast"]').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/invalid email or password/i).first()).toBeVisible({ timeout: 5_000 });
  });

  test('Protected route redirects anonymous user to login', async ({ page }) => {
    await page.goto('/cart');
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
  });

  test('Logout returns to anonymous state', async ({ page }) => {
    await login(page, BUYER);
    await logout(page);
    await page.goto('/');
    await expect(page.locator('a[href="/login"]').first()).toBeVisible({ timeout: 15_000 });
  });
});
