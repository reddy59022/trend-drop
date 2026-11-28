/**
 * PROD E2E — 36: Multi-party release validation.
 *
 * Uses the seeded verified marketplace population (6 sellers, 6 buyers):
 *   seller1..seller6@trenddrop.test / TestPass123!
 *   buyer1..buyer6@trenddrop.test  / TestPass123!
 *
 * Covers cross-seller behavior that the two-account suite cannot:
 *   • one buyer checking out items from TWO different sellers atomically
 *   • two buyers racing for the same last unit (exactly one wins)
 *   • offers between a buyer and a different seller
 *   • messaging + wishlist + follow across accounts
 *   • buyer-to-buyer transaction isolation
 *   • cancellation of one seller's leg without touching the other
 */
const { test } = require('@playwright/test');
const { makeApi, RUN_ID, expect, IS_PROD } = require('./helpers');

const fs = require('fs');
const os = require('os');
const path = require('path');
const PASSWORD = 'TestPass123!';
const TOKEN_CACHE = path.join(os.tmpdir(), 'trenddrop-party-tokens.json');
function readTokens() { try { return JSON.parse(fs.readFileSync(TOKEN_CACHE, 'utf8')); } catch (_) { return {}; } }
function writeTokens(t) { try { fs.writeFileSync(TOKEN_CACHE, JSON.stringify(t)); } catch (_) { /* best effort */ } }
const SHIPPING = {
  fullName: 'Release Buyer', street1: '350 5th Ave', city: 'New York',
  state: 'NY', postalCode: '10118', country: 'US', phone: '+12125550102',
};

async function loginAs(api, email) {
  const cache = readTokens();
  if (cache[email]) {
    const check = await api.req('get', '/api/users/me', { token: cache[email] });
    if (check.status === 200) return cache[email];
  }
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const r = await api.req('post', '/api/auth/login', { body: { email, password: PASSWORD } });
    if (r.status === 200 && r.data.token) {
      cache[email] = r.data.token;
      writeTokens(cache);
      return r.data.token;
    }
    if (r.status === 429) { await new Promise((res) => setTimeout(res, 8000)); continue; }
    throw new Error(`login failed ${email}: ${r.status} ${JSON.stringify(r.data)}`);
  }
  throw new Error(`login throttled ${email}`);
}

async function confirmWithTestCard(api, paymentIntentId, token) {
  const r = await api.req('post', '/api/payments/test-confirm', { token, body: { paymentIntentId } });
  if (r.status !== 200 || !['requires_capture', 'succeeded'].includes(r.data?.status)) {
    throw new Error(`test-confirm failed: ${r.status} ${JSON.stringify(r.data)}`);
  }
  return r.data;
}

async function createListing(api, token, sellerName, title, price) {
  const r = await api.req('post', '/api/listings', {
    token,
    body: {
      title: `RELEASE ${RUN_ID} ${sellerName} ${title}`,
      description: `Multi-party release validation ${RUN_ID}`,
      price, originalPrice: Math.round(price * 1.5), category: 'Clothing',
      brand: 'ReleaseBrand', size: 'M', condition: 'New with tags', color: 'Blue',
      quantity: 1, domesticShipping: 'flat', shippingCost: 7.24, shipsFrom: 'US',
    },
  });
  expect(r.status, JSON.stringify(r.data)).toBe(201);
  return (r.data.listing || r.data)._id;
}

