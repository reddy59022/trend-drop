/**
 * Tests for Settings: Social Links + Store Customization
 * Covers User model fields: socialLinks, store, isVerified
 */
const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../server');
const User = require('../models/User');

const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';
const generateToken = (userId) => jwt.sign({ id: userId }, JWT_SECRET, { expiresIn: '30d' });

let user, token;
const testUserIds = [];

beforeAll(async () => {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/trend-drop-test';
  if (mongoose.connection.readyState === 0) await mongoose.connect(uri);
  user = await User.create({ name: 'SettingsUser', email: `settings_user_${Date.now()}@test.com`, password: 'password123', emailVerified: true, country: 'US', currency: 'USD' });
  testUserIds.push(user._id);
  token = generateToken(user._id);
});

afterAll(async () => {
  await User.deleteMany({ _id: { $in: testUserIds } });
  // Do NOT disconnect — jest.setup.js afterAll cleans DB between files
});

describe('Settings: Social Links & Store Customization', () => {
  test('SS.1 GET /api/auth/me returns new fields', async () => {
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.socialLinks).toBeDefined();
    expect(res.body.store).toBeDefined();
    expect(res.body.isVerified).toBe(false);
  });

  test('SS.2 PUT /api/auth/profile updates socialLinks', async () => {
    const res = await request(app)
      .put('/api/auth/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ socialLinks: { instagram: 'testuser', tiktok: 'testtiktok', pinterest: 'testpin', youtube: 'testchannel' } });
    expect(res.status).toBe(200);
    expect(res.body.socialLinks.instagram).toBe('testuser');
    expect(res.body.socialLinks.tiktok).toBe('testtiktok');
  });

  test('SS.3 PUT /api/auth/profile updates store fields', async () => {
    const res = await request(app)
      .put('/api/auth/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ store: { tagline: 'Best vintage store', colorTheme: '#FF385C', banner: 'https://example.com/banner.jpg', logo: 'https://example.com/logo.jpg', returnPolicy: '30 days returns' } });
    expect(res.status).toBe(200);
    expect(res.body.store.tagline).toBe('Best vintage store');
    expect(res.body.store.colorTheme).toBe('#FF385C');
  });

  test('SS.4 PUT /api/auth/profile updates isVerified', async () => {
    const res = await request(app)
      .put('/api/auth/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ isVerified: true });
    expect(res.status).toBe(200);
    expect(res.body.isVerified).toBe(true);
  });

  test('SS.5 Social links persist across fetches', async () => {
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.socialLinks.instagram).toBe('testuser');
    expect(res.body.store.tagline).toBe('Best vintage store');
    expect(res.body.isVerified).toBe(true);
  });

  test('SS.6 Partial socialLinks update works', async () => {
    const res = await request(app)
      .put('/api/auth/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ socialLinks: { twitter: 'testtwitter' } });
    expect(res.status).toBe(200);
    expect(res.body.socialLinks.twitter).toBe('testtwitter');
    // Other social links should remain
    expect(res.body.socialLinks.instagram).toBe('testuser');
  });

  test('SS.7 Store fields default to empty strings for new users', async () => {
    const newUser = await User.create({ name: 'NewUser', email: `newuser_${Date.now()}@test.com`, password: 'password123', emailVerified: true, country: 'US', currency: 'USD' });
    const newToken = generateToken(newUser._id);
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${newToken}`);
    expect(res.status).toBe(200);
    expect(res.body.socialLinks).toBeDefined();
    expect(res.body.store).toBeDefined();
    expect(res.body.isVerified).toBe(false);
    await User.deleteOne({ _id: newUser._id });
  });

  test('SS.8 Unauthorized update fails', async () => {
    const res = await request(app)
      .put('/api/auth/profile')
      .send({ isVerified: true });
    expect(res.status).toBe(401);
  });
});