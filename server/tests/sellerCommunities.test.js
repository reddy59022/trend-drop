const mongoose = require('mongoose');
const request = require('supertest');
const app = require('../server');
const User = require('../models/User');
const SellerCommunity = require('../models/SellerCommunity');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';

let user;
let outsider;
let userToken;
let outsiderToken;
let testCommunity;

beforeAll(async () => {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/trenddrop_test');
  }
  
  const seedBase = `community_${Date.now()}_`;
  
  user = await User.create({
    name: 'Community User', email: `${seedBase}community@test.com`, password: 'password123',
    country: 'US', currency: 'USD', emailVerified: true, authProvider: 'email',
    shippingAddress: { fullName: 'User', street1: '123 St', city: 'City', state: 'CA', postalCode: '90210', country: 'US' },
  });

  userToken = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '30d' });
  outsider = await User.create({
    name: 'Community Outsider', email: `${seedBase}outsider@test.com`, password: 'password123',
    country: 'US', currency: 'USD', emailVerified: true, authProvider: 'email',
    shippingAddress: { fullName: 'Outsider', street1: '456 St', city: 'City', state: 'CA', postalCode: '90210', country: 'US' },
  });
  outsiderToken = jwt.sign({ id: outsider._id }, JWT_SECRET, { expiresIn: '30d' });

  testCommunity = await SellerCommunity.create({
    name: 'Test Community',
    description: 'A test community for sellers',
    members: [user._id],
    moderators: [user._id],
    isPrivate: false
  });
});

afterAll(async () => {
  if (user) await User.findByIdAndDelete(user._id);
  if (outsider) await User.findByIdAndDelete(outsider._id);
  await SellerCommunity.deleteMany({});
  await mongoose.connection.close();
});

describe('v55.0 Social Seller Communities', () => {
  test('v55.1 - Should require auth for communities', async () => {
    const res = await request(app).get('/api/seller-communities');
    expect(res.status).toBe(401);
  });

  test('v55.2 - Should get all communities', async () => {
    const res = await request(app)
      .get('/api/seller-communities')
      .set('Authorization', `Bearer ${userToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('v55.3 - Should create new community', async () => {
    const res = await request(app)
      .post('/api/seller-communities')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ name: 'New Community', description: 'Test' });

    expect(res.status).toBe(201);
    expect(res.body.inviteCode).toBeDefined();
  });

  test('v55.4 - Should get single community', async () => {
    const res = await request(app)
      .get(`/api/seller-communities/${testCommunity._id}`)
      .set('Authorization', `Bearer ${userToken}`);

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Test Community');
  });

  test('v55.5 - Should deny private community details to non-members', async () => {
    const privateCommunity = await SellerCommunity.create({
      name: 'Private Seller Group',
      description: 'Members only',
      isPrivate: true,
      inviteCode: 'SECRET123',
      members: [user._id],
      moderators: [user._id],
    });

    const res = await request(app)
      .get(`/api/seller-communities/${privateCommunity._id}`)
      .set('Authorization', `Bearer ${outsiderToken}`);

    expect(res.status).toBe(403);
  });

  test('v55.6 - Should join community', async () => {
    const res = await request(app)
      .post(`/api/seller-communities/${testCommunity._id}/join`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ inviteCode: testCommunity.inviteCode });

    expect(res.status).toBe(200);
    expect(res.body.members).toBeDefined();
  });

  test('v55.7 - Should create challenge', async () => {
    const res = await request(app)
      .post(`/api/seller-communities/${testCommunity._id}/challenges`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ title: 'Monthly Sales Challenge', endDate: new Date() });

    expect(res.status).toBe(200);
    expect(res.body.challenges).toBeDefined();
  });

  test('v55.8 - Should award achievement', async () => {
    const res = await request(app)
      .post(`/api/seller-communities/${testCommunity._id}/achievements`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ memberId: user._id, badge: 'Top Seller' });

    expect(res.status).toBe(200);
    expect(res.body.achievements).toBeDefined();
  });

  test('v55.9 - Should get leaderboard', async () => {
    const res = await request(app)
      .get(`/api/seller-communities/${testCommunity._id}/leaderboard`)
      .set('Authorization', `Bearer ${userToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});