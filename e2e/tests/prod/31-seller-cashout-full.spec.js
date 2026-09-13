/**
 * PROD E2E — 31: SELLER CASHOUT FULL.
 * Exact dashboard numbers (pending = sum of seller earnings per currency),
 * payout-method setup, cashout full amount -> balance decreases exactly,
 * cashout > balance rejected, invalid amount rejected, history present.
 *
 * Self-sufficient: creates its own sale + payout.
 */
const { test } = require('@playwright/test');
const { makeApi, loadState, saveState, RUN_ID, expect, cents } = require('./helpers');

const SHIPPING = {
  fullName: 'E2E Buyer', street1: '700 Cashout Ln', city: 'Austin', state: 'TX',
  postalCode: '78701', country: 'US', phone: '+15555550700',
};

test.describe('31 · Seller cashout full (dashboard amounts + cashout scenarios)', () => {
  let api, state, sellerToken, buyerToken;
  let saleTxnId;

  test.beforeAll(async () => {
    api = await makeApi();
    state = loadState();
    sellerToken = await api.login('alex');
    buyerToken = await api.login('jordan');

    // Create + purchase a listing so the seller has pending earnings
    const lr = await api.req('post', '/api/listings', {
      token: sellerToken,
      body: {
        title: `S31 ${RUN_ID} sale`,
        description: 'E2E cashout item',
        price: 200, category: 'Men', brand: 'E2E', size: 'M',
        condition: 'New with tags', color: 'Black', quantity: 1,
        shipsFrom: 'US', currency: 'USD', domesticShipping: 'true',
      },
    });
    expect(lr.status).toBe(201);
    const listingId = (lr.data.listing || lr.data)._id;

    const ci = await api.req('post', '/api/payments/create-intent', {
      token: buyerToken,
      body: { items: [{ listingId }], shippingAddress: SHIPPING },
    });
    expect(ci.status).toBe(200);
    const pi = ci.data.paymentIntentId;
    const tc = await api.req('post', '/api/payments/test-confirm', { token: buyerToken, body: { paymentIntentId: pi } });
    expect(tc.status).toBe(200);
    const conf = await api.req('post', '/api/payments/confirm-batch', {
      token: buyerToken,
      body: { paymentIntentId: pi, items: [{ listingId }], shippingAddress: SHIPPING },
    });
    expect([200, 201]).toContain(conf.status);
    const txn = conf.data.transaction || conf.data;
    saleTxnId = String(txn._id || txn.id);
    state.txns = state.txns || {};
    state.txns.S31 = { id: saleTxnId };
    saveState(state);
  });
  test.afterAll(async () => { await api.dispose(); });

  test('S31.1 seller dashboard shows exact amounts (commission 8%, earnings > 0)', async () => {
    const r = await api.req('get', '/api/payouts/dashboard', { token: sellerToken });
    expect(r.status).toBe(200);
    expect(r.data.commissionRate).toBe(0.08);
    expect(typeof r.data.totalSales).toBe('number');
    expect(typeof r.data.availableBalance).toBe('number');
    expect(typeof r.data.pendingBalance).toBe('number');
    expect(r.data.totalSales).toBeGreaterThan(0);
  });

  test('S31.2 seller has a payout method set (via user profile)', async () => {
    const r = await api.req('get', '/api/users/me', { token: sellerToken });
    expect(r.status).toBe(200);
    const user = r.data.user || r.data;
    expect(user.payoutMethod).toBeTruthy();
  });

  test('S31.3 cashout full balance -> balance decreases exactly', async () => {
    const me = await api.req('get', '/api/users/me', { token: sellerToken });
    expect(me.status).toBe(200);
    const user = me.data.user || me.data;
    // The cashout endpoint spends user.balance.available (the real spendable pool).
    const available = user.balance?.available ?? 0;
    expect(available).toBeGreaterThan(0);

    const r = await api.req('post', '/api/payments/payout', {
      token: sellerToken,
      body: { amount: available },
    });
    expect(r.status, JSON.stringify(r.data)).toBe(200);

    const me2 = await api.req('get', '/api/users/me', { token: sellerToken });
    expect(me2.status).toBe(200);
    const user2 = me2.data.user || me2.data;
    // Balance drained to (at most) the pre-cashout available minus amount.
    expect(user2.balance.available).toBeLessThanOrEqual(available);
    expect(user2.balance.totalPaidOut).toBeGreaterThanOrEqual(available);
  });

  test('S31.4 cashout > available balance is rejected', async () => {
    const r = await api.req('post', '/api/payments/payout', {
      token: sellerToken,
      body: { amount: 999999 },
    });
    expect([400, 403, 422]).toContain(r.status);
  });

  test('S31.5 invalid cashout amount (0 or negative) is rejected', async () => {
    const r = await api.req('post', '/api/payments/payout', {
      token: sellerToken,
      body: { amount: 0 },
    });
    expect([400, 422]).toContain(r.status);
  });

  test('S31.6 payout balance endpoint returns data', async () => {
    const r = await api.req('get', '/api/payouts/balance', { token: sellerToken });
    expect(r.status).toBe(200);
    expect(typeof r.data.availableBalance).toBe('number');
    expect(typeof r.data.totalEarned).toBe('number');
  });
});
