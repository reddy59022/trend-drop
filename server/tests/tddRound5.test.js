/* TDD Round 5 RED tests — second sweep: bulk claims, promo bounds, referral validate, confirm-received replay. */
const mongoose = require('mongoose');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../server');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Offer = require('../models/Offer');
const Promo = require('../models/Promo');
const Referral = require('../models/Referral');
const Transaction = require('../models/Transaction');
const Payout = require('../models/Payout');
const SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';
const RUN = `r5_${Date.now()}`;
const U = []; const L = []; const P = [];
async function mkUser(n, p) {
  const u = await User.create({ name: n, email: `${p}_${RUN}@test.com`, password: 'password123', emailVerified: true, authProvider: 'email', country: 'US', currency: 'USD', shippingAddress: { fullName: n, street1: '1 St', city: 'C', state: 'S', postalCode: '0', country: 'US' }, balance: { available: 0, pending: 0, totalEarned: 0, totalPaidOut: 0, currency: 'USD' } });
  U.push(u._id); return u;
}
async function mkListing(sid, price, qty) {
  const l = await Listing.create({ seller: sid, title: 'R5 Item', description: 'd', price: price || 100, category: 'Men', condition: 'New with tags', quantity: qty || 5, available: true, sold: false, status: 'active', shipsFrom: 'US', currency: 'USD', weight: 0.5 });
  L.push(l._id); return l;
}
let seller; let buyer; let buyer2; let sellerToken; let buyerToken; let buyer2Token;
beforeAll(async () => {
  if (mongoose.connection.readyState !== 1) await mongoose.connect(process.env.MONGO_URI);
  seller = await mkUser('R5 Seller', 'rsell5');
  buyer = await mkUser('R5 Buyer', 'rbuy5');
  buyer2 = await mkUser('R5 Buyer2', 'rbuy52');
  sellerToken = jwt.sign({ id: seller._id }, SECRET, { expiresIn: '30d' });
  buyerToken = jwt.sign({ id: buyer._id }, SECRET, { expiresIn: '30d' });
  buyer2Token = jwt.sign({ id: buyer2._id }, SECRET, { expiresIn: '30d' });
  U.push(buyer2._id);
});
afterAll(async () => {
  await Transaction.deleteMany({ $or: [{ buyer: { $in: U } }, { seller: { $in: U } }] });
  await Payout.deleteMany({ seller: { $in: U } });
  await Offer.deleteMany({ $or: [{ buyer: { $in: U } }, { seller: { $in: U } }] });
  await Promo.deleteMany({ _id: { $in: P } });
  await Referral.deleteMany({ referrer: { $in: U } });
  await Listing.deleteMany({ _id: { $in: L } });
  await User.deleteMany({ _id: { $in: U } });
});
describe('R5.1 bulk-offer claims must carry the 24h window and be single-claim atomic', () => {
  test('claimed offer stamps acceptedUntil ~24h out', async () => {
    const l = await mkListing(seller._id, 100, 5);
    const bulk = await Offer.create({ listing: l._id, buyer: seller._id, seller: seller._id, amount: 70, currency: 'USD', status: 'pending', expiresAt: new Date(Date.now() + 48 * 3600 * 1000), bulkOffer: { isBulk: true, discountType: 'percentage', discountValue: 30, claimedBy: [] } });
    const res = await request(app).post(`/api/offers/to-likers/${bulk._id}/claim`).set('Authorization', `Bearer ${buyerToken}`);
    expect(res.status).toBe(201);
    expect(new Date(res.body.offer.acceptedUntil).getTime()).toBeGreaterThan(Date.now() + 23 * 3600 * 1000);
  });
  test('two concurrent claims by same buyer -> one 201, second 400, one accepted offer', async () => {
    const l = await mkListing(seller._id, 100, 5);
    const bulk = await Offer.create({ listing: l._id, buyer: seller._id, seller: seller._id, amount: 70, currency: 'USD', status: 'pending', expiresAt: new Date(Date.now() + 48 * 3600 * 1000), bulkOffer: { isBulk: true, discountType: 'percentage', discountValue: 30, claimedBy: [] } });
    const [r1, r2] = await Promise.all([
      request(app).post(`/api/offers/to-likers/${bulk._id}/claim`).set('Authorization', `Bearer ${buyer2Token}`),
      request(app).post(`/api/offers/to-likers/${bulk._id}/claim`).set('Authorization', `Bearer ${buyer2Token}`),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([201, 400]);
    expect(await Offer.countDocuments({ listing: l._id, buyer: buyer2._id, status: 'accepted' })).toBe(1);
  });
});
describe('R5.2 promo money fields must be non-negative (no NaN economics)', () => {
  test('create with negative minPurchaseAmount is rejected 400', async () => {
    const res = await request(app).post('/api/promos').set('Authorization', `Bearer ${sellerToken}`).send({ code: `R5MIN_${RUN}`, discountType: 'fixed', discountValue: 5, minPurchaseAmount: -50 });
    expect(res.status).toBe(400);
  });
  test('create with negative maxDiscountAmount is rejected 400', async () => {
    const res = await request(app).post('/api/promos').set('Authorization', `Bearer ${sellerToken}`).send({ code: `R5MAX_${RUN}`, discountType: 'percentage', discountValue: 10, maxDiscountAmount: -5 });
    expect(res.status).toBe(400);
  });
  test('create with negative usageLimit is rejected 400', async () => {
    const res = await request(app).post('/api/promos').set('Authorization', `Bearer ${sellerToken}`).send({ code: `R5UL_${RUN}`, discountType: 'fixed', discountValue: 5, usageLimit: -3 });
    expect(res.status).toBe(400);
  });
  test('update with negative usageLimit is rejected 400', async () => {
    const c = await request(app).post('/api/promos').set('Authorization', `Bearer ${sellerToken}`).send({ code: `R5ULU_${RUN}`, discountType: 'fixed', discountValue: 5 });
    expect(c.status).toBe(201); P.push(c.body._id);
    const res = await request(app).put(`/api/promos/${c.body._id}`).set('Authorization', `Bearer ${sellerToken}`).send({ usageLimit: -1 });
    expect(res.status).toBe(400);
  });
});
describe('R5.3 referral public validate must honor expiry', () => {
  test('GET /referrals/:code on expired code -> 400, not valid:true', async () => {
    await request(app).post('/api/referrals/generate').set('Authorization', `Bearer ${sellerToken}`);
    const ref = await Referral.findOne({ referrer: seller._id, status: 'active' });
    ref.expiresAt = new Date(Date.now() - 3600 * 1000);
    await ref.save();
    const res = await request(app).get(`/api/referrals/${ref.code}`);
    expect(res.status).toBe(400);
    expect(res.body.valid).toBe(false);
    ref.expiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000);
    await ref.save();
  });
});
describe('R5.4 confirm-received must be idempotent (no duplicate payouts/notifications)', () => {
  test('second confirm on same txn -> 400, one payout, one notification', async () => {
    const l = await mkListing(seller._id, 100, 5);
    const txn = await Transaction.create({ listing: l._id, buyer: buyer._id, seller: seller._id, itemPrice: 100, currency: 'USD', paymentBreakdown: { subtotal: 100, shippingCost: 5, buyerProtectionFee: 5, totalPaid: 110, platformFee: 8, platformFeePercent: 8, shippingPayout: 5, sellerEarnings: 92 }, status: 'shipped', payout: { status: 'pending', transactionId: `pi_r5_${Date.now()}` } });
    const sellerBefore = await User.findById(seller._id);
    const notifBefore = (sellerBefore.notifications || []).length;
    const first = await request(app).post('/api/shipping/confirm-received').set('Authorization', `Bearer ${buyerToken}`).send({ transactionId: txn._id });
    expect(first.status).toBe(200);
    const second = await request(app).post('/api/shipping/confirm-received').set('Authorization', `Bearer ${buyerToken}`).send({ transactionId: txn._id });
    expect(second.status).toBe(400);
    expect(await Payout.countDocuments({ transaction: txn._id })).toBe(1);
    const sellerAfter = await User.findById(seller._id);
    expect((sellerAfter.notifications || []).length).toBe(notifBefore + 1);
  });
});
