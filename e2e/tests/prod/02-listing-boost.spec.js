/**
 * PROD E2E — 02: listing creation with and without boost fee (real listings in
 * the production DB, tagged with the RUN_ID). Multi-seller: Alex creates 3,
 * Jordan creates 1.
 */
const { test } = require('@playwright/test');
const { makeApi, loadState, saveState, RUN_ID, expect } = require('./helpers');

const listingBody = (title, price, extra = {}) => ({
  title,
  description: `PROD-E2E automated listing ${RUN_ID} — safe to ignore`,
  price,
  originalPrice: Math.round(price * 1.4),
  category: 'Clothing',
  brand: 'E2EBrand',
  size: '9',
  condition: 'New with tags',
  color: 'Black',
  quantity: 1,
  domesticShipping: 'flat',
  shippingCost: 7.24,
  shipsFrom: 'US',
  ...extra,
});

test.describe('02 · Listing creation & boost fees (production)', () => {
  let api, state, alexToken, jordanToken;

  test.beforeAll(async () => {
    api = await makeApi();
    state = loadState();
    alexToken = await api.login('alex');
    jordanToken = await api.login('jordan');
  });
  test.afterAll(async () => { await api.dispose(); });

  test('boost pricing config exposes standard/premium/elite tiers', async () => {
    const r = await api.req('get', '/api/boost/config');
    expect(r.status).toBe(200);
    expect(r.data.boostFeePercent).toBe(10);
    expect(r.data.tiers.standard.feePercent).toBe(10);
    expect(r.data.tiers.premium.feePercent).toBe(15);
    expect(r.data.tiers.elite.feePercent).toBe(20);
    expect(r.data.minDurationDays).toBe(7);
    expect(r.data.maxDurationDays).toBe(30);
    expect(r.data.priorityMultiplier).toBeGreaterThan(0);
  });

  test('seller A creates a plain listing WITHOUT boost (fee 0)', async () => {
    const title = `PROD-E2E ${RUN_ID} plain`;
    const r = await api.req('post', '/api/listings', { token: alexToken, body: listingBody(title, 45) });
    expect(r.status, JSON.stringify(r.data)).toBe(201);
    const listing = r.data.listing || r.data;
    expect(listing._id).toBeTruthy();
    expect(listing.title).toBe(title);
    expect(listing.price).toBe(45);
    expect(listing.boost?.active).toBeFalsy();
    expect(listing.boost?.fee ?? 0).toBe(0);
    state.listings.A = { id: listing._id, price: 45, seller: 'alex', boosted: false };
    saveState(state);
  });

  test('seller A creates a PREMIUM-boosted listing (15% boost fee)', async () => {
    const title = `PROD-E2E ${RUN_ID} boosted`;
    const r = await api.req('post', '/api/listings', {
      token: alexToken,
      body: listingBody(title, 80, { boostTier: 'premium', boostDuration: 14 }),
    });
    expect(r.status, JSON.stringify(r.data)).toBe(201);
    const listing = r.data.listing || r.data;
    expect(listing.boost.active).toBe(true);
    expect(listing.boost.tier).toBe('premium');
    expect(listing.boost.fee).toBe(12); // 80 × 15%
    expect(listing.boost.priorityScore).toBe(2);
    expect(listing.boost.durationDays).toBe(14);
    state.listings.B = { id: listing._id, price: 80, seller: 'alex', boosted: true, boostFee: 12 };
    saveState(state);
  });

  test('seller B (Jordan) creates a listing — multiple sellers confirmed', async () => {
    const title = `PROD-E2E ${RUN_ID} jordan`;
    const r = await api.req('post', '/api/listings', { token: jordanToken, body: listingBody(title, 25) });
    expect(r.status, JSON.stringify(r.data)).toBe(201);
    const listing = r.data.listing || r.data;
    expect(listing.boost?.active).toBeFalsy();
    state.listings.D = { id: listing._id, price: 25, seller: 'jordan', boosted: false };
    saveState(state);
  });

  test('listing validation: below-minimum price is rejected', async () => {
    const r = await api.req('post', '/api/listings', { token: alexToken, body: listingBody('too cheap', 4) });
    expect(r.status).toBe(400);
    expect(r.data.message).toMatch(/minimum/i);
  });

  test('listing creation requires authentication', async () => {
    const r = await api.req('post', '/api/listings', { body: listingBody('anon', 50) });
    expect([401, 403]).toContain(r.status);
  });

  test('invalid boost tier must NOT silently activate a boost', async () => {
    const r = await api.req('post', '/api/listings', {
      token: alexToken,
      body: listingBody(`PROD-E2E ${RUN_ID} bad-tier`, 30, { boostTier: 'diamond' }),
    });
    expect(r.status).toBe(201);
    const listing = r.data.listing || r.data;
    expect(listing.boost.active).toBe(false);
    state.listings.C = { id: listing._id, price: 30, seller: 'alex', boosted: false };
    saveState(state);
  });

  test('new listings are publicly browsable and searchable', async () => {
    const a = state.listings.A, b = state.listings.B;
    for (const l of [a, b]) {
      const r = await api.req('get', `/api/listings/${l.id}`);
      expect(r.status).toBe(200);
      const body = r.data.listing || r.data;
      expect(body.available).not.toBe(false);
      expect(body.sold).not.toBe(true);
    }
    const search = await api.req('get', `/api/listings?search=${encodeURIComponent(`PROD-E2E ${RUN_ID}`)}`);
    expect(search.status).toBe(200);
    const items = Array.isArray(search.data) ? search.data : (search.data.listings || search.data.items || []);
    const ids = items.map((x) => String(x._id));
    expect(ids).toContain(String(a.id));
    expect(ids).toContain(String(b.id));
  });

  test('seller can add then remove a boost on their own listing (PUT)', async () => {
    const c = state.listings.C;
    const boost = await api.req('put', `/api/listings/${c.id}`, {
      token: alexToken,
      body: { boostTier: 'standard', boostDuration: 7 },
    });
    expect(boost.status).toBe(200);
    const boosted = boost.data.listing || boost.data;
    expect(boosted.boost.active).toBe(true);
    expect(boosted.boost.tier).toBe('standard');
    expect(boosted.boost.fee).toBe(3); // 30 × 10%

    const remove = await api.req('put', `/api/listings/${c.id}`, {
      token: alexToken,
      body: { removeBoost: true },
    });
    expect(remove.status).toBe(200);
    const removed = remove.data.listing || remove.data;
    expect(removed.boost.active).toBe(false);
  });

  test('another seller cannot edit (or boost) someone else’s listing', async () => {
    const r = await api.req('put', `/api/listings/${state.listings.A.id}`, {
      token: jordanToken,
      body: { title: 'hijacked' },
    });
    expect(r.status).toBe(403);
  });
});
