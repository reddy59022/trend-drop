/**
 * TDD Round 35 — AMOUNT PARITY AT THE CAPTURE BOUNDARY.
 *
 * The defect: create-intent authorizes `Σ line totals − promo/bundle discounts`,
 * but confirm-batch asked Stripe to capture the UNDISCOUNTED planned total.
 * Stripe rejects an amount_to_capture ABOVE the authorized amount
 * (invalid_request_error / amount_too_large), so a promo-discounted checkout
 * failed at the capture step — money authorized, no order — the exact
 * "payment confirmed, order placing failed" symptom. Every existing suite
 * stayed green only because the mock capture silently clamped the request to
 * the authorized amount (Math.min), hiding the over-request from the tests.
 *
 * These tests pin the invariant at the payments boundary:
 *     amount captured  <=  amount authorized at create-intent
 * for a promo-discounted cart, a plain cart, and a trimmed (partial) cart.
 *
 * RED before the fix: the promo case fails — the mock now rejects the
 * over-capture exactly as Stripe does, so confirm-batch 500s instead of 201.
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
  fullName: 'R35 Buyer', street1: '9 Capture Rd', city: 'Austin',
  state: 'TX', postalCode: '78701', country: 'US', phone: '+15555550135',
};

let seller, buyer, sellerToken, buyerToken;
const cleanup = { userIds: [], listingIds: [], promoIds: [] };
const mockIntents = [];

beforeAll(async () => {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/trend-drop-test');
  }
  const seed = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const mk = (name, tag) => User.create({
    name, email: `r35_${tag}_${seed}@test.com`, password: 'password123',
    emailVerified: true, country: 'US', currency: 'USD', authProvider: 'email',
    shippingAddress: { ...SHIPPING, fullName: name },
    balance: { available: 0, pending: 0, totalEarned: 0, totalPaidOut: 0, currency: 'USD' },
  });
  seller = await mk('R35 Seller', 'seller');
  buyer = await mk('R35 Buyer', 'buyer');
  cleanup.userIds.push(seller._id, buyer._id);
  sellerToken = tokenFor(seller._id);
  buyerToken = tokenFor(buyer._id);
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

const makeListing = async (price, quantity = 5, title = 'R35 Item') => {
  const l = await Listing.create({
    seller: seller._id, title, description: 'r35', price, category: 'Men',
    condition: 'New with tags', quantity, quantitySold: 0, available: true,
    sold: false, status: 'active', shipsFrom: 'US', currency: 'USD', weight: 1,
  });
  cleanup.listingIds.push(l._id);
  return l;
};

const makePromo = async (body) => {
  const r = await request(app).post('/api/promos')
    .set('Authorization', 'Bearer ' + sellerToken).send(body);
  if (r.status !== 201) throw new Error(`promo create failed: ${r.status} ${JSON.stringify(r.body)}`);
  cleanup.promoIds.push(r.body._id);
  return r.body;
};

const createIntent = (items, promoCode = null) =>
  request(app).post('/api/payments/create-intent')
    .set('Authorization', 'Bearer ' + buyerToken)
    .send({ items, shippingAddress: SHIPPING, buyerCountry: 'US', promoCode });

/** Card authorization (manual capture) — the real browser path. */
const authorize = async (paymentIntentId) => {
  const r = await request(app).post('/api/payments/test-confirm')
    .set('Authorization', 'Bearer ' + buyerToken).send({ paymentIntentId });
  mockIntents.push(paymentIntentId);
  return r;
};

const confirmBatch = (paymentIntentId, items) =>
  request(app).post('/api/payments/confirm-batch')
    .set('Authorization', 'Bearer ' + buyerToken)
    .send({ paymentIntentId, items, shippingAddress: SHIPPING });

/** Authorization state recorded by the mock (Stripe: amount / amount_captured). */
const intentState = (paymentIntentId) => global.__mockPaymentIntents[paymentIntentId];

