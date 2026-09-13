/**
 * PROD E2E — 30: RETURNS + DISPUTES FULL JOURNEY.
 * Scenario A: purchase -> ship -> delivered -> request return -> seller approve
 *   -> buyer return-ship -> seller receive -> refunded (+ inventory restored).
 * Scenario B: purchase -> ship -> delivered -> dispute filed -> status disputed
 *   -> resolve -> refunded.
 */
const { test } = require('@playwright/test');
const { makeApi, loadState, saveState, RUN_ID, expect } = require('./helpers');

const SHIPPING = {
  fullName: 'E2E Buyer', street1: '600 Return Rd', city: 'Austin', state: 'TX',
  postalCode: '78701', country: 'US', phone: '+15555550600',
};

async function purchaseAndDeliver(api, token, listingId) {
  const ci = await api.req('post', '/api/payments/create-intent', {
    token,
    body: { items: [{ listingId }], shippingAddress: SHIPPING },
  });
  expect(ci.status).toBe(200);
  const pi = ci.data.paymentIntentId;
  const tc = await api.req('post', '/api/payments/test-confirm', { token, body: { paymentIntentId: pi } });
  expect(tc.status).toBe(200);
  // Use confirm-batch to get a consolidated order (needed for ship/return/dispute flows).
  const conf = await api.req('post', '/api/payments/confirm-batch', {
    token,
    body: { paymentIntentId: pi, items: [{ listingId }], shippingAddress: SHIPPING },
  });
  expect([200, 201]).toContain(conf.status);
  expect(conf.data.orders).toBeTruthy();
  const orderId = String(conf.data.orders[0]._id);
  const txnId = String(conf.data.transactions[0]._id);
  return { orderId, txnId };
}

