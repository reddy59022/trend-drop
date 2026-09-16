const mongoose = require('mongoose');
const request = require('supertest');
const app = require('../server');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Cart = require('../models/Cart');
const Offer = require('../models/Offer');
const Transaction = require('../models/Transaction');
const jwt = require('jsonwebtoken');

/**
 * TDD Round 26 — Cart checkout must verify the AUTHORIZED PAYMENT AMOUNT.
 *
 * BUG: POST /api/cart/checkout checks the intent's existence, status,
 * single-use and buyer/item BINDING (verifyIntentBinding), but — unlike
 * buy-now (transactions.js), offers (transactions.js) and confirm-batch
 * (payments.js) — never calls verifyIntentAmount. Binding metadata carries
 * only itemIds, NOT quantities. So a buyer can:
 *   1. add 1 unit to the cart,
 *   2. create+confirm an intent authorizing exactly ONE unit's total,
 *   3. raise the cart line to qty 4,
 *   4. checkout — the gate passes and the seller is credited 4x earnings
 *      (plus shipping/protection for 4 units) that were NEVER authorized:
 *      the platform funds the difference (revenue leak, the exact class
 *      verifyIntentAmount was written to stop in the other money paths).
 *
 * Contract asserted here (mirrors verifyIntentAmount's authoritative-only
 * semantics: check fires only for intents with a real amount + binding):
 *   - under-authorized cart checkout => 400, zero side effects
 *   - properly-authorized cart checkout => 200, correct seller earnings
 */
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';

const US_ADDRESS = {
  fullName: 'Cart Parity Buyer', street1: '10 Parity Way', city: 'Austin',
  state: 'TX', postalCode: '78701', country: 'US', phone: '+15555550100',
};

let seller;
let buyer;
let sellerToken;
let buyerToken;

const mkUser = (name, email) => User.create({
  name, email, password: 'password123',
  country: 'US', currency: 'USD', emailVerified: true, authProvider: 'email',
  shippingAddress: { ...US_ADDRESS, fullName: name },
  balance: { available: 0, pending: 0, totalEarned: 0, totalPaidOut: 0, currency: 'USD' },
});

const mkListing = (title, price, quantity) => Listing.create({
  seller: seller._id, title, description: 'parity fixture', price,
  category: 'Men', condition: 'New with tags', quantity,
  available: true, sold: false, status: 'active', shipsFrom: 'US',
  currency: 'USD', weight: 0.5,
});

// Each test gets a FRESH seller+buyer so suites (and jest retryTimes) never
// observe state leaked from a sibling test's checkout.
const seedActor = async (tag) => {
  const run = `cartparity_${Date.now()}_${tag}_${Math.random().toString(36).slice(2, 7)}`;
  seller = await mkUser(`Parity Seller ${tag}`, `${run}_seller@test.com`);
  buyer = await mkUser(`Parity Buyer ${tag}`, `${run}_buyer@test.com`);
  sellerToken = jwt.sign({ id: seller._id }, JWT_SECRET, { expiresIn: '30d' });
  buyerToken = jwt.sign({ id: buyer._id }, JWT_SECRET, { expiresIn: '30d' });
};

beforeAll(async () => {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/trenddrop_test');
  }
});

afterAll(async () => {
  if (seller) await User.findByIdAndDelete(seller._id);
  if (buyer) await User.findByIdAndDelete(buyer._id);
  await Listing.deleteMany({});
  await Cart.deleteMany({});
  await Transaction.deleteMany({});
  await mongoose.connection.close();
});

const addToCart = (listingId, quantity) =>
  request(app)
    .post('/api/cart/items')
    .set('Authorization', `Bearer ${buyerToken}`)
    .send({ listingId, quantity });

const createIntent = (listingId, quantity, negotiatedPrice) =>
  request(app)
    .post('/api/payments/create-intent')
    .set('Authorization', `Bearer ${buyerToken}`)
    .send({
      items: [{
        listingId,
        ...(quantity ? { quantity } : {}),
        ...(negotiatedPrice != null ? { negotiatedPrice } : {}),
      }],
      shippingAddress: US_ADDRESS,
    });

// An accepted offer is the ONLY thing that may legitimately lower the charge.
const acceptOffer = (listing, price) => Offer.create({
  listing: listing._id,
  buyer: buyer._id,
  seller: seller._id,
  amount: price,
  status: 'accepted',
  acceptedPrice: price,
  acceptedAt: new Date(),
  acceptedUntil: new Date(Date.now() + 24 * 3600 * 1000),
  acceptedBy: 'seller',
  currency: 'USD',
});

