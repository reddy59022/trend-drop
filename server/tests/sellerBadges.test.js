const mongoose = require('mongoose');
const request = require('supertest');
const app = require('../server');
const User = require('../models/User');
const SellerBadge = require('../models/SellerBadge');
const Listing = require('../models/Listing');
const Transaction = require('../models/Transaction');
const Rating = require('../models/Rating');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';

let user;
let buyer;
let userToken;
let testListing;

beforeAll(async () => {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/trenddrop_test');
  }
  
  const seedBase = `badge_${Date.now()}_`;
  
  user = await User.create({
    name: 'Badge Seller', email: `${seedBase}test@test.com`, password: 'password123',
    country: 'US', currency: 'USD', emailVerified: true, authProvider: 'email',
    shippingAddress: { fullName: 'Seller', street1: '123 St', city: 'City', state: 'CA', postalCode: '90210', country: 'US' },
  });
  buyer = await User.create({
    name: 'Badge Buyer', email: `${seedBase}buyer@test.com`, password: 'password123',
    country: 'US', currency: 'USD', emailVerified: true, authProvider: 'email',
    shippingAddress: { fullName: 'Buyer', street1: '123 St', city: 'City', state: 'CA', postalCode: '90210', country: 'US' },
  });
  testListing = await Listing.create({
    title: 'Badge fixture listing', description: 'Fixture', price: 10, category: 'Women',
    condition: 'Good', images: ['https://example.com/item.jpg'], seller: user._id,
    quantity: 1, status: 'active', available: true,
  });
  userToken = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '30d' });
});

const seedSales = async (count) => {
  const docs = Array.from({ length: count }, () => ({
    listing: testListing._id,
    buyer: buyer._id,
    seller: user._id,
    itemPrice: 10,
    currency: 'USD',
    status: 'completed',
    paymentBreakdown: { subtotal: 10, totalPaid: 10.8, sellerEarnings: 9.2 },
  }));
  await Transaction.insertMany(docs);
};

afterAll(async () => {
  await Transaction.deleteMany({ seller: user._id });
  await Rating.deleteMany({ seller: user._id });
  if (testListing) await Listing.findByIdAndDelete(testListing._id);
  if (user) await User.findByIdAndDelete(user._id);
  if (buyer) await User.findByIdAndDelete(buyer._id);
  await SellerBadge.deleteMany({ userId: user._id });
  await mongoose.connection.close();
});

