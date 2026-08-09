/**
 * Integration tests for Price History tracking.
 */
const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../server');
const User = require('../models/User');
const Listing = require('../models/Listing');
const PriceHistory = require('../models/PriceHistory');

const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';
const generateToken = (userId) => jwt.sign({ id: userId }, JWT_SECRET, { expiresIn: '30d' });

let sellerToken, sellerId;
const TEST_RUN_ID = `price_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const testUserIds = [];
const testListingIds = [];

beforeAll(async () => {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/trend-drop-test';
  if (mongoose.connection.readyState === 0) await mongoose.connect(uri);

  const seller = await User.create({ name: 'PriceSeller', email: `price_${TEST_RUN_ID}@test.com`, password: 'password123', emailVerified: true, authProvider: 'email' });
  testUserIds.push(seller._id); sellerId = seller._id; sellerToken = generateToken(seller._id);
});

afterAll(async () => {
  await PriceHistory.deleteMany({ listing: { $in: testListingIds } });
  await Listing.deleteMany({ _id: { $in: testListingIds } });
  await User.deleteMany({ _id: { $in: testUserIds } });
  // Do NOT disconnect — jest.setup.js afterAll cleans DB between files
});

describe('Price History', () => {
  test('PRICE.1 Track price change', async () => {
    const listing = await Listing.create({ seller: sellerId, title: 'Price Track', description: 'D', price: 100, category: 'Men', condition: 'Good', available: true, quantity: 1, shipsFrom: 'US', weight: 1 });
    testListingIds.push(listing._id);

    const r = await request(app).post('/api/pricehistory').set('Authorization', `Bearer ${sellerToken}`).send({ listingId: listing._id, price: 80 });
    expect(r.status).toBe(201);
  });

  test('PRICE.2 Get price history for listing', async () => {
    const listing = testListingIds[0];
    const r = await request(app).get(`/api/pricehistory/${listing}`).set('Authorization', `Bearer ${sellerToken}`);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBe(true);
  });
});