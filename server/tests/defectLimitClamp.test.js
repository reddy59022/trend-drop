/**
 * Red tests proving the unclamped-?limit defect class across list endpoints.
 *
 * DEFECT — several list endpoints pass the raw query `limit` straight to
 * `.limit(parseInt(limit))` / `.limit(Number(limit))`, so `?limit=500000`
 * forces the server to load + serialize an unbounded result set (resource
 * exhaustion / DoS), and `?limit=abc` reaches the driver as NaN.
 *
 * The codebase ALREADY establishes the intended contract and the canonical fix
 * in routes/users.js and routes/trends.js:
 *     Math.max(1, Math.min(asNumber(req.query.limit, DEFAULT) || DEFAULT, 50))
 *   ("limit bounded (no unbounded collection dumps)" — routes/users.js)
 * and pins it in tests (zeroDefect2: closet `limit=1000000` -> <=50;
 * searchFilters SF.22: listings `limit=100` -> <=50).
 *
 * These routes ignore that standard: auctions, comments, parties, liveEvents,
 * arShowrooms and parts of admin. The tests below prove the class on two
 * public representatives (auctions + parties); the fix is applied to all of them.
 */
const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../server');
const Auction = require('../models/Auction');
const Party = require('../models/Party');

const PLATFORM_MAX_PAGE = 50;
const Oid = () => new mongoose.Types.ObjectId();

beforeAll(async () => {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/trenddrop_test');
  }
  await Auction.deleteMany({});
  await Party.deleteMany({});
  const now = Date.now();
  // 60 auctions (distinct listings — the schema enforces unique listing).
  await Auction.insertMany(Array.from({ length: 60 }, () => ({
    listing: Oid(), seller: Oid(),
    startTime: new Date(now - 1000), endTime: new Date(now + 100000),
    reservePrice: 10, currentBid: 10, status: 'active',
  })));
  // 60 parties (status 'scheduled' is the default and is listed by GET /api/parties).
  await Party.insertMany(Array.from({ length: 60 }, (_, i) => ({
    hostId: Oid(), hostName: `H${i}`, title: `Party ${i}`,
    category: 'Women', startTime: new Date(now - 1000), endTime: new Date(now + 100000),
  })));
});

afterAll(async () => {
  await Auction.deleteMany({});
  await Party.deleteMany({});
  if (mongoose.connection.readyState === 1) await mongoose.connection.close();
});

describe('DEFECT: list endpoints must clamp ?limit to the platform max (50)', () => {
  test('GET /api/auctions?limit=500000 returns at most the platform max', async () => {
    const res = await request(app).get('/api/auctions?limit=500000');
    expect(res.status).toBe(200);
    expect(res.body.auctions.length).toBeLessThanOrEqual(PLATFORM_MAX_PAGE);
  });

  test('GET /api/auctions?limit=abc falls back to a bounded page (never 60)', async () => {
    const res = await request(app).get('/api/auctions?limit=abc');
    expect(res.status).toBe(200);
    expect(res.body.auctions.length).toBeLessThanOrEqual(PLATFORM_MAX_PAGE);
  });

  test('GET /api/parties?limit=500000 returns at most the platform max', async () => {
    const res = await request(app).get('/api/parties?limit=500000');
    expect(res.status).toBe(200);
    expect(res.body.parties.length).toBeLessThanOrEqual(PLATFORM_MAX_PAGE);
  });

  test('GET /api/parties?limit=abc falls back to a bounded page (never 60)', async () => {
    const res = await request(app).get('/api/parties?limit=abc');
    expect(res.status).toBe(200);
    expect(res.body.parties.length).toBeLessThanOrEqual(PLATFORM_MAX_PAGE);
  });
});
