/**
 * Home page social proof must be real.
 *
 * The landing page rendered hard-coded figures ("50K+ Active Sellers",
 * "1M+ Items Listed", per-category "12.5K items") that no query ever backed.
 * On a live marketplace that is fabricated advertising. This pins a public
 * stats endpoint whose numbers come from the same filter the catalog uses,
 * so the marketing tiles can only ever show what is actually listed.
 */
const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const app = require('../server.js');
const api = request(app);
const User = require('../models/User');
const Listing = require('../models/Listing');

const secret = process.env.JWT_SECRET || 'fallback_secret_change_me';

let sellerA;
let sellerB;

const baseListing = (overrides) => ({
  description: 'Stats fixture',
  price: 40,
  category: 'Women',
  condition: 'Good',
  quantity: 1,
  status: 'active',
  available: true,
  sold: false,
  ...overrides,
});

beforeAll(async () => {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/trend-drop-test');
  }
  const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  sellerA = await User.create({
    _id: new mongoose.Types.ObjectId(),
    name: 'Stats Seller A',
    email: `stats_a_${stamp}@test.com`,
    password: 'password123',
    emailVerified: true,
    authProvider: 'email',
    country: 'US',
    currency: 'USD',
  });
  sellerB = await User.create({
    _id: new mongoose.Types.ObjectId(),
    name: 'Stats Seller B',
    email: `stats_b_${stamp}@test.com`,
    password: 'password123',
    emailVerified: true,
    authProvider: 'email',
    country: 'US',
    currency: 'USD',
  });

  await Listing.create([
    baseListing({ seller: sellerA._id, title: 'Stats women dress' }),
    baseListing({ seller: sellerA._id, title: 'Stats men shirt', category: 'Men' }),
    // Not part of the public catalog: draft, sold, out of stock.
    baseListing({ seller: sellerB._id, title: 'Stats draft', status: 'draft', available: false }),
    baseListing({ seller: sellerB._id, title: 'Stats sold', sold: true }),
    baseListing({ seller: sellerB._id, title: 'Stats out of stock', quantity: 0 }),
  ]);
});

afterAll(async () => {
  await Listing.deleteMany({ seller: { $in: [sellerA._id, sellerB._id] } });
  await User.deleteMany({ _id: { $in: [sellerA._id, sellerB._id] } });
});

describe('GET /api/listings/marketplace-stats', () => {
  it('is public and reports live catalog counts only', async () => {
    const res = await api.get('/api/listings/marketplace-stats');
    expect(res.status).toBe(200);

    // Only the two active, in-stock listings count.
    expect(res.body.totalListings).toBe(2);
    expect(res.body.totalSellers).toBe(1);

    const women = res.body.categories.find((c) => c.name === 'Women');
    expect(women).toEqual({ name: 'Women', count: 1 });
    expect(res.body.categories.find((c) => c.name === 'Men')).toEqual({ name: 'Men', count: 1 });
    expect(res.body.categories.some((c) => c.name === 'Draft')).toBe(false);
  });

  it('exposes the real launch-market count instead of a marketing figure', async () => {
    const res = await api.get('/api/listings/marketplace-stats');
    const { getSupportedCountries } = require('../config/marketplace');
    expect(res.body.totalCountries).toBe(getSupportedCountries().length);
    expect(res.body.totalCountries).toBeGreaterThan(0);
  });

  it('never returns a negative or non-numeric count', async () => {
    const res = await api.get('/api/listings/marketplace-stats');
    for (const key of ['totalListings', 'totalSellers', 'totalCountries']) {
      expect(typeof res.body[key]).toBe('number');
      expect(res.body[key]).toBeGreaterThanOrEqual(0);
    }
    for (const c of res.body.categories) {
      expect(typeof c.count).toBe('number');
      expect(c.count).toBeGreaterThan(0);
    }
  });
});
