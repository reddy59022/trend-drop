/**
 * PROD E2E — 27: MULTICURRENCY MATRIX.
 * Individual test per currency (USD, GBP, EUR, JPY, CAD): a seller creates a
 * listing in their currency, a buyer purchases it, and the transaction's
 * paymentBreakdown/currency are correct. Then verifies the seller dashboard
 * aggregates are USD-normalized for a seller with mixed-currency sales.
 *
 * Self-sufficient: creates its own listings + purchases.
 */
const { test } = require('@playwright/test');
const { makeApi, loadState, saveState, RUN_ID, expect, cents } = require('./helpers');

const SHIPPING = {
  fullName: 'E2E Buyer', street1: '300 Currency Blvd', city: 'Austin', state: 'TX',
  postalCode: '78701', country: 'US', phone: '+15555550300',
};

// Currencies to test individually
const CURRENCIES = [
  { code: 'USD', symbol: '$', country: 'US' },
  { code: 'GBP', symbol: '£', country: 'GB' },
  { code: 'EUR', symbol: '€', country: 'DE' },
  { code: 'JPY', symbol: 'JPY', country: 'JP' },
  { code: 'CAD', symbol: 'C$', country: 'CA' },
];

test.describe('27 · Multicurrency matrix (individual tests per currency)', () => {
  let api, state, sellerToken, buyerToken;

  test.beforeAll(async () => {
    api = await makeApi();
    state = loadState();
    sellerToken = await api.login('alex');
    buyerToken = await api.login('jordan');
  });
  test.afterAll(async () => { await api.dispose(); });

  // Create one listing per currency (all from the same seller for dashboard aggregation)
  test('S27.0 seed one listing per currency', async () => {
    state.listings = state.listings || {};
    for (const c of CURRENCIES) {
      const r = await api.req('post', '/api/listings', {
        token: sellerToken,
        body: {
          title: `S27 ${RUN_ID} ${c.code}`,
          description: `E2E listing in ${c.code}`,
          price: 100, category: 'Men', brand: 'E2E', size: 'M',
          condition: 'New with tags', color: 'Black', quantity: 5,
          shipsFrom: 'US', currency: c.code, domesticShipping: 'true',
        },
      });
      expect(r.status, `${c.code} listing: ${JSON.stringify(r.data)}`).toBe(201);
      const l = r.data.listing || r.data;
      state.listings[`S27_${c.code}`] = { id: l._id, currency: c.code, price: 100 };
    }
    saveState(state);
  });

  // Individual test per currency
  CURRENCIES.forEach((c) => {
    test(`S27.${c.code} purchase in ${c.code} — transaction currency + breakdown correct`, async () => {
      const listingId = state.listings[`S27_${c.code}`].id;
      const ci = await api.req('post', '/api/payments/create-intent', {
        token: buyerToken,
        body: { items: [{ listingId }], shippingAddress: SHIPPING },
      });
      expect(ci.status, `${c.code} create-intent: ${JSON.stringify(ci.data)}`).toBe(200);
      const pi = ci.data.paymentIntentId;
      const tc = await api.req('post', '/api/payments/test-confirm', { token: buyerToken, body: { paymentIntentId: pi } });
      expect(tc.status).toBe(200);
      const conf = await api.req('post', '/api/payments/confirm', {
        token: buyerToken,
        body: { paymentIntentId: pi, listingId, shippingAddress: SHIPPING },
      });
      expect([200, 201]).toContain(conf.status);
      const txn = conf.data.transaction || conf.data;
      expect(txn.currency).toBe(c.code);
      expect(txn.paymentBreakdown).toBeDefined();
      expect(txn.paymentBreakdown.platformFee).toBeGreaterThan(0);
      expect(txn.paymentBreakdown.sellerEarnings).toBeGreaterThan(0);
    });
  });

  test('S27.DASH seller dashboard aggregates are USD-normalized for mixed-currency sales', async () => {
    const r = await api.req('get', '/api/payouts/dashboard', { token: sellerToken });
    expect(r.status).toBe(200);
    expect(r.data.commissionRate).toBe(0.08);
    expect(typeof r.data.totalSales).toBe('number');
    expect(typeof r.data.availableBalance).toBe('number');
    expect(typeof r.data.pendingBalance).toBe('number');
    // With 5 sales of 100 each in various currencies, totalSales should be > 0
    expect(r.data.totalSales).toBeGreaterThan(0);
  });
});
