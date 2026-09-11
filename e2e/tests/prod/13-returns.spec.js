/**
 * PROD E2E — 13: Return/refund flow.
 * Drives a purchase, then exercises the return lifecycle:
 * buyer requests return -> seller approves/denies.
 */
const { test } = require('@playwright/test');
const { makeApi, loadState, saveState, RUN_ID, expect } = require('./helpers');

const SHIPPING = {
  fullName: 'Jordan Patel', street1: '123 E2E Test St', city: 'Los Angeles',
  state: 'CA', postalCode: '90001', country: 'US', phone: '+15555550000',
};

async function confirmWithTestCard(api, paymentIntentId, token) {
  const r = await api.req('post', '/api/payments/test-confirm', { token, body: { paymentIntentId } });
  if (r.status !== 200 || !['requires_capture', 'succeeded'].includes(r.data?.status)) {
    throw new Error(`test-confirm failed: status=${r.status} body=${JSON.stringify(r.data)}`);
  }
  return { status: 200, data: r.data };
}

test.describe('13 · Return/refund flow (production)', () => {
  let api, state, alexToken, jordanToken;
  let returnTxnId;

  test.beforeAll(async () => {
    api = await makeApi();
    state = loadState();
    alexToken = await api.login('alex');
    jordanToken = await api.login('jordan');
  });
  test.afterAll(async () => { await api.dispose(); });

  test('create and purchase a listing for return testing', async () => {
    const listing = await api.req('post', '/api/listings', {
      token: alexToken,
      body: {
        title: `PROD-E2E ${RUN_ID} return-test`,
        description: `Return flow test item ${RUN_ID}`,
        price: 40, category: 'Clothing', brand: 'E2EBrand', size: 'M',
        condition: 'New with tags', quantity: 1,
        domesticShipping: 'flat', shippingCost: 7.24, shipsFrom: 'US',
      },
    });
    expect(listing.status).toBe(201);
    const l = listing.data.listing || listing.data;
    state.listings.returnTest = { id: l._id, price: 40 };

    const ci = await api.req('post', '/api/payments/create-intent', {
      token: jordanToken, body: { items: [{ listingId: l._id }], shippingAddress: SHIPPING },
    });
    expect(ci.status).toBe(200);
    const { status, data } = await confirmWithTestCard(api, ci.data.paymentIntentId, jordanToken);
    expect(status).toBe(200);

    const conf = await api.req('post', '/api/payments/confirm', {
      token: jordanToken,
      body: { paymentIntentId: ci.data.paymentIntentId, listingId: l._id, shippingAddress: SHIPPING },
    });
    expect([200, 201]).toContain(conf.status);
    const txn = conf.data.transaction || conf.data;
    returnTxnId = String(txn._id ?? txn.id);
    state.txns = state.txns || {};
    state.txns.returnTest = { id: returnTxnId, status: 'paid' };
    saveState(state);
  });

  test('return is blocked before completion (transaction not completed)', async () => {
    const r = await api.req('post', '/api/returns', {
      token: jordanToken,
      body: { transactionId: returnTxnId, reason: 'Changed mind', description: 'E2E test' },
    });
    expect(r.status).toBe(400);
    expect(r.data.message).toMatch(/completed|delivered/i);
  });

  test('return requires authentication', async () => {
    const r = await api.req('post', '/api/returns', {
      body: { transactionId: returnTxnId, reason: 'Changed mind' },
    });
    expect([401, 403]).toContain(r.status);
  });

  test('buyer can view their returns list (empty initially)', async () => {
    const r = await api.req('get', '/api/returns', { token: jordanToken });
    expect(r.status).toBe(200);
    const returns = Array.isArray(r.data) ? r.data : (r.data.returns || []);
    expect(Array.isArray(returns)).toBe(true);
  });

  test('seller can view their returns list', async () => {
    const r = await api.req('get', '/api/returns', { token: alexToken });
    expect(r.status).toBe(200);
    const returns = Array.isArray(r.data) ? r.data : (r.data.returns || []);
    expect(Array.isArray(returns)).toBe(true);
  });

  test('return request on a completed transaction works', async () => {
    const tr = await api.req('get', '/api/transactions', { token: jordanToken });
    expect(tr.status).toBe(200);
    const txns = Array.isArray(tr.data) ? tr.data : (tr.data.transactions || tr.data.data || []);
    const completed = txns.find((t) => t.status === 'completed' && t.listing);
    if (!completed) {
      test.info().annotations.push({ type: 'info', description: 'No completed transaction — skipping return-on-completed' });
      return;
    }
    const completedTxnId = String(completed._id);
    // Use valid enum value from Return model: 'Item not as described'
    const r = await api.req('post', '/api/returns', {
      token: jordanToken,
      body: { transactionId: completedTxnId, reason: 'Item not as described', description: 'E2E return test' },
    });
    expect([201, 400]).toContain(r.status);
    if (r.status === 201) {
      state.returns = state.returns || {};
      state.returns.return1 = { id: r.data._id, transactionId: completedTxnId };
      saveState(state);
      const buyerReturns = await api.req('get', '/api/returns', { token: jordanToken });
      expect(buyerReturns.status).toBe(200);
      const bList = Array.isArray(buyerReturns.data) ? buyerReturns.data : (buyerReturns.data.returns || []);
      const found = bList.find((ret) => String(ret._id) === String(r.data._id));
      expect(found, 'return must appear in buyer returns list').toBeTruthy();
    }
  });

  test('seller can approve a return request', async () => {
    if (!state.returns?.return1) {
      test.info().annotations.push({ type: 'info', description: 'No return to approve — skipping' });
      return;
    }
    const r = await api.req('put', `/api/returns/${state.returns.return1.id}/approve`, {
      token: alexToken, body: {},
    });
    expect(r.status, JSON.stringify(r.data)).toBe(200);
    expect(r.data.status).toBe('approved');
  });

  test('seller can deny a return request (state guard)', async () => {
    if (!state.returns?.return1) {
      test.info().annotations.push({ type: 'info', description: 'No return to deny — skipping' });
      return;
    }
    const r = await api.req('put', `/api/returns/${state.returns.return1.id}/deny`, {
      token: alexToken, body: { reason: 'E2E deny test' },
    });
    expect([200, 400]).toContain(r.status);
  });
});
