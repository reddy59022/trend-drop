const mongoose = require('mongoose');
const request = require('supertest');
const app = require('../server');
const User = require('../models/User');
const SellerBadge = require('../models/SellerBadge');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';

let user;
let userToken;

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
  userToken = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '30d' });
});

afterAll(async () => {
  if (user) await User.findByIdAndDelete(user._id);
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

  test('v39.3 - Should update stats and calculate tier', async () => {
    const res = await request(app)
      .put('/api/seller-badges/update-stats')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        salesCount: 50,
        avgRating: 4.7,
        responseRate: 0.95,
        returnRate: 0.04,
      });
    
    expect(res.status).toBe(200);
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

  test('v39.9 - Should calculate platinum tier for high stats', async () => {
    const res = await request(app)
      .put('/api/seller-badges/update-stats')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        salesCount: 250,
        avgRating: 4.9,
        responseRate: 0.98,
        returnRate: 0.01,
      });
    
    expect(res.status).toBe(200);
    expect(res.body.badge.tier).toBe('platinum');
    expect(res.body.badge.benefits.featuredListings).toBe(true);
  });

  test('v39.10 - Should reject response rates outside the normalized 0..1 contract', async () => {
    const res = await request(app)
      .put('/api/seller-badges/update-stats')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ responseRate: 95 });

    expect(res.status).toBe(400);
  });

  test('v39.11 - Should preserve intentional zero stats updates', async () => {
    const res = await request(app)
      .put('/api/seller-badges/update-stats')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ salesCount: 0, avgRating: 0, responseRate: 0, returnRate: 0 });

    expect(res.status).toBe(200);
    expect(res.body.badge.salesCount).toBe(0);
    expect(res.body.badge.avgRating).toBe(0);
    expect(res.body.badge.responseRate).toBe(0);
    expect(res.body.badge.returnRate).toBe(0);
    expect(res.body.badge.benefits.featuredListings).toBe(false);
  });

  test('v39.12 - Should not grant verification benefits before admin approval', async () => {
    const badge = await SellerBadge.findOne({ userId: user._id });
    expect(badge.verificationRequested).toBe(true);
    expect(badge.isVerified).toBe(false);
    expect(badge.benefits.reducedFees).toBe(false);
    expect(badge.benefits.prioritySupport).toBe(false);
  });
});