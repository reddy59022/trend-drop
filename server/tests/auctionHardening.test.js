/**
 * TDD round: auction creation validation and lifecycle reuse.
 */
const mongoose = require('mongoose');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../server');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Auction = require('../models/Auction');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';
const tokenFor = (user) => jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '30d' });
const created = { users: [], listings: [], auctions: [] };

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
    title: 'Auction fixture item',
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
    currency: 'USD',
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
  await Auction.deleteMany({ _id: { $in: created.auctions } });
  await Listing.deleteMany({ _id: { $in: created.listings } });
  await User.deleteMany({ _id: { $in: created.users } });
  await mongoose.connection.close();
});

const body = (listing, overrides = {}) => ({
  listingId: listing._id,
  startTime: new Date(Date.now() + 3600000).toISOString(),
  endTime: new Date(Date.now() + 7200000).toISOString(),
  reservePrice: 90,
  currency: 'USD',
  ...overrides,
});

describe('AH.1 auction creation validates money, currency and schedule', () => {
  let seller;

  beforeAll(async () => {
    seller = await makeUser('auction_seller');
  });

  const post = (listing, overrides) => request(app)
    .post('/api/auctions')
    .set('Authorization', `Bearer ${tokenFor(seller)}`)
    .send(body(listing, overrides));

  test.each([
    ['non-numeric reserve price', { reservePrice: 'not-a-number' }],
    ['negative reserve price', { reservePrice: -50 }],
    ['unknown currency', { currency: 'XXX' }],
    ['unparseable start date', { startTime: 'tomorrow-ish' }],
    ['unparseable end date', { endTime: 'later-ish' }],
  ])('rejects %s', async (_label, overrides) => {
    const listing = await makeListing(seller._id);
    const res = await post(listing, overrides);
    expect(res.status).toBe(400);
  });

  test('rejects auctioning a draft listing', async () => {
    const draft = await makeListing(seller._id, { status: 'draft' });
    const res = await post(draft);
    expect(res.status).toBe(400);
  });

  test('accepts a valid auction', async () => {
    const listing = await makeListing(seller._id);
    const res = await post(listing);
    expect(res.status).toBe(201);
    created.auctions.push(res.body.auction._id);
  });
});

describe('AH.2 a cancelled auction does not block a new one', () => {
  test('the seller can re-auction after cancelling', async () => {
    const seller = await makeUser('auction_reuse_seller');
    const listing = await makeListing(seller._id);
    const token = tokenFor(seller);

    const first = await request(app)
      .post('/api/auctions')
      .set('Authorization', `Bearer ${token}`)
      .send(body(listing));
    expect(first.status).toBe(201);
    created.auctions.push(first.body.auction._id);

    const cancelled = await request(app)
      .delete(`/api/auctions/${first.body.auction._id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(cancelled.status).toBe(200);

    const second = await request(app)
      .post('/api/auctions')
      .set('Authorization', `Bearer ${token}`)
      .send(body(listing));
    expect(second.status).toBe(201);
    created.auctions.push(second.body.auction._id);
  });
});
