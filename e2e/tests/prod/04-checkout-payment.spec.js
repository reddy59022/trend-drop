/**
 * PROD E2E — 04: full checkout with REAL Stripe TEST-mode payment.
 * Buyer Jordan buys Alex's two listings (one boosted, one not) in a single
 * batch checkout → one consolidated Order, two transactions, boost fee applied
 * on the boosted item only, capture through Stripe, listing sold.
 */
const { test } = require('@playwright/test');
const { makeApi, loadState, saveState, expect } = require('./helpers');

const SHIPPING = {
  fullName: 'Jordan Patel',
  street1: '123 E2E Test St',
  city: 'Los Angeles',
  state: 'CA',
  postalCode: '90001',
  country: 'US',
  phone: '+15555550000',
};

/** Confirm a Stripe TEST-mode intent server-side via POST /api/payments/test-confirm
 * (same REAL authorization Stripe.js performs in the browser, but drivable
 * from an API-only E2E runner; raw HTTPS + publishable key 401s by design).
 * Hard-fails if the endpoint is unavailable so suite never passes on a mock. */
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

test.describe('04 · Checkout → payment → order creation (production + Stripe test mode)', () => {
  let api, state, jordanToken, alexToken;

  test.beforeAll(async () => {
    api = await makeApi();
    state = loadState();
    jordanToken = await api.login('jordan');
    alexToken = await api.login('alex');
  });
  test.afterAll(async () => { await api.dispose(); });

  test('create-intent prices the batch (item + shipping + buyer protection)', async () => {
    const r = await api.req('post', '/api/payments/create-intent', {
      token: jordanToken,
      body: { items: [{ listingId: state.listings.A.id }, { listingId: state.listings.B.id }], shippingAddress: SHIPPING },
    });
    expect(r.status, JSON.stringify(r.data)).toBe(200);
    expect(r.data.clientSecret).toBeTruthy();
    expect(r.data.paymentIntentId).toMatch(/^pi_/);
    const breakdowns = r.data.breakdowns || r.data.breakdown || [];
    if (Array.isArray(breakdowns)) {
      expect(breakdowns.length).toBe(2); // one pricing plan per item
    }
    state.payment = { paymentIntentId: r.data.paymentIntentId, clientSecret: r.data.clientSecret };
    saveState(state);
  });

  test('confirm the payment at Stripe (real TEST-mode card, manual capture)', async () => {
    const { status, data } = await confirmWithTestCard(api, state.payment.paymentIntentId, jordanToken);
    expect(status, JSON.stringify(data)).toBe(200);
    expect(['requires_capture', 'succeeded']).toContain(data.status);
    expect(data.amount).toBeGreaterThan(state.listings.A.price + state.listings.B.price); // + shipping + protection
  });

  test('confirm-batch REFUSES an unauthorized payment', async () => {
    // A fresh intent that was never confirmed at Stripe must not create an order.
    const ci = await api.req('post', '/api/payments/create-intent', {
      token: jordanToken,
      body: { items: [{ listingId: state.listings.C.id }], shippingAddress: SHIPPING },
    });
    expect(ci.status).toBe(200);
    const r = await api.req('post', '/api/payments/confirm-batch', {
      token: jordanToken,
      body: { paymentIntentId: ci.data.paymentIntentId, items: [{ listingId: state.listings.C.id }], shippingAddress: SHIPPING },
    });
    expect(r.status).toBe(400);
    expect(r.data.message).toMatch(/not authorized/i);
    // Release the unused authorization (real Stripe cleanup)
    const cancel = await api.req('post', '/api/payments/cancel-payment', { token: jordanToken, body: { paymentIntentId: ci.data.paymentIntentId } });
    expect([200, 400]).toContain(cancel.status);
    expect(String(JSON.stringify(cancel.data)).toLowerCase()).not.toContain('captcha');
  });

  test('confirm-batch captures the payment and creates the order + transactions', async () => {
    const r = await api.req('post', '/api/payments/confirm-batch', {
      token: jordanToken,
      body: {
        paymentIntentId: state.payment.paymentIntentId,
        items: [{ listingId: state.listings.A.id }, { listingId: state.listings.B.id }],
        shippingAddress: SHIPPING,
      },
    });
    expect(r.status, JSON.stringify(r.data)).toBe(201);
    expect(r.data.orderId, 'consolidated Order id must be returned').toBeTruthy();
    if (r.data.captureResult) expect(r.data.captureResult.status).toBe('succeeded');
    const txns = r.data.transactions || [];
    expect(txns.length).toBe(2);

    // Map transactions to listings
    const byListing = {};
    for (const t of txns) byListing[String(t.listing?._id || t.listing)] = t;
    const tA = byListing[String(state.listings.A.id)];
    const tB = byListing[String(state.listings.B.id)];
    expect(tA && tB, 'one transaction per listing').toBeTruthy();

    // BOOST FEE RECONCILIATION: boosted listing B (premium 15% of $80) pays a
    // $12 boost fee out of the seller's earnings; plain listing A pays $0.
    expect(tB.paymentBreakdown?.boostFee).toBe(12);
    expect(tA.paymentBreakdown?.boostFee ?? 0).toBe(0);
    // Seller earnings = price − 8% commission (− boost fee when boosted)
    expect(tA.paymentBreakdown?.sellerEarnings).toBe(41.4);  // 45 − 3.6
    expect(tB.paymentBreakdown?.sellerEarnings).toBe(61.6);  // 80 − 6.4 − 12
    expect(tA.status).toBe('paid');

    state.orders.batch = { orderId: r.data.orderId };
    state.txns.batch = {
      A: { id: String(tA._id), status: tA.status },
      B: { id: String(tB._id), status: tB.status },
    };
    state.txns.batchIds = txns.map((t) => String(t._id));
    saveState(state);
  });

  test('confirm-batch is idempotent — replay does NOT double-charge', async () => {
    const r = await api.req('post', '/api/payments/confirm-batch', {
      token: jordanToken,
      body: {
        paymentIntentId: state.payment.paymentIntentId,
        items: [{ listingId: state.listings.A.id }, { listingId: state.listings.B.id }],
        shippingAddress: SHIPPING,
      },
    });
    expect([200, 201]).toContain(r.status);
    expect(r.data.message).toMatch(/already/i);
    expect((r.data.transactions || []).length).toBe(0); // no new transactions
    expect(r.data.orderId ?? state.orders.batch.orderId).toBeTruthy();
  });

  test('sold listings leave the marketplace (inventory rollback safety)', async () => {
    for (const key of ['A', 'B']) {
      const r = await api.req('get', `/api/listings/${state.listings[key].id}`);
      expect(r.status).toBe(200);
      const body = r.data.listing || r.data;
      expect(body.sold).toBe(true);
    }
  });

  test('single-item legacy checkout also works (reverse direction: Alex buys from Jordan)', async () => {
    // Multi-seller coverage: the OTHER seeded seller is the buyer here.
    const ci = await api.req('post', '/api/payments/create-intent', {
      token: alexToken,
      body: { items: [{ listingId: state.listings.D.id }], shippingAddress: { ...SHIPPING, fullName: 'Alex Rivera' } },
    });
    expect(ci.status, JSON.stringify(ci.data)).toBe(200);
    const { status, data } = await confirmWithTestCard(api, ci.data.paymentIntentId, alexToken);
    expect(status, JSON.stringify(data)).toBe(200);
    expect(['requires_capture', 'succeeded']).toContain(data.status);

    const r = await api.req('post', '/api/payments/confirm', {
      token: alexToken,
      body: { paymentIntentId: ci.data.paymentIntentId, listingId: state.listings.D.id, shippingAddress: { ...SHIPPING, fullName: 'Alex Rivera' } },
    });
    expect([200, 201]).toContain(r.status);
    const txn = r.data.transaction || r.data;
    expect(txn._id ?? txn.id, 'single confirm must create a transaction').toBeTruthy();
    expect(txn.paymentBreakdown?.boostFee ?? 0).toBe(0); // Jordan's listing was not boosted

    state.txns.D = { id: String(txn._id), status: txn.status || 'paid', buyer: 'alex', seller: 'jordan' };
    saveState(state);
  });

  test('refund lifecycle: buyer cancels a paid (pre-shipment) order → full refund + inventory rollback', async () => {
    // Jordan buys listing C ($30, unboosted) then cancels before shipment.
    const ci = await api.req('post', '/api/payments/create-intent', {
      token: jordanToken,
      body: { items: [{ listingId: state.listings.C.id }], shippingAddress: SHIPPING },
    });
    expect(ci.status).toBe(200);
    const { status, data } = await confirmWithTestCard(api, ci.data.paymentIntentId, jordanToken);
    expect(status).toBe(200);
    expect(['requires_capture', 'succeeded']).toContain(data.status);

    const conf = await api.req('post', '/api/payments/confirm', {
      token: jordanToken,
      body: { paymentIntentId: ci.data.paymentIntentId, listingId: state.listings.C.id, shippingAddress: SHIPPING },
    });
    expect([200, 201]).toContain(conf.status);
    const txn = conf.data.transaction || conf.data;
    const txnId = String(txn._id ?? txn.id);
    state.txns.C = { id: txnId, status: txn.status || 'paid' };
    saveState(state);

    // Buyer cancels while status = 'paid' (before shipment)
    const cancel = await api.req('post', `/api/orders/${txnId}/cancel`, {
      token: jordanToken,
      body: { reason: 'E2E pre-shipment cancellation test' },
    });
    expect(cancel.status, JSON.stringify(cancel.data)).toBe(200);
    expect(cancel.data.refundType).toBe('full');
    expect(cancel.data.refundAmount).toBeGreaterThan(0);

    // Listing inventory must be restored
    const after = await api.req('get', `/api/listings/${state.listings.C.id}`);
    const body = after.data.listing || after.data;
    expect(body.sold).not.toBe(true);
    expect(body.available).not.toBe(false);

    // Post-cancel state: cancellation recorded
    const st = await api.req('get', `/api/orders/${txnId}/status`, { token: jordanToken });
    expect(st.status).toBe(200);
    expect(st.data.status).toMatch(/cancel|refund/);
    expect(st.data.eligibility.canCancel).toBe(false); // cannot cancel twice
  });
});
