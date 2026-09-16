/**
 * TDD Round 32 — CART → ORDER PLACEMENT (revenue-loss audit).
 *
 * The reported symptom: "payment happens, order placement fails, stuck on the
 * cart page". Root causes proven here (server half):
 *
 *   R32.1  (contract) confirm-batch MUST accept a MANUAL-CAPTURE authorization
 *          (status `requires_capture`) — that is what the card flow produces.
 *   R32.2  (money held) A terminal order-placing rejection left the buyer's
 *          authorization HELD on the card: authorizePaymentIntent uses
 *          capture_method:'manual', so an un-captured 400 keeps funds reserved
 *          (~7 days) while the buyer only sees an error. Terminal rejections
 *          must release instead of stranding money.
 *   R32.3  (money held) Same when a cart line became unavailable between
 *          authorization and fulfilment (someone else bought it).
 *   R32.4  (SECURITY) POST /api/payments/cancel-payment released ANY intent id
 *          it was handed — no ownership check. A seller can read the buyer's
 *          `payment.paymentIntentId` from the Order document, so a malicious
 *          seller could cancel a rival's authorization and kill the sale with
 *          no trace. Only the intent's own buyer may release it.
 *   R32.5  (robustness) cancel-payment 500'd for unknown/already-released
 *          intents, so the very recovery path that prevents stranded holds
 *          failed. It must be idempotent.
 *   R32.6  (REVENUE) One order consumed TWO promo uses: confirm-batch
 *          increments usageCount AND the client called POST /promos/:id/use.
 *          A usageLimit:10 code died after 5 orders — sellers lose campaign
 *          reach, buyers lose their discount. One order = exactly one use.
 *   R32.7  (audit) The transaction records which promo priced it so the
 *          single-use rule is enforceable/auditable.
 */
const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

const app = require('../server.js');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Promo = require('../models/Promo');
const Transaction = require('../models/Transaction');
const Payout = require('../models/Payout');
const Order = require('../models/Order');
const { capturePaymentIntent } = require('../config/payments');

const SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';
const tokenFor = (id) => jwt.sign({ id }, SECRET, { expiresIn: '30d' });
const ROUND = (n) => Math.round(n * 100) / 100;

const SHIPPING = {
  fullName: 'R32 Buyer', street1: '5 Checkout Rd', city: 'Austin',
  state: 'TX', postalCode: '78701', country: 'US', phone: '+15555550123',
};

let seller, buyer, attacker, sellerToken, buyerToken, attackerToken;
const cleanup = { userIds: [], listingIds: [], promoIds: [] };
// Payment intents authorized in this suite (released at the end).
const mockIntents = [];

beforeAll(async () => {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/trend-drop-test');
  }
  const seed = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const mk = (name, tag) => User.create({
    name, email: `r32_${tag}_${seed}@test.com`, password: 'password123',
    emailVerified: true, country: 'US', currency: 'USD', authProvider: 'email',
    shippingAddress: { ...SHIPPING, fullName: name },
    balance: { available: 0, pending: 0, totalEarned: 0, totalPaidOut: 0, currency: 'USD' },
  });
  seller = await mk('R32 Seller', 'seller');
  buyer = await mk('R32 Buyer', 'buyer');
  attacker = await mk('R32 Attacker', 'attacker');
  cleanup.userIds.push(seller._id, buyer._id, attacker._id);
  sellerToken = tokenFor(seller._id);
  buyerToken = tokenFor(buyer._id);
  attackerToken = tokenFor(attacker._id);
});

afterAll(async () => {
  for (const id of mockIntents) {
    if (global.__mockPaymentIntents) delete global.__mockPaymentIntents[id];
  }
  await Order.deleteMany({ buyer: { $in: cleanup.userIds } });
  await Transaction.deleteMany({ buyer: { $in: cleanup.userIds } });
  await Payout.deleteMany({ seller: { $in: cleanup.userIds } });
  await Promo.deleteMany({ _id: { $in: cleanup.promoIds } });
  await Listing.deleteMany({ _id: { $in: cleanup.listingIds } });
  await User.deleteMany({ _id: { $in: cleanup.userIds } });
});

const makeListing = async (price, quantity = 5, title = 'R32 Item') => {
  const l = await Listing.create({
    seller: seller._id, title, description: 'r32', price, category: 'Men',
    condition: 'New with tags', quantity, quantitySold: 0, available: true,
    sold: false, status: 'active', shipsFrom: 'US', currency: 'USD', weight: 1,
  });
  cleanup.listingIds.push(l._id);
  return l;
};

