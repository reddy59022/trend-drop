const mongoose = require('mongoose');
const request = require('supertest');
const app = require('../server');
const User = require('../models/User');
const Listing = require('../models/Listing');
const RecentlyViewed = require('../models/RecentlyViewed');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';

let user;
let userToken;
let testListing;

beforeAll(async () => {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/trenddrop_test');
  }
  
  const seedBase = `recent_${Date.now()}_`;
  
  user = await User.create({
    name: 'Recent View User', email: `${seedBase}test@test.com`, password: 'password123',
    country: 'US', currency: 'USD', emailVerified: true, authProvider: 'email',
    shippingAddress: { fullName: 'User', street1: '123 St', city: 'City', state: 'CA', postalCode: '90210', country: 'US' },
  });
  userToken = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '30d' });
  
  // Create a test listing
  const listingRes = await request(app)
    .post('/api/listings')
    .set('Authorization', `Bearer ${userToken}`)
    .field('title', 'Test Listing')
    .field('description', 'Test description')
    .field('price', 50)
    .field('category', 'Men')
    .field('condition', 'Good')
    .field('brand', 'TestBrand')
    .field('size', 'M')
    .field('color', 'Black')
    .field('weight', 0.5)
    .field('quantity', 3);
  
  testListing = listingRes.body.listing;
});

afterAll(async () => {
  if (user) await User.findByIdAndDelete(user._id);
  await RecentlyViewed.deleteMany({ userId: user._id });
  await mongoose.connection.close();
});

describe('v38.0 Recently Viewed Items', () => {
  test('v38.1 - Should record a view when user views listing', async () => {
    const res = await request(app)
      .post(`/api/recently-viewed/${testListing._id}`)
      .set('Authorization', `Bearer ${userToken}`);
    
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });

  test('v38.2 - Should not duplicate views for same listing', async () => {
    const res = await request(app)
      .post(`/api/recently-viewed/${testListing._id}`)
      .set('Authorization', `Bearer ${userToken}`);
    
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Already viewed');
  });

  test('v38.3 - Should fetch user recently viewed listings', async () => {
    const res = await request(app)
      .get('/api/recently-viewed')
      .set('Authorization', `Bearer ${userToken}`);
    
    expect(res.status).toBe(200);
    expect(res.body.items).toBeDefined();
    expect(Array.isArray(res.body.items)).toBe(true);
  });

  test('v38.4 - Should limit recently viewed items', async () => {
    const res = await request(app)
      .get('/api/recently-viewed?limit=5')
      .set('Authorization', `Bearer ${userToken}`);
    
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeLessThanOrEqual(5);
  });

  test('v38.5 - Should clear view history', async () => {
    const res = await request(app)
      .delete('/api/recently-viewed/clear')
      .set('Authorization', `Bearer ${userToken}`);
    
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('View history cleared');
  });

  test('v38.6 - Should return empty after clearing history', async () => {
    const res = await request(app)
      .get('/api/recently-viewed')
      .set('Authorization', `Bearer ${userToken}`);
    
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
  });

  test('v38.7 - Should require auth for recording view', async () => {
    const res = await request(app)
      .post(`/api/recently-viewed/${testListing._id}`);
    
    expect(res.status).toBe(401);
  });

  test('v38.8 - Should require auth for fetching history', async () => {
    const res = await request(app)
      .get('/api/recently-viewed');
    
    expect(res.status).toBe(401);
  });

  test('v38.9 - Should require auth for clearing history', async () => {
    const res = await request(app)
      .delete('/api/recently-viewed/clear');
    
    expect(res.status).toBe(401);
  });

  test('v38.10 - Should populate listing data in response', async () => {
    // Re-add a view
    await request(app)
      .post(`/api/recently-viewed/${testListing._id}`)
      .set('Authorization', `Bearer ${userToken}`);
    
    const res = await request(app)
      .get('/api/recently-viewed')
      .set('Authorization', `Bearer ${userToken}`);
    
    expect(res.status).toBe(200);
    expect(res.body.items[0]).toHaveProperty('title');
    expect(res.body.items[0]).toHaveProperty('price');
  });
});