/**
 * Red tests proving defects in the Recently-Viewed endpoint (routes/recentlyViewed.js).
 *
 * DEFECT A — deleted listings surface as `null` entries in the history.
 *   GET /api/recently-viewed does `recentViews.map(v => v.listingId)` after a
 *   populate, with NO null filter. When a viewed listing is later deleted the
 *   populate resolves to `null`, so the response array contains `null` items
 *   that crash/shrink the client grid. The wishlist route already guards
 *   against exactly this ("drop them from the view") — recently-viewed does not.
 *
 * DEFECT B — the `limit` query param is unbounded.
 *   `?limit=500000` is passed straight to `.limit(parseInt(limit))`, so a
 *   caller can force the server to load and serialize the ENTIRE history in one
 *   request (resource exhaustion / DoS). The codebase already establishes the
 *   canonical safe pattern in routes/trends.js:
 *     Math.max(1, Math.min(asNumber(req.query.limit, 20) || 20, 50))
 *   i.e. page size is clamped to a platform max of 50. This endpoint ignores it.
 */
const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../server');
const User = require('../models/User');
const Listing = require('../models/Listing');
const RecentlyViewed = require('../models/RecentlyViewed');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';
const PLATFORM_MAX_PAGE = 50; // matches routes/trends.js + utils/pagination.js

let user, token;

async function createListing(sellerId, i) {
  return Listing.create({
    seller: sellerId,
    title: `RV Item ${i}`,
    description: 'd',
    price: 10 + i,
    category: 'Women',
    condition: 'Good',
    available: true,
    sold: false,
    quantity: 1,
    shipsFrom: 'US',
    weight: 0.5,
  });
}

beforeAll(async () => {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/trenddrop_test');
  }
  user = await User.create({
    name: 'RV User', email: `rv_${Date.now()}@t.com`, password: 'password123',
    country: 'US', currency: 'USD', emailVerified: true, authProvider: 'email',
    shippingAddress: { fullName: 'U', street1: '1 St', city: 'C', state: 'CA', postalCode: '90001', country: 'US' },
  });
  token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '1h' });
});

afterAll(async () => {
  await RecentlyViewed.deleteMany({ userId: user._id });
  await Listing.deleteMany({ seller: user._id });
  await User.findByIdAndDelete(user._id);
  if (mongoose.connection.readyState === 1) await mongoose.connection.close();
});

describe('DEFECT A: deleted listings must not surface as null history entries', () => {
  test('history drops entries whose listing was deleted (no nulls in items)', async () => {
    const a = await createListing(user._id, 1);
    const b = await createListing(user._id, 2);
    await RecentlyViewed.deleteMany({ userId: user._id });
    await RecentlyViewed.create([
      { userId: user._id, listingId: a._id, viewedAt: new Date() },
      { userId: user._id, listingId: b._id, viewedAt: new Date(Date.now() - 1000) },
    ]);
    // Delete listing B — its populate now resolves to null.
    await Listing.findByIdAndDelete(b._id);

    const res = await request(app)
      .get('/api/recently-viewed')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    // Only the surviving listing should be returned — never a null placeholder.
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items.every((it) => it && it._id)).toBe(true);
  });
});

describe('DEFECT B: limit query param must be clamped', () => {
  test('a huge ?limit is capped at the platform max (50), not unbounded', async () => {
    await RecentlyViewed.deleteMany({ userId: user._id });
    // Seed more than the platform max so an unbounded response is detectable.
    const listings = [];
    for (let i = 0; i < PLATFORM_MAX_PAGE + 10; i += 1) listings.push(await createListing(user._id, 100 + i));
    await RecentlyViewed.create(listings.map((l, i) => ({
      userId: user._id, listingId: l._id, viewedAt: new Date(Date.now() - i * 1000),
    })));

    const res = await request(app)
      .get('/api/recently-viewed?limit=500000')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeLessThanOrEqual(PLATFORM_MAX_PAGE);
  });

  test('a non-numeric ?limit falls back to the default page size (never unbounded)', async () => {
    const res = await request(app)
      .get('/api/recently-viewed?limit=abc')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeLessThanOrEqual(PLATFORM_MAX_PAGE);
  });
});
