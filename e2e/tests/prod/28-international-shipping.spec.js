/**
 * PROD E2E — 28: INTERNATIONAL SHIPPING — allowed vs not allowed.
 * Default in-memory server has INTERNATIONAL_SHOPPING_ENABLED=false.
 * Verifies:
 *   - Cross-border create-intent is REJECTED (400, no transaction created)
 *   - Domestic (same-country) purchase SUCCEEDS
 *   - International listing creation is rejected
 *
 * Self-sufficient.
 */
const { test } = require('@playwright/test');
const { makeApi, loadState, saveState, RUN_ID, expect } = require('./helpers');

const US_SHIPPING = {
  fullName: 'E2E Buyer', street1: '400 Border St', city: 'Austin', state: 'TX',
  postalCode: '78701', country: 'US', phone: '+15555550400',
};

test.describe('28 · International shipping gate (flag OFF = domestic only)', () => {
  let api, state, sellerToken, buyerToken;
  let domesticListing, crossBorderListing;

  test.beforeAll(async () => {
    api = await makeApi();
    state = loadState();
    sellerToken = await api.login('alex');
    buyerToken = await api.login('jordan');
  });
  test.afterAll(async () => { await api.dispose(); });

  test('S28.1 feature flag is OFF by default (domestic-only mode)', async () => {
    const r = await api.req('get', '/api/config/features');
    expect(r.status).toBe(200);
    expect(r.data.internationalShippingEnabled).toBe(false);
  });

  test('S28.2 create two domestic listings (purchase + cross-border probe)', async () => {
    const mk = (suffix) => api.req('post', '/api/listings', {
      token: sellerToken,
      body: {
        title: `S28 ${RUN_ID} ${suffix}`,
        description: 'Domestic listing',
        price: 60, category: 'Men', brand: 'E2E', size: 'M',
        condition: 'New with tags', color: 'Black', quantity: 3,
        shipsFrom: 'US', currency: 'USD', domesticShipping: 'true',
      },
    });
    const r = await mk('domestic');
    expect(r.status, JSON.stringify(r.data)).toBe(201);
    domesticListing = (r.data.listing || r.data)._id;
    const r2 = await mk('crossborder-probe');
    expect(r2.status).toBe(201);
    crossBorderListing = (r2.data.listing || r2.data)._id;
    state.listings = state.listings || {};
    state.listings.S28 = { id: domesticListing, id2: crossBorderListing };
    saveState(state);
  });

  test('S28.3 domestic purchase (US buyer -> US listing) SUCCEEDS', async () => {
    const ci = await api.req('post', '/api/payments/create-intent', {
      token: buyerToken,
      body: { items: [{ listingId: domesticListing }], shippingAddress: US_SHIPPING },
    });
    expect(ci.status, JSON.stringify(ci.data)).toBe(200);
    const pi = ci.data.paymentIntentId;
    const tc = await api.req('post', '/api/payments/test-confirm', { token: buyerToken, body: { paymentIntentId: pi } });
    expect(tc.status).toBe(200);
    const conf = await api.req('post', '/api/payments/confirm', {
      token: buyerToken,
      body: { paymentIntentId: pi, listingId: domesticListing, shippingAddress: US_SHIPPING },
    });
    expect([200, 201]).toContain(conf.status);
    const txn = conf.data.transaction || conf.data;
    expect(txn._id || txn.id).toBeTruthy();
  });

  test('S28.4 cross-border create-intent is REJECTED when flag OFF', async () => {
    const id = crossBorderListing || (state.listings && state.listings.S28 && state.listings.S28.id2);
    expect(id, 'crossBorderListing must be set').toBeTruthy();
    // US seller listing, buyer shipping to GB — gate must reject BEFORE any intent.
    const gbShipping = { ...US_SHIPPING, country: 'GB' };
    const ci = await api.req('post', '/api/payments/create-intent', {
      token: buyerToken,
      body: { items: [{ listingId: id }], shippingAddress: gbShipping },
    });
    expect([400, 403]).toContain(ci.status);
    const rejectedByGate = ci.data.supported === false ||
      /international/i.test(String(ci.data.message || ''));
    expect(rejectedByGate, `expected gate rejection, got: ${JSON.stringify(ci.data)}`).toBe(true);
  });

  test('S28.5 international listing creation is rejected when flag OFF', async () => {
    const r = await api.req('post', '/api/listings', {
      token: sellerToken,
      body: {
        title: `S28 ${RUN_ID} intl`,
        description: 'International listing attempt',
        price: 60, category: 'Men', brand: 'E2E', size: 'M',
        condition: 'New with tags', color: 'Black', quantity: 3,
        shipsFrom: 'US', currency: 'USD',
        domesticShipping: 'true', internationalShipping: 'true',
      },
    });
    expect([400, 403]).toContain(r.status);
  });
});
