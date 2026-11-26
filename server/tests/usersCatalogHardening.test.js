/**
 * TDD round: public closet and followed-seller feed must expose only the
 * same catalog-visible listings as the public profile count.
 */
const mongoose = require('mongoose');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../server');
const User = require('../models/User');
const Listing = require('../models/Listing');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';
const tokenFor = (user) => jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '30d' });
const created = { users: [], listings: [] };

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
    title: 'Catalog item',
    description: 'Fixture',
    price: 40,
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

beforeAll(async () => {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/trenddrop_test');
  }
});

afterAll(async () => {
  await Listing.deleteMany({ _id: { $in: created.listings } });
  await User.deleteMany({ _id: { $in: created.users } });
  await mongoose.connection.close();
});

describe('UC.1 public closet shows only catalog-visible listings', () => {
  test('drafts and out-of-stock items are excluded from data and pagination', async () => {
    const seller = await makeUser('closet_seller');
    const active = await makeListing(seller._id);
    await makeListing(seller._id, { status: 'draft' });
    await makeListing(seller._id, { quantity: 0 });

    const res = await request(app).get(`/api/users/${seller._id}/closet`);
    expect(res.status).toBe(200);
    expect(res.body.listings.map((l) => String(l._id))).toEqual([String(active._id)]);
    expect(res.body.total).toBe(1);
    expect(res.body.listings.every((l) => l.status === 'active' && l.quantity > 0)).toBe(true);
  });

  test('the profile count and closet agree on the visible catalog size', async () => {
    const seller = await makeUser('closet_count_seller');
    await makeListing(seller._id);
    await makeListing(seller._id, { status: 'draft' });
    await makeListing(seller._id, { quantity: 0 });

    const profile = await request(app).get(`/api/users/${seller._id}`);
    const closet = await request(app).get(`/api/users/${seller._id}/closet`);
    expect(profile.status).toBe(200);
    expect(profile.body.listingsCount).toBe(1);
    expect(closet.body.total).toBe(profile.body.listingsCount);
  });
});

describe('UC.2 the follower feed mirrors the public catalog', () => {
  test('drafts and out-of-stock listings from followed sellers are hidden', async () => {
    const viewer = await makeUser('feed_viewer');
    const followed = await makeUser('feed_followed');
    const active = await makeListing(followed._id);
    await makeListing(followed._id, { status: 'draft' });
    await makeListing(followed._id, { quantity: 0 });
    await User.updateOne({ _id: viewer._id }, { $push: { following: followed._id } });

    const res = await request(app)
      .get('/api/users/feed')
      .set('Authorization', `Bearer ${tokenFor(viewer)}`);

    expect(res.status).toBe(200);
    expect(res.body.listings.map((l) => String(l._id))).toEqual([String(active._id)]);
    expect(res.body.total).toBe(1);
  });
});
