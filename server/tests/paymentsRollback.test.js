// REGRESSION: confirm-batch rollback must fully restore inventory when a
// Phase-4 write fails AFTER the listing was marked sold. Real live bug: a
// legacy seller doc that failed validation on sellerDoc.save() (Phase 4) left
// the listing sold/available:false/quantity:0 with no Transaction/Payout/Order.
// Fixed via (1) pre('validate') sanitizer + (2) corrected rollback that runs
// when the decrement happened and re-opens the listing.
const mongoose = require('mongoose');
const request = require('supertest');
const app = require('../server');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Transaction = require('../models/Transaction');
const Payout = require('../models/Payout');
const Order = require('../models/Order');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';
const mkEmail = (tag) => `${tag}_${Date.now()}_${Math.floor(Math.random() * 1e6)}@test.com`;

function mockPaymentIntent(status = 'succeeded') {
  const id = `pi_roll_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  if (!global.__mockPaymentIntents) global.__mockPaymentIntents = {};
  global.__mockPaymentIntents[id] = { id, status, amount: 0 };
  return { id, status };
}

describe('Confirm-batch inventory rollback', () => {
  let buyerToken;
  let buyerId;

  beforeAll(async () => {
    if (mongoose.connection.readyState !== 1) {
      await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/trend-drop-test');
    }
    const buyer = await User.create({
      name: 'Rollback Buyer', email: mkEmail('rb_buyer'), password: 'password123',
      country: 'US', currency: 'USD', emailVerified: true, authProvider: 'email',
      shippingAddress: { fullName: 'B', street1: '1 St', city: 'C', state: 'CA', postalCode: '1', country: 'US' },
    });
    buyerId = buyer._id;
    buyerToken = jwt.sign({ id: buyer._id }, JWT_SECRET, { expiresIn: '30d' });
  });
test('Phase-4 seller save failure after inventory decrement fully restores listing', async () => {
    // Seller created through the model (valid), then poison an enum field directly
    // so sellerDoc.save() fails validation in Phase 4 (after the listing was
    // already marked sold). Reproduces the live orphan bug.
    const seller = await User.create({
      name: 'Rollback Seller', email: mkEmail('rb_seller'), password: 'password123',
      country: 'US', authProvider: 'email', emailVerified: true,
      location: 'San Diego, CA, US',
      balance: { available: 0, pending: 0, currency: 'USD' },
      stats: { totalSales: 0, totalPurchases: 0, strikes: 0 },
    });
    await User.collection.updateOne({ _id: seller._id }, { $set: { role: 'not_a_real_role' } });

    const listing = await Listing.create({
      seller: seller._id, title: 'Rollback Item', description: 'd', price: 50,
      category: 'Men', condition: 'New with tags', available: true, sold: false,
      quantity: 1, shipsFrom: 'US', weight: 1,
    });

    const pi = mockPaymentIntent('succeeded');
    const res = await request(app)
      .post('/api/payments/confirm-batch')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({
        paymentIntentId: pi.id,
        items: [{ listingId: listing._id, quantity: 1 }],
        shippingAddress: { fullName: 'Bob', street: '1', city: 'C', state: 'CA', postalCode: '1', country: 'US' },
      });

    expect([400, 500]).toContain(res.status);

    const rel = await Listing.findById(listing._id);
    // THE FIX: fully restored, not orphaned
    expect(rel.available).toBe(true);
    expect(rel.sold).toBe(false);
    expect(rel.quantity).toBe(1);
    // No half-written money state
    expect(await Transaction.countDocuments({ listing: listing._id, buyer: buyerId })).toBe(0);
    expect(await Payout.countDocuments({ listing: listing._id })).toBe(0);
    expect(await Order.countDocuments({ buyer: buyerId })).toBe(0);

    await Promise.all([
      User.deleteOne({ _id: seller._id }),
      Listing.deleteOne({ _id: listing._id }),
    ]);
  });

  it('successful confirm-batch with legacy-location seller works and creates order', async () => {
    // The OTHER half of the live bug: with the pre('validate') sanitizer, a
    // legacy seller (raw object location) must survive sellerDoc.save() and
    // produce a complete order — not the old 500.
    const seller = await User.create({
      name: 'LegacyOk Seller', email: mkEmail('rb_ok'), password: 'password123',
      country: 'US', authProvider: 'email', emailVerified: true,
      balance: { available: 0, pending: 0, currency: 'USD' },
    });
    await User.collection.updateOne({ _id: seller._id }, {
      $set: { location: { city: 'Austin', state: 'TX', country: 'US' } },
    });

    const listing = await Listing.create({
      seller: seller._id, title: 'Legacy OK Item', description: 'd', price: 50,
      category: 'Men', condition: 'New with tags', available: true, sold: false,
      quantity: 1, shipsFrom: 'US', weight: 1,
    });

    const pi = mockPaymentIntent('succeeded');
    const res = await request(app)
      .post('/api/payments/confirm-batch')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({
        paymentIntentId: pi.id,
        items: [{ listingId: listing._id, quantity: 1 }],
        shippingAddress: { fullName: 'Bob', street: '1', city: 'C', state: 'CA', postalCode: '1', country: 'US' },
      });

    expect(res.status).toBe(201);
    expect(res.body.orderId).toBeTruthy();
    expect(res.body.transactions).toHaveLength(1);

    const rel = await Listing.findById(listing._id);
    expect(rel.sold).toBe(true);

    await Promise.all([
      User.deleteOne({ _id: seller._id }),
      Listing.deleteOne({ _id: listing._id }),
      Transaction.deleteMany({ listing: listing._id }),
      Payout.deleteMany({ listing: listing._id }),
      Order.deleteMany({ buyer: buyerId }),
    ]);
  });
});