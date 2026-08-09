/**
 * Integration tests for Saved Searches endpoints.
 * Tests CRUD for saved searches, re-executing searches, and notification preferences.
 */
const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../server');
const User = require('../models/User');
const SavedSearch = require('../models/SavedSearch');
const Listing = require('../models/Listing');

const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';
const generateToken = (userId) => jwt.sign({ id: userId }, JWT_SECRET, { expiresIn: '30d' });

let token, userId;
const TEST_RUN_ID = `ss_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const testUserIds = [];
const testSearchIds = [];

beforeAll(async () => {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/trend-drop-test';
  if (mongoose.connection.readyState === 0) await mongoose.connect(uri);

  const user = await User.create({ name: 'SearchUser', email: `ssuser_${TEST_RUN_ID}@test.com`, password: 'password123', emailVerified: true, authProvider: 'email', country: 'US', currency: 'USD' });
  testUserIds.push(user._id); userId = user._id; token = generateToken(user._id);
});

afterAll(async () => {
  await SavedSearch.deleteMany({ _id: { $in: testSearchIds } });
  await User.deleteMany({ _id: { $in: testUserIds } });
  // Do NOT disconnect — jest.setup.js afterAll cleans DB between files
});

describe('Saved Search CRUD', () => {
  let searchId;

  test('SS.1 Create saved search', async () => {
    const r = await request(app).post('/api/saved-searches').set('Authorization', `Bearer ${token}`).send({ name: 'Nike Shoes', query: 'Nike', filters: { category: 'Men', minPrice: 50 } });
    expect(r.status).toBe(201);
    expect(r.body.name).toBe('Nike Shoes');
    searchId = r.body._id;
    testSearchIds.push(searchId);
  });

  test('SS.2 List saved searches', async () => {
    const r = await request(app).get('/api/saved-searches').set('Authorization', `Bearer ${token}`);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBe(true);
    expect(r.body.length).toBeGreaterThanOrEqual(1);
  });

  test('SS.3 Get saved search results', async () => {
    const r = await request(app).get(`/api/saved-searches/${searchId}/results`).set('Authorization', `Bearer ${token}`);
    expect(r.status).toBe(200);
  });

  test('SS.4 Update saved search', async () => {
    const r = await request(app).put(`/api/saved-searches/${searchId}`).set('Authorization', `Bearer ${token}`).send({ name: 'Nike Updated', notifyFrequency: 'weekly' });
    expect(r.status).toBe(200);
    expect(r.body.name).toBe('Nike Updated');
    expect(r.body.notifyFrequency).toBe('weekly');
  });

  test('SS.5 Delete saved search', async () => {
    const r = await request(app).post('/api/saved-searches').set('Authorization', `Bearer ${token}`).send({ name: 'Temp', query: 'temp' });
    const tempId = r.body._id;
    testSearchIds.push(tempId);
    const r2 = await request(app).delete(`/api/saved-searches/${tempId}`).set('Authorization', `Bearer ${token}`);
    expect(r2.status).toBe(200);
  });
});

describe('Saved Search Authorization', () => {
  test('SS.6 Unauthenticated cannot create', async () => {
    const r = await request(app).post('/api/saved-searches').send({ name: 'Hack', query: 'hack' });
    expect(r.status).toBe(401);
  });

  test('SS.7 Cannot access another user\'s searches', async () => {
    const otherUser = await User.create({ name: 'OtherUser', email: `other_${TEST_RUN_ID}@test.com`, password: 'password123', emailVerified: true, authProvider: 'email' });
    testUserIds.push(otherUser._id);
    const otherToken = generateToken(otherUser._id);

    // Create search for original user
    const r = await request(app).post('/api/saved-searches').set('Authorization', `Bearer ${token}`).send({ name: 'Private Search', query: 'private' });
    testSearchIds.push(r.body._id);

    // Other user should not see it in their list
    const r2 = await request(app).get('/api/saved-searches').set('Authorization', `Bearer ${otherToken}`);
    expect(r2.body.every(s => s.user.toString() === otherUser._id.toString())).toBe(true);
  });
});