test.describe('30 · Returns + disputes full journey', () => {
  let api, state, sellerToken, buyerToken;
  let returnListing, disputeListing;

  test.beforeAll(async () => {
    api = await makeApi();
    state = loadState();
    sellerToken = await api.login('alex');
    buyerToken = await api.login('jordan');
    const mk = (title) => api.req('post', '/api/listings', {
      token: sellerToken,
      body: { title, description: 'E2E item', price: 80, category: 'Men', brand: 'E2E',
        size: 'M', condition: 'New with tags', color: 'Black', quantity: 3,
        shipsFrom: 'US', currency: 'USD', domesticShipping: 'true' },
    });
    const ra = await mk(`S30 ${RUN_ID} return`);
    const rb = await mk(`S30 ${RUN_ID} dispute`);
    returnListing = (ra.data.listing || ra.data)._id;
    disputeListing = (rb.data.listing || rb.data)._id;
  });
  test.afterAll(async () => { await api.dispose(); });

  test('S30.A1 purchase + ship + carrier-delivered (tracking webhook)', async () => {
    const { orderId, txnId } = await purchaseAndDeliver(api, buyerToken, returnListing);
    state.txns = state.txns || {};
    state.txns.S30_return = { id: txnId, orderId };
    const ship = await api.req('post', `/api/orders/${orderId}/ship`, {
      token: sellerToken,
      body: { shipmentIndex: 0, trackingNumber: `S30-RET-${RUN_ID}`, carrier: 'UPS' },
    });
    expect(ship.status, JSON.stringify(ship.data)).toBe(200);
    // Carrier webhook (Bug B3 fix) advances the shipment shipped → delivered.
    const ev = await api.req('post', '/api/shipping/tracking-event', {
      headers: { 'x-tracking-secret': 'trenddrop-tracking-dev' },
      body: { transactionId: txnId, status: 'delivered', trackingNumber: `S30-RET-${RUN_ID}` },
    });
    expect(ev.status, JSON.stringify(ev.data)).toBe(200);
    // Buyer confirms receipt: delivered → buyer_confirmed (return window opens).
    const confirm = await api.req('post', `/api/orders/${txnId}/confirm-received`, {
      token: buyerToken, body: {},
    });
    expect(confirm.status, JSON.stringify(confirm.data)).toBe(200);
    saveState(state);
  });


  test('S30.A2 buyer requests a return', async () => {
    const txnId = state.txns.S30_return.id;
    const r = await api.req('post', `/api/orders/${txnId}/request-return`, {
      token: buyerToken,
      body: { reason: 'Not as described', condition: 'Good', evidence: ['photo.jpg'] },
    });
    expect(r.status, JSON.stringify(r.data)).toBe(200);
  });

  test('S30.A3 seller accepts the return', async () => {
    const txnId = state.txns.S30_return.id;
    const r = await api.req('post', `/api/orders/${txnId}/accept-return`, { token: sellerToken });
    expect(r.status, JSON.stringify(r.data)).toBe(200);
  });

  test('S30.A4 buyer ships item back -> seller confirms receipt -> refunded', async () => {
    const txnId = state.txns.S30_return.id;
    const shipBack = await api.req('post', `/api/orders/${txnId}/return-shipped`, {
      token: buyerToken,
      body: { trackingNumber: `S30-RETBACK-${RUN_ID}` },
    });
    expect(shipBack.status).toBe(200);
    const r = await api.req('post', `/api/orders/${txnId}/confirm-return-received`, { token: sellerToken });
    expect(r.status, JSON.stringify(r.data)).toBe(200);
  });

  test('S30.A5 listing inventory restored after return', async () => {
    const r = await api.req('get', `/api/listings/${returnListing}`);
    const l = r.data.listing || r.data;
    expect(l.quantity).toBeGreaterThanOrEqual(3);
  });

  test('S30.B1 purchase + ship + deliver (dispute scenario)', async () => {
    const { orderId, txnId } = await purchaseAndDeliver(api, buyerToken, disputeListing);
    state.txns.S30_dispute = { id: txnId, orderId };
    const ship = await api.req('post', `/api/orders/${orderId}/ship`, {
      token: sellerToken,
      body: { shipmentIndex: 0, trackingNumber: `S30-DIS-${RUN_ID}`, carrier: 'FedEx' },
    });
    expect(ship.status).toBe(200);
    // Carrier webhook advances the shipment shipped → delivered.
    const ev = await api.req('post', '/api/shipping/tracking-event', {
      headers: { 'x-tracking-secret': 'trenddrop-tracking-dev' },
      body: { transactionId: txnId, status: 'delivered', trackingNumber: `S30-DIS-${RUN_ID}` },
    });
    expect(ev.status, JSON.stringify(ev.data)).toBe(200);
    // Dispute is filed directly from 'delivered' (state machine: delivered →
    // disputed). Deliberately NOT confirm-received — buyer_confirmed cannot
    // transition to disputed per the strict enterprise state machine.
    saveState(state);
  });

  test('S30.B2 buyer files a dispute on delivered order', async () => {
    const txnId = state.txns.S30_dispute.id;
    const r = await api.req('post', `/api/orders/${txnId}/dispute`, {
      token: buyerToken,
      body: { reason: 'Item damaged in transit', description: 'Package arrived torn' },
    });
    expect(r.status, JSON.stringify(r.data)).toBe(200);
  });

  test('S30.B3 order status is disputed', async () => {
    const txnId = state.txns.S30_dispute.id;
    const r = await api.req('get', `/api/orders/${txnId}/status`, { token: buyerToken });
    expect(r.status).toBe(200);
    expect(r.data.status).toBe('disputed');
  });

  test('S30.B4 resolve the dispute -> refunded', async () => {
    const txnId = state.txns.S30_dispute.id;
    const r = await api.req('post', `/api/orders/${txnId}/resolve-dispute`, {
      token: sellerToken,
      body: { resolution: 'refund', notes: 'Agreed to full refund' },
    });
    expect(r.status, JSON.stringify(r.data)).toBe(200);
  });
});
