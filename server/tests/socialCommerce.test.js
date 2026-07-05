const mongoose = require('mongoose');
const request = require('supertest');
const app = require('../server');
const User = require('../models/User');
const Listing = require('../models/Listing');
const SocialCommerce = require('../models/SocialCommerce');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';

let user;
let userToken;
let testListing;
let testConnection;

beforeAll(async () => {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/trenddrop_test');
  }
  
  const seedBase = `social_${Date.now()}_`;
  
  user = await User.create({
    name: 'Social Seller', email: `${seedBase}seller@test.com`, password: 'password123',
    country: 'US', currency: 'USD', emailVerified: true, authProvider: 'email',
    shippingAddress: { fullName: 'Seller', street1: '123 St', city: 'City', state: 'CA', postalCode: '90210', country: 'US' },
  });

  userToken = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '30d' });

  testListing = await Listing.create({
    title: 'Social Item',
    description: 'For testing social commerce',
    price: 100,
    category: 'Women',
    condition: 'New with tags',
    images: ['https://example.com/item.jpg'],
    seller: user._id,
    quantity: 1,
    status: 'active',
  });
});

afterAll(async () => {
  if (user) await User.findByIdAndDelete(user._id);
  if (testListing) await Listing.findByIdAndDelete(testListing._id);
  if (testConnection) await SocialCommerce.findByIdAndDelete(testConnection._id);
  await mongoose.connection.close();
});

describe('v49.0 Social Commerce Integrations', () => {
  test('v49.1 - Should list available platforms', async () => {
    const res = await request(app).get('/api/social-commerce/available');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(5);
  });

  test('v49.2 - Should require auth for connections', async () => {
    const res = await request(app).get('/api/social-commerce');
    expect(res.status).toBe(401);
  });

  test('v49.3 - Should connect a social commerce account', async () => {
    const res = await request(app)
      .post('/api/social-commerce/connect')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        platform: 'instagram',
        accountId: 'test_instagram_123',
        accessToken: 'fake_token_xyz',
      });

    expect(res.status).toBe(200);
    expect(res.body.platform).toBe('instagram');
    testConnection = res.body;
  });

  test('v49.4 - Should get user connections', async () => {
    const res = await request(app)
      .get('/api/social-commerce')
      .set('Authorization', `Bearer ${userToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
  });

  test('v49.5 - Should sync listings to platform', async () => {
    const res = await request(app)
      .post(`/api/social-commerce/${testConnection._id}/sync`)
      .set('Authorization', `Bearer ${userToken}`);

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Sync completed');
  });

  test('v49.6 - Should update settings', async () => {
    const res = await request(app)
      .put(`/api/social-commerce/${testConnection._id}/settings`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        autoPostListings: true,
        syncFrequency: 'daily',
      });

    expect(res.status).toBe(200);
    expect(res.body.settings.autoPostListings).toBe(true);
  });

  test('v49.7 - Should get connection statistics', async () => {
    const res = await request(app)
      .get(`/api/social-commerce/${testConnection._id}/stats`)
      .set('Authorization', `Bearer ${userToken}`);

    expect(res.status).toBe(200);
    expect(res.body.totalPosts).toBeGreaterThan(0);
  });

  test('v49.8 - Should reject invalid platform', async () => {
    const res = await request(app)
      .post('/api/social-commerce/connect')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        platform: 'invalid_platform',
        accountId: 'test',
      });

    expect(res.status).toBe(400);
  });

  test('v49.9 - Should require auth for sync', async () => {
    const res = await request(app)
      .post(`/api/social-commerce/${testConnection._id}/sync`);

    expect(res.status).toBe(401);
  });

  test('v49.10 - Should delete connection', async () => {
    const res = await request(app)
      .delete(`/api/social-commerce/${testConnection._id}`)
      .set('Authorization', `Bearer ${userToken}`);

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Connection removed');
    testConnection = null; // Prevent double cleanup
  });
});