/**
 * API contract sweep: a malformed ObjectId in the path is a client error.
 *
 * `assertObjectId` is mounted globally and every id-taking route is expected to
 * answer 400 for a value that cannot be an ObjectId (instead of letting
 * Mongoose throw a CastError and the catch block answer 500). This suite pins
 * that contract for the public/id-parameterised surface so a new route cannot
 * silently regress it.
 */
const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const app = require('../server.js');
const api = request(app);
const User = require('../models/User');

const secret = process.env.JWT_SECRET || 'fallback_secret_change_me';
const BAD_ID = 'not-an-object-id';

let token;
let adminToken;

beforeAll(async () => {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/trend-drop-test');
  }
  const user = await User.create({
    _id: new mongoose.Types.ObjectId(),
    name: 'Sweep User',
    email: `sweep_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@test.com`,
    password: 'password123',
    emailVerified: true,
    authProvider: 'email',
    country: 'US',
    currency: 'USD',
  });
  token = jwt.sign({ id: user._id }, secret, { expiresIn: '1h' });

  const admin = await User.create({
    _id: new mongoose.Types.ObjectId(),
    name: 'Sweep Admin',
    email: `sweep_admin_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@test.com`,
    password: 'password123',
    emailVerified: true,
    authProvider: 'email',
    role: 'admin',
    country: 'US',
    currency: 'USD',
  });
  adminToken = jwt.sign({ id: admin._id }, secret, { expiresIn: '1h' });
});

const PUBLIC = [
  '/api/listings/{id}',
  '/api/listings/user/{id}',
  '/api/users/{id}',
  '/api/users/{id}/closet',
  '/api/pricehistory/{id}',
  '/api/auctions/{id}',
  '/api/live-events/{id}',
  '/api/ar-showrooms/{id}',
  '/api/video-shopping/{id}',
  '/api/seller-communities/{id}',
  '/api/collections/{id}',
  '/api/parties/{id}',
  '/api/social-commerce/{id}',
  '/api/inventory/{id}',
  '/api/ratings/seller/{id}',
];

const AUTHED = [
  '/api/orders/{id}',
  '/api/orders/{id}/lifecycle',
  '/api/returns/{id}',
  '/api/transactions/{id}',
  '/api/messages/conversation/{id}',
  '/api/saved-searches/{id}/results',
  '/api/offers/{id}',
  '/api/payouts/process/{id}',
  '/api/shipping/track/{id}',
];

describe('malformed ids are 400, never 500', () => {
  // A malformed id is a client error: either 400 ("invalid id") or, where a
  // route deliberately treats every unknown id as missing, 404. Never a 5xx.
  test.each(PUBLIC)('public %s', async (pattern) => {
    const res = await api.get(pattern.replace('{id}', BAD_ID));
    expect([400, 404]).toContain(res.status);
  });

  test.each(AUTHED)('authenticated %s', async (pattern) => {
    const res = await api
      .get(pattern.replace('{id}', BAD_ID))
      .set('Authorization', `Bearer ${token}`);
    expect([400, 404]).toContain(res.status);
  });

  test('write routes with a malformed id are 400', async () => {
    const calls = [
      [api.delete(`/api/notifications/${BAD_ID}`).set('Authorization', `Bearer ${token}`), 400],
      [api.put(`/api/notifications/${BAD_ID}/read`).set('Authorization', `Bearer ${token}`), 400],
      [api.post(`/api/vendors/${BAD_ID}/invite`).set('Authorization', `Bearer ${token}`).send({}), 400],
      [api.patch(`/api/reports/${BAD_ID}/status`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'resolved' }), 400],
    ];
    const results = await Promise.all(calls.map(([call]) => call));
    results.forEach((res, i) => expect(res.status).toBe(calls[i][1]));
  });
});
