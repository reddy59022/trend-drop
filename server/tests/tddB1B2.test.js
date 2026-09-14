/* TDD-B1B2 RED tests: payment gate + self-cart guard. */
const mongoose = require('mongoose');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../server');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Transaction = require('../models/Transaction');
const Offer = require('../models/Offer');
const Cart = require('../models/Cart');
const SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';
const RUN = `tdd_${Date.now()}`;
const ADDR = { fullName: 'TDD Buyer', street1: '1 Main St', city: 'Austin', state: 'TX', postalCode: '78701', country: 'US', phone: '555-0100' };
let seller; let buyer; let buyerToken;
const U = []; const L = [];
function mockPi(s) {
  const id = `pi_tdd_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  if (!global.__mockPaymentIntents) global.__mockPaymentIntents = {};
  global.__mockPaymentIntents[id] = { id, status: s };
  return id;
}
async function mkListing(sid, price, qty) {
  const l = await Listing.create({ seller: sid, title: 'TDD Item',
    description: 'd', price: price || 50, category: 'Men',
    condition: 'New with tags', quantity: qty || 5,
    available: true, sold: false, status: 'active', shipsFrom: 'US',
    currency: 'USD', weight: 0.5 });
  L.push(l._id); return l;
}
beforeAll(async () => {
  if (mongoose.connection.readyState !== 1) await mongoose.connect(process.env.MONGO_URI);
  const mk = async (n, p) => {
    const u = await User.create({ name: n, email: `${p}_${RUN}@test.com`,
      password: 'password123', emailVerified: true, authProvider: 'email',
      country: 'US', currency: 'USD',
      shippingAddress: { fullName: n, street1: '1 St', city: 'C', state: 'S', postalCode: '0', country: 'US' },
      balance: { available: 0, pending: 0, totalEarned: 0, totalPaidOut: 0, currency: 'USD' } });
    U.push(u._id); return u;
  };
  seller = await mk('TDD Seller', 'tsell');
  buyer = await mk('TDD Buyer', 'tbuy');
  buyerToken = jwt.sign({ id: buyer._id }, SECRET, { expiresIn: '30d' });
});
afterAll(async () => {
  await Transaction.deleteMany({ $or: [{ buyer: { $in: U } }, { seller: { $in: U } }] });
  await Offer.deleteMany({ $or: [{ buyer: { $in: U } }, { seller: { $in: U } }] });
  await Listing.deleteMany({ _id: { $in: L } });
  await User.deleteMany({ _id: { $in: U } });
});
describe('TDD-B1 legacy endpoints require verified payment', () => {
  test('B1.1 POST /api/transactions w/o intent -> 400 no side effects', async () => {
    const l = await mkListing(seller._id, 50, 5);
    const res = await request(app).post('/api/transactions')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ listingId: l._id, buyerCountry: 'US' });
    expect(res.status).toBe(400);
    expect(String(res.body.message).toLowerCase()).toMatch(/payment/);
    expect(await Transaction.findOne({ listing: l._id })).toBeNull();
    const after = await Listing.findById(l._id);
    expect(after.sold).toBe(false);
    expect(after.quantity).toBe(5);
  });
  test('B1.2 POST /offer/:offerId w/o intent -> 400', async () => {
    const l = await mkListing(seller._id, 60, 5);
    const offer = await Offer.create({ listing: l._id, buyer: buyer._id,
      seller: seller._id, amount: 45, currency: 'USD', status: 'accepted',
      acceptedPrice: 45, acceptedAt: new Date(),
      acceptedUntil: new Date(Date.now() + 86400000), acceptedBy: 'seller' });
    const res = await request(app).post(`/api/transactions/offer/${offer._id}`)
      .set('Authorization', `Bearer ${buyerToken}`).send({});
    expect(res.status).toBe(400);
    expect(String(res.body.message).toLowerCase()).toMatch(/payment/);
    expect(await Transaction.findOne({ listing: l._id })).toBeNull();
    await Offer.deleteOne({ _id: offer._id });
  });
  test('B1.3 POST /guest w/o intent -> 400', async () => {
    const l = await mkListing(seller._id, 70, 5);
    const res = await request(app).post('/api/transactions/guest').send({
      listingId: l._id, buyerEmail: `guest_${RUN}@example.com`, buyerName: 'Guest',
      shippingAddress: { fullName: 'G', street1: '1 St', city: 'C', state: 'S', postalCode: '1', country: 'US' },
      buyerCountry: 'US' });
    expect(res.status).toBe(400);
    expect(String(res.body.message).toLowerCase()).toMatch(/payment/);
    expect(await Transaction.findOne({ listing: l._id })).toBeNull();
  });
  test('B1.4 unauthorized intent -> 400 no side effects', async () => {
    const l = await mkListing(seller._id, 80, 5);
    const pi = mockPi('requires_payment_method');
    const res = await request(app).post('/api/transactions')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ listingId: l._id, buyerCountry: 'US', paymentIntentId: pi });
    expect(res.status).toBe(400);
    expect(await Transaction.findOne({ listing: l._id })).toBeNull();
  });
  test('B1.5 authorized intent preserves path (201)', async () => {
    const l = await mkListing(seller._id, 90, 5);
    const pi = mockPi('requires_capture');
    const res = await request(app).post('/api/transactions')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ listingId: l._id, buyerCountry: 'US', paymentIntentId: pi,
        shippingAddress: { fullName: 'B', street1: '1', city: 'C', state: 'S', postalCode: '1', country: 'US' } });
    expect(res.status).toBe(201);
  });
  test('B1.6 guest with authorized intent still succeeds (parity)', async () => {
    const l = await mkListing(seller._id, 75, 5);
    const res = await request(app).post('/api/transactions/guest').send({
      listingId: l._id, paymentIntentId: mockPi('succeeded'),
      buyerEmail: `guest_ok_${RUN}@example.com`, buyerName: 'Guest OK',
      shippingAddress: { fullName: 'G', street1: '1 St', city: 'C', state: 'S', postalCode: '1', country: 'US' },
      buyerCountry: 'US' });
    expect(res.status).toBe(201);
    const txn = await Transaction.findOne({ listing: l._id });
    expect(txn).toBeTruthy();
    // Must record the funding intent (schema defaults it to '' so a bare
    // toBeDefined() would pass even when nothing was written).
    expect(txn.paymentBreakdown.paymentIntentId).toMatch(/^pi_/);
  });
  test('B1.9 guest cannot reuse one intent for two purchases', async () => {
    const l1 = await mkListing(seller._id, 20, 3);
    const l2 = await mkListing(seller._id, 25, 3);
    const pi = mockPi('requires_capture');
    const guestBuy = (listingId, email) => request(app).post('/api/transactions/guest').send({
      listingId, paymentIntentId: pi, buyerEmail: email, buyerName: 'Guest Reuse',
      shippingAddress: ADDR, buyerCountry: 'US',
    });

    expect((await guestBuy(l1._id, `reuse1_${RUN}@example.com`)).status).toBe(201);
    const second = await guestBuy(l2._id, `reuse2_${RUN}@example.com`);
    expect(second.status).toBe(400);
    expect(await Transaction.countDocuments({ listing: l2._id })).toBe(0);
    expect((await Listing.findById(l2._id)).quantity).toBe(3);
  });
  test('B1.10 an intent authorized for item A cannot be redeemed for item B', async () => {
    const cheap = await mkListing(seller._id, 5, 5);
    const pricey = await mkListing(seller._id, 500, 5);

    // Realistic flow: buyer authorizes only the cheap item...
    const ci = await request(app).post('/api/payments/create-intent')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ items: [{ listingId: cheap._id, quantity: 1 }], shippingAddress: ADDR, buyerCountry: 'US' });
    expect(ci.status).toBe(200);
    const piId = ci.data ? ci.data.paymentIntentId : ci.body.paymentIntentId;
    // ...then completes Stripe.js confirmation (amount is unchanged by 3DS).
    global.__mockPaymentIntents[piId].status = 'requires_capture';

    // Redeeming it for the $500 listing must be refused.
    const exploit = await request(app).post('/api/transactions')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ listingId: pricey._id, paymentIntentId: piId, buyerCountry: 'US', shippingAddress: ADDR });

    expect(exploit.status).toBe(400);
    expect(await Transaction.countDocuments({ listing: pricey._id })).toBe(0);
    expect((await Listing.findById(pricey._id)).quantity).toBe(5);
  });
  test('B1.11 another account cannot spend an intent it did not authorize', async () => {
    const l = await mkListing(seller._id, 25, 3);
    const other = await User.create({
      name: 'TDD Intent Thief', email: `thief_${RUN}@test.com`, password: 'password123',
      emailVerified: true, authProvider: 'email', country: 'US', currency: 'USD',
      shippingAddress: ADDR,
      balance: { available: 0, pending: 0, totalEarned: 0, totalPaidOut: 0, currency: 'USD' } });
    U.push(other._id);
    const thiefToken = jwt.sign({ id: other._id }, SECRET, { expiresIn: '30d' });

    const ci = await request(app).post('/api/payments/create-intent')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ items: [{ listingId: l._id, quantity: 1 }], shippingAddress: ADDR, buyerCountry: 'US' });
    expect(ci.status).toBe(200);
    const piId = ci.data ? ci.data.paymentIntentId : ci.body.paymentIntentId;
    global.__mockPaymentIntents[piId].status = 'requires_capture';

    const stolen = await request(app).post('/api/transactions')
      .set('Authorization', `Bearer ${thiefToken}`)
      .send({ listingId: l._id, paymentIntentId: piId, buyerCountry: 'US', shippingAddress: ADDR });

    expect(stolen.status).toBe(400);
    expect(await Transaction.countDocuments({ listing: l._id })).toBe(0);
  });
  test('B1.12 cart checkout rejects an intent authorized for other items', async () => {
    const cartItem = await mkListing(seller._id, 40, 3);
    const decoy = await mkListing(seller._id, 1, 3);

    const ci = await request(app).post('/api/payments/create-intent')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ items: [{ listingId: decoy._id, quantity: 1 }], shippingAddress: ADDR, buyerCountry: 'US' });
    expect(ci.status).toBe(200);
    const piId = ci.data ? ci.data.paymentIntentId : ci.body.paymentIntentId;
    global.__mockPaymentIntents[piId].status = 'requires_capture';

    await Cart.deleteMany({ user: buyer._id });
    await Cart.create({ user: buyer._id, items: [{ listing: cartItem._id, quantity: 1 }], status: 'active' });
    const res = await request(app).post('/api/cart/checkout')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ shippingAddress: ADDR, paymentIntentId: piId });

    expect(res.status).toBe(400);
    expect(await Transaction.countDocuments({ listing: cartItem._id })).toBe(0);
    expect((await Listing.findById(cartItem._id)).quantity).toBe(3);
    await Cart.deleteMany({ user: buyer._id });
  });
  test('B1.7 confirm-batch replay of an intent used by a legacy purchase cannot double-credit', async () => {
    const l = await mkListing(seller._id, 50, 5);
    const pi = mockPi('requires_capture');
    const buy = await request(app).post('/api/transactions')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ listingId: l._id, paymentIntentId: pi, buyerCountry: 'US', shippingAddress: ADDR });
    expect(buy.status).toBe(201);

    const before = await User.findById(seller._id);
    const pendingBefore = before.balance.pending;

    // Replay the SAME authorized intent through the batch endpoint.
    const replay = await request(app).post('/api/payments/confirm-batch')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ paymentIntentId: pi, items: [{ listingId: l._id, quantity: 1 }],
        shippingAddress: ADDR, buyerCountry: 'US' });

    // Idempotent contract: no NEW transactions, no second credit.
    expect(replay.status).toBe(200);
    expect(replay.body.transactions).toEqual([]);
    const after = await User.findById(seller._id);
    expect(after.balance.pending).toBe(pendingBefore);
    expect(await Transaction.countDocuments({ listing: l._id })).toBe(1);
  });
  test('B1.8 one authorized intent cannot be reused for a second purchase', async () => {
    const l1 = await mkListing(seller._id, 40, 5);
    const l2 = await mkListing(seller._id, 60, 5);
    const pi = mockPi('requires_capture');

    const first = await request(app).post('/api/transactions')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ listingId: l1._id, paymentIntentId: pi, buyerCountry: 'US', shippingAddress: ADDR });
    expect(first.status).toBe(201);

    // Same intent, different item: must be refused (no second free item).
    const second = await request(app).post('/api/transactions')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ listingId: l2._id, paymentIntentId: pi, buyerCountry: 'US', shippingAddress: ADDR });
    expect(second.status).toBe(400);
    expect(second.body.message).toMatch(/already (been )?(used|processed)/i);
    expect(await Transaction.countDocuments({ listing: l2._id })).toBe(0);
    expect((await Listing.findById(l2._id)).quantity).toBe(5);
  });
  test('B1.13 offer purchase records the funding intent (no replay hole)', async () => {
    const l = await mkListing(seller._id, 70, 5);
    const offer = await Offer.create({
      listing: l._id, buyer: buyer._id, seller: seller._id,
      amount: 70, counterAmount: 70, acceptedPrice: 70,
      status: 'accepted', expiresAt: new Date(Date.now() + 86400000),
    });
    const pi = mockPi('requires_capture');
    const res = await request(app).post(`/api/transactions/offer/${offer._id}`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ paymentIntentId: pi });
    expect(res.status).toBe(201);
    const txn = await Transaction.findOne({ offer: offer._id });
    expect(txn).toBeTruthy();
    expect(txn.paymentBreakdown.paymentIntentId).toBe(pi);
  });
});
describe('TDD-B2 cannot add own listing to cart', () => {
  test('B2.1 seller adding own listing -> 400', async () => {
    const sellerToken = jwt.sign({ id: seller._id }, SECRET, { expiresIn: '30d' });
    const l = await mkListing(seller._id, 55, 5);
    const res = await request(app).post('/api/cart/items')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ listingId: l._id, quantity: 1 });
    expect(res.status).toBe(400);
    expect(String(res.body.message).toLowerCase()).toMatch(/own listing/);
  });
  test('B2.2 a cart already holding your own listing cannot be checked out', async () => {
    // Cart-add now blocks self-listings, but a cart seeded before the fix (or
    // written directly) must not be redeemable at checkout either — otherwise
    // the purchase gates are bypassable. Defense in depth.
    const sellerToken = jwt.sign({ id: seller._id }, SECRET, { expiresIn: '30d' });
    const own = await mkListing(seller._id, 45, 2);

    await Cart.deleteMany({ user: seller._id });
    await Cart.create({ user: seller._id, items: [{ listing: own._id, quantity: 1 }], status: 'active' });

    const res = await request(app).post('/api/cart/checkout')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ shippingAddress: ADDR, paymentIntentId: mockPi('requires_capture') });

    expect(res.status).toBe(400);
    expect(await Transaction.countDocuments({ listing: own._id })).toBe(0);
    expect((await Listing.findById(own._id)).quantity).toBe(2);
    await Cart.deleteMany({ user: seller._id });
  });
});
