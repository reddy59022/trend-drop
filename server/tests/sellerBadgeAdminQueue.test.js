const mongoose = require('mongoose');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../server');
const User = require('../models/User');
const SellerBadge = require('../models/SellerBadge');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';
let admin;
let seller;
let adminToken;
let sellerToken;

beforeAll(async () => {
  admin = await User.create({
    name: 'Queue Admin', email: `queue-admin-${Date.now()}@test.com`, password: 'password123',
    country: 'US', currency: 'USD', emailVerified: true, authProvider: 'email', role: 'admin',
  });
  seller = await User.create({
    name: 'Queue Seller', email: `queue-seller-${Date.now()}@test.com`, password: 'password123',
    country: 'US', currency: 'USD', emailVerified: true, authProvider: 'email', role: 'user',
  });
  adminToken = jwt.sign({ id: admin._id }, JWT_SECRET, { expiresIn: '30d' });
  sellerToken = jwt.sign({ id: seller._id }, JWT_SECRET, { expiresIn: '30d' });
  await SellerBadge.create({ userId: seller._id, verificationRequested: true });
});

afterAll(async () => {
  await SellerBadge.deleteMany({ userId: { $in: [admin._id, seller._id] } });
  await User.deleteMany({ _id: { $in: [admin._id, seller._id] } });
  await mongoose.connection.close();
});

test('non-admin users cannot list pending seller verification requests', async () => {
  const response = await request(app)
    .get('/api/admin/seller-badges/pending')
    .set('Authorization', `Bearer ${sellerToken}`);

  expect(response.status).toBe(403);
});

test('admin can list pending seller verification requests with seller identity', async () => {
  const response = await request(app)
    .get('/api/admin/seller-badges/pending')
    .set('Authorization', `Bearer ${adminToken}`);

  expect(response.status).toBe(200);
  expect(response.body.badges).toEqual(expect.arrayContaining([
    expect.objectContaining({
      userId: expect.objectContaining({ name: 'Queue Seller' }),
      verificationRequested: true,
    }),
  ]));
});
