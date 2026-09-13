/**
 * PROD E2E — 32: Full return flow (enterprise standard).
 * Covers: eligible returns, photo validation, approval + label generation,
 * buyer-only label visibility, shipping, receipt -> refund, inventory restore.
 */
const { test } = require('@playwright/test');
const { makeApi, loadState, saveState, RUN_ID, expect } = require('./helpers');

const SHIPPING = {
  fullName: 'Jordan Patel', street1: '123 E2E Test St', city: 'Los Angeles',
  state: 'CA', postalCode: '90001', country: 'US', phone: '+15555550000',
};

async function confirmWithTestCard(api, pi, token) {
  const r = await api.req('post', '/api/payments/test-confirm', { token, body: { paymentIntentId: pi } });
  if (r.status !== 200 || !['requires_capture', 'succeeded'].includes(r.data?.status)) {
    throw new Error(`test-confirm failed: status=${r.status}`);
  }
  return r;
}

test.describe('32 · Full return flow (enterprise standard)', () => {
  let api, state, sellerToken, buyerToken;
  let listingId, orderId, txnId, returnId;

  test.beforeAll(async () => {
    api = await makeApi();
    state = loadState();
    sellerToken = await api.login('alex');
    buyerToken = await api.login('jordan');
  });
  test.afterAll(async () => { await api.dispose(); });

  test('S32.1 create and purchase a listing', async () => {
    const listing = await api.req('post', '/api/listings', {
      token: sellerToken,
      body: { title: `S32 ${RUN_ID} return-item`, description: 'Return flow test', price: 60,
        category: 'Clothing', brand: 'E2EBrand', size: 'M', condition: 'New with tags', quantity: 3,
        domesticShipping: 'flat', shippingCost: 7.24, shipsFrom: 'US' },
    });
    expect(listing.status).toBe(201);
    listingId = (listing.data.listing || listing.data)._id;
    const ci = await api.req('post', '/api/payments/create-intent', {
      token: buyerToken, body: { items: [{ listingId }], shippingAddress: SHIPPING },
    });
    expect(ci.status).toBe(200);
    await confirmWithTestCard(api, ci.data.paymentIntentId, buyerToken);
    const conf = await api.req('post', '/api/payments/confirm-batch', {
      token: buyerToken, body: { paymentIntentId: ci.data.paymentIntentId, items: [{ listingId }], shippingAddress: SHIPPING },
    });
    expect([200, 201]).toContain(conf.status);
    expect(conf.data.orders).toBeTruthy();
    orderId = String(conf.data.orders[0]._id);
    txnId = String(conf.data.transactions[0]._id);
  });

  test('S32.2 mark transaction delivered', async () => {
    const ship = await api.req('post', `/api/orders/${orderId}/ship`, {
      token: sellerToken, body: { shipmentIndex: 0, trackingNumber: `S32-${RUN_ID}`, carrier: 'UPS' },
    });
    expect(ship.status).toBe(200);
    // Carrier webhook advances the shipment shipped → delivered.
    const t = await api.req('post', '/api/shipping/tracking-event', {
      headers: { 'x-tracking-secret': 'trenddrop-tracking-dev' },
      body: { transactionId: txnId, status: 'delivered', trackingNumber: `S32-${RUN_ID}` },
    });
    expect(t.status).toBe(200);
  });

  test('S32.3 eligible returns shows the delivered item', async () => {
    const r = await api.req('get', '/api/returns/eligible', { token: buyerToken });
    expect(r.status).toBe(200);
    expect(r.data.returnWindowDays).toBe(3);
    expect(r.data.eligible.length).toBeGreaterThanOrEqual(1);
    const found = r.data.eligible.find((e) => e.transactionId === txnId);
    expect(found).toBeTruthy();
    expect(found.daysRemaining).toBeGreaterThan(0);
  });

  test('S32.4 return creation without photos is rejected', async () => {
    const r = await api.req('post', '/api/returns', {
      token: buyerToken, body: { transactionId: txnId, reason: 'Item not as described' },
    });
    expect(r.status).toBe(400);
    expect(r.data.message).toMatch(/photo/i);
  });

  test('S32.5 return with more than 5 photos is rejected', async () => {
    const images = Array.from({ length: 6 }, (_, i) => `https://example.com/photo${i}.jpg`);
    const r = await api.req('post', '/api/returns', {
      token: buyerToken, body: { transactionId: txnId, reason: 'Item not as described', images },
    });
    expect(r.status).toBe(400);
    expect(r.data.message).toMatch(/photo/i);
  });

  test('S32.6 buyer creates return with 5 photos', async () => {
    const images = Array.from({ length: 5 }, (_, i) => `https://example.com/photo${i}.jpg`);
    const r = await api.req('post', '/api/returns', {
      token: buyerToken, body: { transactionId: txnId, reason: 'Item not as described', images },
    });
    expect(r.status).toBe(201);
    returnId = r.data._id;
    expect(r.data.images.length).toBe(5);
    expect(r.data.status).toBe('pending');
  });

  test('S32.7 seller approves return -> label generated', async () => {
    const r = await api.req('put', `/api/returns/${returnId}/approve`, {
      token: sellerToken, body: { sellerResponse: 'Approved' },
    });
    expect(r.status).toBe(200);
    expect(r.data.status).toBe('approved');
    // NOTE: the approve response strips the buyer-only label URL by design;
    // the tracking number + carrier stay visible to the seller.
    expect(r.data.returnTrackingNumber).toBeTruthy();
    expect(r.data.labelCarrier).toBeTruthy();
  });

  test('S32.8 buyer can see label URL; seller cannot', async () => {
    const buyerView = await api.req('get', `/api/returns/${returnId}`, { token: buyerToken });
    expect(buyerView.status).toBe(200);
    expect(buyerView.data.returnLabel).toBeTruthy();
    expect(buyerView.data.returnTrackingNumber).toBeTruthy();
    const sellerView = await api.req('get', `/api/returns/${returnId}`, { token: sellerToken });
    expect(sellerView.status).toBe(200);
    expect(sellerView.data.returnLabel).toBeUndefined();
    expect(sellerView.data.returnTrackingNumber).toBeTruthy();
  });

  test('S32.9 buyer ships item back', async () => {
    const r = await api.req('put', `/api/returns/${returnId}/ship`, {
      token: buyerToken, body: { trackingNumber: '1ZRETURN123' },
    });
    expect(r.status).toBe(200);
    expect(r.data.status).toBe('shipped');
  });

  test('S32.10 seller confirms receipt -> refunded + inventory restored', async () => {
    const r = await api.req('put', `/api/returns/${returnId}/receive`, {
      token: sellerToken, body: { inspectionNotes: 'OK' },
    });
    expect(r.status).toBe(200);
    expect(r.data.status).toBe('refunded');
    const listing = await api.req('get', `/api/listings/${listingId}`);
    const l = listing.data.listing || listing.data;
    expect(l.quantity).toBe(3);
    expect(l.sold).toBe(false);
  });

  test('S32.11 duplicate return for same transaction is rejected', async () => {
    const r = await api.req('post', '/api/returns', {
      token: buyerToken, body: { transactionId: txnId, reason: 'Changed mind', images: ['https://example.com/p.jpg'] },
    });
    expect(r.status).toBe(400);
    expect(r.data.message).toMatch(/already exists/i);
  });

  test('S32.12 non-participant cannot access return', async () => {
    // seller2 is a seeded, email-verified account that is neither the buyer
    // nor the seller of this return (new registrations cannot log in until
    // their email is verified, so a seeded third account is used instead).
    const otherToken = await api.login('seller2');
    const r = await api.req('get', `/api/returns/${returnId}`, { token: otherToken });
    expect(r.status).toBe(403);
  });
});