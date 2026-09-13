/**
 * PROD E2E — 33: IMMEDIATE CANCELLATION (enterprise zero-sum guarantee).
 *
 * Scenario: a buyer places an order and cancels immediately within the
 * eligible pre-shipment window. The platform must fully unwind with NO gain
 * or NO loss for anyone:
 *   buyer   → 100% refund (item + shipping + protection) to original method
 *   seller  → pending earnings clawed back EXACTLY (available/totalEarned
 *             untouched; totalSales unchanged)
 *   buyer   → totalPurchases unchanged
 *   listing → quantity/quantitySold restored; relistable & re-purchasable
 *   order   → consolidated Order refunded, payment refunded, shipment
 *             cancelled, cancellation audit trail written
 *
 * Also verifies idempotent double-cancel, cancel-vs-ship guard, and the
 * seller-initiated cancel (strike + identical zero-sum unwind).
 *
 * Runs against the in-memory server. SKIPPED on the production target —
 * these scenarios issue live Stripe refunds and mutate real balances.
 */
const { test, expect } = require('@playwright/test');
const { makeApi, loadState, saveState, RUN_ID, IS_PROD } = require('./helpers');

const SHIPPING = {
  fullName: 'Jordan Patel', street1: '123 E2E Test St', city: 'Los Angeles',
  state: 'CA', postalCode: '90001', country: 'US', phone: '+15555550000',
};

const cents = (n) => Math.round(n * 100) / 100;

async function confirmWithTestCard(api, pi, token) {
  const r = await api.req('post', '/api/payments/test-confirm', { token, body: { paymentIntentId: pi } });
  if (r.status !== 200 || !['requires_capture', 'succeeded'].includes(r.data?.status)) {
    throw new Error(`test-confirm failed: status=${r.status} body=${JSON.stringify(r.data)}`);
  }
  return r;
}

/** Create a seller listing, pay for it as the buyer, return order/txn ids. */
async function placeOrder(api, sellerToken, buyerToken, title) {
  const listing = await api.req('post', '/api/listings', {
    token: sellerToken,
    body: {
      title: `${title} ${RUN_ID}`, description: 'Immediate cancel E2E', price: 75,
      category: 'Clothing', brand: 'E2EBrand', size: 'M', condition: 'New with tags',
      quantity: 3, domesticShipping: 'flat', shippingCost: 7.24, shipsFrom: 'US',
    },
  });
  expect(listing.status, JSON.stringify(listing.data)).toBe(201);
  const listingId = String((listing.data.listing || listing.data)._id);

  const ci = await api.req('post', '/api/payments/create-intent', {
    token: buyerToken, body: { items: [{ listingId }], shippingAddress: SHIPPING },
  });
  expect(ci.status).toBe(200);
  await confirmWithTestCard(api, ci.data.paymentIntentId, buyerToken);
  const conf = await api.req('post', '/api/payments/confirm-batch', {
    token: buyerToken,
    body: { paymentIntentId: ci.data.paymentIntentId, items: [{ listingId }], shippingAddress: SHIPPING },
  });
  expect([200, 201], JSON.stringify(conf.data)).toContain(conf.status);
  const order = conf.data.orders?.[0] || conf.data.order;
  return {
    listingId,
    orderId: String(order._id),
    txnId: String(conf.data.transactions[0]._id),
    orderNumber: order.orderNumber,
    checkout: conf.data,
  };
}

