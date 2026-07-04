const mongoose = require('mongoose');
const request = require('supertest');
const app = require('../server');
const User = require('../models/User');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';

let user;
let userToken;

beforeAll(async () => {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/trenddrop_test');
  }
  
  const seedBase = `size_${Date.now()}_`;
  
  user = await User.create({
    name: 'Size User', email: `${seedBase}test@test.com`, password: 'password123',
    country: 'US', currency: 'USD', emailVerified: true, authProvider: 'email',
    shippingAddress: { fullName: 'User', street1: '123 St', city: 'City', state: 'CA', postalCode: '90210', country: 'US' },
  });
  userToken = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '30d' });
});

afterAll(async () => {
  if (user) await User.findByIdAndDelete(user._id);
  await mongoose.connection.close();
});

describe('v40.0 Size Recommendation System', () => {
  test('v40.1 - Should list all size guide categories', async () => {
    const res = await request(app).get('/api/size-guides');
    expect(res.status).toBe(200);
    expect(res.body).toBeDefined();
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('v40.2 - Should get size guide for specific category', async () => {
    const res = await request(app).get('/api/size-guides/Women');
    expect(res.status).toBe(200);
    expect(res.body.category || res.body.description).toBeDefined();
  });

  test('v40.3 - Should get size suggestions for category and size', async () => {
    const res = await request(app).get('/api/size-guides/suggestions/Women/M');
    expect(res.status).toBe(200);
    expect(res.body.size).toBe('M');
    expect(res.body.measurements).toBeDefined();
  });

  test('v40.4 - Should save measurements and get recommendations', async () => {
    const res = await request(app)
      .post('/api/size-guides/recommendations')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ bust: 36, waist: 28, hip: 38 });
    
    expect(res.status).toBe(200);
    expect(res.body.recommendedSize).toBeDefined();
  });

  test('v40.5 - Should require auth for recommendations', async () => {
    const res = await request(app)
      .post('/api/size-guides/recommendations')
      .send({ bust: 36 });
    
    expect(res.status).toBe(401);
  });

  test('v40.6 - Should calculate XS for small measurements', async () => {
    const res = await request(app)
      .post('/api/size-guides/recommendations')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ bust: 32, waist: 24, hip: 33 });
    
    expect(res.status).toBe(200);
    expect(res.body.recommendedSize).toBe('XS');
  });
});