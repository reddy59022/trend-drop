/**
 * TDD round: collections must hide unpublished listings publicly and must be
 * idempotent when the same listing id is supplied twice.
 */
const mongoose = require('mongoose');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../server');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Collection = require('../models/Collection');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';
const tokenFor = (user) => jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '30d' });
const created = { users: [], listings: [], collections: [] };

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
    title: 'Collection fixture item',
    description: 'Fixture',
    price: 50,
    category: 'Men',
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

const makeCollection = async (seller, listings = []) => {
  const collection = await Collection.create({
    seller,
    name: 'Summer picks',
    description: 'Fixture',
    listings,
    isActive: true,
    sortOrder: 0,
  });
  created.collections.push(collection._id);
  return collection;
};

beforeAll(async () => {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/trenddrop_test');
  }
});

afterAll(async () => {
  await Collection.deleteMany({ _id: { $in: created.collections } });
  await Listing.deleteMany({ _id: { $in: created.listings } });
  await User.deleteMany({ _id: { $in: created.users } });
  await mongoose.connection.close();
});

describe('CH.1 collection listings match catalog visibility', () => {
  test('the public seller collections endpoint hides draft and deleted listings', async () => {
    const seller = await makeUser('coll_visibility');
    const active = await makeListing(seller._id);
    const draft = await makeListing(seller._id, { status: 'draft' });
    const deleted = await makeListing(seller._id, { status: 'deleted' });
    await makeCollection(seller._id, [active._id, draft._id, deleted._id]);

    const res = await request(app).get(`/api/collections/seller/${seller._id}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].listings.map((l) => l._id)).toEqual([String(active._id)]);
  });

  test('the owner still sees their hidden listings in the collection detail', async () => {
    const seller = await makeUser('coll_owner');
    const draft = await makeListing(seller._id, { status: 'draft' });
    const collection = await makeCollection(seller._id, [draft._id]);

    const res = await request(app)
      .get(`/api/collections/${collection._id}`)
      .set('Authorization', `Bearer ${tokenFor(seller)}`);
    expect(res.status).toBe(200);
    expect(res.body.listings.map((l) => String(l._id))).toEqual([String(draft._id)]);
  });
});

describe('CH.2 duplicate listing ids are idempotent', () => {
  test('updating with the same id twice succeeds and stores it once', async () => {
    const seller = await makeUser('coll_dup_update');
    const listing = await makeListing(seller._id);
    const collection = await makeCollection(seller._id);

    const res = await request(app)
      .put(`/api/collections/${collection._id}`)
      .set('Authorization', `Bearer ${tokenFor(seller)}`)
      .send({ listings: [String(listing._id), String(listing._id)] });
    expect(res.status).toBe(200);
    expect(res.body.listings).toHaveLength(1);
  });

  test('adding the same listing twice does not duplicate it', async () => {
    const seller = await makeUser('coll_dup_add');
    const listing = await makeListing(seller._id);
    const collection = await makeCollection(seller._id);
    const token = tokenFor(seller);

    const first = await request(app)
      .post(`/api/collections/${collection._id}/listings`)
      .set('Authorization', `Bearer ${token}`)
      .send({ listingId: listing._id });
    expect(first.status).toBe(200);

    const second = await request(app)
      .post(`/api/collections/${collection._id}/listings`)
      .set('Authorization', `Bearer ${token}`)
      .send({ listingId: listing._id });
    expect(second.status).toBe(200);
    expect(second.body.listings).toHaveLength(1);
  });
});
