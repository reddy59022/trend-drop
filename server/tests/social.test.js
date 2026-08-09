/**
 * Integration tests for Social Sharing endpoint.
 */
const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../server');
const User = require('../models/User');
const Listing = require('../models/Listing');

const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';
const generateToken = (userId) => jwt.sign({ id: userId }, JWT_SECRET, { expiresIn: '30d' });

let sellerToken, sellerId, buyerToken;
const TEST_RUN_ID = `social_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const testUserIds = [];
const testListingIds = [];

beforeAll(async () => {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/trend-drop-test';
  if (mongoose.connection.readyState === 0) await mongoose.connect(uri);

  const seller = await User.create({ name: 'SocialSeller', email: `social_${TEST_RUN_ID}@test.com`, password: 'password123', emailVerified: true, authProvider: 'email' });
  testUserIds.push(seller._id);
  sellerId = seller._id;
  sellerToken = generateToken(seller._id);

  const buyer = await User.create({ name: 'SocialBuyer', email: `socialb_${TEST_RUN_ID}@test.com`, password: 'password123', emailVerified: true, authProvider: 'email' });
  testUserIds.push(buyer._id);
  buyerToken = generateToken(buyer._id);
});

afterAll(async () => {
  await Listing.deleteMany({ _id: { $in: testListingIds } });
  await User.deleteMany({ _id: { $in: testUserIds } });
  // Do NOT disconnect — jest.setup.js afterAll cleans DB between files
});

describe('Social Sharing', () => {
  test('SOC.1 Share listing increments share count', async () => {
    const listing = await Listing.create({ seller: sellerId, title: 'Share Test', description: 'Desc', price: 100, category: 'Men', condition: 'New with tags', available: true, quantity: 5, shipsFrom: 'US', weight: 1 });
    testListingIds.push(listing._id);

    const r = await request(app).post(`/api/listings/${listing._id}/share`).set('Authorization', `Bearer ${buyerToken}`);
    expect(r.status).toBe(200);
    expect(r.body.shares).toBe(1);
  });

  test('SOC.2 Duplicate share does not double-count', async () => {
    const listing = await Listing.create({ seller: sellerId, title: 'Share Test 2', description: 'Desc', price: 100, category: 'Men', condition: 'New with tags', available: true, quantity: 5, shipsFrom: 'US', weight: 1 });
    testListingIds.push(listing._id);

    await request(app).post(`/api/listings/${listing._id}/share`).set('Authorization', `Bearer ${buyerToken}`);
    const r = await request(app).post(`/api/listings/${listing._id}/share`).set('Authorization', `Bearer ${buyerToken}`);
    expect(r.body.shares).toBe(1); // Same user, no double count
  });

  test('SOC.3 Unauthenticated cannot share', async () => {
    const listing = await Listing.create({ seller: sellerId, title: 'Share Test 3', description: 'Desc', price: 100, category: 'Men', condition: 'New with tags', available: true, quantity: 5, shipsFrom: 'US', weight: 1 });
    testListingIds.push(listing._id);

    const r = await request(app).post(`/api/listings/${listing._id}/share`);
    expect(r.status).toBe(401);
  });
});