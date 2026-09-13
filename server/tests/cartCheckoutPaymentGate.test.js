/**
 * CART CHECKOUT PAYMENT GATE — regression for Bug B2.
 *
 * POST /api/cart/checkout must NOT commit an order (transaction, listing
 * sold, seller pending credit) without a real authorized payment intent.
 * Before the fix this legacy endpoint gave items away for free: no Stripe
 * intent, no capture, yet the listing was marked sold and the seller was
 * credited - an authenticated buyer could "checkout" a cart and never pay.
 *
 * After the fix:
 *   - unauthenticated       -> 401
 *   - no paymentIntentId    -> 400 (no side effects)
 *   - unauthorized intent   -> 400 (no side effects)
 *   - authorized intent     -> 200 (valid payment path preserved)
 */
const mongoose = require('mongoose');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../server');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Transaction = require('../models/Transaction');
const Payout = require('../models/Payout');
const Cart = require('../models/Cart');

const SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';
const RUN = `cc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
const mkEmail = (p) => `${p}_${RUN}@test.com`;
const US_ADDRESS = { fullName: 'CC Buyer', street1: '1 Main St', city: 'Austin', state: 'TX', postalCode: '78701', country: 'US', phone: '555-0001' };

let seller, buyer, buyerToken;
const testUserIds = [];
const testListingIds = [];

function mockPi(status = 'succeeded') {
  const id = `pi_cc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  if (!global.__mockPaymentIntents) global.__mockPaymentIntents = {};
  global.__mockPaymentIntents[id] = { id, status };
  return id;
}

async function mkListing(sellerId, price = 50) {
  const l = await Listing.create({
    seller: sellerId, title: `CC Item ${RUN}`, description: 'd',
    price, originalPrice: Math.round(price * 1.3), category: 'Men', condition: 'New with tags',
    size: 'M', brand: 'CC', color: 'Black', quantity: 5,
    available: true, sold: false, status: 'active', shipsFrom: 'US', currency: 'USD',
    shipping: { domestic: true, international: false, freeShipping: false, shippingCost: 0 },
    weight: 0.5, weightUnit: 'kg',
  });
  testListingIds.push(l._id);
  return l;
}

async function seedCart(listingId, qty = 1) {
  await Cart.deleteMany({ user: buyer._id });
  await Cart.create({ user: buyer._id, items: [{ listing: listingId, quantity: qty }], status: 'active' });
}

function checkout(body) {
  return request(app).post('/api/cart/checkout').set('Authorization', `Bearer ${buyerToken}`).send(body);
}

beforeAll(async () => {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/trenddrop_test');
  }
  const mk = async (name, p) => {
    const u = await User.create({
      name, email: mkEmail(p), password: 'password123', emailVerified: true, authProvider: 'email',
      country: 'US', currency: 'USD',
      shippingAddress: { fullName: name, street1: '1 St', city: 'C', state: 'S', postalCode: '00000', country: 'US' },
      balance: { available: 0, pending: 0, totalEarned: 0, totalPaidOut: 0, currency: 'USD' },
      stats: { totalSales: 5, totalPurchases: 0, strikes: 0 },
    });
    testUserIds.push(u._id);
    return u;
  };
  seller = await mk('CC Seller', 'seller');
  buyer = await mk('CC Buyer', 'buyer');
  buyerToken = jwt.sign({ id: buyer._id }, SECRET, { expiresIn: '30d' });
});

afterAll(async () => {
  await Transaction.deleteMany({ $or: [{ buyer: { $in: testUserIds } }, { seller: { $in: testUserIds } }] });
  await Payout.deleteMany({ seller: { $in: testUserIds } });
  await Cart.deleteMany({ user: { $in: testUserIds } });
  await Listing.deleteMany({ _id: { $in: testListingIds } });
  await User.deleteMany({ _id: { $in: testUserIds } });
});

describe('CC · Cart checkout requires a real authorized payment', () => {
  test('CC.1 checkout requires authentication (401)', async () => {
    const l = await mkListing(seller._id);
    await seedCart(l._id);
    const res = await request(app).post('/api/cart/checkout').send({ shippingAddress: US_ADDRESS });
    expect([401, 403]).toContain(res.status);
  });

  test('CC.2 checkout WITHOUT a paymentIntentId is rejected (400) with no side effects', async () => {
    const l = await mkListing(seller._id);
    await seedCart(l._id);
    const res = await checkout({ shippingAddress: US_ADDRESS });
    expect(res.status).toBe(400);
    expect(String(res.body.message).toLowerCase()).toMatch(/payment/i);
    expect(await Transaction.findOne({ listing: l._id })).toBeNull();
    const after = await Listing.findById(l._id);
    expect(after.sold).toBe(false);
    expect(after.available).toBe(true);
    expect(after.quantity).toBe(5);
  });

  test('CC.3 checkout with an UNAUTHORIZED intent is rejected (400) with no side effects', async () => {
    const l = await mkListing(seller._id);
    await seedCart(l._id);
    const pi = mockPi('requires_payment_method'); // never authorized
    const res = await checkout({ paymentIntentId: pi, shippingAddress: US_ADDRESS });
    expect(res.status).toBe(400);
    expect(await Transaction.findOne({ listing: l._id })).toBeNull();
    const after = await Listing.findById(l._id);
    expect(after.sold).toBe(false);
  });

  test('CC.4 checkout with an AUTHORIZED intent succeeds (payment path preserved)', async () => {
    const l = await mkListing(seller._id);
    await seedCart(l._id);
    const pi = mockPi('requires_capture'); // authorized but not yet captured
    const res = await checkout({ paymentIntentId: pi, shippingAddress: US_ADDRESS });
    expect(res.status).toBe(200);
    expect(res.body.transaction).toBeDefined();
    const txn = await Transaction.findOne({ listing: l._id });
    expect(txn).toBeTruthy();
    expect(String(txn.paymentBreakdown.paymentIntentId || txn.payout?.transactionId || '')).toBe(pi);
  });

  test('CC.5 unknown intent id is rejected (400) - never trusts a fabricated id', async () => {
    const l = await mkListing(seller._id);
    await seedCart(l._id);
    const res = await checkout({ paymentIntentId: 'pi_does_not_exist_12345', shippingAddress: US_ADDRESS });
    expect(res.status).toBe(400);
    expect(await Transaction.findOne({ listing: l._id })).toBeNull();
  });
});

