const mongoose = require('mongoose');
const request = require('supertest');
const app = require('../server');
const User = require('../models/User');
const CrossBorder = require('../models/CrossBorder');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';

let user;
let userToken;

beforeAll(async () => {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/trenddrop_test');
  }
  
  user = await User.create({
    name: 'Intl Seller', email: `intl_${Date.now()}@test.com`, password: 'password123',
    country: 'US', currency: 'USD', emailVerified: true, authProvider: 'email',
    shippingAddress: { fullName: 'Seller', street1: '123 St', city: 'City', state: 'CA', postalCode: '90210', country: 'US' },
  });

  userToken = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '30d' });
});

afterAll(async () => {
  if (user) await User.findByIdAndDelete(user._id);
  await CrossBorder.deleteMany({ seller: user._id });
  await mongoose.connection.close();
});

describe('v52.0 Cross-Border Marketplace', () => {
  test('v52.1 - Should require auth for cross-border settings', async () => {
    const res = await request(app).get('/api/cross-border');
    expect(res.status).toBe(401);
  });

  test('v52.2 - Should get/create cross-border settings', async () => {
    const res = await request(app)
      .get('/api/cross-border')
      .set('Authorization', `Bearer ${userToken}`);

    expect(res.status).toBe(200);
    expect(res.body.country).toBeDefined();
  });

  test('v52.3 - Should update cross-border settings', async () => {
    const res = await request(app)
      .put('/api/cross-border')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ country: 'CA', currency: 'CAD', taxId: 'TAX123' });

    expect(res.status).toBe(200);
    expect(res.body.currency).toBe('CAD');
  });

  test('v52.4 - Should list supported countries', async () => {
    const res = await request(app).get('/api/cross-border/countries');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});