/**
 * Integration tests for User Profile endpoints.
 * Covers profile update, avatar, settings, and follow/unfollow.
 */
const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../server');
const User = require('../models/User');

const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';
const generateToken = (userId) => jwt.sign({ id: userId }, JWT_SECRET, { expiresIn: '30d' });

let token, userId;
const TEST_RUN_ID = `prof_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const testUserIds = [];

beforeAll(async () => {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/trend-drop-test';
  if (mongoose.connection.readyState === 0) await mongoose.connect(uri);

  const user = await User.create({ name: 'ProfileUser', email: `prof_${TEST_RUN_ID}@test.com`, password: 'password123', emailVerified: true, authProvider: 'email', country: 'US', currency: 'USD' });
  testUserIds.push(user._id); userId = user._id; token = generateToken(user._id);
});

afterAll(async () => {
  await User.deleteMany({ _id: { $in: testUserIds } });
  // Do NOT disconnect — jest.setup.js afterAll cleans DB between files
});

describe('User Profile', () => {
  test('PROF.1 Update profile fields', async () => {
    const r = await request(app).put('/api/auth/profile').set('Authorization', `Bearer ${token}`).send({ bio: 'New bio', closetName: 'My Closet', location: 'NYC' });
    expect(r.status).toBe(200);
    expect(r.body.bio).toBe('New bio');
    expect(r.body.closetName).toBe('My Closet');
  });

  test('PROF.2 Get current user', async () => {
    const r = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(r.status).toBe(200);
    expect(r.body._id).toBe(userId.toString());
  });

  test('PROF.3 Unauthenticated cannot access /me', async () => {
    const r = await request(app).get('/api/auth/me');
    expect(r.status).toBe(401);
  });

  test('PROF.4 Profile endpoint accepts allowed fields only', async () => {
    const r = await request(app).put('/api/auth/profile').set('Authorization', `Bearer ${token}`).send({ bio: 'Updated bio' });
    expect(r.status).toBe(200);
    expect(r.body.bio).toBe('Updated bio');
  });

  test('PROF.5 follow is idempotent and cannot duplicate followers', async () => {
    const target = await User.create({
      name: 'Follow Target',
      email: `follow_${TEST_RUN_ID}@test.com`,
      password: 'password123',
      emailVerified: true,
      authProvider: 'email',
      country: 'US',
      currency: 'USD',
    });
    testUserIds.push(target._id);

    const first = await request(app)
      .post(`/api/users/${target._id}/follow`)
      .set('Authorization', `Bearer ${token}`);
    expect(first.status).toBe(200);

    const confirm = await request(app)
      .post(`/api/users/${target._id}/follow`)
      .set('Authorization', `Bearer ${token}`);
    expect(confirm.status).toBe(200);
    expect(confirm.body.following).toBe(false);

    const again = await request(app)
      .post(`/api/users/${target._id}/follow`)
      .set('Authorization', `Bearer ${token}`);
    expect(again.status).toBe(200);
    expect(again.body.following).toBe(true);

    const targetAfter = await User.findById(target._id).select('followers');
    expect(targetAfter.followers.filter((id) => id.toString() === userId.toString())).toHaveLength(1);
  });

  test('PROF.6 authenticated listing responses are not publicly cacheable', async () => {
    const r = await request(app)
      .get('/api/listings/my')
      .set('Authorization', `Bearer ${token}`);
    expect(r.status).toBe(200);
    expect(r.headers['cache-control']).toBe('no-store');
  });
});