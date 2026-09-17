/**
 * TDD — Promo code integrity (limits, expiry, caps, seller scoping).
 *
 * Bugs proven here (all failed before the fix):
 *   PI.1  POST /api/promos/:id/use incremented usageCount past usageLimit —
 *         limited codes kept working forever (the client calls /use at
 *         checkout, so this is a live revenue leak).
 *   PI.2  /use accepted expired / inactive codes.
 *   PI.3  /validate returned fixed discounts (and percentages >100%) larger
 *         than the cart total → negative payable totals.
 *   PI.4  /validate honored a promo owned by seller A against seller B's
 *         items, although Promo documents are seller-scoped.
 *   PI.5  Promo creation accepted discountValue <= 0 and percentage > 100.
 */
const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

const app = require('../server.js');
const Promo = require('../models/Promo');
const Listing = require('../models/Listing');
const User = require('../models/User');

const SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';
const tokenFor = (id) => jwt.sign({ id }, SECRET, { expiresIn: '30d' });

let sellerA, sellerB, buyer, tokenA, tokenB, buyerToken;
const cleanup = { userIds: [], listingIds: [], promoIds: [] };

beforeAll(async () => {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/trend-drop-test');
  }
  const seed = Date.now();
  sellerA = await User.create({ name: 'PromoSellerA', email: `pia_${seed}@test.com`, password: 'password123', emailVerified: true, country: 'US', currency: 'USD' });
  sellerB = await User.create({ name: 'PromoSellerB', email: `pib_${seed}@test.com`, password: 'password123', emailVerified: true, country: 'US', currency: 'USD' });
  buyer = await User.create({ name: 'PromoBuyer', email: `pibuyer_${seed}@test.com`, password: 'password123', emailVerified: true, country: 'US', currency: 'USD' });
  cleanup.userIds.push(sellerA._id, sellerB._id, buyer._id);
  tokenA = tokenFor(sellerA._id);
  tokenB = tokenFor(sellerB._id);
  buyerToken = tokenFor(buyer._id);
});

afterAll(async () => {
  await Promo.deleteMany({ _id: { $in: cleanup.promoIds } });
  await Listing.deleteMany({ _id: { $in: cleanup.listingIds } });
  await User.deleteMany({ _id: { $in: cleanup.userIds } });
});

const makeListing = async (seller, price) => {
  const l = await Listing.create({
    seller: seller._id, title: 'PromoItem', description: 'd', price,
    category: 'Women', condition: 'New with tags', available: true,
    quantity: 5, shipsFrom: 'US', weight: 1,
  });
  cleanup.listingIds.push(l._id);
  return l;
};

const createPromo = async (body) => {
  const r = await request(app).post('/api/promos').set('Authorization', 'Bearer ' + tokenA).send(body);
  if (r.status === 201) cleanup.promoIds.push(r.body._id);
  return r;
};

describe('PI — promo usage enforcement', () => {
  test('PI.1 /use stops counting once usageLimit is exhausted', async () => {
    const promo = (await createPromo({ code: 'PI1LIMIT', discountType: 'fixed', discountValue: 5, usageLimit: 1 })).body;
    expect(promo.usageLimit).toBe(1);

    const first = await request(app).post(`/api/promos/${promo._id}/use`).set('Authorization', 'Bearer ' + buyerToken);
    expect(first.status).toBe(200);
    expect(first.body.usageCount).toBe(1);

    const second = await request(app).post(`/api/promos/${promo._id}/use`).set('Authorization', 'Bearer ' + buyerToken);
    expect(second.status).toBe(400);

    const fresh = await Promo.findById(promo._id).lean();
    expect(fresh.usageCount).toBe(1);
  });

  test('PI.2 /use rejects expired and inactive codes', async () => {
    const expired = (await createPromo({
      code: 'PI2EXPIRED', discountType: 'percentage', discountValue: 10,
      expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    })).body;
    const r1 = await request(app).post(`/api/promos/${expired._id}/use`).set('Authorization', 'Bearer ' + buyerToken);
    expect(r1.status).toBe(400);
    expect(r1.body.message).toMatch(/expired/i);

    const inactive = (await createPromo({ code: 'PI2OFF', discountType: 'percentage', discountValue: 10 })).body;
    await Promo.findByIdAndUpdate(inactive._id, { isActive: false });
    const r2 = await request(app).post(`/api/promos/${inactive._id}/use`).set('Authorization', 'Bearer ' + buyerToken);
    expect(r2.status).toBe(400);
    expect(r2.body.message).toMatch(/active/i);
  });
});

