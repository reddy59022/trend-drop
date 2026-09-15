const mongoose = require('mongoose');
const request = require('supertest');
const app = require('../server');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Transaction = require('../models/Transaction');
const Payout = require('../models/Payout');
const Offer = require('../models/Offer');
const Cart = require('../models/Cart');
const jwt = require('jsonwebtoken');
const { getJwtSecret } = require('../config/security');

const JWT_SECRET = getJwtSecret();
const US = { fullName: 'T', street1: '1 St', city: 'NYC', state: 'NY', postalCode: '10001', country: 'US' };

const makeUser = async (name, email) => {
  const user = await User.create({
    name, email, password: 'password123', country: 'US', currency: 'USD',
    emailVerified: true, authProvider: 'email',
    shippingAddress: { ...US },
  });
  const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '30d' });
  return { user, token };
};

const makeListing = (seller, price = 100, extra = {}) => Listing.create({
  title: `PayIntegrity ${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
  description: 'payment integrity listing',
  price, currency: 'USD', category: 'Men', size: 'M', condition: 'Good',
  images: ['https://example.com/p.jpg'], seller: seller._id, available: true,
  quantity: 10, shipsFrom: 'US', ...extra,
});

const mockIntent = (buyerId, listingIds, status = 'succeeded', amount = 50000) => {
  const pi = 'pi_payint_' + Date.now() + Math.random().toString(36).slice(2, 9);
  global.__mockPaymentIntents = global.__mockPaymentIntents || {};
  global.__mockPaymentIntents[pi] = {
    id: pi, status, amount, currency: 'usd',
    metadata: { buyerId: buyerId.toString(), itemIds: listingIds.join(',') },
  };
  return pi;
};

const acceptedOffer = async (buyer, seller, listing, price) => Offer.create({
  listing: listing._id, buyer: buyer.user._id, seller: seller.user._id,
  amount: price, status: 'accepted', acceptedPrice: price,
  acceptedUntil: new Date(Date.now() + 24 * 60 * 60 * 1000),
});

const expectNoLiveHold = (pi) => {
  const piState = global.__mockPaymentIntents?.[pi];
  const refunded = global.__mockRefunds?.[pi];
  const released = piState && ['cancelled', 'canceled', 'refunded'].includes(piState.status);
  expect(refunded || released).toBeTruthy();
};

beforeAll(async () => {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/trend-drop-test');
  }
});

describe('ZD23 — confirm-batch rollback restores the FULL purchased quantity', () => {
  test('a failed batch with qty=3 puts every unit back', async () => {
    const seller = await makeUser('PI1', `pi1_${Date.now()}@test.com`);
    const buyer = await makeUser('PI2', `pi2_${Date.now()}@test.com`);
    const listing = await makeListing(seller.user, 100);
    const pi = mockIntent(buyer.user._id, [listing._id.toString()], 'requires_capture');

    const saveSpy = jest.spyOn(User.prototype, 'save').mockRejectedValueOnce(new Error('VersionError simulation'));
    try {
      const r = await request(app).post('/api/payments/confirm-batch')
        .set('Authorization', 'Bearer ' + buyer.token)
        .send({ paymentIntentId: pi, items: [{ listingId: listing._id.toString(), quantity: 3 }], shippingAddress: { ...US } });
      expect(r.status).toBe(500);
    } finally {
      saveSpy.mockRestore();
    }

    // NO order may survive a failed checkout
    expect(await Transaction.countDocuments({ 'paymentBreakdown.paymentIntentId': pi })).toBe(0);
    expect(await Payout.countDocuments({ paymentIntentId: pi })).toBe(0);

    // EVERY unit must be back — not just one
    const after = await Listing.findById(listing._id);
    expect(after.quantity).toBe(10);
    expect(after.quantitySold).toBe(0);
    expect(after.sold).toBe(false);
    expect(after.available).toBe(true);

    // money must not stay captured
    expect(global.__mockRefunds?.[pi]).toBeTruthy();
  });
});

describe('ZD24 — confirm-batch rollback reverts a completed offer to accepted', () => {
  test('the accepted offer is reusable after a failed batch', async () => {
    const seller = await makeUser('PI3', `pi3_${Date.now()}@test.com`);
    const buyer = await makeUser('PI4', `pi4_${Date.now()}@test.com`);
    const listing = await makeListing(seller.user, 80);
    const offer = await acceptedOffer(buyer, seller, listing, 60);
    const pi = mockIntent(buyer.user._id, [listing._id.toString()], 'requires_capture');

    const saveSpy = jest.spyOn(User.prototype, 'save').mockRejectedValueOnce(new Error('VersionError simulation'));
    try {
      const r = await request(app).post('/api/payments/confirm-batch')
        .set('Authorization', 'Bearer ' + buyer.token)
        .send({ paymentIntentId: pi, items: [{ listingId: listing._id.toString(), offerId: offer._id.toString() }], shippingAddress: { ...US } });
      expect(r.status).toBe(500);
    } finally {
      saveSpy.mockRestore();
    }

    const after = await Offer.findById(offer._id);
    expect(after.status).toBe('accepted');
    expect(after.transaction ?? null).toBeNull();
  });
});

describe('ZD25 — legacy purchase rolls back transaction+inventory+hold on failure', () => {
  test('failed seller balance update leaves NO transaction, NO sold listing, NO hold', async () => {
    const seller = await makeUser('PI5', `pi5_${Date.now()}@test.com`);
    const buyer = await makeUser('PI6', `pi6_${Date.now()}@test.com`);
    const listing = await makeListing(seller.user, 100, { boost: { active: true, tier: 'standard', feeLedger: { owed: 0 } } });
    const pi = mockIntent(buyer.user._id, [listing._id.toString()], 'succeeded');

    const saveSpy = jest.spyOn(User.prototype, 'save').mockRejectedValueOnce(new Error('VersionError simulation'));
    try {
      const r = await request(app).post('/api/transactions')
        .set('Authorization', 'Bearer ' + buyer.token)
        .send({ paymentIntentId: pi, listingId: listing._id.toString(), shippingAddress: { ...US }, buyerCountry: 'US' });
      expect(r.status).toBe(500);
    } finally {
      saveSpy.mockRestore();
    }

    expect(await Transaction.countDocuments({ 'paymentBreakdown.paymentIntentId': pi })).toBe(0);
    const after = await Listing.findById(listing._id);
    expect(after.quantity).toBe(10);
    expect(after.quantitySold).toBe(0);
    expect(after.sold).toBe(false);
    expect(after.available).toBe(true);
    // boost fee ledger must be reverted too
    expect(after.boost?.feeLedger?.owed || 0).toBe(0);
    // the payment hold must be gone (released or refunded) — never left live
    expectNoLiveHold(pi);
  });
});


describe('ZD26 — offer-based purchase rolls back and keeps the offer accepted', () => {
  test('failed purchase via /transactions/offer/:id leaves no order and offer intact', async () => {
    const seller = await makeUser('PI7', `pi7_${Date.now()}@test.com`);
    const buyer = await makeUser('PI8', `pi8_${Date.now()}@test.com`);
    const listing = await makeListing(seller.user, 80);
    const offer = await acceptedOffer(buyer, seller, listing, 60);
    const pi = mockIntent(buyer.user._id, [listing._id.toString()], 'succeeded');

    const saveSpy = jest.spyOn(User.prototype, 'save').mockRejectedValueOnce(new Error('VersionError simulation'));
    try {
      const r = await request(app).post(`/api/transactions/offer/${offer._id}`)
        .set('Authorization', 'Bearer ' + buyer.token).send({ paymentIntentId: pi });
      expect([200, 201, 500]).toContain(r.status);
      if (r.status !== 500) throw new Error('expected failure injection to trigger 500');
    } finally {
      saveSpy.mockRestore();
    }

    expect(await Transaction.countDocuments({ 'paymentBreakdown.paymentIntentId': pi })).toBe(0);
    const afterListing = await Listing.findById(listing._id);
    expect(afterListing.quantity).toBe(10);
    expect(afterListing.sold).toBe(false);
    expectNoLiveHold(pi);

    const afterOffer = await Offer.findById(offer._id);
    expect(['accepted']).toContain(afterOffer.status);
  });
});

describe('ZD27 — cart checkout rolls back the ENTIRE multi-item cart on failure', () => {
  test('a mid-cart failure commits nothing and releases the payment', async () => {
    const sellerA = await makeUser('PI9', `pi9_${Date.now()}@test.com`);
    const sellerB = await makeUser('PI10', `pi10_${Date.now()}@test.com`);
    const buyer = await makeUser('PI11', `pi11_${Date.now()}@test.com`);
    const listingA = await makeListing(sellerA.user, 50);
    const listingB = await makeListing(sellerB.user, 60);
    const pi = mockIntent(buyer.user._id, [listingA._id.toString(), listingB._id.toString()]);

    const addA = await request(app).post('/api/cart/items')
      .set('Authorization', 'Bearer ' + buyer.token)
      .send({ listingId: listingA._id.toString(), quantity: 1 });
    expect([200, 201]).toContain(addA.status);
    const addB = await request(app).post('/api/cart/items')
      .set('Authorization', 'Bearer ' + buyer.token)
      .send({ listingId: listingB._id.toString(), quantity: 1 });
    expect([200, 201]).toContain(addB.status);

    const saveSpy = jest.spyOn(User.prototype, 'save').mockRejectedValueOnce(new Error('VersionError simulation'));
    try {
      const r = await request(app).post('/api/cart/checkout')
        .set('Authorization', 'Bearer ' + buyer.token)
        .send({ paymentIntentId: pi, shippingAddress: { ...US } });
      expect(r.status).toBe(500);
    } finally {
      saveSpy.mockRestore();
    }

    // no partial commit: neither item may survive
    expect(await Transaction.countDocuments({ 'paymentBreakdown.paymentIntentId': pi })).toBe(0);
    expect(await Payout.countDocuments({ paymentIntentId: pi })).toBe(0);
    const afterA = await Listing.findById(listingA._id);
    const afterB = await Listing.findById(listingB._id);
    for (const l of [afterA, afterB]) {
      expect(l.quantity).toBe(10);
      expect(l.quantitySold).toBe(0);
      expect(l.sold).toBe(false);
      expect(l.available).toBe(true);
    }
    // the cart must be usable again, not stuck 'purchased'
    const cart = await Cart.findOne({ user: buyer.user._id, status: 'active' }) ||
                 await Cart.findOne({ user: buyer.user._id });
    expect(cart.status).toBe('active');
    expectNoLiveHold(pi);
  });
});

