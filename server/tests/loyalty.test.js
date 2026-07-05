const mongoose = require('mongoose');
const request = require('supertest');
const app = require('../server');
const User = require('../models/User');
const LoyaltyProgram = require('../models/LoyaltyProgram');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';

let user;
let userToken;

beforeAll(async () => {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/trenddrop_test');
  }
  
  const seedBase = `loyalty_${Date.now()}_`;
  
  user = await User.create({
    name: 'Loyalty User', email: `${seedBase}loyalty@test.com`, password: 'password123',
    country: 'US', currency: 'USD', emailVerified: true, authProvider: 'email',
    shippingAddress: { fullName: 'User', street1: '123 St', city: 'City', state: 'CA', postalCode: '90210', country: 'US' },
  });

  userToken = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '30d' });
});

afterAll(async () => {
  if (user) await User.findByIdAndDelete(user._id);
  await LoyaltyProgram.deleteMany({});
  await mongoose.connection.close();
});

describe('v57.0 Customer Loyalty Program', () => {
  test('v57.1 - Should require auth for loyalty', async () => {
    const res = await request(app).get('/api/loyalty');
    expect(res.status).toBe(401);
  });

  test('v57.2 - Should get loyalty status', async () => {
    const res = await request(app)
      .get('/api/loyalty')
      .set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(200);
    expect(res.body.tier).toBeDefined();
  });

  test('v57.3 - Should earn points', async () => {
    const res = await request(app)
      .post('/api/loyalty/earn')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ amount: 100, reason: 'purchase' });
    expect(res.status).toBe(200);
    expect(res.body.points).toBeGreaterThan(0);
  });

  test('v57.4 - Should get points history', async () => {
    const res = await request(app)
      .get('/api/loyalty/history')
      .set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});