/**
 * TDD Round 34 — confirm-batch UNKNOWN-INTENT release (defense-in-depth for
 * the /cart "payment confirmed, order placement failed" incident).
 *
 * E2E proved the /cart checkout contract end-to-end (spec 34). The server
 * half of the incident response: when confirm-batch rejects an order, the
 * buyer's authorization must NEVER stay reserved. Two distinct rejection
 * classes:
 *
 *   R34.1  KNOWN intent (mock/Stripe registry, requires_capture) — already
 *          covered by R32.2/R32.3: releaseAuthOnFailure cancels it.
 *   R34.2  UNKNOWN intent (registry miss). retrievePaymentIntent's mock mode
 *          FABRICATES `{ status:'succeeded', amount:0 }` for unknown ids, so
 *          the VALID_STATUSES gate passes and the flow walks straight into
 *          Phase 2/3 with no real authorization behind it. When a later step
 *          throws, the catch block calls releaseAuthorization — but a mock
 *          'succeeded' intent is not a hold, so nothing is released and
 *          nothing errors: the failure surfaces as a generic 500. The route
 *          must treat an unknown intent as a terminal 400 (never a 500), so
 *          clients get a deterministic recovery contract and no fabricated
 *          order state can ever be committed.
 *
 * R34.3 re-pins the R32 terminal-rejection release (regression guard for the
 * contract the client's cancel-payment recovery path depends on).
 */
const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

const app = require('../server.js');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Transaction = require('../models/Transaction');
const Payout = require('../models/Payout');
const Order = require('../models/Order');

const SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';
const tokenFor = (id) => jwt.sign({ id }, SECRET, { expiresIn: '30d' });

const SHIPPING = {
  fullName: 'R34 Buyer', street1: '7 Round34 Rd', city: 'Austin',
  state: 'TX', postalCode: '78701', country: 'US', phone: '+15555550134',
};

let seller, buyer, sellerToken, buyerToken;
const cleanup = { userIds: [], listingIds: [] };
const mockIntents = [];

beforeAll(async () => {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/trend-drop-test');
  }
  const seed = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const mk = (name, tag) => User.create({
    name, email: `r34_${tag}_${seed}@test.com`, password: 'password123',
    emailVerified: true, country: 'US', currency: 'USD', authProvider: 'email',
    shippingAddress: { ...SHIPPING, fullName: name },
    balance: { available: 0, pending: 0, totalEarned: 0, totalPaidOut: 0, currency: 'USD' },
  });
  seller = await mk('R34 Seller', 'seller');
  buyer = await mk('R34 Buyer', 'buyer');
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
  await Listing.deleteMany({ _id: { $in: cleanup.listingIds } });
  await User.deleteMany({ _id: { $in: cleanup.userIds } });
});

const makeListing = async (price, quantity = 5, title = 'R34 Item') => {
  const l = await Listing.create({
    seller: seller._id, title, description: 'r34', price, category: 'Men',
    condition: 'New with tags', quantity, quantitySold: 0, available: true,
    sold: false, status: 'active', shipsFrom: 'US', currency: 'USD', weight: 1,
  });
  cleanup.listingIds.push(l._id);
  return l;
};

const confirmBatch = (paymentIntentId, items) =>
  request(app).post('/api/payments/confirm-batch')
    .set('Authorization', 'Bearer ' + buyerToken)
    .send({ paymentIntentId, items, shippingAddress: SHIPPING });

describe('R34 — confirm-batch release semantics (no stranded authorizations)', () => {
  test('R34.1 a KNOWN terminal-rejected authorization is released (R32 regression guard)', async () => {
    const listing = await makeListing(60, 5, 'R34 Known Intent');
    // Authorize ONE unit via the real card flow, then ask for TWO — terminal.
    const ci = await request(app).post('/api/payments/create-intent')
      .set('Authorization', 'Bearer ' + buyerToken)
      .send({ items: [{ listingId: String(listing._id), quantity: 1 }], shippingAddress: SHIPPING });
    expect(ci.status).toBe(200);
    mockIntents.push(ci.body.paymentIntentId);

    const auth = await request(app).post('/api/payments/test-confirm')
      .set('Authorization', 'Bearer ' + buyerToken)
      .send({ paymentIntentId: ci.body.paymentIntentId });
    expect(auth.status).toBe(200);

    const res = await confirmBatch(ci.body.paymentIntentId, [{ listingId: String(listing._id), quantity: 2 }]);
    expect(res.status).toBe(400);

    // The hold must be handed back, not left reserved on the card.
    const intent = global.__mockPaymentIntents[ci.body.paymentIntentId];
    expect(intent?.status).toBe('canceled');
    expect((await Transaction.find({ listing: listing._id })).length).toBe(0);
  });

  test('R34.2 an UNKNOWN payment intent is a terminal 400, never a fabricated order or a 500', async () => {
    const listing = await makeListing(45, 5, 'R34 Unknown Intent');
    const ghostId = `pi_r34_never_authorized_${Date.now()}`;
    expect(global.__mockPaymentIntents?.[ghostId]).toBeUndefined();

    // retrievePaymentIntent mock mode fabricates status:'succeeded' for this
    // unknown id — the route must NOT treat that as a real authorization.
    const res = await confirmBatch(ghostId, [{ listingId: String(listing._id), quantity: 1 }]);

    // DETERMINISTIC CONTRACT: 400 (client error), never a 500 and never 201.
    expect([400, 403]).toContain(res.status);
    expect(res.status).not.toBe(500);

    // Nothing was committed off the fabricated intent.
    expect((await Transaction.find({ listing: listing._id })).length).toBe(0);
    expect((await Payout.find({ listing: listing._id })).length).toBe(0);
    expect((await Order.find({ 'items.listing': listing._id })).length).toBe(0);

    // The listing is still buyable (no phantom inventory decrement).
    const after = await Listing.findById(listing._id).lean();
    expect(after.available).toBe(true);
    expect(after.sold).toBe(false);
    expect(after.quantity).toBe(5);
  });
});