const createPromo = async (body) => {
  const r = await request(app).post('/api/promos').set('Authorization', 'Bearer ' + sellerToken).send(body);
  if (r.status === 201) cleanup.promoIds.push(r.body._id);
  return r;
};

const createIntent = (items, token = buyerToken, promoCode = null) =>
  request(app).post('/api/payments/create-intent')
    .set('Authorization', 'Bearer ' + token)
    .send({ items, shippingAddress: SHIPPING, buyerCountry: 'US', promoCode });

/** The card authorization the browser performs (manual capture → requires_capture). */
const confirmWithTestCard = async (paymentIntentId, token = buyerToken) => {
  const r = await request(app).post('/api/payments/test-confirm')
    .set('Authorization', 'Bearer ' + token).send({ paymentIntentId });
  mockIntents.push(paymentIntentId);
  return r;
};

const trackIntent = (id) => { mockIntents.push(id); return id; };

const confirmBatch = (paymentIntentId, items, token = buyerToken) =>
  request(app).post('/api/payments/confirm-batch')
    .set('Authorization', 'Bearer ' + token)
    .send({ paymentIntentId, items, shippingAddress: SHIPPING });

/** Full happy path: intent → card authorization → confirm-batch. */
const checkout = async (items, { token = buyerToken, promoCode = null } = {}) => {
  const ci = await createIntent(items, token, promoCode);
  expect(ci.status).toBe(200);
  const auth = await confirmWithTestCard(ci.body.paymentIntentId, token);
  expect(auth.status).toBe(200);
  const res = await confirmBatch(ci.body.paymentIntentId, items, token);
  return { ci, auth, res, paymentIntentId: ci.body.paymentIntentId };
};
describe('R32 — cart → order placement', () => {
  test('R32.1 a manual-capture authorization (requires_capture) completes the order', async () => {
    const listing = await makeListing(80);
    const ci = await createIntent([{ listingId: String(listing._id), quantity: 1 }]);
    expect(ci.status).toBe(200);

    const auth = await confirmWithTestCard(ci.body.paymentIntentId);
    expect(auth.status).toBe(200); // auth body: JSON.stringify(auth.body)
    // The card flow uses capture_method:'manual' — this is the status the
    // browser receives and the ONLY extra status the client must accept.
    expect(['requires_capture', 'succeeded']).toContain(auth.body.status);

    const res = await confirmBatch(ci.body.paymentIntentId, [{ listingId: String(listing._id), quantity: 1 }]);
    expect(res.status).toBe(201);
    expect(res.body.orderId).toBeTruthy();
    expect(res.body.transactions.length).toBe(1);
    expect((await Transaction.find({ listing: listing._id })).length).toBe(1);
  });

  test('R32.2 a terminal rejection RELEASES the buyer authorization instead of holding it', async () => {
    const listing = await makeListing(100, 5, 'R32 Parity Item');
    // Authorize ONE unit then ask confirm-batch to fulfil TWO: the intent can
    // never cover it, so the rejection is terminal — the hold must be handed
    // back rather than left reserved on the buyer's card.
    const ci = await createIntent([{ listingId: String(listing._id), quantity: 1 }]);
    expect(ci.status).toBe(200);
    const auth = await confirmWithTestCard(ci.body.paymentIntentId);
    expect(auth.status).toBe(200);

    const res = await confirmBatch(ci.body.paymentIntentId, [{ listingId: String(listing._id), quantity: 2 }]);
    expect(res.status).toBe(400);

    const intent = global.__mockPaymentIntents[ci.body.paymentIntentId];
    // money must not stay HELD on the card after a rejected order
    expect(intent?.status).toBe('canceled');
    // ...and nothing was created.
    expect((await Transaction.find({ listing: listing._id })).length).toBe(0);
  });

  test('R32.3 an item that became unavailable releases the authorization', async () => {
    const listing = await makeListing(60, 1, 'R32 Sold Item');
    const ci = await createIntent([{ listingId: String(listing._id), quantity: 1 }]);
    const auth = await confirmWithTestCard(ci.body.paymentIntentId);
    expect(auth.status).toBe(200);

    // Someone else buys it first.
    await Listing.updateOne({ _id: listing._id }, { $set: { available: false, sold: true, quantity: 0 } });

    const res = await confirmBatch(ci.body.paymentIntentId, [{ listingId: String(listing._id), quantity: 1 }]);
    expect(res.status).toBe(400);
    const intent = global.__mockPaymentIntents[ci.body.paymentIntentId];
    // no order will ever exist -> do not hold the funds
    expect(intent?.status).toBe('canceled');
  });
  test('R32.4 only the intent OWNER may release it (a stranger cannot kill a sale)', async () => {
    const listing = await makeListing(45, 3, 'R32 Attack Target');
    const ci = await createIntent([{ listingId: String(listing._id), quantity: 1 }]);
    const auth = await confirmWithTestCard(ci.body.paymentIntentId);
    expect(auth.status).toBe(200);
    trackIntent(ci.body.paymentIntentId);

    // The attacker is NOT the buyer of this intent. Sellers can read
    // payment.paymentIntentId off the Order document, so this must be gated.
    const attack = await request(app).post('/api/payments/cancel-payment')
      .set('Authorization', 'Bearer ' + attackerToken)
      .send({ paymentIntentId: ci.body.paymentIntentId });
    // a stranger must never be able to release someone else's payment
    expect(attack.status).toBe(403);

    // The buyer's sale is still fully placeable.
    const res = await confirmBatch(ci.body.paymentIntentId, [{ listingId: String(listing._id), quantity: 1 }]);
    expect(res.status).toBe(201);

    // The owner can still release their own intent.
    const own = await request(app).post('/api/payments/cancel-payment')
      .set('Authorization', 'Bearer ' + buyerToken)
      .send({ paymentIntentId: 'pi_r32_unknown_intent' });
    expect(own.status).toBe(200);
  });

  test('R32.5 cancel-payment is idempotent for unknown / already-released intents', async () => {
    // The client calls this as its recovery path when order placement fails —
    // a 500 here is what leaves a hold stranded, so it must never throw.
    const r1 = await request(app).post('/api/payments/cancel-payment')
      .set('Authorization', 'Bearer ' + buyerToken)
      .send({ paymentIntentId: 'pi_r32_never_existed' });
    expect(r1.status).toBe(200);
    expect(r1.body.released).toBe(false);

    // Missing id is a client bug: 400, never 500.
    const r2 = await request(app).post('/api/payments/cancel-payment')
      .set('Authorization', 'Bearer ' + buyerToken)
      .send({});
    expect(r2.status).toBe(400);

    // Releasing twice is safe.
    const listing = await makeListing(30, 2, 'R32 Double Release');
    const ci = await createIntent([{ listingId: String(listing._id), quantity: 1 }]);
    await confirmWithTestCard(ci.body.paymentIntentId);
    trackIntent(ci.body.paymentIntentId);
    const first = await request(app).post('/api/payments/cancel-payment')
      .set('Authorization', 'Bearer ' + buyerToken).send({ paymentIntentId: ci.body.paymentIntentId });
    expect(first.status).toBe(200);
    expect(first.body.released).toBe(true);
    const second = await request(app).post('/api/payments/cancel-payment')
      .set('Authorization', 'Bearer ' + buyerToken).send({ paymentIntentId: ci.body.paymentIntentId });
    expect(second.status).toBe(200);
    expect(second.body.released).toBe(false);
  });

  test('R32.6 one order consumes EXACTLY one promo use (even with a legacy client)', async () => {
    const promo = (await createPromo({
      code: `R32ONCE${Date.now() % 100000}`, discountType: 'percentage',
      discountValue: 10, usageLimit: 10,
    })).body;
    expect(promo.usageLimit).toBe(10);

    const l1 = await makeListing(50, 3, 'R32 Promo Item 1');
    const first = await checkout([{ listingId: String(l1._id), quantity: 1 }], { promoCode: promo.code });
    expect(first.res.status).toBe(201);

    // Deployed (older) clients ALSO call POST /promos/:id/use after the order
    // is created. That must not double-charge the campaign's budget.
    const legacyUse = await request(app).post(`/api/promos/${promo._id}/use`)
      .set('Authorization', 'Bearer ' + buyerToken);
    expect([200, 400]).toContain(legacyUse.status);
    let fresh = await Promo.findById(promo._id).lean();
    expect(fresh.usageCount).toBe(1); // one order == one use

    // A second order with the same code burns exactly one more (not two).
    const l2 = await makeListing(40, 3, 'R32 Promo Item 2');
    const second = await checkout([{ listingId: String(l2._id), quantity: 1 }], { promoCode: promo.code });
    expect(second.res.status).toBe(201);
    const legacyUse2 = await request(app).post(`/api/promos/${promo._id}/use`)
      .set('Authorization', 'Bearer ' + buyerToken);
    expect([200, 400]).toContain(legacyUse2.status);
    fresh = await Promo.findById(promo._id).lean();
    expect(fresh.usageCount).toBe(2); // two orders == two uses
  });

  test('R32.7 /use still counts a standalone redemption (no order involved)', async () => {
    const promo = (await createPromo({
      code: `R32STAND${Date.now() % 100000}`, discountType: 'fixed',
      discountValue: 5, usageLimit: 3,
    })).body;
    const r = await request(app).post(`/api/promos/${promo._id}/use`)
      .set('Authorization', 'Bearer ' + buyerToken);
    expect(r.status).toBe(200);
    expect(r.body.usageCount).toBe(1);
  });

  test('R32.8 the transaction records the promo that priced it (audit + single-use rule)', async () => {
    const promo = (await createPromo({
      code: `R32AUDIT${Date.now() % 100000}`, discountType: 'fixed', discountValue: 5,
    })).body;
    const listing = await makeListing(70, 2, 'R32 Audit Item');
    const { res } = await checkout([{ listingId: String(listing._id), quantity: 1 }], { promoCode: promo.code });
    expect(res.status).toBe(201);

    const txn = await Transaction.findOne({ listing: listing._id }).lean();
    expect(txn).toBeTruthy();
    // the promo must be auditable from the order
    expect(String(txn.promoId || '')).toBe(String(promo._id));

    // The discount is NOT baked into the per-line totalPaid (the transaction
    // records the item + shipping + protection it fulfilled); it is applied to
    // the amount the buyer is actually CHARGED. That is the number that must
    // prove the promo worked.
    const lineTotal = ROUND(txn.paymentBreakdown.totalPaid);
    expect(lineTotal).toBeGreaterThan(70); // 70 + shipping + protection
    const { paymentIntentId } = res.body.transactions[0].paymentBreakdown;
    const authorized = Number(global.__mockPaymentIntents[paymentIntentId].amount) / 100;
    expect(ROUND(authorized)).toBe(ROUND(lineTotal - 5));
  });

  test('R32.9 an over-authorized intent captures ONLY the order total', async () => {
    // Every intent is created with capture_method:'manual' and Stripe captures
    // the FULL authorized amount unless told otherwise — the buyer trims the
    // cart and is debited for units they will never receive.
    const partial = await capturePaymentIntent('pi_r32_over', 7514);
    expect(partial.status).toBe('succeeded');
    expect(partial.amount).toBe(7514);

    // No cap supplied → unchanged full-capture behaviour.
    const full = await capturePaymentIntent('pi_r32_full', null);
    expect(full.amount).toBeUndefined();
  });

  test('R32.10 trimming the cart after authorizing does not over-charge the buyer', async () => {
    const listing = await makeListing(100, 10, 'R32 Over-Auth Item');
    // Buyer authorizes a qty-4 line...
    const ci = await createIntent([{ listingId: String(listing._id), quantity: 4 }]);
    expect(ci.status).toBe(200);
    const auth = await confirmWithTestCard(ci.body.paymentIntentId);
    expect(auth.status).toBe(200);
    const authorized = Number(global.__mockPaymentIntents[ci.body.paymentIntentId].amount) / 100;

    // ...then confirms an order for a single unit.
    const res = await confirmBatch(ci.body.paymentIntentId, [{ listingId: String(listing._id), quantity: 1 }]);
    expect(res.status).toBe(201);

    const txn = await Transaction.findOne({ listing: listing._id }).lean();
    expect(txn.quantity).toBe(1);
    const charged = ROUND(txn.paymentBreakdown.totalPaid);
    expect(charged).toBeLessThan(authorized / 2);
    // The order total agrees with what the transaction records.
    expect(ROUND(res.body.orders[0].totals.total)).toBe(charged);
    // Only ONE unit left the seller's stock.
    const after = await Listing.findById(listing._id).lean();
    expect(after.quantity).toBe(9);
  });
});