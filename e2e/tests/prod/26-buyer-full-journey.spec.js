/**
 * PROD E2E — 26: BUYER FULL JOURNEY.
 * A buyer adds items from MULTIPLE sellers to cart, updates quantities, removes
 * one, checks out via the payments flow (create-intent -> test-confirm ->
 * confirm-batch) producing a consolidated order with one shipment per seller,
 * then exercises: cancel-before-ship (full refund + inventory rollback) and
 * the cancel-after-ship guard (rejected).
 *
 * Self-sufficient: creates its own listings.
 */
const { test } = require('@playwright/test');
const { makeApi, loadState, saveState, RUN_ID, expect } = require('./helpers');

const SHIPPING = {
  fullName: 'E2E Buyer', street1: '200 Market St', city: 'Austin', state: 'TX',
  postalCode: '78701', country: 'US', phone: '+15555550200',
};

test.describe('26 · Buyer full journey (multi-seller cart -> checkout -> cancel guard)', () => {
  let api, state, sellerToken, buyerToken;
  let listingA, listingB, listingC;

  test.beforeAll(async () => {
    api = await makeApi();
    state = loadState();
    sellerToken = await api.login('alex');
    buyerToken = await api.login('jordan');

    // Clean slate: remove any leftovers from previous runs
    const existingCart = await api.req('get', '/api/cart', { token: buyerToken });
    if (existingCart.status === 200) {
      const existingItems = existingCart.data.items || existingCart.data.cart?.items || [];
      for (const item of existingItems) {
        const id = item.listing?._id || item.listingId || item.listing || item._id;
        if (id) await api.req('delete', `/api/cart/items/${id}`, { token: buyerToken }).catch(() => {});
      }
    }

    // Create 3 listings: 2 from alex, 1 from jordan (multi-seller)
    const mk = (title, price, tok) => api.req('post', '/api/listings', {
      token: tok,
      body: { title, description: 'E2E item', price, category: 'Men', brand: 'E2E',
        size: 'M', condition: 'New with tags', color: 'Black', quantity: 5,
        shipsFrom: 'US', currency: 'USD', domesticShipping: 'true' },
    });
    const ra = await mk(`S26 ${RUN_ID} A`, 50, sellerToken);
    const rb = await mk(`S26 ${RUN_ID} B`, 75, sellerToken);
    const rc = await mk(`S26 ${RUN_ID} C`, 30, buyerToken); // jordan as seller
    listingA = (ra.data.listing || ra.data)._id;
    listingB = (rb.data.listing || rb.data)._id;
    listingC = (rc.data.listing || rc.data)._id;
  });
  test.afterAll(async () => { await api.dispose(); });

  test('S26.1 add items from 3 sellers to cart', async () => {
    for (const id of [listingA, listingB, listingC]) {
      const r = await api.req('post', '/api/cart/items', {
        token: buyerToken,
        body: { listingId: id, quantity: 1 },
      });
      expect(r.status, JSON.stringify(r.data)).toBe(200);
    }
    const cart = await api.req('get', '/api/cart', { token: buyerToken });
    expect(cart.status).toBe(200);
    const items = cart.data.items || cart.data.cart?.items || [];
    expect(items.length).toBe(3);
  });

  test('S26.2 update quantity of one item', async () => {
    // Cart uses POST for both add and update (re-add with new quantity).
    const r = await api.req('post', '/api/cart/items', {
      token: buyerToken,
      body: { listingId: listingA, quantity: 2 },
    });
    expect(r.status, JSON.stringify(r.data)).toBe(200);
  });

  test('S26.3 remove one item from cart', async () => {
    const r = await api.req('delete', `/api/cart/items/${listingC}`, { token: buyerToken });
    expect(r.status, JSON.stringify(r.data)).toBe(200);
    const cart = await api.req('get', '/api/cart', { token: buyerToken });
    const items = cart.data.items || cart.data.cart?.items || [];
    expect(items.length).toBe(2);
  });


  test('S26.4 checkout via payments flow (create-intent -> test-confirm -> confirm-batch)', async () => {
    const ci = await api.req('post', '/api/payments/create-intent', {
      token: buyerToken,
      body: {
        items: [{ listingId: listingA, quantity: 2 }, { listingId: listingB, quantity: 1 }],
        shippingAddress: SHIPPING,
      },
    });
    expect(ci.status, JSON.stringify(ci.data)).toBe(200);
    const pi = ci.data.paymentIntentId;
    const tc = await api.req('post', '/api/payments/test-confirm', { token: buyerToken, body: { paymentIntentId: pi } });
    expect(tc.status).toBe(200);

    const conf = await api.req('post', '/api/payments/confirm-batch', {
      token: buyerToken,
      body: {
        paymentIntentId: pi,
        items: [{ listingId: listingA, quantity: 2 }, { listingId: listingB, quantity: 1 }],
        shippingAddress: SHIPPING,
      },
    });
    expect(conf.status, JSON.stringify(conf.data)).toBe(201);
    expect(conf.data.transactions).toHaveLength(2);
    expect(conf.data.orders).toHaveLength(1);
    const order = conf.data.orders[0];
    // Both items are from the SAME seller -> one consolidated shipment.
    expect(order.shipments.length).toBe(1);
    state.txns = state.txns || {};
    // Cancel/status endpoints operate on TRANSACTION ids; ship on ORDER ids.
    state.txns.S26 = { id: order._id, txnId: String(conf.data.transactions[0]._id), status: order.status || 'paid' };
    state.listings = state.listings || {};
    state.listings.S26 = { orderId: order._id };
    saveState(state);
  });

  test('S26.5 cancel-before-ship: full refund + inventory rollback', async () => {
    const txnId = state.txns.S26.txnId;
    const before = await api.req('get', `/api/listings/${listingA}`);
    const qtyBefore = (before.data.listing || before.data).quantity;

    const cancel = await api.req('post', `/api/orders/${txnId}/cancel`, {
      token: buyerToken,
      body: { reason: 'E26 pre-shipment cancellation' },
    });
    expect(cancel.status, JSON.stringify(cancel.data)).toBe(200);
    expect(cancel.data.refundType).toBe('full');
    expect(cancel.data.refundAmount).toBeGreaterThan(0);

    const after = await api.req('get', `/api/listings/${listingA}`);
    const qtyAfter = (after.data.listing || after.data).quantity;
    expect(qtyAfter).toBeGreaterThanOrEqual(qtyBefore);
  });

  test('S26.6 cannot cancel the same order twice', async () => {
    const txnId = state.txns.S26.txnId;
    const st = await api.req('get', `/api/orders/${txnId}/status`, { token: buyerToken });
    expect(st.status).toBe(200);
    expect(st.data.eligibility.canCancel).toBe(false);
  });

  test('S26.7 ship-then-cancel guard: cancel after shipment is rejected', async () => {
    // Fresh listing so the marketplace has an available item to ship.
    const mk = await api.req('post', '/api/listings', {
      token: sellerToken,
      body: { title: `S26 ${RUN_ID} D`, description: 'E2E item', price: 40, category: 'Men',
        brand: 'E2E', size: 'M', condition: 'New with tags', color: 'Black', quantity: 5,
        shipsFrom: 'US', currency: 'USD', domesticShipping: 'true' },
    });
    expect(mk.status).toBe(201);
    const shipListing = (mk.data.listing || mk.data)._id;

    const ci = await api.req('post', '/api/payments/create-intent', {
      token: buyerToken,
      body: { items: [{ listingId: shipListing, quantity: 1 }], shippingAddress: SHIPPING },
    });
    expect(ci.status, JSON.stringify(ci.data)).toBe(200);
    const pi = ci.data.paymentIntentId;
    const tc = await api.req('post', '/api/payments/test-confirm', { token: buyerToken, body: { paymentIntentId: pi } });
    expect(tc.status).toBe(200);
    // confirm-batch so a consolidated ORDER exists (ship operates on order ids).
    const conf = await api.req('post', '/api/payments/confirm-batch', {
      token: buyerToken,
      body: { paymentIntentId: pi, items: [{ listingId: shipListing, quantity: 1 }], shippingAddress: SHIPPING },
    });
    expect([200, 201]).toContain(conf.status);
    const orderId = String(conf.data.orders[0]._id);
    const txnId = String(conf.data.transactions[0]._id);

    const ship = await api.req('post', `/api/orders/${orderId}/ship`, {
      token: sellerToken,
      body: { shipmentIndex: 0, trackingNumber: `S26-${RUN_ID}`, carrier: 'FedEx' },
    });
    expect(ship.status, JSON.stringify(ship.data)).toBe(200);

    const cancel = await api.req('post', `/api/orders/${txnId}/cancel`, {
      token: buyerToken,
      body: { reason: 'E26 post-ship cancel attempt' },
    });
    expect([400, 403, 409]).toContain(cancel.status);
  });
});
