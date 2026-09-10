/**
 * PROD E2E — 03: real cart flows for the buyer (Jordan) across listings.
 */
const { test } = require('@playwright/test');
const { makeApi, loadState, saveState, expect } = require('./helpers');

async function cartItems(api, token) {
  const r = await api.req('get', '/api/cart', { token });
  expect(r.status).toBe(200);
  const cart = r.data?.cart || r.data;
  return cart?.items || [];
}

test.describe('03 · Cart (production, buyer Jordan)', () => {
  let api, state, jordanToken;

  test.beforeAll(async () => {
    api = await makeApi();
    state = loadState();
    jordanToken = await api.login('jordan');
    // Clean slate: remove any leftovers from previous runs
    for (const item of await cartItems(api, jordanToken)) {
      const id = item.listing?._id || item.listingId || item.listing;
      if (id) await api.req('delete', `/api/cart/items/${id}`, { token: jordanToken });
    }
  });
  test.afterAll(async () => { await api.dispose(); });

  test('add to cart works and populates the server cart', async () => {
    const r = await api.req('post', '/api/cart/items', { token: jordanToken, body: { listingId: state.listings.A.id } });
    expect(r.status, JSON.stringify(r.data)).toBe(200);
    const items = await cartItems(api, jordanToken);
    const ids = items.map((i) => String(i.listing?._id || i.listing));
    expect(ids).toContain(String(state.listings.A.id));
  });

  test('cart supports multiple items (ready for multi-seller checkout)', async () => {
    const r = await api.req('post', '/api/cart/items', { token: jordanToken, body: { listingId: state.listings.B.id } });
    expect(r.status).toBe(200);
    const items = await cartItems(api, jordanToken);
    expect(items.length).toBe(2);
  });

  test('re-adding the same listing updates quantity, not duplicates', async () => {
    const r = await api.req('post', '/api/cart/items', { token: jordanToken, body: { listingId: state.listings.A.id, quantity: 1 } });
    expect(r.status).toBe(200);
    const items = await cartItems(api, jordanToken);
    const aRows = items.filter((i) => String(i.listing?._id || i.listing) === String(state.listings.A.id));
    expect(aRows.length).toBe(1);
  });

  test('cart rejects unavailable / over-stock quantities', async () => {
    const r = await api.req('post', '/api/cart/items', { token: jordanToken, body: { listingId: state.listings.A.id, quantity: 99 } });
    expect(r.status).toBe(400);
    expect(r.data.message).toMatch(/available/i);
  });

  test('cart rejects unknown listing ids', async () => {
    const r = await api.req('post', '/api/cart/items', { token: jordanToken, body: { listingId: '000000000000000000000000' } });
    expect(r.status).toBe(404);
  });

  test('remove an item from the cart', async () => {
    const r = await api.req('delete', `/api/cart/items/${state.listings.C.id}`, { token: jordanToken });
    expect(r.status).toBe(200);
    const items = await cartItems(api, jordanToken);
    const ids = items.map((i) => String(i.listing?._id || i.listing));
    expect(ids).not.toContain(String(state.listings.C.id));
  });

  test('cart is left with exactly the checkout set [A, B]', async () => {
    const items = await cartItems(api, jordanToken);
    const ids = items.map((i) => String(i.listing?._id || i.listing)).sort();
    expect(ids).toEqual([String(state.listings.A.id), String(state.listings.B.id)].sort());
    saveState(state);
  });
});