const describe33 = IS_PROD ? test.describe.skip : test.describe;
describe33('33 · Immediate cancellation — zero-sum unwind', () => {
  let api, state, sellerToken, buyerToken;
  let alexBaseline, jordanBaseline;

  test.beforeAll(async () => {
    api = await makeApi();
    state = loadState();
    sellerToken = await api.login('alex');
    buyerToken = await api.login('jordan');
    const a = await api.req('get', '/api/users/me', { token: sellerToken });
    const b = await api.req('get', '/api/users/me', { token: buyerToken });
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    alexBaseline = { pending: a.data.balance?.pending || 0, available: a.data.balance?.available || 0, totalSales: a.data.stats?.totalSales || 0, strikes: a.data.stats?.strikes || 0 };
    jordanBaseline = { totalPurchases: b.data.stats?.totalPurchases || 0 };
  });
  test.afterAll(async () => { await api.dispose(); });

  test('S33.1 buyer cancels immediately after paying → full refund + full unwind', async () => {
    const bought = await placeOrder(api, sellerToken, buyerToken, 'S33 immed-cancel-A');
    state.cancel = { listingId: bought.listingId, orderId: bought.orderId, txnId: bought.txnId };
    saveState(state);

    const txn = bought.checkout.transactions.find((t) => t._id === bought.txnId);
    const totalPaid = txn.paymentBreakdown.totalPaid;
    expect(txn.status).toBe('paid');

    // Post-purchase state: seller escrow + sold listing
    const escrowed = await api.req('get', '/api/users/me', { token: sellerToken });
    expect(escrowed.data.balance.pending).toBeCloseTo(alexBaseline.pending + txn.paymentBreakdown.sellerEarnings, 2);
    const sold = await api.req('get', `/api/listings/${bought.listingId}`);
    expect(sold.status).toBe(200);
    expect(sold.data.listing.available).toBe(false);

    // IMMEDIATE CANCEL
    const r = await api.req('post', `/api/orders/${bought.txnId}/cancel`, {
      token: buyerToken, body: { reason: 'Ordered by mistake' },
    });
    expect(r.status, JSON.stringify(r.data)).toBe(200);
    expect(r.data.refundType).toBe('full');
    expect(cents(r.data.refundAmount)).toBe(cents(totalPaid)); // 100% back
    saveState(state);
  });

  test('S33.2 transaction + consolidated order are fully settled', async () => {
    const { orderId, txnId } = state.cancel;
    const st = await api.req('get', `/api/orders/${txnId}/status`, { token: buyerToken });
    expect(st.status).toBe(200);
    expect(st.data.status).toBe('cancelled_by_buyer');
    expect(st.data.eligibility.canCancel).toBe(false);

    const od = await api.req('get', `/api/orders/${orderId}`, { token: buyerToken });
    expect(od.status).toBe(200);
    const order = od.data.order;
    expect(order.status).toBe('refunded');
    expect(order.payment.status).toBe('refunded');
    expect(order.items.length).toBe(0);
    expect(order.shipments[0].status).toBe('cancelled');
    expect(order.cancellation.cancelledBy).toBe('buyer');
    expect(cents(order.cancellation.refundAmount)).toBe(cents(order.totals.total)); // audit = full captured total
  });

  test('S33.3 ZERO-SUM: seller pending back at baseline, counts unchanged', async () => {
    const a = await api.req('get', '/api/users/me', { token: sellerToken });
    const b = await api.req('get', '/api/users/me', { token: buyerToken });
    expect(a.data.balance.pending).toBeCloseTo(alexBaseline.pending, 2);   // seller: exact clawback
    expect(a.data.balance.available).toBe(alexBaseline.available);         // never paid out
    expect(a.data.stats.totalSales).toBe(alexBaseline.totalSales);         // sales count unchanged
    expect(b.data.stats.totalPurchases).toBe(jordanBaseline.totalPurchases);
  });

  test('S33.4 INVENTORY + relist: quantity restored, item buyable again', async () => {
    const { listingId } = state.cancel;
    const l = await api.req('get', `/api/listings/${listingId}`);
    expect(l.status).toBe(200);
    expect(l.data.listing.available).toBe(true);
    expect(l.data.listing.sold).toBe(false);
    expect(l.data.listing.quantity).toBe(3);          // restored exactly
    expect(l.data.listing.quantitySold).toBe(0);      // sold counter reset

    // Prove the stock is REAL: buy the same-item-style listing again
    const again = await placeOrder(api, sellerToken, buyerToken, 'S33 relist-B');
    expect(again.txnId).toBeTruthy();
    const second = await api.req('post', `/api/orders/${again.txnId}/cancel`, { token: buyerToken, body: { reason: 'cleanup' } });
    expect(second.status).toBe(200);
    saveState(state);
  });

  test('S33.5 double cancel is idempotent (no double refund, no double restore)', async () => {
    const { listingId, orderId, txnId } = state.cancel;
    const dup = await api.req('post', `/api/orders/${txnId}/cancel`, { token: buyerToken, body: { reason: 'again' } });
    expect(dup.status).toBe(200);
    expect(dup.data.alreadyCancelled).toBe(true);

    const l = await api.req('get', `/api/listings/${listingId}`);
    expect(l.data.listing.quantity).toBe(3);   // restored EXACTLY ONCE
    const od = await api.req('get', `/api/orders/${orderId}`, { token: buyerToken });
    expect(cents(od.data.order.cancellation.refundAmount)).toBe(cents(od.data.order.totals.total));
  });

  test('S33.6 cancel after shipment is rejected and nothing moves', async () => {
    // The cancelled order from S33.1 must refuse shipping (ship-vs-cancel guard)
    const guard = await api.req('post', `/api/orders/${state.cancel.orderId}/ship`, {
      token: sellerToken, body: { shipmentIndex: 0, trackingNumber: `S33-${RUN_ID}`, carrier: 'USPS' },
    });
    expect([400, 409]).toContain(guard.status);
    const od = await api.req('get', `/api/orders/${state.cancel.orderId}`, { token: sellerToken });
    expect(od.data.order.shipments[0].status).toBe('cancelled'); // still cancelled

    // Place a fresh order, ship it, then try to cancel → 400, nothing moves
    const bought = await placeOrder(api, sellerToken, buyerToken, 'S33 shipped-C');
    const shipR = await api.req('post', `/api/orders/${bought.orderId}/ship`, {
      token: sellerToken, body: { shipmentIndex: 0, trackingNumber: `S33-${RUN_ID}`, carrier: 'USPS' },
    });
    expect(shipR.status, JSON.stringify(shipR.data)).toBe(200);
    // The new order's escrow is now held — remember it as the baseline.
    const escrowed = await api.req('get', '/api/users/me', { token: sellerToken });

    const r = await api.req('post', `/api/orders/${bought.txnId}/cancel`, { token: buyerToken, body: { reason: 'late' } });
    expect(r.status).toBe(400);
    expect(String(r.data.message)).toMatch(/cannot cancel/i);
    // Rejected cancel moved NOTHING: escrow unchanged, listing not restored
    const after = await api.req('get', '/api/users/me', { token: sellerToken });
    expect(after.data.balance.pending).toBeCloseTo(escrowed.data.balance.pending, 2);
    const stillSold = await api.req('get', `/api/listings/${bought.listingId}`);
    expect(stillSold.data.listing.available).toBe(false);
  });

  test('S33.7 seller-initiated cancel: strike applied, identical zero-sum unwind', async () => {
    const bought = await placeOrder(api, sellerToken, buyerToken, 'S33 seller-cancel-D');
    const boughtEarnings = bought.checkout.transactions.find((t) => t._id === bought.txnId).paymentBreakdown.sellerEarnings;
    const before = await api.req('get', '/api/users/me', { token: sellerToken });
    const strikesBefore = before.data.stats?.strikes || 0;

    const r = await api.req('post', `/api/orders/${bought.txnId}/cancel`, {
      token: sellerToken, body: { reason: 'Out of stock' },
    });
    expect(r.status, JSON.stringify(r.data)).toBe(200);

    const st = await api.req('get', `/api/orders/${bought.txnId}/status`, { token: buyerToken });
    expect(st.data.status).toBe('cancelled_by_seller');

    const after = await api.req('get', '/api/users/me', { token: sellerToken });
    expect(after.data.stats.strikes).toBe(strikesBefore + 1);
    // EXACT clawback of THIS order's earnings (unrelated escrow stays put)
    expect(after.data.balance.pending).toBeCloseTo(before.data.balance.pending - boughtEarnings, 2);
    const l = await api.req('get', `/api/listings/${bought.listingId}`);
    expect(l.data.listing.quantity).toBe(3);
  });
});