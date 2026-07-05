const mongoose = require('mongoose');
const request = require('supertest');
const app = require('../server');
const User = require('../models/User');
const ShippingIntegration = require('../models/ShippingIntegration');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';

let user;
let userToken;

beforeAll(async () => {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/trenddrop_test');
  }
  
  const seedBase = `ship_${Date.now()}_`;
  
  user = await User.create({
    name: 'Shipping User', email: `${seedBase}ship@test.com`, password: 'password123',
    country: 'US', currency: 'USD', emailVerified: true, authProvider: 'email',
    shippingAddress: { fullName: 'User', street1: '123 St', city: 'City', state: 'CA', postalCode: '90210', country: 'US' },
  });

  userToken = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '30d' });
});

afterAll(async () => {
  if (user) await User.findByIdAndDelete(user._id);
  await ShippingIntegration.deleteMany({});
  await mongoose.connection.close();
});

describe('v59.0 Advanced Shipping Options', () => {
  test('v59.1 - Should require auth for shipping', async () => {
    const res = await request(app).get('/api/advanced-shipping');
    expect(res.status).toBe(401);
  });

  test('v59.2 - Should get shipping integrations', async () => {
    const res = await request(app)
      .get('/api/advanced-shipping')
      .set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('v59.3 - Should add carrier integration', async () => {
    const res = await request(app)
      .post('/api/advanced-shipping')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ carrier: 'UPS', apiKey: 'test-key' });
    expect(res.status).toBe(201);
    expect(res.body.carrier).toBe('UPS');
  });

  test('v59.4 - Should calculate shipping rate', async () => {
    await ShippingIntegration.create({ user: user._id, carrier: 'UPS', apiKey: 'test-key' });
    
    const res = await request(app)
      .post('/api/advanced-shipping/rates')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ carrier: 'UPS', weight: 2 });
    expect(res.status).toBe(200);
    expect(res.body.estimatedCost).toBeDefined();
  });

  test('v59.5 - Should generate shipping label', async () => {
    const res = await request(app)
      .post('/api/advanced-shipping/label')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ carrier: 'UPS', service: 'Ground' });
    expect(res.status).toBe(200);
    expect(res.body.trackingNumber).toBeDefined();
  });
});