describe('PI — validate caps and seller scoping', () => {
  test('PI.3 discount is capped at the cart total (never negative payable)', async () => {
    const listing = await makeListing(sellerA, 40);

    const fixed = (await createPromo({ code: 'PI3FLAT100', discountType: 'fixed', discountValue: 100 })).body;
    const r1 = await request(app).post('/api/promos/validate').set('Authorization', 'Bearer ' + buyerToken)
      .send({ code: 'PI3FLAT100', items: [{ listingId: listing._id, price: 40, quantity: 1 }] });
    expect(r1.status).toBe(200);
    expect(r1.body.promo.discountAmount).toBe(40); // capped at total, NOT 100

    const pct = (await createPromo({ code: 'PI3PCT', discountType: 'percentage', discountValue: 100 })).body;
    const r2 = await request(app).post('/api/promos/validate').set('Authorization', 'Bearer ' + buyerToken)
      .send({ code: 'PI3PCT', items: [{ listingId: listing._id, price: 40, quantity: 1 }] });
    expect(r2.status).toBe(200);
    expect(r2.body.promo.discountAmount).toBe(40); // capped at total, NOT 40*100%
  });

  test('PI.4 a promo only applies to its own seller\'s items', async () => {
    const listingA = await makeListing(sellerA, 100);
    const listingB = await makeListing(sellerB, 100);
    const promo = (await createPromo({ code: 'PI4SCOPED', discountType: 'percentage', discountValue: 10 })).body;

    // Another seller's listing → the code must not apply.
    const foreign = await request(app).post('/api/promos/validate').set('Authorization', 'Bearer ' + buyerToken)
      .send({ code: 'PI4SCOPED', items: [{ listingId: listingB._id, price: 100, quantity: 1 }] });
    expect(foreign.status).toBe(400);

    // Own seller's listing → still valid (regression guard).
    const own = await request(app).post('/api/promos/validate').set('Authorization', 'Bearer ' + buyerToken)
      .send({ code: 'PI4SCOPED', items: [{ listingId: listingA._id, price: 100, quantity: 1 }] });
    expect(own.status).toBe(200);
    expect(own.body.valid).toBe(true);
    expect(own.body.promo.discountAmount).toBe(10);

    // Mixed cart → the discount applies ONLY to the promo owner's items.
    const mixed = await request(app).post('/api/promos/validate').set('Authorization', 'Bearer ' + buyerToken)
      .send({ code: 'PI4SCOPED', items: [{ listingId: listingA._id, price: 100, quantity: 1 }, { listingId: listingB._id, price: 100, quantity: 1 }] });
    expect(mixed.status).toBe(200);
    expect(mixed.body.promo.discountAmount).toBe(10); // 10% of seller A's $100 only
    expect(mixed.body.promo.eligibleTotal).toBe(100);
  });

  test('PI.6 validation uses the listing price, not a client-supplied price', async () => {
    const listing = await makeListing(sellerA, 40);
    await createPromo({ code: 'PI6AUTHORITATIVE', discountType: 'percentage', discountValue: 50 });

    const response = await request(app).post('/api/promos/validate')
      .set('Authorization', 'Bearer ' + buyerToken)
      .send({
        code: 'PI6AUTHORITATIVE',
        items: [{ listingId: listing._id, price: 1000, quantity: 1 }],
      });

    expect(response.status).toBe(200);
    expect(response.body.promo.eligibleTotal).toBe(40);
    expect(response.body.promo.discountAmount).toBe(20);
  });

  test('PI.5 invalid discount values are rejected at creation', async () => {
    const neg = await createPromo({ code: 'PI5NEG', discountType: 'fixed', discountValue: -5 });
    expect(neg.status).toBe(400);

    const zero = await createPromo({ code: 'PI5ZERO', discountType: 'percentage', discountValue: 0 });
    expect(zero.status).toBe(400);

    const tooBig = await createPromo({ code: 'PI5BIG', discountType: 'percentage', discountValue: 150 });
    expect(tooBig.status).toBe(400);
    expect(tooBig.body.message).toMatch(/100/);
  });
});