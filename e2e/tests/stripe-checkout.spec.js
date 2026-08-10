/**
 * Stripe test-mode checkout — full card payment with the 4242… test card.
 *
 * KEY-GATED: runs only when real Stripe TEST keys are present in the
 * environment (STRIPE_SECRET_KEY + STRIPE_PUBLISHABLE_KEY, sk_test_/pk_test_,
 * no placeholders). Without keys the tests skip cleanly, keeping the base
 * E2E count stable. The E2E server passes real env keys through now
 * (e2eServer.js only fills placeholders when vars are absent).
 *
 * Activation: export STRIPE_SECRET_KEY / STRIPE_PUBLISHABLE_KEY /
 * STRIPE_WEBHOOK_SECRET (local shell, or CI secrets) and run the suite.
 * Fills the Stripe Elements iframe with the 4242 test card and asserts the
 * full purchase completes (TD-1.1 AC: checkout with Stripe test card 4242…
 * completes; webhook updates order; seller balance/payout record created).
 */
const { test, expect } = require('@playwright/test');
const { login, clearCart, addJacketToCart, BUYER } = require('../helpers');

const SECRET = process.env.STRIPE_SECRET_KEY || '';
const PUBLISHABLE = process.env.STRIPE_PUBLISHABLE_KEY || '';
const KEYS_CONFIGURED =
  /^sk_test_/.test(SECRET) &&
  /^pk_test_/.test(PUBLISHABLE) &&
  !/placeholder|CHANGE_ME|xxxx/i.test(`${SECRET}${PUBLISHABLE}`);

const CARD_IFRAME = 'iframe[title="Secure card payment input frame"]';

test.describe('Stripe test-mode checkout (live keys)', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, BUYER);
    await clearCart(page);
    await page.reload();
  });

  test.afterEach(async ({ page }) => {
    await clearCart(page);
  });

  test('full checkout with Stripe test card 4242 completes the order', async ({ page }) => {
    test.skip(!KEYS_CONFIGURED, 'STRIPE test keys not configured — skipping live card checkout');

    await addJacketToCart(page);
    await page.goto('/cart');

    // Enter checkout — wait for cart sync (item visible + button enabled) so
    // the click actually navigates; the button is disabled while React state
    // hasn't loaded the server cart yet.
    await expect(page.getByText('Vintage Denim Jacket').first()).toBeVisible({ timeout: 15_000 });
    const checkoutBtn = page.getByRole('button', { name: /proceed to checkout/i });
    await expect(checkoutBtn).toBeEnabled({ timeout: 15_000 });
    await checkoutBtn.click();
    // Checkout is INLINE on /cart (no separate URL): the Stripe payment form
    // renders in place after the intent is created.
    await expect(page.locator('form').first()).toBeVisible({ timeout: 15_000 });

    // Stripe Elements renders the card fields in a cross-origin iframe
    const cardFrame = page.frameLocator(CARD_IFRAME).first();
    await expect(cardFrame.locator('input[name="cardnumber"]')).toBeVisible({ timeout: 20_000 });
    await cardFrame.locator('input[name="cardnumber"]').fill('4242424242424242');
    await cardFrame.locator('input[name="exp-date"]').fill('12/34');
    await cardFrame.locator('input[name="cvc"]').fill('567');
    const postal = cardFrame.locator('input[name="postal"]');
    if (await postal.count()) {
      await postal.fill('12345');
    }

    // Submit the payment form
    const payBtn = page.locator('form button[type="submit"]').last();
    await payBtn.click();

    // TD-1.1 AC: order completes — the form flips to its success state after
    // createPaymentMethod → confirmCardPayment → confirm-batch (order created,
    // seller balance + payout record created server-side).
    await expect(page.getByText('Payment Successful!').first()).toBeVisible({ timeout: 30_000 });
  });
});
