const mongoose = require('mongoose');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../server');
const User = require('../models/User');
const SellerBadge = require('../models/SellerBadge');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';

let user;
let token;

beforeAll(async () => {
  user = await User.create({
    name: 'Concurrent Badge Seller',
    email: `badge-concurrent-${Date.now()}@test.com`,
    password: 'password123',
    country: 'US',
    currency: 'USD',
    emailVerified: true,
    authProvider: 'email',
  });
  token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '30d' });
});

afterAll(async () => {
  await SellerBadge.deleteMany({ userId: user._id });
  await User.findByIdAndDelete(user._id);
  await mongoose.connection.close();
});

test('concurrent first badge reads create one badge and never return a server error', async () => {
  const responses = await Promise.all(
    Array.from({ length: 10 }, () => request(app)
      .get('/api/seller-badges/me')
      .set('Authorization', `Bearer ${token}`))
  );

  expect(responses.every((response) => response.status === 200)).toBe(true);
  expect(new Set(responses.map((response) => String(response.body.badge.userId))).size).toBe(1);
  expect(await SellerBadge.countDocuments({ userId: user._id })).toBe(1);
});
