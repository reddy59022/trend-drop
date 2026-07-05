const mongoose = require('mongoose');
const request = require('supertest');
const app = require('../server');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Vendor = require('../models/Vendor');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';

let user;
let userToken;

beforeAll(async () => {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/trenddrop_test');
  }
  
  const seedBase = `vendor_${Date.now()}_`;
  
  user = await User.create({
    name: 'Vendor User', email: `${seedBase}vendor@test.com`, password: 'password123',
    country: 'US', currency: 'USD', emailVerified: true, authProvider: 'email',
    shippingAddress: { fullName: 'User', street1: '123 St', city: 'City', state: 'CA', postalCode: '90210', country: 'US' },
  });

  userToken = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '30d' });
});

afterAll(async () => {
  if (user) await User.findByIdAndDelete(user._id);
  await Vendor.deleteMany({});
  await mongoose.connection.close();
});

describe('v58.0 Multi-Vendor Marketplace', () => {
  test('v58.1 - Should require auth for vendors', async () => {
    const res = await request(app).get('/api/vendors');
    expect(res.status).toBe(401);
  });

  test('v58.2 - Should get vendor listings', async () => {
    const res = await request(app)
      .get('/api/vendors')
      .set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('v58.3 - Should create vendor listing', async () => {
    const res = await request(app)
      .post('/api/vendors')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ listingId: 'test-listing', commission: 10 });
    expect(res.status).toBe(201);
    expect(res.body.sellers).toBeDefined();
  });

  test('v58.4 - Should update shared inventory', async () => {
    const vendor = await Vendor.create({
      listing: 'test-listing',
      sellers: [{ seller: user._id, commission: 10, isPrimary: true }]
    });
    
    const res = await request(app)
      .put('/api/vendors/shared-inventory')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ listingId: 'test-listing', quantity: 20 });
    expect(res.status).toBe(200);
  });
});