const mongoose = require('mongoose');
const request = require('supertest');
const app = require('../server');
const User = require('../models/User');
const MobilePreferences = require('../models/MobilePreferences');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';

let user;
let userToken;

beforeAll(async () => {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/trenddrop_test');
  }
  
  const seedBase = `mobile_${Date.now()}_`;
  
  user = await User.create({
    name: 'Mobile User', email: `${seedBase}user@test.com`, password: 'password123',
    country: 'US', currency: 'USD', emailVerified: true, authProvider: 'email',
    shippingAddress: { fullName: 'User', street1: '123 St', city: 'City', state: 'CA', postalCode: '90210', country: 'US' },
  });
  userToken = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '30d' });
});

afterAll(async () => {
  if (user) {
    await MobilePreferences.findOneAndDelete({ userId: user._id });
    await User.findByIdAndDelete(user._id);
  }
  await mongoose.connection.close();
});

describe('v42.0 Enhanced Mobile Experience', () => {
  test('v42.1 - Should get mobile preferences for authenticated user', async () => {
    const res = await request(app)
      .get('/api/mobile/preferences')
      .set('Authorization', `Bearer ${userToken}`);
    
    expect(res.status).toBe(200);
    expect(res.body.userId).toBeDefined();
    expect(res.body.pushNotifications.enabled).toBe(true);
  });

  test('v42.2 - Should update mobile preferences', async () => {
    const res = await request(app)
      .put('/api/mobile/preferences')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        pushNotifications: { enabled: false, priceDrop: false },
        location: { country: 'CA', useForShipping: true },
      });
    
    expect(res.status).toBe(200);
    expect(res.body.location.country).toBe('CA');
  });

  test('v42.3 - Should get shipping estimate for domestic', async () => {
    const res = await request(app)
      .get('/api/mobile/shipping-estimate?country=US&weight=1');
    
    expect(res.status).toBe(200);
    expect(res.body.shippingCost).toBeGreaterThan(0);
    expect(res.body.zone).toBe(1);
  });

  test('v42.4 - Should get shipping estimate for international', async () => {
    const res = await request(app)
      .get('/api/mobile/shipping-estimate?country=CA&weight=1');
    
    expect(res.status).toBe(200);
    expect(res.body.shippingCost).toBeGreaterThan(0);
  });

  test('v42.5 - Should register push notification token', async () => {
    const res = await request(app)
      .post('/api/mobile/push-token')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ token: 'test-push-token-123', platform: 'iOS' });
    
    expect(res.status).toBe(200);
    expect(res.body.message).toContain('registered');
  });

  test('v42.6 - Should require authentication for preferences', async () => {
    const res = await request(app)
      .get('/api/mobile/preferences');
    
    expect(res.status).toBe(401);
  });

  test('v42.7 - Should get available mobile features', async () => {
    const res = await request(app)
      .get('/api/mobile/features');
    
    expect(res.status).toBe(200);
    expect(res.body.quickSell).toBe(true);
    expect(res.body.pushNotifications).toBe(true);
  });

  test('v42.8 - Should handle barcode lookup', async () => {
    const res = await request(app)
      .post('/api/mobile/barcode-lookup')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ barcode: '123456789012' });
    
    expect(res.status).toBe(200);
    expect(res.body.barcode).toBe('123456789012');
  });

  test('v42.9 - Should reject barcode lookup without barcode', async () => {
    const res = await request(app)
      .post('/api/mobile/barcode-lookup')
      .set('Authorization', `Bearer ${userToken}`)
      .send({});
    
    expect(res.status).toBe(400);
  });

  test('v42.10 - Should reject push token without token', async () => {
    const res = await request(app)
      .post('/api/mobile/push-token')
      .set('Authorization', `Bearer ${userToken}`)
      .send({});
    
    expect(res.status).toBe(400);
  });
});