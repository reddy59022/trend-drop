/**
 * PAYMENT INTERNATIONAL-SHIPPING GATE — regression for Bug B1.
 *
 * The main Stripe checkout flow (create-intent -> confirm-batch / confirm)
 * MUST enforce the same INTERNATIONAL_SHOPPING_ENABLED feature flag that
 * listing creation and the legacy cart checkout already enforce:
 *
 *   flag OFF (default) -> cross-border purchase REJECTED (400): no intent,
 *   no transaction, no payout, listing untouched, seller not credited.
 *   flag OFF -> same-country purchase still succeeds.
 *   flag ON  -> cross-border purchase succeeds (per-currency math intact).
 *
 * Before the fix these tests FAILED: create-intent / confirm-batch happily
 * charged cross-border orders while the flag was disabled - inconsistent
 * with the cart-checkout path and a violation of the Feature-2 business rule.
 */
const mongoose = require('mongoose');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../server');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Transaction = require('../models/Transaction');
const Payout = require('../models/Payout');
const Order = require('../models/Order');

const SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';
const RUN = `pg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
const mkEmail = (p) => `${p}_${RUN}@test.com`;

const US_ADDRESS = { fullName: 'PG Buyer', street1: '1 Main St', city: 'Austin', state: 'TX', postalCode: '78701', country: 'US', phone: '555-0001' };
const GB_ADDRESS = { fullName: 'PG Buyer', street1: '1 High St', city: 'London', state: 'England', postalCode: 'SW1A 1AA', country: 'GB', phone: '555-0002' };

let sellerUS, sellerGB, buyer, sellerUSToken, sellerGBToken, buyerToken;
const testUserIds = [];
const testListingIds = [];
const saveFlag = process.env.INTERNATIONAL_SHOPPING_ENABLED;

function mockPi(status = 'succeeded') {
  const id = `pi_pg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  if (!global.__mockPaymentIntents) global.__mockPaymentIntents = {};
  global.__mockPaymentIntents[id] = { id, status };
  return id;
}

function mkListing(sellerId, price, country, currency) {
  return Listing.create({
    seller: sellerId, title: `PG ${country} ${price} ${RUN}`, description: 'd',
    price, originalPrice: Math.round(price * 1.3), category: 'Men', condition: 'New with tags',
    size: 'M', brand: 'PG', color: 'Black', quantity: 5,
    available: true, sold: false, status: 'active', shipsFrom: country, currency,
    shipping: { domestic: true, international: false, freeShipping: false, shippingCost: 0 },
    weight: 0.5, weightUnit: 'kg',
  });
}

function createIntent(token, items, address) {
  return request(app).post('/api/payments/create-intent').set('Authorization', `Bearer ${token}`).send({ items, shippingAddress: address });
}
function confirmBatch(token, items, pi, address) {
  return request(app).post('/api/payments/confirm-batch').set('Authorization', `Bearer ${token}`).send({ paymentIntentId: pi, items, shippingAddress: address });
}

beforeAll(async () => {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/trenddrop_test');
  }
  const mk = async (name, p, country, currency) => {
    const u = await User.create({
      name, email: mkEmail(p), password: 'password123', emailVerified: true, authProvider: 'email',
      country, currency,
      shippingAddress: { fullName: name, street1: '1 St', city: 'C', state: 'S', postalCode: '00000', country },
      balance: { available: 0, pending: 0, totalEarned: 0, totalPaidOut: 0, currency },
      stats: { totalSales: 5, totalPurchases: 0, strikes: 0 },
      createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    });
    testUserIds.push(u._id);
    return u;
  };
  sellerUS = await mk('PG Seller US', 'seller_us', 'US', 'USD');
  sellerGB = await mk('PG Seller GB', 'seller_gb', 'GB', 'GBP');
  buyer = await mk('PG Buyer', 'buyer', 'US', 'USD');
  sellerUSToken = jwt.sign({ id: sellerUS._id }, SECRET, { expiresIn: '30d' });
  sellerGBToken = jwt.sign({ id: sellerGB._id }, SECRET, { expiresIn: '30d' });
  buyerToken = jwt.sign({ id: buyer._id }, SECRET, { expiresIn: '30d' });
});

afterAll(async () => {
  process.env.INTERNATIONAL_SHOPPING_ENABLED = saveFlag || '';
  await Transaction.deleteMany({ $or: [{ buyer: { $in: testUserIds } }, { seller: { $in: testUserIds } }] });
  await Payout.deleteMany({ seller: { $in: testUserIds } });
  await Order.deleteMany({ buyer: { $in: testUserIds } });
  await Listing.deleteMany({ _id: { $in: testListingIds } });
  await User.deleteMany({ _id: { $in: testUserIds } });
});