const confirmIntent = (paymentIntentId) =>
  request(app)
    .post('/api/payments/test-confirm')
    .set('Authorization', `Bearer ${buyerToken}`)
    .send({ paymentIntentId });

const checkoutCart = (paymentIntentId) =>
  request(app)
    .post('/api/cart/checkout')
    .set('Authorization', `Bearer ${buyerToken}`)
    .send({ paymentIntentId, shippingAddress: US_ADDRESS });

// This jest major doesn't support expect()'s second (message) argument, so
// status assertions carry context via a helper that throws on mismatch.
const expectStatus = (res, status, label = 'request') => {
  if (res.status !== status) {
    throw new Error(`${label}: expected HTTP ${status}, got ${res.status} — body=${JSON.stringify(res.body)}`);
  }
  expect(res.status).toBe(status);
};

describe('TDD R26 — cart checkout payment-amount parity', () => {
  test('under-authorized intent (1 unit authed, 4 units in cart) is REJECTED with no side effects', async () => {
    await seedActor('attack');
    const listing = await mkListing('Parity Attack Item', 50, 10);

    // 1. Cart line = 1 unit.
    expect((await addToCart(listing._id, 1)).status).toBe(200);

    // 2. Authorize + confirm exactly ONE unit's total.
    const ci = await createIntent(listing._id);
    expectStatus(ci, 200, 'create-intent');
    expect(ci.body.paymentIntentId).toMatch(/^pi_/);
    const storedIntent = global.__mockPaymentIntents[ci.body.paymentIntentId];
    expect(Number(storedIntent?.amount) || 0).toBeGreaterThan(0);
    const confirm = await confirmIntent(ci.body.paymentIntentId);
    expectStatus(confirm, 200, 'test-confirm');

    // 3. Raise the cart line to 4 units (binding metadata only knows itemIds).
    expect((await addToCart(listing._id, 4)).status).toBe(200);

    // 4. Checkout must refuse: the authorization covers 1 unit, not 4.
    const res = await checkoutCart(ci.body.paymentIntentId);
    expectStatus(res, 400, 'BUG: under-authorized checkout accepted');

    // Zero side effects anywhere.
    const after = await Listing.findById(listing._id);
    expect(after.quantity).toBe(10);
    expect(after.sold).toBe(false);
    expect(after.available).toBe(true);

    const sellerAfter = await User.findById(seller._id);
    expect(sellerAfter.balance.pending || 0).toBe(0);

    const txns = await Transaction.find({ listing: listing._id });
    expect(txns.length).toBe(0);

    const cartAfter = await Cart.findOne({ user: buyer._id, status: 'active' });
    expect(cartAfter).toBeTruthy();
  });

  test('matching authorization (created AFTER the qty change) still completes checkout', async () => {
    await seedActor('happy');
    const listing = await mkListing('Parity Happy Item', 50, 10);

    // Cart line = 4 units BEFORE the intent is created; the client prices the
    // intent for exactly what the cart will charge (4 units).
    expect((await addToCart(listing._id, 4)).status).toBe(200);

    const ci = await createIntent(listing._id, 4);
    expectStatus(ci, 200, 'create-intent');
    const confirm = await confirmIntent(ci.body.paymentIntentId);
    expectStatus(confirm, 200, 'test-confirm');

    const res = await checkoutCart(ci.body.paymentIntentId);
    expectStatus(res, 200, 'checkout');

    // 4 units consumed, seller credited exactly the recorded earnings.
    const after = await Listing.findById(listing._id);
    expect(after.quantity).toBe(6);
    expect(after.sold).toBe(false);
    expect(after.quantitySold || 0).toBe(4);

    const txn = await Transaction.findOne({ listing: listing._id });
    expect(txn).toBeTruthy();
    expect(txn.quantity).toBe(4);

    // Retry-proof: the seller's pending balance must equal the earnings the
    // platform actually RECORDED for them (sum, not a hardcoded figure).
    const sellerTxns = await Transaction.find({ seller: seller._id });
    const recordedEarnings = sellerTxns
      .reduce((sum, t) => sum + (t.paymentBreakdown?.sellerEarnings || 0), 0);
    const sellerAfter = await User.findById(seller._id);
    expect(Math.round((sellerAfter.balance.pending || 0) * 100) / 100)
      .toBe(Math.round(recordedEarnings * 100) / 100);
    expect(txn.paymentBreakdown.sellerEarnings).toBeGreaterThan(0);
  });

  // ============================================================
  // NEGOTIATED LINES (accepted offers). The client's Cart page sends
  // `negotiatedPrice` to create-intent (client/src/pages/Cart.js
  // buildItemsPayload), which resolves the accepted offer server-side and
  // authorizes the OFFER total. cart/checkout, however, priced every line at
  // `listing.price` and never looked at offers — so the authorization
  // (offer price) and the recorded money (list price) disagreed in BOTH
  // directions:
  //   * buyer authorized the offer total -> seller was credited list-price
  //     earnings the platform never collected,
  //   * with the new amount gate the same cart would be rejected forever
  //     ("start a new payment" re-created the same offer-priced intent), i.e.
  //     negotiated purchases could never complete.
  // The two tests below pin the correct contract: the price basis is chosen
  // from the AUTHORIZATION, server-side, and whichever basis the buyer paid
  // for is the one recorded.
  // ============================================================
  test('accepted offer: an offer-priced authorization completes checkout and records the OFFER price', async () => {
    await seedActor('offer');
    const listing = await mkListing('Parity Offer Item', 100, 5);
    await acceptOffer(listing, 60); // buyer and seller agreed on $60

    expect((await addToCart(listing._id, 1)).status).toBe(200);

    // Negotiated client payload: create-intent authorizes the OFFER total.
    const ci = await createIntent(listing._id, 1, 60);
    expectStatus(ci, 200, 'create-intent (negotiated)');
    const authorized = Number(global.__mockPaymentIntents[ci.body.paymentIntentId].amount) / 100;
    expect(authorized).toBeGreaterThan(0);
    expect(authorized).toBeLessThan(100); // really the offer price, not list
    const confirm = await confirmIntent(ci.body.paymentIntentId);
    expectStatus(confirm, 200, 'test-confirm');

    const res = await checkoutCart(ci.body.paymentIntentId);
    expectStatus(res, 200, 'BUG: negotiated checkout did not complete');

    const txn = await Transaction.findOne({ listing: listing._id });
    expect(txn).toBeTruthy();
    // Recorded money must match what was AUTHORIZED (the offer price).
    expect(txn.itemPrice).toBe(60);
    expect(Math.abs(txn.paymentBreakdown.totalPaid - authorized)).toBeLessThan(0.011);
    expect(txn.paymentBreakdown.sellerEarnings).toBeLessThan(60);

    const sellerAfter = await User.findById(seller._id);
    expect(Math.round((sellerAfter.balance.pending || 0) * 100) / 100)
      .toBe(Math.round(txn.paymentBreakdown.sellerEarnings * 100) / 100);
  });

  test('accepted offer present but buyer authorized LIST price: list price is what gets recorded', async () => {
    await seedActor('listprice');
    const listing = await mkListing('Parity List Price Item', 100, 5);
    await acceptOffer(listing, 60);

    expect((await addToCart(listing._id, 1)).status).toBe(200);

    // No negotiatedPrice sent -> the buyer chose to pay list price.
    const ci = await createIntent(listing._id);
    expectStatus(ci, 200, 'create-intent (list)');
    const confirm = await confirmIntent(ci.body.paymentIntentId);
    expectStatus(confirm, 200, 'test-confirm');

    const res = await checkoutCart(ci.body.paymentIntentId);
    expectStatus(res, 200, 'checkout');

    // Never silently downgrade a list-price purchase to the offer price
    // (that would under-credit the seller and capture less than authorized).
    const txn = await Transaction.findOne({ listing: listing._id });
    expect(txn).toBeTruthy();
    expect(txn.itemPrice).toBe(100);
  });

  test('negotiated line cannot be quantity-inflated (offer authorization covers 1 unit, cart has 3)', async () => {
    await seedActor('offerqty');
    const listing = await mkListing('Parity Offer Qty Item', 100, 10);
    await acceptOffer(listing, 60);

    expect((await addToCart(listing._id, 1)).status).toBe(200);
    const ci = await createIntent(listing._id, 1, 60); // authorizes ONE unit at $60
    expectStatus(ci, 200, 'create-intent (negotiated)');
    const confirm = await confirmIntent(ci.body.paymentIntentId);
    expectStatus(confirm, 200, 'test-confirm');

    // Inflate the line AFTER authorization — neither basis may cover it.
    expect((await addToCart(listing._id, 3)).status).toBe(200);

    const res = await checkoutCart(ci.body.paymentIntentId);
    expectStatus(res, 400, 'BUG: offer-priced quantity inflation accepted');

    const after = await Listing.findById(listing._id);
    expect(after.quantity).toBe(10);
    const txns = await Transaction.find({ listing: listing._id });
    expect(txns.length).toBe(0);
    const sellerAfter = await User.findById(seller._id);
    expect(sellerAfter.balance.pending || 0).toBe(0);
  });
});
