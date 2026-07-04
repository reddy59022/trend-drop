const mongoose = require('mongoose');
const request = require('supertest');
const app = require('../server');
const User = require('../models/User');
const Listing = require('../models/Listing');
const VirtualTryOn = require('../models/VirtualTryOn');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';

let user, seller;
let userToken;
let testListing;

beforeAll(async () => {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/trenddrop_test');
  }
  
  const seedBase = `vt_${Date.now()}_`;
  
  user = await User.create({
    name: 'VT User', email: `${seedBase}user@test.com`, password: 'password123',
    country: 'US', currency: 'USD', emailVerified: true, authProvider: 'email',
    shippingAddress: { fullName: 'User', street1: '123 St', city: 'City', state: 'CA', postalCode: '90210', country: 'US' },
  });
  userToken = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '30d' });
  
  seller = await User.create({
    name: 'VT Seller', email: `${seedBase}seller@test.com`, password: 'password123',
    country: 'US', currency: 'USD', emailVerified: true, authProvider: 'email',
    shippingAddress: { fullName: 'Seller', street1: '456 St', city: 'City', state: 'CA', postalCode: '90210', country: 'US' },
  });
  
  testListing = await Listing.create({
    title: 'Test Dress for Try-On',
    description: 'Beautiful dress for testing virtual try-on',
    price: 50,
    category: 'Women',
    condition: 'New with tags',
    images: ['https://example.com/dress.jpg'],
    seller: seller._id,
    quantity: 1,
    status: 'active',
  });
});

afterAll(async () => {
  if (user) await User.findByIdAndDelete(user._id);
  if (seller) await User.findByIdAndDelete(seller._id);
  if (testListing) await Listing.findByIdAndDelete(testListing._id);
  await mongoose.connection.close();
});

describe('v41.0 Virtual Try-On', () => {
  test('v41.1 - Should get virtual try-on settings', async () => {
    const res = await request(app).get('/api/virtual-try-on/settings');
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(true);
    expect(res.body.arSupported).toBe(true);
    expect(res.body.supportedCategories).toContain('Women');
  });

  test('v41.2 - Should create virtual try-on session', async () => {
    const res = await request(app)
      .post('/api/virtual-try-on/session')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        listingId: testListing._id,
        sessionType: 'ar',
        measurements: { bust: 36, waist: 28, hip: 38 },
      });
    
    expect(res.status).toBe(200);
    expect(res.body.listingId).toBeDefined();
    expect(res.body.fitAnalysis.recommendedSize).toBe('M');
    expect(res.body.fitAnalysis.confidenceScore).toBeGreaterThan(0);
  });

  test('v41.3 - Should require authentication for session creation', async () => {
    const res = await request(app)
      .post('/api/virtual-try-on/session')
      .send({ listingId: testListing._id });
    
    expect(res.status).toBe(401);
  });

  test('v41.4 - Should return 404 for non-existent listing', async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const res = await request(app)
      .post('/api/virtual-try-on/session')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ listingId: fakeId });
    
    expect(res.status).toBe(404);
    expect(res.body.message).toContain('not found');
  });

  test('v41.5 - Should get user try-on history', async () => {
    // Create a session first
    await request(app)
      .post('/api/virtual-try-on/session')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        listingId: testListing._id,
        sessionType: 'ar',
      });
    
    const res = await request(app)
      .get('/api/virtual-try-on')
      .set('Authorization', `Bearer ${userToken}`);
    
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('v41.6 - Should get specific try-on session by listing ID', async () => {
    // Create session
    const createRes = await request(app)
      .post('/api/virtual-try-on/session')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ listingId: testListing._id });
    
    const res = await request(app)
      .get(`/api/virtual-try-on/${testListing._id}`)
      .set('Authorization', `Bearer ${userToken}`);
    
    expect(res.status).toBe(200);
    expect(res.body.sessionType).toBe('ar');
  });

  test('v41.7 - Should update try-on session', async () => {
    // Create session
    const createRes = await request(app)
      .post('/api/virtual-try-on/session')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ listingId: testListing._id });
    
    const tryOnId = createRes.body._id;
    
    const res = await request(app)
      .put(`/api/virtual-try-on/${tryOnId}`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ imageUrl: 'https://example.com/result.jpg', durationSeconds: 30 });
    
    expect(res.status).toBe(200);
    expect(res.body.imageUrl).toBeDefined();
  });

  test('v41.8 - Should delete try-on session', async () => {
    // Create session
    const createRes = await request(app)
      .post('/api/virtual-try-on/session')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ listingId: testListing._id });
    
    const tryOnId = createRes.body._id;
    
    const delRes = await request(app)
      .delete(`/api/virtual-try-on/${tryOnId}`)
      .set('Authorization', `Bearer ${userToken}`);
    
    expect(delRes.status).toBe(200);
    expect(delRes.body.message).toContain('deleted');
    
    // Verify it's deleted
    const getRes = await request(app)
      .get(`/api/virtual-try-on/${tryOnId}`)
      .set('Authorization', `Bearer ${userToken}`);
    
    expect(getRes.status).toBe(404);
  });

  test('v41.9 - Should calculate size for small measurements', async () => {
    const res = await request(app)
      .post('/api/virtual-try-on/session')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        listingId: testListing._id,
        measurements: { bust: 32, waist: 28, hip: 33 },
      });
    
    expect(res.status).toBe(200);
    expect(res.body.fitAnalysis.recommendedSize).toBe('S');
  });

  test('v41.10 - Should calculate size for large measurements', async () => {
    const secondListing = await Listing.create({
      title: 'Another Test Item',
      description: 'For size testing',
      price: 60,
      category: 'Men',
      condition: 'New with tags',
      images: ['https://example.com/item.jpg'],
      seller: seller._id,
      quantity: 1,
      status: 'active',
    });
    
    const res = await request(app)
      .post('/api/virtual-try-on/session')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        listingId: secondListing._id,
        measurements: { bust: 44, waist: 35, hip: 46 },
      });
    
    expect(res.status).toBe(200);
    expect(res.body.fitAnalysis.recommendedSize).toBe('XL');
    
    // Cleanup
    await Listing.findByIdAndDelete(secondListing._id);
  });
});