// This spec depends on the seeded production population (seller1..6 /
// buyer1..6). The in-memory server seeds a different, smaller account set, so
// running it there can only fail at login. It remains part of the production
// suite (`npm run test:e2e:prod`).
(IS_PROD ? test.describe : test.describe.skip)('36 · Multi-party release validation (production)', () => {
  let api;
  const T = {};
  const L = {};
  let s1Token; let s2Token; let s3Token;
  let b1Token; let b2Token; let b3Token;
  let s1Id; let s2Id;

  test.beforeAll(async () => {
    api = await makeApi();
    s1Token = await loginAs(api, 'seller1@trenddrop.test');
    s2Token = await loginAs(api, 'seller2@trenddrop.test');
    s3Token = await loginAs(api, 'seller3@trenddrop.test');
    b1Token = await loginAs(api, 'buyer1@trenddrop.test');
    b2Token = await loginAs(api, 'buyer2@trenddrop.test');
    b3Token = await loginAs(api, 'buyer3@trenddrop.test');

    for (const [key, token] of [['s1', s1Token], ['s2', s2Token], ['s3', s3Token], ['b1', b1Token], ['b2', b2Token], ['b3', b3Token]]) {
      const me = await api.req('get', '/api/users/me', { token });
      expect(me.status, JSON.stringify(me.data)).toBe(200);
      T[key] = String((me.data.user || me.data)._id || (me.data.user || me.data).id);
    }
    s1Id = T.s1; s2Id = T.s2;
  });

  test.afterAll(async () => { await api.dispose(); });

  test('three sellers publish listings for the release run', async () => {
    L.a = await createListing(api, s1Token, 'S1', 'item-A', 35);
    L.b = await createListing(api, s1Token, 'S1', 'item-B-offer', 45);
    L.c = await createListing(api, s2Token, 'S2', 'item-C', 50);
    L.d = await createListing(api, s3Token, 'S3', 'item-D-social', 60);
    L.last = await createListing(api, s1Token, 'S1', 'last-unit', 25);
    L.offer = await createListing(api, s2Token, 'S2', 'offer-item', 55);
    expect(new Set(Object.values(L)).size).toBe(6);
  });

  test('buyer1 checks out items from seller1 AND seller2 in one payment', async () => {
    const ci = await api.req('post', '/api/payments/create-intent', {
      token: b1Token,
      body: { items: [{ listingId: L.a }, { listingId: L.c }], shippingAddress: SHIPPING },
    });
    expect(ci.status, JSON.stringify(ci.data)).toBe(200);
    await confirmWithTestCard(api, ci.data.paymentIntentId, b1Token);

    const conf = await api.req('post', '/api/payments/confirm-batch', {
      token: b1Token,
      body: {
        paymentIntentId: ci.data.paymentIntentId,
        items: [{ listingId: L.a }, { listingId: L.c }],
        shippingAddress: SHIPPING,
      },
    });
    expect(conf.status, JSON.stringify(conf.data)).toBe(201);

    const txns = conf.data.transactions || [];
    expect(txns.length, 'one transaction per seller').toBe(2);
    const sellerIds = txns.map((t) => String(t.seller?._id || t.seller));
    expect(new Set(sellerIds).size).toBe(2);
    expect(sellerIds).toContain(T.s1);
    expect(sellerIds).toContain(T.s2);
    for (const t of txns) {
      expect(t.shipping?.labelUrl || t.shipping?.trackingNumber, 'label must exist before order').toBeTruthy();
    }
    // One checkout produces one Order holding a shipment per seller.
    const orders = conf.data.orders || [];
    expect(orders.length).toBe(1);
    expect((orders[0].shipments || []).length).toBe(2);
    T.batch1 = String(txns.find((t) => String(t.seller?._id || t.seller) === T.s2)._id || txns[0].id);
    T.batchIds = txns.map((t) => String(t._id || t.id));
  });

  test('two buyers racing for the last unit: exactly one order wins', async () => {
    const intents = [];
    for (const token of [b2Token, b3Token]) {
      const ci = await api.req('post', '/api/payments/create-intent', {
        token, body: { items: [{ listingId: L.last }], shippingAddress: SHIPPING },
      });
      expect(ci.status, JSON.stringify(ci.data)).toBe(200);
      intents.push({ token, id: ci.data.paymentIntentId });
    }
    await Promise.all(intents.map((i) => confirmWithTestCard(api, i.id, i.token)));

    const results = await Promise.all(intents.map((i) => api.req('post', '/api/payments/confirm', {
      token: i.token,
      body: { paymentIntentId: i.id, listingId: L.last, shippingAddress: SHIPPING },
    })));
    const wins = results.filter((r) => [200, 201].includes(r.status));
    const losses = results.filter((r) => ![200, 201].includes(r.status));
    expect(wins.length, JSON.stringify(results.map((r) => r.status))).toBe(1);
    expect(losses.length).toBe(1);
    // 502 is the fail-closed path when the loser's label/rollback cannot
    // complete; what matters is that it never becomes a second order.
    expect([400, 409, 410, 422, 502]).toContain(losses[0].status);
    const winnerIndex = results.findIndex((r) => [200, 201].includes(r.status));
    const loserToken = intents[winnerIndex === 0 ? 1 : 0].token;
    if (loserToken) {
      const loserTxns = await api.req('get', '/api/transactions?limit=50', { token: loserToken });
      const forLast = (loserTxns.data.transactions || [])
        .filter((t) => String(t.listing?._id || t.listing) === String(L.last));
      // Fail-closed audit: the loser may have a transaction, but it must have
      // been fully compensated (refunded), never left paid/captured.
      for (const t of forLast) {
        expect(['refunded', 'cancelled_by_buyer']).toContain(t.status);
      }
    }

    const listing = await api.req('get', `/api/listings/${L.last}`);
    const body = listing.data.listing || listing.data;
    expect(body.sold === true || body.available === false || body.quantity === 0).toBeTruthy();
    T.lastWinner = wins[0].data.transaction ? String((wins[0].data.transaction)._id) : null;
  });

  test('seller2 accepts buyer2 offer, and offer state is enforced', async () => {
    const offer = await api.req('post', '/api/offers', {
      token: b2Token, body: { listingId: L.offer, amount: 30, message: `Offer ${RUN_ID}` },
    });
    expect(offer.status, JSON.stringify(offer.data)).toBe(201);
    const offerId = offer.data._id;

    const accept = await api.req('patch', `/api/offers/${offerId}/seller-accept`, {
      token: s2Token, body: {},
    });
    expect(accept.status, JSON.stringify(accept.data)).toBe(200);
    expect(accept.data.offer.status).toBe('accepted');
    expect(accept.data.offer.acceptedPrice).toBe(30);

    const again = await api.req('patch', `/api/offers/${offerId}/seller-accept`, {
      token: s2Token, body: {},
    });
    expect(again.status).toBe(400);
  });

  test('buyer3 messages seller3, seller replies, conversation is unified', async () => {
    const send = await api.req('post', '/api/messages', {
      token: b3Token, body: { listingId: L.d, sellerId: T.s3, text: `Release question ${RUN_ID}` },
    });
    expect(send.status, JSON.stringify(send.data)).toBe(201);

    const reply = await api.req('post', '/api/messages', {
      token: s3Token, body: { listingId: L.d, sellerId: T.b3, text: `Release answer ${RUN_ID}` },
    });
    // 201 for a new thread, 200 when the thread already exists.
    expect([200, 201], JSON.stringify(reply.data)).toContain(reply.status);

    const conv = await api.req('get', `/api/messages/conversation/${T.b3}`, { token: s3Token });
    expect(conv.status).toBe(200);
    const msgs = conv.data.messages || conv.data;
    expect(Array.isArray(msgs) ? msgs.length : 0).toBeGreaterThanOrEqual(2);

    const rows = await api.req('get', '/api/messages/conversations', { token: s3Token });
    expect(rows.status).toBe(200);
    expect(rows.data.filter((c) => String(c.otherUser?._id || c.otherUser) === T.b3).length).toBe(1);
  });

  test('buyer3 wishlists and follows seller3', async () => {
    const wish = await api.req('post', '/api/wishlist', { token: b3Token, body: { listingId: L.d } });
    expect([200, 201]).toContain(wish.status);
    const check = await api.req('get', `/api/wishlist/check/${L.d}`, { token: b3Token });
    expect([200, 201]).toContain(check.status);

    // Follow is a TOGGLE. Only call it when not already following so reruns
    // against the same accounts do not unfollow and fail the assertion.
    const before = await api.req('get', `/api/users/${T.b3}`);
    const beforeUser = before.data.user || before.data;
    const alreadyFollowing = (beforeUser.following || []).map((u) => String(u._id || u)).includes(T.s3);
    if (!alreadyFollowing) {
      const follow = await api.req('post', `/api/users/${T.s3}/follow`, { token: b3Token });
      expect([200, 201]).toContain(follow.status);
    }
    // /api/users/me omits the following list; the public profile serializes it.
    const profile = await api.req('get', `/api/users/${T.b3}`);
    expect(profile.status).toBe(200);
    const user = profile.data.user || profile.data;
    expect((user.following || []).map((u) => String(u._id || u))).toContain(T.s3);
  });

  test('buyer1 cannot read buyer2 transaction (cross-account isolation)', async () => {
    const offerTxn = await api.req('get', '/api/transactions?limit=50', { token: b2Token });
    expect(offerTxn.status).toBe(200);
    const list = offerTxn.data.transactions || [];
    if (list.length === 0) return; // no purchase by buyer2 in this run
    const foreign = String(list[0]._id || list[0].id);
    const r = await api.req('get', `/api/transactions/${foreign}`, { token: b1Token });
    expect([403, 404]).toContain(r.status);
  });

  test('cancelling seller2 leg refunds that order and voids only its label', async () => {
    const cancel = await api.req('post', `/api/orders/${T.batch1}/cancel`, {
      token: b1Token, body: { reason: `Release cancellation ${RUN_ID}` },
    });
    expect(cancel.status, JSON.stringify(cancel.data)).toBe(200);
    expect(cancel.data.refundType).toBe('full');
    expect(cancel.data.refundAmount).toBeGreaterThan(0);

    const txn = await api.req('get', `/api/transactions/${T.batch1}`, { token: b1Token });
    const t = txn.data.transaction || txn.data;
    expect(t.status).toBe('cancelled_by_buyer');
    expect(t.shipping?.voided).toBe(true);
    expect(t.shipping?.labelRefunded !== false).toBeTruthy();

    const label = await api.req('get', `/api/shipping/label/${T.batch1}`, { token: s2Token });
    expect(label.status).toBe(410);
  });
});
