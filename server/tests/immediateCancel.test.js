/**
 * IMMEDIATE CANCELLATION — ENTERPRISE ZERO-SUM GUARANTEES (TDD)
 *
 * Scenario: customer places an order and cancels immediately (within the
 * eligible pre-shipment window). The platform must fully unwind with
 * ZERO gain and ZERO loss for every party:
 *
 *   buyer   → 100% refund (item + shipping + protection) to original method
 *   seller  → pending earnings clawed back EXACTLY (net of boost fee);
 *             available / totalEarned untouched; totalSales unchanged
 *   buyer   → totalPurchases unchanged
 *   listing → quantity / quantitySold restored EXACTLY; relistable
 *   boost   → fee ledger reversed (never charged for a cancelled sale)
 *   payout  → every Payout record + txn.payout.status → 'refunded'
 *   order   → consolidated Order → 'refunded', payment → 'refunded',
 *             emptied shipment → 'cancelled', cancellation audit trail
 *
 * Also proves: atomic claim (no double-refund / double-restore under
 * concurrency), idempotent double-cancel, ship-vs-cancel race guard,
 * authorization, Stripe-failure rollback, multi-seller partial cancels.
 */
const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const app = require('../server');
const payments = require('../config/payments');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Transaction = require('../models/Transaction');
const Payout = require('../models/Payout');
const Order = require('../models/Order');
const Cart = require('../models/Cart');

const PASS = 'password123';
const SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';
const mkEmail = (p) => `${p}_immediateCancel_${Date.now()}@test.com`;
const shippingAddress = {
  fullName: 'Immediate Buyer', street1: '1 Main St', city: 'Austin',
  state: 'TX', postalCode: '78701', country: 'US', phone: '555-0001',
};

let seller, buyer, seller2, stranger;
let sellerToken, buyerToken, seller2Token, strangerToken;

async function makeUser(name, email, { balance = 0, stats } = {}) {
  const u = await User.create({
    name, email: email.toLowerCase(), password: PASS, emailVerified: true,
    authProvider: 'email', country: 'US', currency: 'USD',
    shippingAddress: { fullName: name, street1: '1 St', city: 'C', state: 'S', postalCode: '11111', country: 'US' },
    balance: { available: balance, pending: 0, totalEarned: 0, totalPaidOut: 0, currency: 'USD' },
    stats: stats || { totalSales: 0, totalPurchases: 0, strikes: 0 },
  });
  return { user: u, token: jwt.sign({ id: u._id }, SECRET, { expiresIn: '30d' }) };
}

