const mongoose = require('mongoose');
const request = require('supertest');
const app = require('../server');
const User = require('../models/User');
const Subscription = require('../models/Subscription');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';

let user;
let userToken;

beforeAll(async () => {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/trenddrop_test');
  }
  
  user = await User.create({
    name: 'Sub Seller', email: `sub_${Date.now()}@test.com`, password: 'password123',
    country: 'US', currency: 'USD', emailVerified: true, authProvider: 'email',
    shippingAddress: { fullName: 'Seller', street1: '123 St', city: 'City', state: 'CA', postalCode: '90210', country: 'US' },
  });

  userToken = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '30d' });
});

afterAll(async () => {
  if (user) await User.findByIdAndDelete(user._id);
  await Subscription.deleteMany({ seller: user._id });
  await mongoose.connection.close();
});

describe('v51.0 Subscription Seller Plans', () => {
  test('v51.1 - Should list available plans', async () => {
    const res = await request(app).get('/api/subscriptions/plans');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(4);
  });

  // TDD regression: the UI advertises annual billing as "Save 20%" but the
  // plans response previously exposed only the monthly price, so the client
  // rendered the monthly amount with a `/year` suffix and the server stored
  // the monthly amount for annual subscriptions.
  test('v51.1a - annual plans expose discounted annual prices', async () => {
    const res = await request(app).get('/api/subscriptions/plans');
    const pro = res.body.find((plan) => plan.id === 'pro');
    expect(pro.annualPrice).toBe(287.90);
  });

  test('v51.2 - Should require auth for subscription', async () => {
    const res = await request(app).get('/api/subscriptions');
    expect(res.status).toBe(401);
  });

  test('v51.3 - Should get/create default subscription', async () => {
    const res = await request(app)
      .get('/api/subscriptions')
      .set('Authorization', `Bearer ${userToken}`);

    expect(res.status).toBe(200);
    expect(res.body.tier).toBeDefined();
  });

  test('v51.4 - Should subscribe to a plan', async () => {
    const res = await request(app)
      .post('/api/subscriptions/subscribe')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ tier: 'pro', billingCycle: 'monthly' });

    expect(res.status).toBe(200);
    expect(res.body.tier).toBe('pro');
  });

  // TDD regression: updating an existing subscription used to change only
  // tier/billingCycle. The stored price and feature entitlements stayed on the
  // old plan, so a seller could be shown Enterprise while retaining Pro
  // entitlements (or be charged the Pro amount). Billing cycle was also not
  // validated, allowing an unpriceable subscription state.
  test('v51.4a - switching plans refreshes authoritative price/features and validates cycle', async () => {
    const switched = await request(app)
      .post('/api/subscriptions/subscribe')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ tier: 'enterprise', billingCycle: 'annual' });

    expect(switched.status).toBe(200);
    expect(switched.body.tier).toBe('enterprise');
    expect(switched.body.billingCycle).toBe('annual');
    expect(switched.body.price).toBe(959.90);
    expect(switched.body.features).toEqual(expect.objectContaining({
      customDomain: true,
      enhancedPromotions: true,
      prioritySupport: true,
    }));

    const invalidCycle = await request(app)
      .post('/api/subscriptions/subscribe')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ tier: 'basic', billingCycle: 'weekly' });
    expect(invalidCycle.status).toBe(400);
  });

  test('v51.5 - Should reject invalid tier', async () => {
    const res = await request(app)
      .post('/api/subscriptions/subscribe')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ tier: 'invalid', billingCycle: 'monthly' });

    expect(res.status).toBe(400);
  });

  test('v51.6 - Should cancel subscription', async () => {
    const res = await request(app)
      .post('/api/subscriptions/cancel')
      .set('Authorization', `Bearer ${userToken}`);

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Subscription cancelled');
  });
});