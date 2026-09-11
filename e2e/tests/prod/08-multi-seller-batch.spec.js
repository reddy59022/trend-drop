/**
 * PROD E2E — 08: Multi-seller trading between the two seeded accounts.
 * Tests cross-trading: Alex buys from Jordan, and Jordan buys from Alex.
 * Also tests a batch checkout with multiple items from one seller.
 */
const { test } = require('@playwright/test');
const { makeApi, loadState, saveState, RUN_ID, expect } = require('./helpers');

const SHIPPING = {
  fullName: 'Jordan Patel', street1: '123 E2E Test St', city: 'Los Angeles',
  state: 'CA', postalCode: '90001', country: 'US', phone: '+15555550000',
};
const ALEX_SHIPPING = {
  fullName: 'Alex Rivera', street1: '456 E2E Ave', city: 'San Francisco',
  state: 'CA', postalCode: '94102', country: 'US', phone: '+15555550001',
};

async function confirmWithTestCard(api, paymentIntentId, token) {
  const r = await api.req('post', '/api/payments/test-confirm', { token, body: { paymentIntentId } });
  if (r.status !== 200 || !['requires_capture', 'succeeded'].includes(r.data?.status)) {
    throw new Error(`test-confirm failed: status=${r.status} body=${JSON.stringify(r.data)}`);
  }
  return { status: 200, data: r.data };
}

