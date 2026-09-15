/* TDD Round 4 RED tests part 1 */
const mongoose = require('mongoose');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../server');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Offer = require('../models/Offer');
const Promo = require('../models/Promo');
const BundleRule = require('../models/BundleRule');
const Referral = require('../models/Referral');
const Transaction = require('../models/Transaction');
const SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';
const RUN = `r4_${Date.now()}`;
const ADDR = { fullName: 'R4 Buyer', street1: '1 Main St', city: 'Austin', state: 'TX', postalCode: '78701', country: 'US', phone: '555-0100' };
const U = []; const L = []; const P = []; const B = [];
function mockPi(s) {
  const id = `pi_r4_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  if (!global.__mockPaymentIntents) global.__mockPaymentIntents = {};
  global.__mockPaymentIntents[id] = { id, status: s };
  return id;
}
async function mkUser(n, p) {
  const u = await User.create({ name: n, email: `${p}_${RUN}@test.com`, password: 'password123', emailVerified: true, authProvider: 'email', country: 'US', currency: 'USD', shippingAddress: { fullName: n, street1: '1 St', city: 'C', state: 'S', postalCode: '0', country: 'US' }, balance: { available: 0, pending: 0, totalEarned: 0, totalPaidOut: 0, currency: 'USD' } });
  U.push(u._id); return u;
}
async function mkListing(sid, price, qty) {
  const l = await Listing.create({ seller: sid, title: 'R4 Item', description: 'd', price: price || 100, category: 'Men', condition: 'New with tags', quantity: qty || 5, available: true, sold: false, status: 'active', shipsFrom: 'US', currency: 'USD', weight: 0.5 });
  L.push(l._id); return l;
}
let seller; let buyer; let sellerToken; let buyerToken;
beforeAll(async () => {
  if (mongoose.connection.readyState !== 1) await mongoose.connect(process.env.MONGO_URI);
  seller = await mkUser('R4 Seller', 'rsell');
  buyer = await mkUser('R4 Buyer', 'rbuy');
  sellerToken = jwt.sign({ id: seller._id }, SECRET, { expiresIn: '30d' });
  buyerToken = jwt.sign({ id: buyer._id }, SECRET, { expiresIn: '30d' });
});
afterAll(async () => {
  await Transaction.deleteMany({ $or: [{ buyer: { $in: U } }, { seller: { $in: U } }] });
  await Offer.deleteMany({ $or: [{ buyer: { $in: U } }, { seller: { $in: U } }] });
  await Promo.deleteMany({ _id: { $in: P } });
  await BundleRule.deleteMany({ _id: { $in: B } });
  await Referral.deleteMany({ referrer: { $in: U } });
  await Listing.deleteMany({ _id: { $in: L } });
  await User.deleteMany({ _id: { $in: U } });
});
describe('R4.1 seller-accept must stamp the 24h purchase window (acceptedUntil)', () => {
  test('PATCH /offers/:id/seller-accept sets acceptedUntil ~24h out', async () => {
    const l = await mkListing(seller._id, 100, 5);
    const offer = await Offer.create({ listing: l._id, buyer: buyer._id, seller: seller._id, amount: 80, currency: 'USD', status: 'pending' });
    const res = await request(app).patch(`/api/offers/${offer._id}/seller-accept`).set('Authorization', `Bearer ${sellerToken}`);
    expect(res.status).toBe(200);
    const body = res.body.offer || res.body;
    expect(body.acceptedPrice).toBe(80);
    expect(new Date(body.acceptedUntil).getTime()).toBeGreaterThan(Date.now() + 23 * 3600 * 1000);
    await Offer.deleteOne({ _id: offer._id });
  });
});
describe('R4.2 promo updates must validate discount values (no 500s, no invalid persistence)', () => {
  test('PUT percentage > 100 is rejected with 400', async () => {
    const c = await request(app).post('/api/promos').set('Authorization', `Bearer ${sellerToken}`).send({ code: `R4PCT_${RUN}`, discountType: 'percentage', discountValue: 10 });
    expect(c.status).toBe(201); P.push(c.body._id);
    const res = await request(app).put(`/api/promos/${c.body._id}`).set('Authorization', `Bearer ${sellerToken}`).send({ discountValue: 150 });
    expect(res.status).toBe(400);
    expect((await Promo.findById(c.body._id)).discountValue).toBe(10);
  });
  test('PUT negative discountValue is rejected with 400', async () => {
    const c = await request(app).post('/api/promos').set('Authorization', `Bearer ${sellerToken}`).send({ code: `R4NEG_${RUN}`, discountType: 'fixed', discountValue: 5 });
    expect(c.status).toBe(201); P.push(c.body._id);
    const res = await request(app).put(`/api/promos/${c.body._id}`).set('Authorization', `Bearer ${sellerToken}`).send({ discountValue: -5 });
    expect(res.status).toBe(400);
  });
  test('PUT bogus discountType is rejected with 400 (not 500)', async () => {
    const c = await request(app).post('/api/promos').set('Authorization', `Bearer ${sellerToken}`).send({ code: `R4TYP_${RUN}`, discountType: 'fixed', discountValue: 5 });
    expect(c.status).toBe(201); P.push(c.body._id);
    const res = await request(app).put(`/api/promos/${c.body._id}`).set('Authorization', `Bearer ${sellerToken}`).send({ discountType: 'bogus' });
    expect(res.status).toBe(400);
  });
});
describe('R4.3 bundle rules must validate discount bounds (no 500s)', () => {
  test('POST /offers/bundle with discountPercent > 100 is rejected with 400', async () => {
    const res = await request(app).post('/api/offers/bundle').set('Authorization', `Bearer ${sellerToken}`).send({ name: 'R4Big', minQuantity: 2, discountPercent: 150 });
    expect(res.status).toBe(400);
  });
  test('POST /offers/bundle with minQuantity < 2 is rejected with 400', async () => {
    const res = await request(app).post('/api/offers/bundle').set('Authorization', `Bearer ${sellerToken}`).send({ name: 'R4Min', minQuantity: 1, discountPercent: 10 });
    expect(res.status).toBe(400);
  });
});
describe('R4.4 referral reward credits exactly once under concurrent claims', () => {
  test('two concurrent POST /referrals/claim -> one 200, balance credited once', async () => {
    const before = await User.findById(seller._id);
    const baseAvail = before.balance.available || 0;
    await request(app).post('/api/referrals/generate').set('Authorization', `Bearer ${sellerToken}`);
    const referral = await Referral.findOne({ referrer: seller._id, status: 'active' });
    const reward = referral.rewardAmount;
    const [r1, r2] = await Promise.all([
      request(app).post('/api/referrals/claim').set('Authorization', `Bearer ${sellerToken}`),
      request(app).post('/api/referrals/claim').set('Authorization', `Bearer ${sellerToken}`),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([200, 400]);
    const after = await User.findById(seller._id);
    expect(after.balance.available).toBe(baseAvail + reward);
  });
});
describe('R4.5 guest checkout cannot buy the sellers own listing', () => {
  test('guest checkout with the sellers email on own listing -> 400', async () => {
    const ownEmail = `r4own_${RUN}@test.com`;
    const ownSeller = await User.create({ name: 'R4 Own', email: ownEmail, password: 'password123', emailVerified: true, authProvider: 'email', country: 'US', currency: 'USD', shippingAddress: { fullName: 'O', street1: '1 St', city: 'C', state: 'S', postalCode: '0', country: 'US' }, balance: { available: 0, pending: 0, totalEarned: 0, totalPaidOut: 0, currency: 'USD' } });
    U.push(ownSeller._id);
    const l = await mkListing(ownSeller._id, 60, 5);
    const res = await request(app).post('/api/transactions/guest').send({ listingId: l._id, buyerEmail: ownEmail, buyerName: 'R4 Own', buyerCountry: 'US', paymentIntentId: mockPi('requires_capture'), shippingAddress: ADDR });
    expect(res.status).toBe(400);
    expect(await Transaction.countDocuments({ listing: l._id })).toBe(0);
    expect((await Listing.findById(l._id)).quantity).toBe(5);
  });
});
