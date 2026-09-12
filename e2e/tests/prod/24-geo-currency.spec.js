/**
 * 24 — Geo auto-selection E2E: top-right country + currency from the IP.
 *
 * The browser tests simulate different visitor IPs by intercepting the
 * /api/marketplace/status call (the endpoint the server resolves from the
 * real client IP in production — identical for web, iOS and Android) and
 * returning the payload that IP would produce.
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

async function expectGeoSelected(page, country, currency) {
  await expect(page.locator('.country-btn')).toHaveText(new RegExp(country));
  await expect(page.locator('.currency-btn')).toHaveText(new RegExp(currency));
}

test.describe('Geo auto-selection of top-right country + currency', () => {
  test('24.1 fresh visitor with a GB IP sees GB + GBP auto-selected', async ({ page }) => {
    await page.addInitScript(() => localStorage.clear());
    await page.route('**/api/marketplace/status**', fulfillGeo('GB', 'GBP'));
    await page.goto('/');
    await expectGeoSelected(page, 'GB', 'GBP');

    // The auto-selected currency is the active option in its dropdown.
    await page.locator('.currency-btn').click();
    const active = page.locator('.currency-option.active');
    await expect(active).toHaveCount(1);
    await expect(active).toContainText('GBP');
    await expect(active).toContainText('✓');
  });

  test('24.2 fresh visitor with a DE IP sees DE + EUR auto-selected', async ({ page }) => {
    await page.addInitScript(() => localStorage.clear());
    await page.route('**/api/marketplace/status**', fulfillGeo('DE', 'EUR'));
    await page.goto('/');
    await expectGeoSelected(page, 'DE', 'EUR');

    await page.locator('.country-btn').click();
    const activeCountry = page.locator('.country-option.active');
    await expect(activeCountry).toHaveCount(1);
    await expect(activeCountry).toContainText('DE');
    await expect(activeCountry).toContainText('✓');
  });

  test('24.3 a manual currency choice is never overridden by IP geo (country still updates)', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.clear();
      localStorage.setItem('currency', 'USD');
      localStorage.setItem('currencySource', 'manual');
    });
    await page.route('**/api/marketplace/status**', fulfillGeo('GB', 'GBP'));
    await page.goto('/');
    await expect(page.locator('.currency-btn')).toHaveText(/USD/);
    await expect(page.locator('.country-btn')).toHaveText(/GB/);
  });

  test('24.4 geo endpoint failure: falls back to USD, app renders, no crash', async ({ page }) => {
    await page.addInitScript(() => localStorage.clear());
    await page.route('**/api/marketplace/status**', (route) => route.abort());
    await page.goto('/');
    await expect(page.locator('.currency-btn')).toHaveText(/USD/);
    await expect(page.locator('.country-btn')).toBeVisible();
  });

  test('24.5 real server (localhost IP unresolved): default US + USD contract', async ({ page }) => {
    await page.addInitScript(() => localStorage.clear());
    await page.goto('/');
    await expect(page.locator('.country-btn')).toHaveText(/US/);
    await expect(page.locator('.currency-btn')).toHaveText(/USD/);
  });

  test('24.6 switching country from the top-right switches to its currency', async ({ page }) => {
    await page.addInitScript(() => localStorage.clear());
    await page.route('**/api/marketplace/status**', fulfillGeo('GB', 'GBP'));
    await page.goto('/');
    await expectGeoSelected(page, 'GB', 'GBP');

    await page.locator('.country-btn').click();
    await page.locator('.country-option', { hasText: 'United States' }).click();
    await expect(page.locator('.country-btn')).toHaveText(/US/);
    await expect(page.locator('.currency-btn')).toHaveText(/USD/);

    // Manual choice survives a reload (not re-detected from the IP).
    await page.reload();
    await expect(page.locator('.country-btn')).toHaveText(/US/);
    await expect(page.locator('.currency-btn')).toHaveText(/USD/);
  });
});