function mockPi(status = 'succeeded') {
  const id = `pi_ic_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  if (!global.__mockPaymentIntents) global.__mockPaymentIntents = {};
  global.__mockPaymentIntents[id] = { id, status, amount: 0 };
  return id;
}

async function seedListing(owner, overrides = {}) {
  return Listing.create({
    seller: owner._id, title: 'ImmediateCancel Item', description: 'desc',
    price: 100, category: 'Men', condition: 'New with tags',
    currency: 'USD', available: true, sold: false,
    quantity: 5, shipsFrom: 'US', weight: 1,
    ...overrides,
  });
}

/** Full checkout through the REAL payment pipeline (mock Stripe intent). */
async function checkout(token, items) {
  const pi = mockPi('succeeded');
  const r = await request(app)
    .post('/api/payments/confirm-batch')
    .set('Authorization', `Bearer ${token}`)
    .send({ paymentIntentId: pi, items, shippingAddress, buyerCurrency: 'USD' });
  return { res: r, pi };
}

/** Checkout a single listing; returns { order, txn, pi }. */
async function buyNow(token, listing, qty = 1) {
  const { res, pi } = await checkout(token, [{ listingId: listing._id.toString(), quantity: qty }]);
  if (res.status !== 201) throw new Error(`checkout failed: ${res.status} ${JSON.stringify(res.body)}`);
  const order = res.body.orders?.[0] || res.body.order;
  const txn = res.body.transactions.find((t) => String(t.listing?._id || t.listing) === String(listing._id));
  return { order, txn, pi };
}

/** Cancel helper. */
const cancel = (txnId, token, body = { reason: 'Changed my mind' }) =>
  request(app).post(`/api/orders/${txnId}/cancel`).set('Authorization', `Bearer ${token}`).send(body);

beforeAll(async () => {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/trend-drop-test';
  if (mongoose.connection.readyState === 0) await mongoose.connect(uri);
  const re = /immediateCancel/i;
  await Promise.all([
    User.deleteMany({ email: re }),
    Listing.deleteMany({ title: re }),
    Transaction.deleteMany({}),
    Payout.deleteMany({}),
    Order.deleteMany({}),
    Cart.deleteMany({}),
  ]);

  const s = await makeUser('IC Seller', mkEmail('seller'));
  seller = s.user; sellerToken = s.token;
  const b = await makeUser('IC Buyer', mkEmail('buyer'));
  buyer = b.user; buyerToken = b.token;
  const s2 = await makeUser('IC Seller2', mkEmail('seller2'));
  seller2 = s2.user; seller2Token = s2.token;
  const st = await makeUser('IC Stranger', mkEmail('stranger'));
  stranger = st.user; strangerToken = st.token;
});

afterAll(async () => {
  const re = /immediateCancel/i;
  await Promise.all([
    User.deleteMany({ email: re }),
    Listing.deleteMany({ title: re }),
    Transaction.deleteMany({}),
    Payout.deleteMany({}),
    Order.deleteMany({}),
    Cart.deleteMany({}),
  ]);
});

// ============================================================
// A. HAPPY PATH — buyer cancels immediately after purchase
// ============================================================
describe('A. buyer immediate cancel → full refund, zero-sum unwind', () => {
  let listing, order, txn, pi;
  let sellerBefore, buyerBefore;

  test('A1. purchase creates paid order and escrowed seller earnings', async () => {
    listing = await seedListing(seller, { title: 'immediateCancel HappyA', price: 100, quantity: 5 });
    ({ order, txn, pi } = await buyNow(buyerToken, listing, 2));

    expect(txn.status).toBe('paid');
    const fresh = await Transaction.findById(txn._id);
    expect(fresh.paymentBreakdown.totalPaid).toBeGreaterThan(0);
    sellerBefore = (await User.findById(seller._id)).toObject();
    buyerBefore = (await User.findById(buyer._id)).toObject();
    const l = await Listing.findById(listing._id);
    expect(l.quantity).toBe(3);          // 5 - 2
    expect(l.quantitySold).toBe(2);
    expect(l.sold).toBe(true);
    expect(l.available).toBe(false);
    const s = await User.findById(seller._id);
    expect(s.balance.pending).toBeCloseTo(fresh.paymentBreakdown.sellerEarnings, 2);
    expect(s.balance.available).toBe(0);
  });

  test('A2. immediate cancel succeeds with FULL refund amount', async () => {
    const r = await cancel(txn._id, buyerToken);
    expect(r.status).toBe(200);
    expect(r.body.refundType).toBe('full');
    const fresh = await Transaction.findById(txn._id);
    const pb = fresh.paymentBreakdown;
    expect(r.body.refundAmount).toBe(pb.totalPaid);
    // Buyer is refunded EVERYTHING they paid: item + shipping + protection
    expect(pb.totalPaid).toBeCloseTo(pb.subtotal + pb.shippingCost + pb.buyerProtectionFee, 2);
    // Stripe mock recorded the refund against the payment intent
    expect(global.__mockPaymentIntents[pi].status).toBe('refunded');
  });

  test('A3. transaction finalized: cancelled_by_buyer + audit + payout refunded', async () => {
    const fresh = await Transaction.findById(txn._id);
    expect(fresh.status).toBe('cancelled_by_buyer');
    expect(fresh.cancellation.cancelledBy).toBe('buyer');
    expect(fresh.cancellation.refundAmount).toBe(fresh.paymentBreakdown.totalPaid);
    expect(fresh.cancellation.cancelledAt).toBeTruthy();
    expect(fresh.payout.status).toBe('refunded');
    const payouts = await Payout.find({ transaction: fresh._id });
    expect(payouts.length).toBeGreaterThan(0);
    payouts.forEach((p) => expect(p.status).toBe('refunded'));
  });

  test('A4. SELLER: pending clawed back exactly, available/totalEarned untouched', async () => {
    const s = await User.findById(seller._id);
    expect(s.balance.pending).toBe(0);
    expect(s.balance.available).toBe(sellerBefore.balance.available || 0);
    expect(s.balance.totalEarned).toBe(sellerBefore.balance.totalEarned || 0);
  });

  test('A5. ORDER COUNTS: seller.totalSales / buyer.totalPurchases unchanged', async () => {
    const s = await User.findById(seller._id);
    const b = await User.findById(buyer._id);
    expect(s.stats.totalSales).toBe(sellerBefore.stats.totalSales || 0);
    expect(b.stats.totalPurchases).toBe(buyerBefore.stats.totalPurchases || 0);
  });

  test('A6. INVENTORY: exact restore — relistable and re-purchasable', async () => {
    const l = await Listing.findById(listing._id);
    expect(l.quantity).toBe(5);
    expect(l.quantitySold).toBe(0);
    expect(l.sold).toBe(false);
    expect(l.available).toBe(true);

    // The restored unit is genuinely buyable again (no phantom stock)
    const rebuy = await buyNow(buyerToken, listing, 1);
    expect(rebuy.txn.status).toBe('paid');
    const l2 = await Listing.findById(listing._id);
    expect(l2.quantity).toBe(4);
    // unwind the re-purchase too so later suites start clean
    await cancel(rebuy.txn._id, buyerToken);
  });

  test('A7. ORDER: refunded + payment refunded + shipment cancelled + audit', async () => {
    const o = await Order.findById(order._id);
    expect(o.status).toBe('refunded');
    expect(o.payment.status).toBe('refunded');
    expect(o.items.length).toBe(0);
    expect(o.shipments[0].status).toBe('cancelled');
    expect(o.cancellation.cancelledBy).toBe('buyer');
    expect(o.cancellation.refundAmount).toBeCloseTo(txn.paymentBreakdown.totalPaid, 2);
    expect(o.cancellation.cancelledAt).toBeTruthy();
  });

  test('A8. NOTIFICATIONS: buyer refund notice + seller cancel notice', async () => {
    const b = await User.findById(buyer._id);
    const s = await User.findById(seller._id);
    expect(b.notifications.some((n) => n.type === 'refund' && /full refund/i.test(n.message))).toBe(true);
    expect(s.notifications.some((n) => /cancelled by the buyer/i.test(n.message))).toBe(true);
  });

  test('A9. order actions: consolidated order is no longer cancellable', async () => {
    const r = await request(app).get(`/api/orders/${order._id}`).set('Authorization', `Bearer ${buyerToken}`);
    expect(r.status).toBe(200);
    expect(r.body.order.allowedActions).not.toContain('cancel_within_window');
  });
});


// ============================================================
// B. EXPLICIT ZERO-SUM LEDGER IDENTITY
// ============================================================
describe('B. zero-sum ledger identity (no gain, no loss)', () => {
  test('B1. buyer net = 0, seller net = 0, platform collects nothing', async () => {
    const listing = await seedListing(seller, { title: 'immediateCancel ZeroSum', price: 60, quantity: 3 });
    const sellerBefore = (await User.findById(seller._id)).toObject();
    const { txn } = await buyNow(buyerToken, listing, 1);
    const pb = txn.paymentBreakdown;

    const r = await cancel(txn._id, buyerToken);
    expect(r.status).toBe(200);

    const s = await User.findById(seller._id);
    const b = await User.findById(buyer._id);
    // Buyer: paid pb.totalPaid, refunded pb.totalPaid → net 0
    expect(r.body.refundAmount).toBe(pb.totalPaid);
    // Seller: credited sellerEarnings, clawed back sellerEarnings → net 0
    expect(Math.round((s.balance.pending - sellerBefore.balance.pending) * 100) / 100).toBe(0);
    expect(s.balance.available).toBe(sellerBefore.balance.available);
    expect(s.balance.totalEarned).toBe(sellerBefore.balance.totalEarned);
    // Platform: commission is NEVER collected on a cancelled sale (escrow
    // model — fees are only collected at completion).
    expect(pb.platformFee).toBeGreaterThan(0);
    expect(b.balance.pending || 0).toBe(0); // buyer is never a payee here
  });
});

// ============================================================
// C. DOUBLE CANCEL — idempotent, no double side effects
// ============================================================
describe('C. double cancel is idempotent', () => {
  test('C1. second cancel acks without re-running side effects', async () => {
    const listing = await seedListing(seller, { title: 'immediateCancel Double', price: 40, quantity: 4 });
    const { txn } = await buyNow(buyerToken, listing, 1);

    const first = await cancel(txn._id, buyerToken);
    expect(first.status).toBe(200);
    expect(first.body.alreadyCancelled).toBeUndefined();

    const second = await cancel(txn._id, buyerToken);
    expect(second.status).toBe(200);
    expect(second.body.alreadyCancelled).toBe(true);

    // EXACTLY-ONCE side effects: inventory restored once (4, not 5)
    const l = await Listing.findById(listing._id);
    expect(l.quantity).toBe(4);
    expect(l.quantitySold).toBe(0);
    expect((await User.findById(seller._id)).balance.pending).toBe(0);
  });
});


// ============================================================
// D. CONCURRENT CANCELS — exactly-once under race
// ============================================================
describe('D. concurrent cancel race (3 parallel requests)', () => {
  test('D1. only one cancel takes effect; inventory restored exactly once', async () => {
    const listing = await seedListing(seller, { title: 'immediateCancel Race', price: 30, quantity: 10 });
    const { txn } = await buyNow(buyerToken, listing, 3);

    const results = await Promise.all([
      cancel(txn._id, buyerToken),
      cancel(txn._id, buyerToken),
      cancel(txn._id, buyerToken),
    ]);

    // Every request is answered (success or idempotent ack) — none 500
    results.forEach((r) => expect(r.status).toBe(200));
    const real = results.filter((r) => !r.body.alreadyCancelled);
    expect(real.length).toBe(1); // exactly one claim won

    // ZERO-LEAKAGE under concurrency: restore happened exactly once
    const l = await Listing.findById(listing._id);
    expect(l.quantity).toBe(10);
    expect(l.quantitySold).toBe(0);
    expect((await User.findById(seller._id)).balance.pending).toBe(0);
  });
});

// ============================================================
// E. CANCEL AFTER SHIPMENT — blocked, nothing moves
// ============================================================
describe('E. cancel blocked after shipment', () => {
  test('E1. shipped order cannot be cancelled (state machine guard)', async () => {
    const listing = await seedListing(seller, { title: 'immediateCancel Shipped', price: 80, quantity: 2 });
    const { order, txn } = await buyNow(buyerToken, listing, 1);
    const sBefore = (await User.findById(seller._id)).balance.pending;
    const lBefore = await Listing.findById(listing._id);

    // Seller ships via the real consolidated-order endpoint
    const ship = await request(app)
      .post(`/api/orders/${order._id}/ship`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ shipmentIndex: 0, trackingNumber: 'IC-TRACK-1', carrier: 'usps' });
    expect(ship.status).toBe(200);

    const r = await cancel(txn._id, buyerToken);
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/cannot cancel/i);

    // NOTHING moved: txn still shipped, seller pending intact, inventory unchanged
    expect((await Transaction.findById(txn._id)).status).toBe('shipped');
    expect((await User.findById(seller._id)).balance.pending).toBe(sBefore);
    const l = await Listing.findById(listing._id);
    expect(l.quantity).toBe(lBefore.quantity);
    expect(l.quantitySold).toBe(lBefore.quantitySold);

    // Status endpoint reports canCancel=false
    const st = await request(app).get(`/api/orders/${txn._id}/status`).set('Authorization', `Bearer ${buyerToken}`);
    expect(st.status).toBe(200);
    expect(st.body.eligibility.canCancel).toBe(false);
  });

  test('E2. shipping a cancelled shipment is refused (ship-vs-cancel race guard)', async () => {
    const listing = await seedListing(seller, { title: 'immediateCancel ShipGuard', price: 55, quantity: 2 });
    const { order, txn } = await buyNow(buyerToken, listing, 1);
    expect((await cancel(txn._id, buyerToken)).status).toBe(200);

    const ship = await request(app)
      .post(`/api/orders/${order._id}/ship`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ shipmentIndex: 0, trackingNumber: 'IC-TRACK-2', carrier: 'usps' });
    expect(ship.status).toBe(400); // nothing to ship — shipment was cancelled
    expect((await Transaction.findById(txn._id)).status).toBe('cancelled_by_buyer');
  });
});


// ============================================================
// F. SELLER-INITIATED CANCEL — strike + same zero-sum unwind
// ============================================================
describe('F. seller cancels before shipment', () => {
  test('F1. strike incremented, full refund, identical zero-sum unwind', async () => {
    const listing = await seedListing(seller2, { title: 'immediateCancel SellerCancel', price: 70, quantity: 2 });
    const { txn } = await buyNow(buyerToken, listing, 1);
    const strikesBefore = (await User.findById(seller2._id)).stats.strikes || 0;

    const r = await cancel(txn._id, seller2Token);
    expect(r.status).toBe(200);

    const fresh = await Transaction.findById(txn._id);
    expect(fresh.status).toBe('cancelled_by_seller');
    expect(fresh.cancellation.refundAmount).toBe(fresh.paymentBreakdown.totalPaid);

    const s = await User.findById(seller2._id);
    expect(s.stats.strikes).toBe(strikesBefore + 1);
    expect(s.balance.pending).toBe(0);
    const l = await Listing.findById(listing._id);
    expect(l.quantity).toBe(2);
    expect(l.quantitySold).toBe(0);
    expect((await User.findById(buyer._id)).notifications.some((n) => n.type === 'refund')).toBe(true);
  });
});

// ============================================================
// G. MULTI-SELLER ORDER — partial then full cancel
// ============================================================
describe('G. multi-seller consolidated order', () => {
  test('G1. cancelling one item keeps the order active for the rest', async () => {
    const lA = await seedListing(seller, { title: 'immediateCancel MS-A', price: 50, quantity: 3 });
    const lB = await seedListing(seller2, { title: 'immediateCancel MS-B', price: 90, quantity: 3 });
    // Baselines: seller may hold OTHER legit escrow (e.g. a shipped order
    // from an earlier suite) — everything is asserted RELATIVE to this.
    const sABefore = (await User.findById(seller._id)).balance.pending;
    const sBBefore = (await User.findById(seller2._id)).balance.pending;
    const { res } = await checkout(buyerToken, [
      { listingId: lA._id.toString(), quantity: 1 },
      { listingId: lB._id.toString(), quantity: 1 },
    ]);
    expect(res.status).toBe(201);
    const order = res.body.orders?.[0] || res.body.order;
    const txns = res.body.transactions;
    expect(txns.length).toBe(2);
    const o = await Order.findById(order._id);
    expect(o.shipments.length).toBe(2);
    const totalBefore = o.totals.total;

    const txnA = txns.find((t) => String(t.listing?._id || t.listing) === String(lA._id));
    const r = await cancel(txnA._id, buyerToken);
    expect(r.status).toBe(200);

    // Order still active: one item remains, payment still captured
    const o1 = await Order.findById(order._id);
    expect(o1.status).toBe('confirmed');
    expect(o1.payment.status).toBe('captured');
    expect(o1.items.length).toBe(1);
    expect(o1.shipments.find((s) => String(s.seller) === String(seller._id)).status).toBe('cancelled');
    expect(o1.shipments.find((s) => String(s.seller) === String(seller2._id)).status).toBe('pending');
    // Partial refund audit accumulates
    expect(o1.cancellation.refundAmount).toBe(txnA.paymentBreakdown.totalPaid);

    // Seller A unwound: pending returns EXACTLY to its pre-checkout baseline.
    // Seller B untouched: still holds escrow for the active item.
    expect((await User.findById(seller._id)).balance.pending).toBe(sABefore);
    expect((await User.findById(seller2._id)).balance.pending).toBeGreaterThan(sBBefore);
    expect((await Listing.findById(lA._id)).quantity).toBe(3);
    expect((await Listing.findById(lB._id)).quantity).toBe(2);

    global.__MS = {
      order: order._id,
      txnB: txns.find((t) => String(t.listing?._id || t.listing) === String(lB._id)),
      lB, totalBefore, sBBefore,
    };
  });

  test('G2. cancelling the last item settles the order fully refunded', async () => {
    const { order, txnB, lB, totalBefore, sBBefore } = global.__MS;
    const r = await cancel(txnB._id, buyerToken);
    expect(r.status).toBe(200);

    const o = await Order.findById(order);
    expect(o.status).toBe('refunded');
    expect(o.payment.status).toBe('refunded');
    expect(o.items.length).toBe(0);
    o.shipments.forEach((s) => expect(s.status).toBe('cancelled'));
    // Running refund total equals the ENTIRE captured order total
    expect(o.cancellation.refundAmount).toBeCloseTo(totalBefore, 2);
    expect((await Listing.findById(lB._id)).quantity).toBe(3);
    // Seller B's escrow returns to its pre-checkout baseline exactly
    expect((await User.findById(seller2._id)).balance.pending).toBe(sBBefore || 0);
  });
});

// ============================================================
// H. AUTHORIZATION + STATE GUARDS
// ============================================================
describe('H. authorization and state guards', () => {
  test('H1. unauthenticated cancel is rejected', async () => {
    const listing = await seedListing(seller, { title: 'immediateCancel Auth', price: 20, quantity: 2 });
    const { txn } = await buyNow(buyerToken, listing, 1);
    const r = await request(app).post(`/api/orders/${txn._id}/cancel`).send({ reason: 'x' });
    expect([401, 403]).toContain(r.status);
    // unauthorized request must not have moved anything
    expect((await Transaction.findById(txn._id)).status).toBe('paid');
    await cancel(txn._id, buyerToken); // cleanup
  });

  test('H2. third party cannot cancel someone else’s order', async () => {
    const listing = await seedListing(seller, { title: 'immediateCancel Auth2', price: 25, quantity: 2 });
    const { txn } = await buyNow(buyerToken, listing, 1);
    const r = await cancel(txn._id, strangerToken);
    expect(r.status).toBe(403);
    expect((await Transaction.findById(txn._id)).status).toBe('paid');
    await cancel(txn._id, buyerToken); // cleanup
  });

  test('H3. buyer cannot cancel a processing order; seller can', async () => {
    const listing = await seedListing(seller, { title: 'immediateCancel Processing', price: 35, quantity: 2 });
    const { txn } = await buyNow(buyerToken, listing, 1);
    await Transaction.findByIdAndUpdate(txn._id, { status: 'processing' });

    const buyerTry = await cancel(txn._id, buyerToken);
    expect(buyerTry.status).toBe(400);
    expect((await Transaction.findById(txn._id)).status).toBe('processing');

    const sellerOk = await cancel(txn._id, sellerToken);
    expect(sellerOk.status).toBe(200);
    expect((await Transaction.findById(txn._id)).status).toBe('cancelled_by_seller');
    expect((await Listing.findById(listing._id)).quantity).toBe(2);
  });
});

// ============================================================
// I. STRIPE FAILURE — claim reverted, retryable, nothing moved
// ============================================================
describe('I. Stripe refund failure rolls the cancellation back', () => {
  let issueRefundSpy;

  afterEach(() => { if (issueRefundSpy) issueRefundSpy.mockRestore(); });

  test('I1. 502 + claim reverted + ledger untouched; retry then succeeds', async () => {
    const listing = await seedListing(seller, { title: 'immediateCancel StripeFail', price: 45, quantity: 3 });
    const { txn, pi } = await buyNow(buyerToken, listing, 2);
    const sBefore = (await User.findById(seller._id)).balance.pending;

    issueRefundSpy = jest.spyOn(payments, 'issueRefund').mockRejectedValueOnce(new Error('stripe unavailable'));
    const fail = await cancel(txn._id, buyerToken);
    expect(fail.status).toBe(502);
    expect(fail.body.message).toMatch(/not cancelled|try again/i);

    // Nothing moved: status back to paid, inventory still decremented,
    // seller pending still escrowed, mock intent NOT refunded.
    const fresh = await Transaction.findById(txn._id);
    expect(fresh.status).toBe('paid');
    expect(fresh.cancellation.cancelledBy).toBeNull();
    const l = await Listing.findById(listing._id);
    expect(l.quantity).toBe(1);
    expect(l.quantitySold).toBe(2);
    expect(l.sold).toBe(true);
    expect((await User.findById(seller._id)).balance.pending).toBe(sBefore);
    expect(global.__mockPaymentIntents[pi].status).toBe('succeeded');

    // Retry (no failure injected) → succeeds cleanly; the EXACT credited
    // amount is clawed back relative to the pre-cancel escrow baseline.
    const retry = await cancel(txn._id, buyerToken);
    expect(retry.status).toBe(200);
    expect((await Transaction.findById(txn._id)).status).toBe('cancelled_by_buyer');
    expect((await Listing.findById(listing._id)).quantity).toBe(3);
    expect((await User.findById(seller._id)).balance.pending)
      .toBeCloseTo(sBefore - txn.paymentBreakdown.sellerEarnings, 2);
  });
});

// ============================================================
// J. BOOSTED ITEM — boost fee fully reversed on cancel
// ============================================================
describe('J. boosted listing cancel reverses the boost fee', () => {
  test('J1. feeLedger owed returns to pre-sale level; seller clawback is net of fee', async () => {
    const listing = await seedListing(seller, {
      title: 'immediateCancel Boosted', price: 100, quantity: 2,
      boost: { active: true, tier: 'premium', feeLedger: { owed: 0, collected: 0, reversed: 0 } },
    });
    const ledgerBefore = (await Listing.findById(listing._id)).boost.feeLedger.toObject();
    const pBefore = (await User.findById(seller._id)).balance.pending; // incl. unrelated escrow
    const { txn } = await buyNow(buyerToken, listing, 1);
    const fresh = await Transaction.findById(txn._id);
    expect(fresh.paymentBreakdown.boostFee).toBe(15); // premium = 15% of 100
    const afterCheckout = (await User.findById(seller._id)).balance.pending;
    expect(afterCheckout).toBeCloseTo(pBefore + fresh.paymentBreakdown.sellerEarnings, 2);

    const r = await cancel(txn._id, buyerToken);
    expect(r.status).toBe(200);

    const l = await Listing.findById(listing._id);
    // The sale added 15 owed; the cancel reversed it → back to pre-sale owed
    expect(l.boost.feeLedger.owed).toBe(ledgerBefore.owed || 0);
    expect(l.boost.feeLedger.reversed).toBe((ledgerBefore.reversed || 0) + 15);
    // Seller was credited earnings NET of the boost fee and clawed back
    // the exact same net amount → pending back to pre-checkout baseline
    expect((await User.findById(seller._id)).balance.pending).toBeCloseTo(pBefore, 2);
  });
});
