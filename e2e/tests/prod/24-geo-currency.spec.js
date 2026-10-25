/**
 * 24 — Geo auto-selection E2E: top-right country + currency from the IP.
 *
 * The browser tests simulate different visitor IPs by intercepting the
 * /api/marketplace/status call (the endpoint the server resolves from the
 * real client IP in production — identical for web, iOS and Android) and
 * returning the payload that IP would produce.
 *
 * The controls live in ONE consolidated preferences popover (the panel also
 * holds language + theme). The trigger always shows the active country and
 * currency codes, so the auto-selection is visible without opening anything.
 */
const { test, expect } = require('@playwright/test');

const fulfillGeo = (country, currency) => (route) =>
  route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      country,
      currency,
      supported: true,
      message: 'Available in your area',
      code: 'REGION_SUPPORTED',
      source: 'ip-geoip-lite',
    }),
  });

const TRIGGER = '.prefs-trigger';

async function expectGeoSelected(page, country, currency) {
  const trigger = page.locator(TRIGGER);
  await expect(trigger).toHaveText(new RegExp(country));
  await expect(trigger).toHaveText(new RegExp(currency));
}

async function openPrefs(page) {
  await page.locator(TRIGGER).click();
  await expect(page.locator('select[aria-label="Select country"]')).toBeVisible();
}

test.describe('Geo auto-selection of top-right country + currency', () => {
  test('24.1 fresh visitor with a GB IP sees GB + GBP auto-selected', async ({ page }) => {
    await page.addInitScript(() => localStorage.clear());
    await page.route('**/api/marketplace/status**', fulfillGeo('GB', 'GBP'));
    await page.goto('/');
    await expectGeoSelected(page, 'GB', 'GBP');

    // The auto-selected currency is the active choice in the panel select.
    await openPrefs(page);
    await expect(page.locator('select[aria-label="Select currency"]')).toHaveValue('GBP');
  });

  test('24.2 fresh visitor with a DE IP sees DE + EUR auto-selected', async ({ page }) => {
    await page.addInitScript(() => localStorage.clear());
    await page.route('**/api/marketplace/status**', fulfillGeo('DE', 'EUR'));
    await page.goto('/');
    await expectGeoSelected(page, 'DE', 'EUR');

    await openPrefs(page);
    await expect(page.locator('select[aria-label="Select country"]')).toHaveValue('DE');
  });

  test('24.3 a manual currency choice is never overridden by IP geo (country still updates)', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.clear();
      localStorage.setItem('currency', 'USD');
      localStorage.setItem('currencySource', 'manual');
    });
    await page.route('**/api/marketplace/status**', fulfillGeo('GB', 'GBP'));
    await page.goto('/');
    await expect(page.locator(TRIGGER)).toHaveText(/USD/);
    await expect(page.locator(TRIGGER)).toHaveText(/GB/);
  });

  test('24.4 geo endpoint failure: falls back to USD, app renders, no crash', async ({ page }) => {
    await page.addInitScript(() => localStorage.clear());
    await page.route('**/api/marketplace/status**', (route) => route.abort());
    await page.goto('/');
    await expect(page.locator(TRIGGER)).toHaveText(/USD/);
    await expect(page.locator(TRIGGER)).toBeVisible();
  });

  test('24.5 real server (localhost IP unresolved): default US + USD contract', async ({ page }) => {
    await page.addInitScript(() => localStorage.clear());
    await page.goto('/');
    await expect(page.locator(TRIGGER)).toHaveText(/US/);
    await expect(page.locator(TRIGGER)).toHaveText(/USD/);
  });

  test('24.6 switching country from the top-right switches to its currency', async ({ page }) => {
    await page.addInitScript(() => {
      // Clear ONLY on the first load. A manual country/currency choice must
      // survive a reload (its whole purpose); clearing localStorage again on
      // reload would erase the persisted manual selection and re-trigger IP
      // auto-detection, making the reload assertion impossible.
      if (!sessionStorage.getItem('geo-cleared')) {
        sessionStorage.setItem('geo-cleared', '1');
        localStorage.clear();
      }
    });
    await page.route('**/api/marketplace/status**', fulfillGeo('GB', 'GBP'));
    await page.goto('/');
    await expectGeoSelected(page, 'GB', 'GBP');

    await openPrefs(page);
    await page.locator('select[aria-label="Select country"]').selectOption('US');
    await expect(page.locator(TRIGGER)).toHaveText(/US/);
    await expect(page.locator(TRIGGER)).toHaveText(/USD/);

    // Manual choice survives a reload (not re-detected from the IP).
    await page.reload();
    await expect(page.locator(TRIGGER)).toHaveText(/US/);
    await expect(page.locator(TRIGGER)).toHaveText(/USD/);
  });
});
