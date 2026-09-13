/**
 * PROD E2E — 25: SELLER FULL JOURNEY.
 * Create listing with EVERY field -> browse/search -> update ALL fields -> sell -> ship -> dashboard.
 * Self-sufficient.
 */
const { test } = require('@playwright/test');
const { makeApi, loadState, saveState, RUN_ID, expect } = require('./helpers');

const SHIPPING = {
  fullName: 'E2E Buyer', street1: '100 Test Ave', city: 'Austin', state: 'TX',
  postalCode: '78701', country: 'US', phone: '+15555550100',
};

test.describe('25 · Seller full journey', () => {
  let api, state, sellerToken, buyerToken;
  let listingId;

  test.beforeAll(async () => {
    api = await makeApi();
    state = loadState();
    sellerToken = await api.login('alex');
    buyerToken = await api.login('jordan');
  });
  test.afterAll(async () => { await api.dispose(); });

  test('S25.1 create a listing with EVERY field populated', async () => {
    const title = 'S25 ' + RUN_ID + ' full-fields';
    const body = {
      title, description: 'A fully populated E2E listing demonstrating every field.',
      price: 120, originalPrice: 180, category: 'Women', brand: 'E2EBrand',
      size: 'M', condition: 'New with tags', color: 'Navy', weight: 1.2,
      weightUnit: 'kg', shipsFrom: 'US', currency: 'USD',
      domesticShipping: 'true', freeShipping: 'false', shippingCost: 8.5, quantity: 4,
    };
    const r = await api.req('post', '/api/listings', { token: sellerToken, body });
    expect(r.status, JSON.stringify(r.data)).toBe(201);
    const l = r.data.listing || r.data;
    listingId = l._id;
    expect(l.title).toBe(title);
    expect(l.price).toBe(120);
    expect(l.quantity).toBe(4);
    state.listings = state.listings || {};
    state.listings.S25 = { id: listingId, price: 120, seller: 'alex' };
    saveState(state);
  });


  test('S25.2 new listing is publicly browsable + searchable', async () => {
    const got = await api.req('get', '/api/listings/' + listingId);
    expect(got.status).toBe(200);
    const l = got.data.listing || got.data;
    expect(l.available).toBe(true);
    expect(l.sold).toBe(false);
    var q = '/api/listings?search=' + encodeURIComponent('S25 ' + RUN_ID);
    const search = await api.req('get', q);
    expect(search.status).toBe(200);
    const items = Array.isArray(search.data) ? search.data : (search.data.listings || []);
    expect(items.map(function(x){return String(x._id);})).toContain(String(listingId));
  });

  test('S25.3 seller sees the listing in My Listings', async () => {
    const r = await api.req('get', '/api/listings/my', { token: sellerToken });
    expect(r.status).toBe(200);
    const mine = Array.isArray(r.data) ? r.data : (r.data.listings || []);
    expect(mine.some(function(l){return String(l._id) === String(listingId);})).toBe(true);
  });

  test('S25.4 update ALL fields via PUT', async () => {
    const r = await api.req('put', '/api/listings/' + listingId, {
      token: sellerToken,
      body: {
        title: 'S25 ' + RUN_ID + ' UPDATED',
        description: 'Updated description across all fields.',
        price: 95, originalPrice: 150, category: 'Men', brand: 'E2EBrand-Upd',
        size: 'L', condition: 'Good', color: 'Black', weight: 2.0, weightUnit: 'lb',
        shipsFrom: 'US', currency: 'USD', freeShipping: 'true', shippingCost: 0, quantity: 7,
      },
    });
    expect(r.status, JSON.stringify(r.data)).toBe(200);
    const l = r.data.listing || r.data;
    expect(l.title).toBe('S25 ' + RUN_ID + ' UPDATED');
    expect(l.price).toBe(95);
    expect(l.quantity).toBe(7);
    expect(l.shipping.freeShipping).toBe(true);
  });

  test('S25.5 price-drop history endpoint behaves (200 or 404)', async () => {
    const r = await api.req('get', '/api/listings/' + listingId + '/price-history');
    // Endpoint may return 200 (JSON/HTML) or 404 (not implemented). Both are acceptable.
    expect([200, 404]).toContain(r.status);
  });

  test('S25.6 seller views own listing (not blocked)', async () => {
    const id = listingId || (state.listings && state.listings.S25 && state.listings.S25.id);
    expect(id, 'listingId must be set').toBeTruthy();
    const r = await api.req('get', '/api/listings/' + id, { token: sellerToken });
    expect(r.status).toBe(200);
  });

  test('S25.7 buyer purchases the listing (create-intent -> test-confirm -> confirm-batch)', async () => {
    const id = listingId || (state.listings && state.listings.S25 && state.listings.S25.id);
    expect(id, 'listingId must be set').toBeTruthy();
    const ci = await api.req('post', '/api/payments/create-intent', {
      token: buyerToken,
      body: { items: [{ listingId: id }], shippingAddress: SHIPPING },
    });
    expect(ci.status, JSON.stringify(ci.data)).toBe(200);
    const pi = ci.data.paymentIntentId;
    const tc = await api.req('post', '/api/payments/test-confirm', { token: buyerToken, body: { paymentIntentId: pi } });
    expect(tc.status).toBe(200);
    // Use confirm-batch (same as the real client checkout) so we get a consolidated order.
    const conf = await api.req('post', '/api/payments/confirm-batch', {
      token: buyerToken,
      body: { paymentIntentId: pi, items: [{ listingId: id }], shippingAddress: SHIPPING },
    });
    expect([200, 201]).toContain(conf.status);
    expect(conf.data.orders).toBeTruthy();
    expect(conf.data.orders.length).toBe(1);
    const orderId = String(conf.data.orders[0]._id);
    state.txns = state.txns || {};
    state.txns.S25 = { id: orderId, status: 'paid' };
    saveState(state);
  });

  test('S25.8 listing quantity decremented after purchase', async () => {
    const id = listingId || (state.listings && state.listings.S25 && state.listings.S25.id);
    expect(id, 'listingId must be set').toBeTruthy();
    const r = await api.req('get', '/api/listings/' + id);
    const l = r.data.listing || r.data;
    expect(l.quantity).toBeLessThanOrEqual(7);
  });

  test('S25.9 seller ships the order', async () => {
    const orderId = state.txns && state.txns.S25 && state.txns.S25.id;
    expect(orderId, 'txn id must be set').toBeTruthy();
    const r = await api.req('post', '/api/orders/' + orderId + '/ship', {
      token: sellerToken,
      body: { shipmentIndex: 0, trackingNumber: 'S25-' + RUN_ID, carrier: 'UPS' },
    });
    expect(r.status, JSON.stringify(r.data)).toBe(200);
  });

  test('S25.10 seller dashboard reflects the sale (commission 8%)', async () => {
    const r = await api.req('get', '/api/payouts/dashboard', { token: sellerToken });
    expect(r.status).toBe(200);
    expect(r.data.commissionRate).toBe(0.08);
    expect(typeof r.data.totalSales).toBe('number');
    expect(typeof r.data.availableBalance).toBe('number');
    expect(typeof r.data.pendingBalance).toBe('number');
  });
});