describe('R35 — capture never exceeds the authorized amount', () => {
  test('R35.1 a promo-discounted cart captures EXACTLY the authorized amount', async () => {
    const promo = await makePromo({
      code: `R35PROMO${Date.now() % 100000}`, discountType: 'percentage',
      discountValue: 10, usageLimit: 5, isActive: true,
    });
    const listing = await makeListing(80, 3, 'R35 Promo Item');

    const ci = await createIntent([{ listingId: String(listing._id), quantity: 1 }], promo.code);
    expect(ci.status).toBe(200);
    const authorized = intentState(ci.body.paymentIntentId).amount;
    expect(authorized).toBeGreaterThan(0);
    // create-intent already subtracted the discount from the authorization.
    const lineTotal = ROUND(ci.body.breakdowns[0].buyer.totalPaid);
    expect(ROUND(authorized / 100)).toBe(ROUND(lineTotal - ROUND(80 * 0.10)));

    expect((await authorize(ci.body.paymentIntentId)).status).toBe(200);

    // THE BUG: capturing the undiscounted planned total exceeded the hold and
    // Stripe rejects it — order placement then fails with money authorized.
    const res = await confirmBatch(ci.body.paymentIntentId, [{ listingId: String(listing._id), quantity: 1 }]);
    if (res.status !== 201) throw new Error(`confirm-batch failed: ${res.status} ${JSON.stringify(res.body)}`);

    const state = intentState(ci.body.paymentIntentId);
    expect(state.amount_captured).toBeLessThanOrEqual(state.amount); // THE INVARIANT
    expect(state.amount_captured).toBe(state.amount);                // exact, no drift

    // The transaction and the order agree with what was captured.
    const txn = await Transaction.findOne({ listing: listing._id }).lean();
    expect(txn).toBeTruthy();
    const charged = ROUND(txn.paymentBreakdown.totalPaid);
    expect(ROUND(state.amount_captured / 100)).toBe(ROUND(charged));
    expect(ROUND(res.body.orders[0].totals.total)).toBe(ROUND(charged));
  });

  test('R35.2 a plain (undiscounted) cart captures EXACTLY the authorized amount', async () => {
    const listing = await makeListing(60, 3, 'R35 Plain Item');
    const ci = await createIntent([{ listingId: String(listing._id), quantity: 1 }]);
    expect(ci.status).toBe(200);
    const authorized = intentState(ci.body.paymentIntentId).amount;

    expect((await authorize(ci.body.paymentIntentId)).status).toBe(200);
    const res = await confirmBatch(ci.body.paymentIntentId, [{ listingId: String(listing._id), quantity: 1 }]);
    if (res.status !== 201) throw new Error(`confirm-batch failed: ${res.status} ${JSON.stringify(res.body)}`);

    const state = intentState(ci.body.paymentIntentId);
    expect(state.amount_captured).toBeLessThanOrEqual(state.amount);
    expect(state.amount_captured).toBe(state.amount);
    expect(state.amount_captured).toBe(authorized);
  });

  test('R35.3 a trimmed promo cart is NEVER over-captured (partial capture stays under the hold)', async () => {
    const promo = await makePromo({
      code: `R35TRIM${Date.now() % 100000}`, discountType: 'fixed',
      discountValue: 5, usageLimit: 5, isActive: true,
    });
    const listing = await makeListing(70, 5, 'R35 Trim Item');

    // Authorize 2 units with the promo...
    const ci = await createIntent([{ listingId: String(listing._id), quantity: 2 }], promo.code);
    expect(ci.status).toBe(200);
    const authorized = intentState(ci.body.paymentIntentId).amount;
    expect((await authorize(ci.body.paymentIntentId)).status).toBe(200);

    // ...then confirm a single unit (cart trimmed).
    const res = await confirmBatch(ci.body.paymentIntentId, [{ listingId: String(listing._id), quantity: 1 }]);
    if (res.status !== 201) throw new Error(`confirm-batch failed: ${res.status} ${JSON.stringify(res.body)}`);

    const state = intentState(ci.body.paymentIntentId);
    expect(state.amount_captured).toBeLessThanOrEqual(state.amount);
    expect(state.amount_captured).toBeLessThan(state.amount); // partial capture
    expect(state.amount_captured).toBeGreaterThan(0);

    // Only one unit left the seller's stock.
    const after = await Listing.findById(listing._id).lean();
    expect(after.quantity).toBe(4);
  });

  test('R35.4 a price change after authorization keeps the discount and stays under the hold', async () => {
    const promo = await makePromo({
      code: `R35DROP${Date.now() % 100000}`, discountType: 'fixed',
      discountValue: 10, usageLimit: 5, isActive: true,
    });
    const listing = await makeListing(80, 3, 'R35 Price Drop Item');

    const ci = await createIntent([{ listingId: String(listing._id), quantity: 1 }], promo.code);
    expect(ci.status).toBe(200);
    const authorized = intentState(ci.body.paymentIntentId).amount;
    expect((await authorize(ci.body.paymentIntentId)).status).toBe(200);

    // The seller drops the price between authorization and fulfilment: the
    // capture must follow the RECOMPUTED order total (still discounted), not
    // the stale authorization and not the undiscounted plan.
    const upd = await request(app).put(`/api/listings/${listing._id}`)
      .set('Authorization', 'Bearer ' + sellerToken).send({ price: 20 });
    if (upd.status !== 200) throw new Error(`price update failed: ${upd.status} ${JSON.stringify(upd.body)}`);

    const res = await confirmBatch(ci.body.paymentIntentId, [{ listingId: String(listing._id), quantity: 1 }]);
    if (res.status !== 201) throw new Error(`confirm-batch failed: ${res.status} ${JSON.stringify(res.body)}`);

    const state = intentState(ci.body.paymentIntentId);
    expect(state.amount_captured).toBeLessThanOrEqual(state.amount);
    expect(state.amount_captured).toBeLessThan(authorized); // recomputed, lower total

    const txn = await Transaction.findOne({ listing: listing._id }).lean();
    const expected = ROUND(txn.paymentBreakdown.totalPaid);
    expect(ROUND(state.amount_captured / 100)).toBe(expected);
    expect(ROUND(res.body.orders[0].totals.total)).toBe(expected);
  });

  test('R35.5 the payment double enforces the provider rule (over-capture is rejected, not clamped)', async () => {
    // Pins the test-double fidelity that makes R35.1 fail honestly: a request
    // above the authorization must throw the way Stripe does, never be
    // silently clamped to the authorized amount.
    const listing = await makeListing(50, 2, 'R35 Fidelity Item');
    const ci = await createIntent([{ listingId: String(listing._id), quantity: 1 }]);
    expect(ci.status).toBe(200);
    const pi = ci.body.paymentIntentId;
    mockIntents.push(pi);
    const authorized = intentState(pi).amount;

    await expect(capturePaymentIntent(pi, authorized + 1)).rejects.toMatchObject({ code: 'amount_too_large' });
    // The rejected request must not have moved any money.
    expect(intentState(pi).amount_captured).toBeUndefined();

    // The exact authorized amount (and anything below it) still captures.
    const ok = await capturePaymentIntent(pi, authorized);
    expect(ok.status).toBe('succeeded');
    expect(intentState(pi).amount_captured).toBe(authorized);
  });

  test('R35.6 a BUNDLE-discounted cart captures EXACTLY the authorized amount', async () => {
    // The same defect reaches the bundle leg: batchMetaDiscount carries
    // promoDiscount + bundleDiscount, and create-intent subtracts both from
    // the authorization, so the capture must be discounted the same way.
    const rule = await request(app).post('/api/offers/bundle')
      .set('Authorization', 'Bearer ' + sellerToken)
      .send({ name: `R35 bundle ${Date.now() % 100000}`, minQuantity: 2, discountPercent: 10 });
    if (rule.status !== 201) throw new Error(`bundle rule create failed: ${rule.status} ${JSON.stringify(rule.body)}`);

    const l1 = await makeListing(40, 2, 'R35 Bundle Item 1');
    const l2 = await makeListing(60, 2, 'R35 Bundle Item 2');
    const items = [{ listingId: String(l1._id), quantity: 1 }, { listingId: String(l2._id), quantity: 1 }];

    const ci = await createIntent(items);
    expect(ci.status).toBe(200);
    expect(ci.body.bundleDiscount).toBeGreaterThan(0); // the discount was applied
    const authorized = intentState(ci.body.paymentIntentId).amount;
    expect((await authorize(ci.body.paymentIntentId)).status).toBe(200);

    const res = await confirmBatch(ci.body.paymentIntentId, items);
    if (res.status !== 201) throw new Error(`confirm-batch failed: ${res.status} ${JSON.stringify(res.body)}`);

    const state = intentState(ci.body.paymentIntentId);
    expect(state.amount_captured).toBeLessThanOrEqual(state.amount); // THE INVARIANT
    expect(state.amount_captured).toBe(state.amount);                // exact, no drift
    expect(ROUND(res.body.orders[0].totals.discounts)).toBe(ROUND(ci.body.bundleDiscount));
  });

  test('R35.8 multi-seller discounts stay with their owning sellers', async () => {
    const sellerB = await User.create({
      name: 'R35 Seller B', email: `r35_seller_b_${Date.now()}@test.com`, password: 'password123',
      emailVerified: true, country: 'US', currency: 'USD', authProvider: 'email',
      shippingAddress: { ...SHIPPING, fullName: 'R35 Seller B' },
      balance: { available: 0, pending: 0, totalEarned: 0, totalPaidOut: 0, currency: 'USD' },
    });
    cleanup.userIds.push(sellerB._id);
    const sellerBToken = tokenFor(sellerB._id);
    const listingA = await makeListing(80, 2, 'R35 Seller A Promo Item');
    const listingB = await Listing.create({
      seller: sellerB._id, title: 'R35 Seller B Bundle Item', description: 'r35', price: 50,
      category: 'Men', condition: 'New with tags', quantity: 3, quantitySold: 0,
      available: true, sold: false, status: 'active', shipsFrom: 'US', currency: 'USD', weight: 1,
    });
    cleanup.listingIds.push(listingB._id);

    const promo = await makePromo({
      code: `R35OWNER${Date.now() % 100000}`, discountType: 'percentage',
      discountValue: 10, usageLimit: 5, isActive: true,
    });
    const bundle = await request(app).post('/api/offers/bundle')
      .set('Authorization', 'Bearer ' + sellerBToken)
      .send({ name: `R35 owner bundle ${Date.now() % 100000}`, minQuantity: 2, discountPercent: 10 });
    expect(bundle.status).toBe(201);

    const items = [
      { listingId: String(listingA._id), quantity: 1 },
      { listingId: String(listingB._id), quantity: 2 },
    ];
    const ci = await createIntent(items, promo.code);
    expect(ci.status).toBe(200);
    await authorize(ci.body.paymentIntentId);
    const res = await confirmBatch(ci.body.paymentIntentId, items);
    expect(res.status).toBe(201);

    const txns = await Transaction.find({ 'paymentBreakdown.paymentIntentId': ci.body.paymentIntentId }).lean();
    expect(txns).toHaveLength(2);
    const a = txns.find((t) => String(t.seller) === String(seller._id));
    const b = txns.find((t) => String(t.seller) === String(sellerB._id));
    expect(a.paymentBreakdown.discountAmount).toBe(8); // seller A's 10% promo
    expect(b.paymentBreakdown.discountAmount).toBe(10); // seller B's 10% bundle
    expect(a.paymentBreakdown.originalSubtotal).toBe(80);
    expect(b.paymentBreakdown.originalSubtotal).toBe(100);
    expect(a.paymentBreakdown.sellerEarnings).toBe(66.24); // (80 - 8) - 8%
    expect(b.paymentBreakdown.sellerEarnings).toBe(82.80); // (100 - 10) - 8%

    const order = res.body.orders[0];
    expect(order.totals.discounts).toBe(18);
    expect(order.totals.total).toBe(ROUND(a.paymentBreakdown.totalPaid + b.paymentBreakdown.totalPaid));
  });

  test('R35.9 seller-funded discounts reconcile the captured amount, payout, and ledger', async () => {
    const promo = await makePromo({
      code: `R35LEDGER${Date.now() % 100000}`, discountType: 'percentage',
      discountValue: 10, usageLimit: 5, isActive: true,
    });
    const listing = await makeListing(80, 2, 'R35 Discount Ledger Item');
    const ci = await createIntent([{ listingId: String(listing._id), quantity: 1 }], promo.code);
    expect(ci.status).toBe(200);
    const discount = ROUND(80 * 0.10);
    const originalLineTotal = ROUND(ci.body.breakdowns[0].buyer.totalPaid);
    const authorized = intentState(ci.body.paymentIntentId).amount;
    expect(ROUND(authorized / 100)).toBe(ROUND(originalLineTotal - discount));
    await authorize(ci.body.paymentIntentId);

    const res = await confirmBatch(ci.body.paymentIntentId, [{ listingId: String(listing._id), quantity: 1 }]);
    expect(res.status).toBe(201);

    const txn = await Transaction.findOne({ listing: listing._id }).lean();
    const payout = await Payout.findOne({ transaction: txn._id }).lean();
    const order = res.body.orders[0];
    const discountedSubtotal = ROUND(80 - discount);
    const expectedFee = ROUND(discountedSubtotal * 0.08);
    const expectedSellerNet = ROUND(discountedSubtotal - expectedFee);

    // The captured amount and buyer-visible transaction must agree.
    expect(ROUND(txn.paymentBreakdown.totalPaid)).toBe(ROUND(originalLineTotal - discount));
    expect(txn.paymentBreakdown.discountAmount).toBe(discount);
    expect(txn.paymentBreakdown.subtotal).toBe(discountedSubtotal);
    expect(ROUND(txn.paymentBreakdown.platformFee)).toBe(expectedFee);
    expect(ROUND(txn.paymentBreakdown.sellerEarnings)).toBe(expectedSellerNet);
    expect(payout.payoutAmount).toBe(expectedSellerNet);
    expect(ROUND(order.totals.total)).toBe(ROUND(authorized / 100));
    expect(intentState(ci.body.paymentIntentId).amount_captured).toBe(authorized);
  });

  test('R35.7 a discount larger than the recomputed total never captures the whole hold', async () => {
    // Boundary of the fix: when a price change makes the discounted total
    // non-positive, a capture request of ≤ 0 is not a real partial capture —
    // passing it through would fall back to capturing the ENTIRE authorization
    // and the buyer would be charged the old hold for a near-free order.
    const promo = await makePromo({
      code: `R35BIG${Date.now() % 100000}`, discountType: 'fixed',
      discountValue: 40, usageLimit: 5, isActive: true,
    });
    const listing = await makeListing(80, 2, 'R35 Big Discount Item');

    const ci = await createIntent([{ listingId: String(listing._id), quantity: 1 }], promo.code);
    expect(ci.status).toBe(200);
    const authorized = intentState(ci.body.paymentIntentId).amount;
    expect((await authorize(ci.body.paymentIntentId)).status).toBe(200);

    // Seller drops the price to the $5 minimum: the stale $40 promo now
    // exceeds the recomputed order total.
    const upd = await request(app).put(`/api/listings/${listing._id}`)
      .set('Authorization', 'Bearer ' + sellerToken).send({ price: 5 });
    if (upd.status !== 200) throw new Error(`price update failed: ${upd.status} ${JSON.stringify(upd.body)}`);

    const res = await confirmBatch(ci.body.paymentIntentId, [{ listingId: String(listing._id), quantity: 1 }]);
    if (res.status !== 201) throw new Error(`confirm-batch failed: ${res.status} ${JSON.stringify(res.body)}`);

    const txn = await Transaction.findOne({ listing: listing._id }).lean();
    const recomputedCents = Math.round(ROUND(txn.paymentBreakdown.totalPaid) * 100);
    expect(recomputedCents).toBeLessThan(authorized); // the plan really shrank

    const state = intentState(ci.body.paymentIntentId);
    // Never the whole hold, and never more than the recomputed plan.
    expect(state.amount_captured).toBeLessThanOrEqual(Math.min(recomputedCents, authorized));
    // The floor is the recomputed plan total (the discount cannot drive a
    // charge below zero; Stripe cannot capture 0 at all).
    expect(state.amount_captured).toBe(recomputedCents);
  });
});
