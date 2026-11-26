/**
 * Production-readiness regressions:
 *  - seller tiers cannot be self-assigned from client-supplied statistics
 *  - live-event revenue is realized seller earnings, not a listing estimate
 *  - account deletion anonymizes instead of orphaning order history
 *  - password reset revokes every previously issued JWT
 */
const mongoose = require('mongoose');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../server');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Transaction = require('../models/Transaction');
const Rating = require('../models/Rating');
const LiveEvent = require('../models/LiveEvent');
const SellerBadge = require('../models/SellerBadge');
const PushDevice = require('../models/PushDevice');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';
const tokenFor = (id) => jwt.sign({ id }, JWT_SECRET, { expiresIn: '30d' });

const created = { users: [], listings: [], transactions: [], ratings: [], events: [] };

const makeUser = async (label) => {
  const user = await User.create({
    name: `${label} User`,
    email: `${label}_${Date.now()}_${Math.random().toString(36).slice(2)}@test.com`,
    password: 'password123',
    country: 'US',
    currency: 'USD',
    emailVerified: true,
    authProvider: 'email',
    shippingAddress: { fullName: label, street1: '1 Main St', city: 'City', state: 'CA', postalCode: '90210', country: 'US' },
  });
  created.users.push(user._id);
  return user;
};

const makeListing = async (seller) => {
  const listing = await Listing.create({
    title: 'Production readiness item',
    description: 'Fixture listing',
    price: 100,
    category: 'Women',
    condition: 'Good',
    images: ['https://example.com/item.jpg'],
    seller,
    quantity: 1,
    status: 'active',
    available: true,
  });
  created.listings.push(listing._id);
  return listing;
};

const makeSale = async ({ seller, buyer, listing, status = 'completed', sellerEarnings = 92 }) => {
  const txn = await Transaction.create({
    listing: listing._id,
    buyer,
    seller,
    itemPrice: 100,
    currency: 'USD',
    status,
    paymentBreakdown: { subtotal: 100, totalPaid: 108, sellerEarnings },
  });
  created.transactions.push(txn._id);
  return txn;
};

beforeAll(async () => {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/trenddrop_test');
  }
});

afterAll(async () => {
  await Transaction.deleteMany({ _id: { $in: created.transactions } });
  await Rating.deleteMany({ _id: { $in: created.ratings } });
  await LiveEvent.deleteMany({ _id: { $in: created.events } });
  await Listing.deleteMany({ _id: { $in: created.listings } });
  await SellerBadge.deleteMany({ userId: { $in: created.users } });
  await User.deleteMany({ _id: { $in: created.users } });
  await mongoose.connection.close();
});

describe('PR.1 seller badges derive stats from platform records', () => {
  test('client-supplied stats cannot grant a tier or benefits', async () => {
    const seller = await makeUser('badge_inflate');
    const token = tokenFor(seller._id);

    const res = await request(app)
      .put('/api/seller-badges/update-stats')
      .set('Authorization', `Bearer ${token}`)
      .send({ salesCount: 250, avgRating: 4.9, responseRate: 1, returnRate: 0 });

    expect(res.status).toBe(200);
    expect(res.body.badge.salesCount).toBe(0);
    expect(res.body.badge.avgRating).toBe(0);
    expect(res.body.badge.tier).toBe('bronze');
    expect(res.body.badge.benefits.featuredListings).toBe(false);

    const stored = await SellerBadge.findOne({ userId: seller._id });
    expect(stored.salesCount).toBe(0);
    expect(stored.tier).toBe('bronze');
  });

  test('the tier is recomputed from real sales and ratings', async () => {
    const seller = await makeUser('badge_real');
    const buyer = await makeUser('badge_buyer');
    const listing = await makeListing(seller._id);
    const token = tokenFor(seller._id);

    for (let i = 0; i < 10; i += 1) {
      await makeSale({ seller: seller._id, buyer: buyer._id, listing });
    }
    const rating = await Rating.create({
      listing: listing._id,
      reviewer: buyer._id,
      seller: seller._id,
      rating: 4.6,
    });
    created.ratings.push(rating._id);

    const res = await request(app)
      .put('/api/seller-badges/update-stats')
      .set('Authorization', `Bearer ${token}`)
      .send({ salesCount: 9999, avgRating: 5 });

    expect(res.status).toBe(200);
    expect(res.body.badge.salesCount).toBe(10);
    expect(res.body.badge.avgRating).toBeCloseTo(4.6, 2);
    expect(res.body.badge.tier).toBe('silver');
    expect(res.body.badge.benefits.featuredListings).toBe(false);
  });

  test('cancelled and refunded orders do not count toward sales', async () => {
    const seller = await makeUser('badge_cancelled');
    const buyer = await makeUser('badge_cancelled_buyer');
    const listing = await makeListing(seller._id);
    const token = tokenFor(seller._id);

    await makeSale({ seller: seller._id, buyer: buyer._id, listing, status: 'cancelled' });
    await makeSale({ seller: seller._id, buyer: buyer._id, listing, status: 'refunded' });

    const res = await request(app)
      .put('/api/seller-badges/update-stats')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.badge.salesCount).toBe(0);
    expect(res.body.badge.tier).toBe('bronze');
  });
});