test.describe('08 · Multi-seller trading (production)', () => {
  let api, state, jordanToken, alexToken;

  test.beforeAll(async () => {
    api = await makeApi();
    state = loadState();
    jordanToken = await api.login('jordan');
    alexToken = await api.login('alex');
  });
  test.afterAll(async () => { await api.dispose(); });

  test('create fresh listings for cross-trade testing', async () => {
    // Alex creates a listing for Jordan to buy
    const alexListing = await api.req('post', '/api/listings', {
      token: alexToken,
      body: {
        title: `PROD-E2E ${RUN_ID} cross-trade-alex`,
        description: `Cross-trade item from Alex ${RUN_ID}`,
        price: 48, originalPrice: 70, category: 'Clothing', brand: 'E2EBrand',
        size: 'M', condition: 'New with tags', color: 'Teal', quantity: 1,
        domesticShipping: 'flat', shippingCost: 7.24, shipsFrom: 'US',
      },
    });
    expect(alexListing.status).toBe(201);
    state.listings.crossAlex = { id: (alexListing.data.listing || alexListing.data)._id, price: 48 };

    // Jordan creates a listing for Alex to buy
    const jordanListing = await api.req('post', '/api/listings', {
      token: jordanToken,
      body: {
        title: `PROD-E2E ${RUN_ID} cross-trade-jordan`,
        description: `Cross-trade item from Jordan ${RUN_ID}`,
        price: 42, originalPrice: 65, category: 'Clothing', brand: 'E2EBrand',
        size: 'L', condition: 'New with tags', color: 'Orange', quantity: 1,
        domesticShipping: 'flat', shippingCost: 7.24, shipsFrom: 'US',
      },
    });
    expect(jordanListing.status).toBe(201);
    state.listings.crossJordan = { id: (jordanListing.data.listing || jordanListing.data)._id, price: 42 };
    saveState(state);
  });

  test('Alex (as buyer) purchases Jordan listing (cross-trade)', async () => {
    const listingId = state.listings.crossJordan.id;
    const ci = await api.req('post', '/api/payments/create-intent', {
      token: alexToken,
      body: { items: [{ listingId }], shippingAddress: ALEX_SHIPPING },
    });
    expect(ci.status, JSON.stringify(ci.data)).toBe(200);
    const { status, data } = await confirmWithTestCard(api, ci.data.paymentIntentId, alexToken);
    expect(status).toBe(200);

    const conf = await api.req('post', '/api/payments/confirm', {
      token: alexToken,
      body: { paymentIntentId: ci.data.paymentIntentId, listingId, shippingAddress: ALEX_SHIPPING },
    });
    expect([200, 201]).toContain(conf.status);
    const txn = conf.data.transaction || conf.data;
    state.txns.crossTradeAlex = { id: String(txn._id ?? txn.id), buyer: 'alex', seller: 'jordan' };
    saveState(state);
  });

  test('Jordan (as buyer) purchases Alex listing (cross-trade reverse)', async () => {
    const listingId = state.listings.crossAlex.id;
    const ci = await api.req('post', '/api/payments/create-intent', {
      token: jordanToken,
      body: { items: [{ listingId }], shippingAddress: SHIPPING },
    });
    expect(ci.status).toBe(200);
    const { status, data } = await confirmWithTestCard(api, ci.data.paymentIntentId, jordanToken);
    expect(status).toBe(200);

    const conf = await api.req('post', '/api/payments/confirm', {
      token: jordanToken,
      body: { paymentIntentId: ci.data.paymentIntentId, listingId, shippingAddress: SHIPPING },
    });
    expect([200, 201]).toContain(conf.status);
    const txn = conf.data.transaction || conf.data;
    state.txns.crossTradeJordan = { id: String(txn._id ?? txn.id), buyer: 'jordan', seller: 'alex' };
    saveState(state);
  });

  test('batch checkout with multiple items from Alex (single-seller batch)', async () => {
    const l1 = await api.req('post', '/api/listings', {
      token: alexToken,
      body: {
        title: `PROD-E2E ${RUN_ID} batch-A`,
        description: `Batch item A ${RUN_ID}`,
        price: 30, category: 'Clothing', brand: 'E2EBrand', size: 'S',
        condition: 'New with tags', quantity: 1,
        domesticShipping: 'flat', shippingCost: 5.00, shipsFrom: 'US',
      },
    });
    expect(l1.status).toBe(201);
    const id1 = (l1.data.listing || l1.data)._id;

    const l2 = await api.req('post', '/api/listings', {
      token: alexToken,
      body: {
        title: `PROD-E2E ${RUN_ID} batch-B`,
        description: `Batch item B ${RUN_ID}`,
        price: 40, category: 'Clothing', brand: 'E2EBrand', size: 'L',
        condition: 'New with tags', quantity: 1,
        domesticShipping: 'flat', shippingCost: 5.00, shipsFrom: 'US',
      },
    });
    expect(l2.status).toBe(201);
    const id2 = (l2.data.listing || l2.data)._id;

    const ci = await api.req('post', '/api/payments/create-intent', {
      token: jordanToken,
      body: { items: [{ listingId: id1 }, { listingId: id2 }], shippingAddress: SHIPPING },
    });
    expect(ci.status).toBe(200);
    const { status, data } = await confirmWithTestCard(api, ci.data.paymentIntentId, jordanToken);
    expect(status).toBe(200);

    const conf = await api.req('post', '/api/payments/confirm-batch', {
      token: jordanToken,
      body: {
        paymentIntentId: ci.data.paymentIntentId,
        items: [{ listingId: id1 }, { listingId: id2 }],
        shippingAddress: SHIPPING,
      },
    });
    expect(conf.status, JSON.stringify(conf.data)).toBe(201);
    // Response structure: { transactions, captureResult, orders, orderId }
    const orderId = conf.data.orderId;
    expect(orderId).toBeTruthy();
    const orders = conf.data.orders || [];
    expect(orders.length).toBeGreaterThan(0);
    const order = orders[0];
    expect(order.items.length).toBe(2);
    expect(order.shipments.length).toBe(1); // Same seller -> bundled
    state.orders.singleSellerBatch = { orderId: order._id || orderId };
    saveState(state);
  });

  test('both cross-trade transactions created valid payout records', async () => {
    for (const token of [alexToken, jordanToken]) {
      const r = await api.req('get', '/api/payouts/dashboard', { token });
      expect(r.status).toBe(200);
      expect(typeof r.data.availableBalance === 'number' && Number.isFinite(r.data.availableBalance)).toBe(true);
    }
    saveState(state);
  });
});
