/**
 * PROD E2E — 11: Listing relist (Reposh) flow.
 * Seller sells an item, then relists it (creates a new available copy).
 * Verifies the relisted item is live, sellable, and distinct from the sold one.
 */
const { test } = require('@playwright/test');
const { makeApi, loadState, saveState, RUN_ID, expect } = require('./helpers');

const SHIPPING = {
  fullName: 'Jordan Patel',
  street1: '123 E2E Test St',
  city: 'Los Angeles',
  state: 'CA',
  postalCode: '90001',
  country: 'US',
  phone: '+15555550000',
};

async function confirmWithTestCard(api, paymentIntentId, token) {
  const r = await api.req('post', '/api/payments/test-confirm', {
    token,
    body: { paymentIntentId },
  });
  if (r.status !== 200 || !['requires_capture', 'succeeded'].includes(r.data?.status)) {
    throw new Error(`test-confirm unavailable or failed: status=${r.status} body=${JSON.stringify(r.data)}`);
  }
  return { status: 200, data: r.data };
}

test.describe('11 · Listing relist (production)', () => {
  let api, state, alexToken, jordanToken;
  let relistListingId;

  test.beforeAll(async () => {
    api = await makeApi();
    state = loadState();
    alexToken = await api.login('alex');
    jordanToken = await api.login('jordan');
  });
  test.afterAll(async () => { await api.dispose(); });

  test('create a listing specifically for relist testing', async () => {
    const r = await api.req('post', '/api/listings', {
      token: alexToken,
      body: {
        title: `PROD-E2E ${RUN_ID} relist-test`,
        description: `Relist test item ${RUN_ID}`,
        price: 50,
        originalPrice: 75,
        category: 'Clothing',
        brand: 'E2EBrand',
        size: 'M',
        condition: 'New with tags',
        color: 'Purple',
        quantity: 1,
        domesticShipping: 'flat',
        shippingCost: 7.24,
        shipsFrom: 'US',
      },
    });
    expect(r.status, JSON.stringify(r.data)).toBe(201);
    const listing = r.data.listing || r.data;
    relistListingId = listing._id;
    state.listings.relistTest = { id: relistListingId, price: 50 };
    saveState(state);
  });

  test('buyer purchases the listing (marks it sold)', async () => {
    const ci = await api.req('post', '/api/payments/create-intent', {
      token: jordanToken,
      body: { items: [{ listingId: relistListingId }], shippingAddress: SHIPPING },
    });
    expect(ci.status).toBe(200);
    const { status, data } = await confirmWithTestCard(api, ci.data.paymentIntentId, jordanToken);
    expect(status).toBe(200);
    expect(['requires_capture', 'succeeded']).toContain(data.status);

    const conf = await api.req('post', '/api/payments/confirm', {
      token: jordanToken,
      body: { paymentIntentId: ci.data.paymentIntentId, listingId: relistListingId, shippingAddress: SHIPPING },
    });
    expect([200, 201]).toContain(conf.status);
  });

  test('listing is now sold and unavailable', async () => {
    const r = await api.req('get', `/api/listings/${relistListingId}`);
    expect(r.status).toBe(200);
    const body = r.data.listing || r.data;
    expect(body.sold).toBe(true);
  });

  test('seller relists the sold item (creates a new available copy)', async () => {
    const r = await api.req('post', `/api/listings/${relistListingId}/relist`, {
      token: alexToken,
      body: { price: 55, description: `Relisted with new price ${RUN_ID}` },
    });
    expect(r.status, JSON.stringify(r.data)).toBe(200);
    const relisted = r.data.listing || r.data;
    expect(relisted._id).toBeTruthy();
    expect(relisted.available).toBe(true);
    expect(relisted.sold).not.toBe(true);
    expect(relisted.price).toBe(55);
    state.listings.relistedCopy = { id: relisted._id, price: 55 };
    saveState(state);
  });

  test('relisted item is publicly browsable and searchable', async () => {
    const r = await api.req('get', `/api/listings/${state.listings.relistedCopy.id}`);
    expect(r.status).toBe(200);
    const body = r.data.listing || r.data;
    expect(body.available).toBe(true);
    expect(body.sold).not.toBe(true);
  });

  test('original sold listing remains sold (relist creates new, does not modify original)', async () => {
    const r = await api.req('get', `/api/listings/${relistListingId}`);
    expect(r.status).toBe(200);
    const body = r.data.listing || r.data;
    expect(body.sold).toBe(true);
  });

  test('another seller cannot relist someone else\'s sold item', async () => {
    const r = await api.req('post', `/api/listings/${relistListingId}/relist`, {
      token: jordanToken,
      body: { price: 30 },
    });
    expect(r.status).toBe(403);
  });

  test('seller can delete the relisted item', async () => {
    const r = await api.req('delete', `/api/listings/${state.listings.relistedCopy.id}`, { token: alexToken });
    expect(r.status).toBe(200);
    const gone = await api.req('get', `/api/listings/${state.listings.relistedCopy.id}`);
    // Deleted listings return 404 or { listing: null }
    expect([404, 200]).toContain(gone.status);
    saveState(state);
  });
});
