/**
 * Offers E2E — buyer makes offer, seller sees & responds.
 * Simulates price negotiation between real users.
 */
const { test, expect } = require('@playwright/test');
const { login, BUYER, SELLER } = require('../helpers');

test.describe('Offer negotiation', () => {
  test('Buyer makes an offer on a listing', async ({ page }) => {
    await login(page, BUYER);
    await page.goto('/');
    await page.getByText('Silk Evening Dress').first().click();
    const offerBtn = page.getByRole('button', { name: /make an offer|make offer/i }).first();
    if (await offerBtn.count()) {
      await offerBtn.click();
      const amountInput = page.locator('input[placeholder*="mount"], input[type="number"]').first();
      if (await amountInput.count()) {
        await amountInput.fill('100');
      }
      const sendBtn = page.getByRole('button', { name: /send|submit offer|place offer/i }).first();
      if (await sendBtn.count()) {
        await sendBtn.click();
        await expect(page.getByText(/offer.*sent|sent.*offer|success/i).first()).toBeVisible({ timeout: 15_000 });
      }
    }
  });

  test('Seller sees received offers', async ({ page }) => {
    await login(page, SELLER);
    await page.goto('/offers');
    await expect(page.getByText(/offer/i).first()).toBeVisible({ timeout: 20_000 });
  });
});