describe('PR.2 live-event statistics report realized revenue', () => {
  test('totalRevenue sums settled earnings for event listings only', async () => {
    const host = await makeUser('event_host');
    const buyer = await makeUser('event_buyer');
    const eventListing = await makeListing(host._id);
    const otherListing = await makeListing(host._id);

    const event = await LiveEvent.create({
      host: host._id,
      title: 'Live revenue event',
      listings: [eventListing._id],
      startTime: new Date(Date.now() - 3600000),
      endTime: new Date(Date.now() + 3600000),
      status: 'live',
    });
    created.events.push(event._id);

    await makeSale({ seller: host._id, buyer: buyer._id, listing: eventListing, sellerEarnings: 42.5 });
    await makeSale({ seller: host._id, buyer: buyer._id, listing: otherListing, sellerEarnings: 900 });
    await makeSale({ seller: host._id, buyer: buyer._id, listing: eventListing, status: 'refunded', sellerEarnings: 500 });

    const res = await request(app).get(`/api/live-events/stats/${host._id}`);

    expect(res.status).toBe(200);
    expect(res.body.totalEvents).toBe(1);
    expect(res.body.liveEvents).toBe(1);
    expect(res.body.totalRevenue).toBe(42.5);
    expect(res.body.currency).toBe('USD');
  });

  test('malformed host ids are rejected instead of throwing a cast error', async () => {
    const res = await request(app).get('/api/live-events/stats/not-an-object-id');
    expect(res.status).toBe(400);
  });
});

describe('PR.3 account deletion anonymizes while preserving order history', () => {
  test('deletion is blocked while money is still owed', async () => {
    const seller = await makeUser('delete_balance');
    await User.updateOne({ _id: seller._id }, { $set: { 'balance.available': 25 } });

    const res = await request(app)
      .delete('/api/auth/account')
      .set('Authorization', `Bearer ${tokenFor(seller._id)}`);

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/withdraw/i);
    const stored = await User.findById(seller._id);
    expect(stored.deletedAt).toBeFalsy();
  });

  test('deleting removes PII, revokes the token, and keeps the seller reference', async () => {
    const seller = await makeUser('delete_seller');
    const buyer = await makeUser('delete_buyer');
    const listing = await makeListing(seller._id);
    const txn = await makeSale({ seller: seller._id, buyer: buyer._id, listing });
    const token = tokenFor(seller._id);
    const originalEmail = seller.email;
    await PushDevice.create({ userId: seller._id, token: `delete-device-${Date.now()}`, platform: 'Android' });

    const res = await request(app)
      .delete('/api/auth/account')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);

    const stored = await User.findById(seller._id);
    expect(stored).toBeTruthy();
    expect(stored.deletedAt).toBeTruthy();
    expect(stored.name).toBe('Deleted User');
    expect(stored.email).not.toBe(originalEmail);
    expect(stored.email).toMatch(/@deleted\.trenddrop\.invalid$/);
    expect(stored.password).toBeFalsy();
    expect(stored.googleId).toBeNull();
    expect(stored.tokenVersion).toBe(1);
    expect(await PushDevice.countDocuments({ userId: seller._id })).toBe(0);

    const me = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);
    expect(me.status).toBe(401);

    const deletedListing = await Listing.findById(listing._id);
    expect(deletedListing.status).toBe('deleted');
    expect(deletedListing.available).toBe(false);

    // The order survives and still resolves to the (anonymized) seller.
    const history = await Transaction.findById(txn._id).populate('seller', 'name deletedAt');
    expect(history).toBeTruthy();
    expect(history.seller.name).toBe('Deleted User');
  });
});

describe('PR.4 password reset revokes existing sessions', () => {
  test('tokens issued before the reset stop working; new credentials do', async () => {
    const user = await makeUser('reset_sessions');
    const oldToken = tokenFor(user._id);

    const meBefore = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${oldToken}`);
    expect(meBefore.status).toBe(200);

    const forgot = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: user.email });
    expect(forgot.status).toBe(200);

    const withToken = await User.findById(user._id).select('verificationToken');
    expect(withToken.verificationToken).toBeTruthy();

    const reset = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: withToken.verificationToken, password: 'newpassword123' });
    expect(reset.status).toBe(200);

    const meAfter = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${oldToken}`);
    expect(meAfter.status).toBe(401);

    const oldLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: user.email, password: 'password123' });
    expect(oldLogin.status).toBe(400);

    const newLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: user.email, password: 'newpassword123' });
    expect(newLogin.status).toBe(200);

    const newMe = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${newLogin.body.token}`);
    expect(newMe.status).toBe(200);
  });

  test('legacy tokens without a generation claim remain valid until a reset', async () => {
    const user = await makeUser('legacy_token');
    const legacyToken = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '30d' });

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${legacyToken}`);

    expect(res.status).toBe(200);
    expect(res.body._id).toBe(String(user._id));
  });
});
