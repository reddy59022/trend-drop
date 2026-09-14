/* TDD-B3B4 RED tests: cart qty + acceptedPrice/acceptedUntil. */
const mongoose = require('mongoose');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../server');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Transaction = require('../models/Transaction');
const Cart = require('../models/Cart');
const Offer = require('../models/Offer');
const SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';
const RUN = `tdd34_${Date.now()}`;
let seller; let buyer; let buyerToken;
const U = []; const L = [];
function mockPi(s) {
  const id = `pi_tdd34_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  if (!global.__mockPaymentIntents) global.__mockPaymentIntents = {};
  global.__mockPaymentIntents[id] = { id, status: s };
  return id;
}
async function mkListing(sid, price, qty) {
  const l = await Listing.create({ seller: sid, title: 'TDD34 Item',
    description: 'd', price: price || 40, category: 'Men',
    condition: 'New with tags', quantity: qty || 10,
    available: true, sold: false, status: 'active', shipsFrom: 'US',
    currency: 'USD', weight: 0.5 });
  L.push(l._id); return l;
}
const ADDR = { fullName: 'B', street1: '1 Main St', city: 'Austin', state: 'TX', postalCode: '78701', country: 'US', phone: '555-0001' };
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
  seller = await mk('TDD34 Seller', 'tsell34');
  buyer = await mk('TDD34 Buyer', 'tbuy34');
  buyerToken = jwt.sign({ id: buyer._id }, SECRET, { expiresIn: '30d' });
});
afterAll(async () => {
  await Transaction.deleteMany({ $or: [{ buyer: { $in: U } }, { seller: { $in: U } }] });
  await Cart.deleteMany({ user: { $in: U } });
  await Offer.deleteMany({ $or: [{ buyer: { $in: U } }, { seller: { $in: U } }] });
  await Listing.deleteMany({ _id: { $in: L } });
  await User.deleteMany({ _id: { $in: U } });
});
describe('TDD-B3 cart checkout honors item.quantity', () => {
  test('B3.1 qty=3 decrements by 3 and scales subtotal', async () => {
    const l = await mkListing(seller._id, 40, 10);
    await Cart.deleteMany({ user: buyer._id });
    await Cart.create({ user: buyer._id, items: [{ listing: l._id, quantity: 3 }], status: 'active' });
    const pi = mockPi('requires_capture');
    const res = await request(app).post('/api/cart/checkout')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ shippingAddress: ADDR, paymentIntentId: pi });
    expect(res.status).toBe(200);
    const after = await Listing.findById(l._id);
    expect(after.quantity).toBe(7);
    const txn = await Transaction.findOne({ listing: l._id, buyer: buyer._id }).sort({ createdAt: -1 });
    expect(txn).toBeTruthy();
    expect(txn.paymentBreakdown.subtotal).toBe(120);
    await Cart.deleteMany({ user: buyer._id });
  });
  test('B3.2 qty greater than stock -> 400, no transaction, no decrement', async () => {
    const l = await mkListing(seller._id, 40, 2);
    await Cart.deleteMany({ user: buyer._id });
    await Cart.create({ user: buyer._id, items: [{ listing: l._id, quantity: 5 }], status: 'active' });
    const res = await request(app).post('/api/cart/checkout')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ shippingAddress: ADDR, paymentIntentId: mockPi('requires_capture') });
    expect(res.status).toBe(400);
    expect(String(res.body.message)).toMatch(/only 2 left/i);
    const after = await Listing.findById(l._id);
    expect(after.quantity).toBe(2);
    expect(await Transaction.findOne({ listing: l._id, buyer: buyer._id })).toBeNull();
    await Cart.deleteMany({ user: buyer._id });
  });
  test('B3.3 concurrent checkouts cannot oversell the last unit', async () => {
    const l = await mkListing(seller._id, 30, 1);
    const b2 = await User.create({
      name: 'TDD34 Buyer2', email: `tbuy34b_${RUN}@test.com`, password: 'password123',
      emailVerified: true, authProvider: 'email', country: 'US', currency: 'USD',
      shippingAddress: { fullName: 'B2', street1: '1 St', city: 'C', state: 'S', postalCode: '0', country: 'US' },
      balance: { available: 0, pending: 0, totalEarned: 0, totalPaidOut: 0, currency: 'USD' } });
    U.push(b2._id);
    const token2 = jwt.sign({ id: b2._id }, SECRET, { expiresIn: '30d' });

    await Cart.deleteMany({ user: { $in: [buyer._id, b2._id] } });
    await Cart.create({ user: buyer._id, items: [{ listing: l._id, quantity: 1 }], status: 'active' });
    await Cart.create({ user: b2._id, items: [{ listing: l._id, quantity: 1 }], status: 'active' });

    const [r1, r2] = await Promise.all([
      request(app).post('/api/cart/checkout').set('Authorization', `Bearer ${buyerToken}`)
        .send({ shippingAddress: ADDR, paymentIntentId: mockPi('requires_capture') }),
      request(app).post('/api/cart/checkout').set('Authorization', `Bearer ${token2}`)
        .send({ shippingAddress: ADDR, paymentIntentId: mockPi('requires_capture') }),
    ]);

    // Exactly one buyer wins; the loser must not be charged, credited or
    // receive a transaction for stock that no longer exists.
    expect([r1.status, r2.status].sort()).toEqual([200, 400]);
    expect(await Transaction.countDocuments({ listing: l._id })).toBe(1);
    expect((await Listing.findById(l._id)).quantity).toBe(0);
    await Cart.deleteMany({ user: { $in: [buyer._id, b2._id] } });
  });
});
describe('TDD-B4 accepted-offer price and expiry', () => {
  test('B4.1 purchase uses acceptedPrice not stale counterAmount', async () => {
    const l = await mkListing(seller._id, 100, 5);
    const offer = await Offer.create({ listing: l._id, buyer: buyer._id,
      seller: seller._id, amount: 60, counterAmount: 90, currency: 'USD',
      status: 'accepted', acceptedPrice: 70, acceptedAt: new Date(),
      acceptedUntil: new Date(Date.now() + 86400000), acceptedBy: 'seller' });
    const pi = mockPi('requires_capture');
    const res = await request(app).post('/api/transactions')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ listingId: l._id, buyerCountry: 'US', paymentIntentId: pi,
        shippingAddress: ADDR });
    expect(res.status).toBe(201);
    const txn = await Transaction.findOne({ listing: l._id, buyer: buyer._id }).sort({ createdAt: -1 });
    expect(txn).toBeTruthy();
    expect(txn.itemPrice).toBe(70);
    expect(txn.negotiatedPrice).toBe(70);
    await Offer.deleteOne({ _id: offer._id });
  });
  test('B4.2 expired accepted offer cannot purchase', async () => {
    const l = await mkListing(seller._id, 100, 5);
    const offer = await Offer.create({ listing: l._id, buyer: buyer._id,
      seller: seller._id, amount: 60, counterAmount: 60, currency: 'USD',
      status: 'accepted', acceptedPrice: 60,
      acceptedAt: new Date(Date.now() - 172800000),
      acceptedUntil: new Date(Date.now() - 86400000), acceptedBy: 'seller' });
    const pi = mockPi('requires_capture');
    const res = await request(app).post('/api/transactions')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ listingId: l._id, buyerCountry: 'US', paymentIntentId: pi,
        shippingAddress: ADDR });
    expect(res.status).toBe(400);
    expect(String(res.body.message).toLowerCase()).toMatch(/expir/);
    expect(await Transaction.findOne({ listing: l._id, buyer: buyer._id })).toBeNull();
    const after = await Listing.findById(l._id);
    expect(after.sold).toBe(false);
    await Offer.deleteOne({ _id: offer._id });
  });
  test('B4.3 cron expireOffers() expires accepted offers past acceptedUntil', async () => {
    const { expireOffers } = require('../config/cron');
    const l = await mkListing(seller._id, 100, 5);
    const stale = await Offer.create({ listing: l._id, buyer: buyer._id,
      seller: seller._id, amount: 60, currency: 'USD', status: 'accepted',
      acceptedPrice: 60, acceptedAt: new Date(Date.now() - 172800000),
      acceptedUntil: new Date(Date.now() - 60000), acceptedBy: 'seller' });
    const fresh = await Offer.create({ listing: l._id, buyer: buyer._id,
      seller: seller._id, amount: 65, currency: 'USD', status: 'accepted',
      acceptedPrice: 65, acceptedAt: new Date(),
      acceptedUntil: new Date(Date.now() + 86400000), acceptedBy: 'seller' });

    const expiredCount = await expireOffers();

    expect(expiredCount).toBeGreaterThanOrEqual(1);
    expect((await Offer.findById(stale._id)).status).toBe('expired');
    expect((await Offer.findById(fresh._id)).status).toBe('accepted');
    await Offer.deleteMany({ _id: { $in: [stale._id, fresh._id] } });
  });
});
