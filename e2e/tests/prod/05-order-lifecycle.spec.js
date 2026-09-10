/**
 * PROD E2E — 05: full order lifecycle on the real batch order.
 * paid → shipped (seller) → guards on invalid transitions.
 * (Full delivered/completed progression requires a real carrier tracking
 * webhook, exercised by the auto-tracking job — asserted here as guards.)
 */
const { test } = require('@playwright/test');
const { makeApi, loadState, saveState, expect } = require('./helpers');

test.describe('05 · Order lifecycle (production)', () => {
  let api, state, jordanToken, alexToken, orderId, txnA, txnB;

  test.beforeAll(async () => {
    api = await makeApi();
    state = loadState();
    jordanToken = await api.login('jordan');
    alexToken = await api.login('alex');
    orderId = state.orders?.batch?.orderId;
    txnA = state.txns?.batch?.A?.id;
    txnB = state.txns?.batch?.B?.id;
  });
  test.afterAll(async () => { await api.dispose(); });

  test('consolidated order is visible to buyer with one shipment per seller', async () => {
    const r = await api.req('get', `/api/orders/${orderId}`, { token: jordanToken });
    expect(r.status, JSON.stringify(r.data)).toBe(200);
    const order = r.data.order;
    expect(order._id).toBe(orderId);
    expect(order.role).toBe('buyer');
    expect(order.items.length).toBe(2);
    expect(order.shipments.length).toBe(1); // both items from the SAME seller → bundled
    expect(String(order.shipments[0].seller)).toBe(String(state.users.alex.id));
    expect(order.totals.total).toBeGreaterThan(state.listings.A.price + state.listings.B.price);
    expect(order.payment.paymentIntentId).toBeTruthy();
  });

  test('seller sees the order and their allowed seller actions', async () => {
    const r = await api.req('get', `/api/orders/${orderId}`, { token: alexToken });
    expect(r.status).toBe(200);
    expect(r.data.order.role).toBe('seller');
    expect(Array.isArray(r.data.order.allowedActions)).toBe(true);
    expect(r.data.order.allowedActions).toContain('ship'); // seller CAN ship now
  });

  test('unauthenticated access to the order is rejected', async () => {
    const r = await api.req('get', `/api/orders/${orderId}`);
    expect([401, 403]).toContain(r.status);
  });

  test('seller ships the shipment with tracking (paid → shipped)', async () => {
    const r = await api.req('post', `/api/orders/${orderId}/ship`, {
      token: alexToken,
      body: { shipmentIndex: 0, trackingNumber: `E2E${Date.now()}`, carrier: 'usps' },
    });
    expect(r.status, JSON.stringify(r.data)).toBe(200);
    expect(r.data.message).toMatch(/shipped/i);
    expect(r.data.order.shipments[0].status).toBe('shipped');
    expect(r.data.order.shipments[0].trackingNumber).toBeTruthy();
  });

  test('buyer CANNOT ship the seller’s shipment (403)', async () => {
    const r = await api.req('post', `/api/orders/${orderId}/ship`, {
      token: jordanToken,
      body: { shipmentIndex: 0, trackingNumber: 'FAKE', carrier: 'usps' },
    });
    expect(r.status).toBe(403);
    expect(r.data.message).toMatch(/not authorized/i);
  });

  test('double-ship is rejected (state machine guard)', async () => {
    const r = await api.req('post', `/api/orders/${orderId}/ship`, {
      token: alexToken,
      body: { shipmentIndex: 0, trackingNumber: 'E2E-DUP', carrier: 'usps' },
    });
    expect(r.status).toBe(400);
    expect(r.data.message).toMatch(/already shipped/i);
  });

  test('ship requires shipmentIndex', async () => {
    const r = await api.req('post', `/api/orders/${orderId}/ship`, { token: alexToken, body: {} });
    expect(r.status).toBe(400);
    expect(r.data.message).toMatch(/shipmentIndex/i);
  });

  test('transaction status endpoint reflects shipped + payment breakdown', async () => {
    const r = await api.req('get', `/api/orders/${txnB}/status`, { token: jordanToken });
    expect(r.status, JSON.stringify(r.data)).toBe(200);
    expect(r.data.status).toBe('shipped');
    expect(Array.isArray(r.data.allowedActions)).toBe(true);
    expect(r.data.payment.boostFee).toBe(12); // boosted item reconciliation
    expect(r.data.timeline.shippedAt).toBeTruthy();
    expect(r.data.eligibility.canCancel).toBe(false); // too late to cancel after shipment
  });

  test('confirm-received is blocked before delivery (state machine guard)', async () => {
    const r = await api.req('post', `/api/orders/${txnB}/confirm-received`, { token: jordanToken, body: {} });
    expect(r.status).toBe(400);
    expect(r.data.message).toMatch(/confirm receipt/i);
  });

  test('auto-complete is blocked from paid/shipped state (guard)', async () => {
    const r = await api.req('post', `/api/orders/${txnA}/auto-complete`, { token: jordanToken, body: {} });
    expect(r.status).toBe(400);
  });

  test('seller payout processing is blocked for a non-completed transaction', async () => {
    const r = await api.req('post', `/api/payouts/process/${txnA}`, { token: alexToken, body: {} });
    expect(r.status).toBe(400);
    expect(r.data.message).toMatch(/completed/i);
  });

  test('lifecycle endpoint returns state-machine info for a transaction', async () => {
    const r = await api.req('get', `/api/orders/${txnB}/lifecycle`, { token: jordanToken });
    expect(r.status).toBe(200);
  });

  test('orders list includes the batch order for both roles', async () => {
    for (const [token, role] of [[jordanToken, 'buyer'], [alexToken, 'seller']]) {
      const r = await api.req('get', '/api/orders', { token });
      expect(r.status).toBe(200);
      const orders = r.data.orders || [];
      const mine = orders.find((o) => String(o._id) === String(orderId));
      expect(mine, `order missing from ${role} list`).toBeTruthy();
      expect(mine.role).toBe(role);
    }
    saveState(state);
  });
});