describe('PG · Payment flow enforces the international-shipping flag', () => {
  beforeEach(() => { process.env.INTERNATIONAL_SHOPPING_ENABLED = ''; });

  test('PG.1 flag OFF: create-intent rejects a cross-border purchase (US buyer -> GB seller)', async () => {
    const l = await mkListing(sellerGB._id, 100, 'GB', 'GBP');
    testListingIds.push(l._id);
    const res = await createIntent(buyerToken, [{ listingId: l._id }], US_ADDRESS);
    expect(res.status).toBe(400);
    expect(String(res.body.message).toLowerCase()).toContain('international');
    expect(res.body.supported).toBe(false);
  });

  test('PG.2 flag OFF: create-intent rejects cross-border even with buyerCountry override', async () => {
    const l = await mkListing(sellerGB._id, 100, 'GB', 'GBP');
    testListingIds.push(l._id);
    const res = await request(app).post('/api/payments/create-intent').set('Authorization', `Bearer ${buyerToken}`)
      .send({ items: [{ listingId: l._id }], buyerCountry: 'US' });
    expect(res.status).toBe(400);
    expect(String(res.body.message).toLowerCase()).toContain('international');
  });

  test('PG.3 flag OFF: create-intent allows a same-country purchase', async () => {
    const l = await mkListing(sellerUS._id, 60, 'US', 'USD');
    testListingIds.push(l._id);
    const res = await createIntent(buyerToken, [{ listingId: l._id }], US_ADDRESS);
    expect(res.status).toBe(200);
    expect(res.body.paymentIntentId).toBeTruthy();
  });

  test('PG.4 flag OFF: confirm-batch rejects cross-border with NO side effects', async () => {
    const l = await mkListing(sellerGB._id, 40, 'GB', 'GBP');
    testListingIds.push(l._id);
    const pi = mockPi('requires_capture');
    const res = await confirmBatch(buyerToken, [{ listingId: l._id }], pi, US_ADDRESS);
    expect(res.status).toBe(400);
    expect(String(res.body.message).toLowerCase()).toContain('international');
    expect(await Transaction.findOne({ listing: l._id })).toBeNull();
    expect(await Payout.findOne({ listing: l._id })).toBeNull();
    expect(await Order.findOne({ 'items.listing': l._id })).toBeNull();
    const after = await Listing.findById(l._id);
    expect(after.sold).toBe(false);
    expect(after.available).toBe(true);
    expect(after.quantity).toBe(5);
    const s = await User.findById(sellerGB._id);
    expect(s.balance.pending).toBe(0);
  });

  test('PG.5 flag OFF: confirm-batch allows a same-country purchase', async () => {
    const l = await mkListing(sellerUS._id, 50, 'US', 'USD');
    testListingIds.push(l._id);
    const pi = mockPi('succeeded');
    const res = await confirmBatch(buyerToken, [{ listingId: l._id }], pi, US_ADDRESS);
    expect(res.status).toBe(201);
    expect(res.body.transactions).toHaveLength(1);
  });

  test('PG.6 flag ON: create-intent allows a cross-border purchase', async () => {
    process.env.INTERNATIONAL_SHOPPING_ENABLED = 'true';
    const l = await mkListing(sellerGB._id, 70, 'GB', 'GBP');
    testListingIds.push(l._id);
    const res = await createIntent(buyerToken, [{ listingId: l._id }], US_ADDRESS);
    expect(res.status).toBe(200);
  });

  test('PG.7 flag ON: confirm-batch allows a cross-border purchase (per-currency intact)', async () => {
    process.env.INTERNATIONAL_SHOPPING_ENABLED = 'true';
    const l = await mkListing(sellerGB._id, 55, 'GB', 'GBP');
    testListingIds.push(l._id);
    const pi = mockPi('succeeded');
    const res = await confirmBatch(buyerToken, [{ listingId: l._id }], pi, US_ADDRESS);
    expect(res.status).toBe(201);
    expect(res.body.transactions).toHaveLength(1);
    expect(res.body.transactions[0].currency).toBe('GBP');
  });

  test('PG.8 flag OFF: single-item /confirm rejects cross-border', async () => {
    const l = await mkListing(sellerGB._id, 35, 'GB', 'GBP');
    testListingIds.push(l._id);
    const pi = mockPi('succeeded');
    const res = await request(app).post('/api/payments/confirm').set('Authorization', `Bearer ${buyerToken}`)
      .send({ paymentIntentId: pi, listingId: l._id, shippingAddress: US_ADDRESS });
    expect(res.status).toBe(400);
    expect(String(res.body.message).toLowerCase()).toContain('international');
  });

  test('PG.9 flag OFF: a buyer shipping within the seller country is NOT blocked', async () => {
    const l = await mkListing(sellerGB._id, 45, 'GB', 'GBP');
    testListingIds.push(l._id);
    const res = await createIntent(buyerToken, [{ listingId: l._id }], GB_ADDRESS);
    expect(res.status).toBe(200);
  });
});

