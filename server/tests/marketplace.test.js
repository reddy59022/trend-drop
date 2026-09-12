/**
 * Marketplace availability / supported-country gating (Feature 1).
 *
 * The app is currently available in the USA and European countries only.
 * Users outside these markets must see an enterprise-standard "not available
 * in your area" message and must not be able to use the marketplace.
 */
const mongoose = require('mongoose');
const request = require('supertest');
const app = require('../server');
const User = require('../models/User');
const PendingUser = require('../models/PendingUser');
const Listing = require('../models/Listing');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';
const mkEmail = (p) => `${p}_market_${Date.now()}@test.com`;

let testUserIds = [];
let testPendingIds = [];
let testListingIds = [];

beforeAll(async () => {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/trenddrop_test');
  }
});

afterAll(async () => {
  await User.deleteMany({ _id: { $in: testUserIds } });
  await PendingUser.deleteMany({ _id: { $in: testPendingIds } });
  await Listing.deleteMany({ _id: { $in: testListingIds } });
  await PendingUser.deleteMany({ email: /_market_/ });
  await User.deleteMany({ email: /_market_/ });
  await Listing.deleteMany({ title: /Market Test/ });
});

describe('Marketplace availability (Feature 1 - USA + Europe)', () => {
  test('MP.1 GET /api/marketplace/countries lists US + European markets with currency', async () => {
    const res = await request(app).get('/api/marketplace/countries');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const codes = res.body.map((c) => c.code);
    expect(codes).toContain('US');
    expect(codes).toContain('GB');
    expect(codes).toContain('DE');
    expect(codes).toContain('FR');
    expect(codes).toEqual(expect.arrayContaining(['IT', 'ES', 'NL', 'BE', 'PT', 'IE', 'SE', 'CH', 'PL']));
    expect(codes).not.toContain('IN');
    expect(codes).not.toContain('BR');
    expect(codes).not.toContain('JP');
    expect(codes).not.toContain('AU');
    res.body.forEach((c) => {
      expect(c.code).toBeTruthy();
      expect(c.name).toBeTruthy();
      expect(c.currency).toBeTruthy();
    });
  });

  test('MP.2 GET /api/marketplace/status reports supported=true for US + European countries', async () => {
    for (const country of ['US', 'GB', 'DE', 'FR', 'IT', 'ES', 'NL']) {
      const res = await request(app).get(`/api/marketplace/status?country=${country}`);
      expect(res.status).toBe(200);
      expect(res.body.country).toBe(country);
      expect(res.body.supported).toBe(true);
    }
  });

  test('MP.3 GET /api/marketplace/status reports supported=false + message for unsupported countries', async () => {
    for (const country of ['IN', 'BR', 'JP', 'AU', 'CN', 'MX']) {
      const res = await request(app).get(`/api/marketplace/status?country=${country}`);
      expect(res.status).toBe(200);
      expect(res.body.country).toBe(country);
      expect(res.body.supported).toBe(false);
      expect(typeof res.body.message).toBe('string');
      expect(res.body.message.length).toBeGreaterThan(5);
    }
  });

  test('MP.4 Registration from an unsupported country is rejected (400)', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Unsupported Region User', email: mkEmail('unsupported'), password: 'password123', country: 'IN' });
    expect(res.status).toBe(400);
    expect(res.body.message.toLowerCase()).toContain('area');
  });

  test('MP.5 Registration from a supported country succeeds (201) and stores country', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'London Seller', email: mkEmail('london'), password: 'password123', country: 'GB' });
    expect(res.status).toBe(201);
    expect(res.body.userId).toBeTruthy();
    const pending = await PendingUser.findById(res.body.userId);
    if (pending) {
      testPendingIds.push(pending._id);
      expect(pending.country).toBe('GB');
    }
  });

  test('MP.6 Authenticated user whose country is unsupported is blocked from marketplace APIs (403)', async () => {
    const blockedUser = await User.create({
      name: 'Blocked', email: mkEmail('blocked'), password: 'password123',
      emailVerified: true, country: 'IN', currency: 'INR',
    });
    testUserIds.push(blockedUser._id);
    const token = jwt.sign({ id: blockedUser._id }, JWT_SECRET, { expiresIn: '30d' });

    const res = await request(app).get('/api/listings?limit=5').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect(res.body.supported).toBe(false);
    expect(res.body.message.toLowerCase()).toContain('area');
  });

  test('MP.7 X-Country-Code header: unsupported region blocked, supported region allowed', async () => {
    const listing = await Listing.create({
      seller: new mongoose.Types.ObjectId(),
      title: 'Market Test Item',
      description: 'region-gating test listing',
      price: 25,
      category: 'Women',
      condition: 'Good',
      available: true,
      quantity: 1,
    });
    testListingIds.push(listing._id);

    const blocked = await request(app).get('/api/listings?limit=5').set('X-Country-Code', 'IN');
    expect(blocked.status).toBe(403);
    expect(blocked.body.supported).toBe(false);

    const allowed = await request(app).get('/api/listings?limit=5').set('X-Country-Code', 'US');
    expect(allowed.status).toBe(200);
    expect(Array.isArray(allowed.body.listings)).toBe(true);
  });

  test('MP.8 Request with no country info (no header, no auth) still serves the public catalog', async () => {
    const res = await request(app).get('/api/listings?limit=5');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.listings)).toBe(true);
  });
});