describe('v39.0 Verified Badges & Seller Levels', () => {
  test('v39.1 - Should create badge on first fetch if not exists', async () => {
    const res = await request(app)
      .get('/api/seller-badges/me')
      .set('Authorization', `Bearer ${userToken}`);
    
    expect(res.status).toBe(200);
    expect(res.body.badge.tier).toBe('bronze');
  });

  test('v39.2 - Should verify seller badge', async () => {
    const res = await request(app)
      .put('/api/seller-badges/verify')
      .set('Authorization', `Bearer ${userToken}`);
    
    expect(res.status).toBe(200);
    expect(res.body.badge.isVerified).toBe(false);
    expect(res.body.badge.verificationRequested).toBe(true);
  });

  test('v39.3 - A pending request revokes stale verification state instead of self-approving', async () => {
    await SellerBadge.findOneAndUpdate(
      { userId: user._id },
      {
        isVerified: true,
        verifiedAt: new Date(),
        verificationRequested: false,
        benefits: { reducedFees: true, prioritySupport: true, featuredListings: true },
      },
      { new: true }
    );

    const res = await request(app)
      .put('/api/seller-badges/verify')
      .set('Authorization', `Bearer ${userToken}`);

    expect(res.status).toBe(200);
    expect(res.body.badge.isVerified).toBe(false);
    expect(res.body.badge.verificationRequested).toBe(true);
    expect(res.body.badge.verifiedAt).toBeFalsy();
    expect(res.body.badge.benefits.reducedFees).toBe(false);
    expect(res.body.badge.benefits.prioritySupport).toBe(false);
  });

  test('v39.4 - Should derive stats from sales and ratings and calculate tier', async () => {
    await seedSales(50);
    await Rating.create({ listing: testListing._id, reviewer: buyer._id, seller: user._id, rating: 4.7 });

    const res = await request(app)
      .put('/api/seller-badges/update-stats')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        salesCount: 9999,
        avgRating: 5,
        responseRate: 1,
        returnRate: 0,
      });
    
    expect(res.status).toBe(200);
    expect(res.body.badge.salesCount).toBe(50);
    expect(res.body.badge.tier).toBe('gold');
  });

  test('v39.4 - Should not cache the authenticated badge response', async () => {
    const res = await request(app)
      .get('/api/seller-badges/me')
      .set('Authorization', `Bearer ${userToken}`);

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  test('v39.5 - Should get public badge info', async () => {
    const res = await request(app).get(`/api/seller-badges/${user._id}`);
    expect(res.status).toBe(200);
    expect(res.body.badge.tier).toBeDefined();
  });

  test('v39.6 - Should return none tier for non-badge user', async () => {
    const otherUser = await User.create({
      name: 'No Badge User', email: `nobadge_${Date.now()}@test.com`, password: 'password123',
      country: 'US', currency: 'USD', emailVerified: true, authProvider: 'email',
      shippingAddress: { fullName: 'User', street1: '123 St', city: 'City', state: 'CA', postalCode: '90210', country: 'US' },
    });
    
    const res = await request(app).get(`/api/seller-badges/${otherUser._id}`);
    expect(res.status).toBe(200);
    expect(res.body.badge.tier).toBe('none');
    
    await User.findByIdAndDelete(otherUser._id);
  });

  test('v39.7 - Should reject malformed public seller IDs with 400', async () => {
    const res = await request(app).get('/api/seller-badges/not-an-object-id');
    expect(res.status).toBe(400);
  });

  test('v39.8 - Should require auth for me endpoint', async () => {
    const res = await request(app).get('/api/seller-badges/me');
    expect(res.status).toBe(401);
  });

  test('v39.9 - Should calculate platinum tier from authoritative high stats', async () => {
    await seedSales(200);
    const extraListing = await Listing.create({
      title: 'Second badge fixture', description: 'Fixture', price: 10, category: 'Women',
      condition: 'Good', images: ['https://example.com/item2.jpg'], seller: user._id,
      quantity: 1, status: 'active', available: true,
    });
    await Rating.create({ listing: extraListing._id, reviewer: buyer._id, seller: user._id, rating: 4.9 });

    const res = await request(app)
      .put('/api/seller-badges/update-stats')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        salesCount: 5000,
        avgRating: 5,
        responseRate: 1,
        returnRate: 0,
      });
    
    expect(res.status).toBe(200);
    expect(res.body.badge.salesCount).toBe(250);
    expect(res.body.badge.avgRating).toBeCloseTo(4.8, 2);
    expect(res.body.badge.tier).toBe('platinum');
    expect(res.body.badge.benefits.featuredListings).toBe(true);

    await Listing.findByIdAndDelete(extraListing._id);
  });

  test('v39.10 - Ignores a client-supplied response rate outside the normalized contract', async () => {
    const res = await request(app)
      .put('/api/seller-badges/update-stats')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ responseRate: 95 });

    expect(res.status).toBe(200);
    expect(res.body.badge.responseRate).toBeLessThanOrEqual(1);
    expect(res.body.badge.responseRate).not.toBe(95);
  });

  test('v39.11 - Client zeroed stats cannot erase authoritative sales', async () => {
    const res = await request(app)
      .put('/api/seller-badges/update-stats')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ salesCount: 0, avgRating: 0, responseRate: 0, returnRate: 0 });

    expect(res.status).toBe(200);
    expect(res.body.badge.salesCount).toBe(250);
    expect(res.body.badge.tier).toBe('platinum');
    expect(res.body.badge.benefits.featuredListings).toBe(true);
  });

  test('v39.12 - Should not grant verification benefits before admin approval', async () => {
    const badge = await SellerBadge.findOne({ userId: user._id });
    expect(badge.verificationRequested).toBe(true);
    expect(badge.isVerified).toBe(false);
    expect(badge.benefits.reducedFees).toBe(false);
    expect(badge.benefits.prioritySupport).toBe(false);
  });
});