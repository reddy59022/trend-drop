/**
 * TDD round: hidden listings must not be wishlistable/viewable/offerable,
 * and an expired offer must not be acceptable.
 */
const mongoose = require('mongoose');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../server');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Offer = require('../models/Offer');
const Wishlist = require('../models/Wishlist');
const RecentlyViewed = require('../models/RecentlyViewed');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';
const tokenFor = (user) => jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '30d' });
const created = { users: [], listings: [], offers: [] };

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

const makeListing = async (seller, overrides = {}) => {
  const listing = await Listing.create({
    title: 'Offer fixture item',
    description: 'Fixture',
    price: 100,
    category: 'Women',
    condition: 'Good',
    images: ['https://example.com/item.jpg'],
    seller,
    quantity: 1,
    status: 'active',
    available: true,
    sold: false,
    ...overrides,
  });
  created.listings.push(listing._id);
  return listing;
};

const makeOffer = async (buyer, listing, overrides = {}) => {
  const offer = await Offer.create({
    listing: listing._id,
    buyer: buyer._id,
    seller: listing.seller,
    amount: 60,
    currency: 'USD',
    status: 'pending',
    ...overrides,
  });
  created.offers.push(offer._id);
  return offer;
};

beforeAll(async () => {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/trenddrop_test');
  }
});

afterAll(async () => {
  await Offer.deleteMany({ _id: { $in: created.offers } });
  await Wishlist.deleteMany({ user: { $in: created.users } });
  await RecentlyViewed.deleteMany({ userId: { $in: created.users } });
  await Listing.deleteMany({ _id: { $in: created.listings } });
  await User.deleteMany({ _id: { $in: created.users } });
  await mongoose.connection.close();
});

describe('WH.1 hidden listings cannot be wishlisted', () => {
  test.each(['draft', 'deleted'])('%s listings return 404', async (status) => {
    const seller = await makeUser(`wish_${status}_seller`);
    const buyer = await makeUser(`wish_${status}_buyer`);
    const listing = await makeListing(seller._id, { status });

    const res = await request(app)
      .post('/api/wishlist')
      .set('Authorization', `Bearer ${tokenFor(buyer)}`)
      .send({ listingId: listing._id });
    expect(res.status).toBe(404);
  });

  test('a listing hidden after being wishlisted disappears from the wishlist', async () => {
    const seller = await makeUser('wish_later_seller');
    const buyer = await makeUser('wish_later_buyer');
    const listing = await makeListing(seller._id);

    await request(app)
      .post('/api/wishlist')
      .set('Authorization', `Bearer ${tokenFor(buyer)}`)
      .send({ listingId: listing._id });

    await Listing.updateOne({ _id: listing._id }, { $set: { status: 'draft' } });

    const res = await request(app)
      .get('/api/wishlist')
      .set('Authorization', `Bearer ${tokenFor(buyer)}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe('WH.2 hidden listings cannot be recorded as recently viewed', () => {
  test('draft listings return 404', async () => {
    const seller = await makeUser('recent_draft_seller');
    const viewer = await makeUser('recent_draft_viewer');
    const listing = await makeListing(seller._id, { status: 'draft' });

    const res = await request(app)
      .post(`/api/recently-viewed/${listing._id}`)
      .set('Authorization', `Bearer ${tokenFor(viewer)}`);
    expect(res.status).toBe(404);
  });

  test('malformed listing ids return 400, not a cast error', async () => {
    const viewer = await makeUser('recent_bad_id');
    const res = await request(app)
      .post('/api/recently-viewed/not-an-id')
      .set('Authorization', `Bearer ${tokenFor(viewer)}`);
    expect(res.status).toBe(400);
  });

  test('a listing hidden after being viewed disappears from history', async () => {
    const seller = await makeUser('recent_later_seller');
    const viewer = await makeUser('recent_later_viewer');
    const listing = await makeListing(seller._id);

    await request(app)
      .post(`/api/recently-viewed/${listing._id}`)
      .set('Authorization', `Bearer ${tokenFor(viewer)}`);
    await Listing.updateOne({ _id: listing._id }, { $set: { status: 'deleted' } });

    const res = await request(app)
      .get('/api/recently-viewed')
      .set('Authorization', `Bearer ${tokenFor(viewer)}`);
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
  });
});

describe('WH.3 offers respect listing visibility and expiry', () => {
  test('buyers cannot offer on a draft listing', async () => {
    const seller = await makeUser('offer_draft_seller');
    const buyer = await makeUser('offer_draft_buyer');
    const listing = await makeListing(seller._id, { status: 'draft' });

    const res = await request(app)
      .post('/api/offers')
      .set('Authorization', `Bearer ${tokenFor(buyer)}`)
      .send({ listingId: listing._id, amount: 50 });
    expect(res.status).toBe(404);
  });

  test('an expired pending offer cannot be accepted', async () => {
    const seller = await makeUser('offer_exp_seller');
    const buyer = await makeUser('offer_exp_buyer');
    const listing = await makeListing(seller._id);
    const offer = await makeOffer(buyer, listing, {
      expiresAt: new Date(Date.now() - 60 * 1000),
    });

    const res = await request(app)
      .patch(`/api/offers/${offer._id}/accept`)
      .set('Authorization', `Bearer ${tokenFor(seller)}`);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/expired/i);

    const stored = await Offer.findById(offer._id);
    expect(stored.status).toBe('pending');
  });

  test('an expired counter cannot be accepted by the buyer', async () => {
    const seller = await makeUser('offer_exp2_seller');
    const buyer = await makeUser('offer_exp2_buyer');
    const listing = await makeListing(seller._id);
    const offer = await makeOffer(buyer, listing, {
      status: 'countered',
      counterAmount: 80,
      expiresAt: new Date(Date.now() - 60 * 1000),
    });

    const res = await request(app)
      .patch(`/api/offers/${offer._id}/accept-counter`)
      .set('Authorization', `Bearer ${tokenFor(buyer)}`);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/expired/i);

    const stored = await Offer.findById(offer._id);
    expect(stored.status).toBe('countered');
  });
});
