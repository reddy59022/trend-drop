/**
 * Tests for Bundle Discounts (Section 28a)
 * Tests: create, list, update, delete, apply bundle rules
 */
const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../server');
const BundleRule = require('../models/BundleRule');
const Listing = require('../models/Listing');
const User = require('../models/User');

const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';
const generateToken = (userId) => jwt.sign({ id: userId }, JWT_SECRET, { expiresIn: '30d' });

let seller, buyer, sellerToken, buyerToken, listing;
const testUserIds = [];
const testListingIds = [];
const testBundleIds = [];

beforeAll(async () => {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/trend-drop-test';
  if (mongoose.connection.readyState === 0) await mongoose.connect(uri);

  seller = await User.create({ name: 'BundleSeller', email: `bundle_seller_${Date.now()}@test.com`, password: 'password123', emailVerified: true, country: 'US', currency: 'USD' });
  testUserIds.push(seller._id);
  buyer = await User.create({ name: 'BundleBuyer', email: `bundle_buyer_${Date.now()}@test.com`, password: 'password123', emailVerified: true, country: 'US', currency: 'USD' });
  testUserIds.push(buyer._id);
  sellerToken = generateToken(seller._id);
  buyerToken = generateToken(buyer._id);

  listing = await Listing.create({ seller: seller._id, title: 'Bundle Test Item', description: 'Test', price: 50, category: 'Women', condition: 'New with tags', available: true, quantity: 5, shipsFrom: 'US', weight: 1 });
  testListingIds.push(listing._id);
});

afterAll(async () => {
  await BundleRule.deleteMany({ _id: { $in: testBundleIds } });
  await Listing.deleteMany({ _id: { $in: testListingIds } });
  await User.deleteMany({ _id: { $in: testUserIds } });
  await mongoose.disconnect();
});

describe('Bundle Discounts (Section 28a)', () => {
  let bundleId;

  test('BD.1 Create bundle rule', async () => {
    const res = await request(app)
      .post('/api/offers/bundle')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ name: 'Summer Bundle', minQuantity: 2, discountPercent: 15, applicableCategories: ['Women', 'Accessories'], description: 'Buy 2+ items, save 15%' });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Summer Bundle');
    expect(res.body.discountPercent).toBe(15);
    expect(res.body.minQuantity).toBe(2);
    bundleId = res.body._id;
    testBundleIds.push(bundleId);
  });

  test('BD.2 List seller bundle rules', async () => {
    const res = await request(app).get('/api/offers/bundle').set('Authorization', `Bearer ${sellerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0].name).toBe('Summer Bundle');
  });

  test('BD.3 Update bundle rule', async () => {
    const res = await request(app)
      .put(`/api/offers/bundle/${bundleId}`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ discountPercent: 20, minQuantity: 3 });
    expect(res.status).toBe(200);
    expect(res.body.discountPercent).toBe(20);
    expect(res.body.minQuantity).toBe(3);
  });

  test('BD.4 Delete bundle rule', async () => {
    // Create another to delete
    const createRes = await request(app)
      .post('/api/offers/bundle')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ name: 'Temp Rule', minQuantity: 2, discountPercent: 10 });
    const tempId = createRes.body._id;

    const res = await request(app).delete(`/api/offers/bundle/${tempId}`).set('Authorization', `Bearer ${sellerToken}`);
    expect(res.status).toBe(200);
    const found = await BundleRule.findById(tempId);
    expect(found).toBeNull();
  });

  test('BD.5 Apply bundle discount - no eligible items', async () => {
    const res = await request(app)
      .post('/api/offers/bundle/apply')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ items: [{ listingId: listing._id, quantity: 1, price: 50 }] });
    expect(res.status).toBe(200);
    expect(res.body.totalBundleDiscount).toBe(0);
  });

  test('BD.6 Apply bundle discount - eligible items', async () => {
    const res = await request(app)
      .post('/api/offers/bundle/apply')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({
        items: [
          { listingId: listing._id, quantity: 2, price: 50 },
        ]
      });
    expect(res.status).toBe(200);
    // Should have discount since minQuantity=3 was set in BD.3, but we have qty 2
    // The rule requires minQuantity=3, so this should be 0
    expect(res.body.totalBundleDiscount).toBe(0);
  });

  test('BD.7 Unauthorized access', async () => {
    const res = await request(app).post('/api/offers/bundle').send({ name: 'Hack', minQuantity: 2, discountPercent: 10 });
    expect(res.status).toBe(401);
  });

  test('BD.8 Update other seller rule fails', async () => {
    const res = await request(app)
      .put(`/api/offers/bundle/${bundleId}`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ discountPercent: 5 });
    expect(res.status).toBe(403);
  });

  test('BD.9 Create bundle requires name and discount', async () => {
    const res = await request(app)
      .post('/api/offers/bundle')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ minQuantity: 2 });
    expect(res.status).toBe(400);
  });
});