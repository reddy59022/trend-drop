/**
 * Red tests proving unvalidated pagination INPUT (page) and unclamped limit on
 * two endpoints that the batch-3 clamp missed:
 *
 *   GET /api/notifications        — `?page=abc` / `?page=0` produced an EMPTY
 *     page and `currentPage: NaN` (start = (Number(page)-1)*pageSize = NaN ->
 *     arr.slice(NaN, NaN) = []), instead of falling back to page 1.
 *   GET /api/listings/user/:userId — raw `Number(limit)` / `Number(page)`:
 *     `?limit=500000` is unbounded (DoS) and `?page=abc` -> NaN skip.
 *
 * The intended contract (routes/users.js, routes/trends.js, batch-3 clamp) is:
 *   page  -> integer >= 1
 *   limit -> integer in [1, PLATFORM_MAX=50], non-numeric -> default
 */
const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../server');
const User = require('../models/User');
const Listing = require('../models/Listing');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';
const PLATFORM_MAX_PAGE = 50;

let user, token;

async function makeListing(sellerId, i) {
  return Listing.create({
    seller: sellerId, title: `PI ${i}`, description: 'd', price: 10 + i,
    category: 'Women', condition: 'Good', available: true, sold: false,
    quantity: 1, shipsFrom: 'US', weight: 0.5,
  });
}

beforeAll(async () => {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/trenddrop_test');
  }
  user = await User.create({
    name: 'PI User', email: `pi_${Date.now()}@t.com`, password: 'password123',
    country: 'US', currency: 'USD', emailVerified: true, authProvider: 'email',
    shippingAddress: { fullName: 'U', street1: '1 St', city: 'C', state: 'CA', postalCode: '90001', country: 'US' },
    notifications: Array.from({ length: 3 }, (_, i) => ({
      type: 'sale', message: `n${i}`, read: false, createdAt: new Date(Date.now() - i * 1000),
    })),
  });
  token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '1h' });
});

afterAll(async () => {
  await Listing.deleteMany({ seller: user._id });
  await User.findByIdAndDelete(user._id);
  if (mongoose.connection.readyState === 1) await mongoose.connection.close();
});

describe('DEFECT: GET /api/notifications page validation', () => {
  test('?page=abc falls back to page 1 (non-empty), never currentPage NaN', async () => {
    const res = await request(app).get('/api/notifications?page=abc').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.notifications.length).toBeGreaterThan(0);
    expect(Number.isInteger(res.body.currentPage)).toBe(true);
    expect(res.body.currentPage).toBeGreaterThanOrEqual(1);
  });

  test('?page=0 falls back to page 1 (non-empty)', async () => {
    const res = await request(app).get('/api/notifications?page=0').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.notifications.length).toBeGreaterThan(0);
  });
});

describe('DEFECT: GET /api/listings/user/:userId limit+page validation', () => {
  test('?limit=500000 is clamped to the platform max (not unbounded)', async () => {
    for (let i = 0; i < PLATFORM_MAX_PAGE + 10; i += 1) await makeListing(user._id, i);
    const res = await request(app).get(`/api/listings/user/${user._id}?limit=500000`);
    expect(res.status).toBe(200);
    expect(res.body.listings.length).toBeLessThanOrEqual(PLATFORM_MAX_PAGE);
  });

  test('?page=abc does not NaN the page (currentPage is a valid integer)', async () => {
    const res = await request(app).get(`/api/listings/user/${user._id}?page=abc`);
    expect(res.status).toBe(200);
    expect(Number.isInteger(res.body.currentPage)).toBe(true);
  });
});
