/* TDD Round 6 RED tests — trust & safety gaps (reports PII leak, unauthenticated
 * status mutation, unauthenticated trends refresh).
 *
 * Business reading of the suites:
 *  - Reports are a trust & safety moderation queue. The ADMIN queue
 *    (/api/admin/reports, auth+adminAuth) is correctly locked down.
 *  - But the legacy public router (routes/reports.js) still exposes the SAME
 *    queue unauthenticated: GET /api/reports returns reporter name+email for
 *    every report, and PATCH /api/reports/:id/status lets ANY logged-in user
 *    mutate moderation state. The client only ever calls POST /reports (file
 *    a report); the admin UI calls /admin/reports. So GET+PATCH on /reports
 *    are dead-but-dangerous surface: PII leak + moderation-tampering hole.
 *  - POST /api/trends/refresh triggers a paid third-party X API call
 *    (xService.fetchTrends) with zero auth. Anyone can burn quota / force
 *    failures. Client Trends page calls it from a Refresh button, but it must
 *    at minimum require auth (admin-only is the correct long-term shape;
 *    auth-required is the minimal safe gate proven here).
 */
const mongoose = require('mongoose');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../server');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Report = require('../models/Report');

const SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';
const RUN = `r6_${Date.now()}`;
const U = [];
const L = [];

async function mkUser(name, prefix) {
  const u = await User.create({
    name,
    email: `${prefix}_${RUN}@test.com`,
    password: 'password123',
    emailVerified: true,
    authProvider: 'email',
    country: 'US',
    currency: 'USD',
    shippingAddress: { fullName: name, street1: '1 St', city: 'C', state: 'S', postalCode: '0', country: 'US' },
    balance: { available: 0, pending: 0, totalEarned: 0, totalPaidOut: 0, currency: 'USD' },
  });
  U.push(u._id);
  return u;
}

async function mkListing(sellerId) {
  const l = await Listing.create({
    seller: sellerId,
    title: 'R6 Item',
    description: 'd',
    price: 50,
    category: 'Men',
    condition: 'New with tags',
    quantity: 5,
    available: true,
    sold: false,
    status: 'active',
    shipsFrom: 'US',
    currency: 'USD',
    weight: 0.5,
  });
  L.push(l._id);
  return l;
}

let reporter;
let reporterToken;
let outsider;
let outsiderToken;
let listing;

beforeAll(async () => {
  if (mongoose.connection.readyState !== 1) await mongoose.connect(process.env.MONGO_URI);
  reporter = await mkUser('R6 Reporter', 'r6rep');
  outsider = await mkUser('R6 Outsider', 'r6out');
  reporterToken = jwt.sign({ id: reporter._id }, SECRET, { expiresIn: '30d' });
  outsiderToken = jwt.sign({ id: outsider._id }, SECRET, { expiresIn: '30d' });
  listing = await mkListing(reporter._id);
  await Report.create({
    reporter: reporter._id,
    listing: listing._id,
    reason: 'Spam',
    description: 'r6 seed report',
  });
});

afterAll(async () => {
  await Report.deleteMany({ reporter: { $in: U } });
  await Listing.deleteMany({ _id: { $in: L } });
  await User.deleteMany({ _id: { $in: U } });
});

describe('R6.1 moderation queue must not leak reporter PII to anonymous callers', () => {
  test('GET /api/reports without token -> 401, no reporter emails in body', async () => {
    const res = await request(app).get('/api/reports');
    expect(res.status).toBe(401);
    expect(JSON.stringify(res.body)).not.toMatch(/@test\.com/);
  });
});

describe('R6.2 moderation state cannot be mutated by a non-admin user', () => {
  test('PATCH /api/reports/:id/status with non-admin token -> 403, status unchanged', async () => {
    const report = await Report.findOne({ reporter: reporter._id });
    const res = await request(app)
      .patch(`/api/reports/${report._id}/status`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .send({ status: 'resolved' });
    expect(res.status).toBe(403);
    const reloaded = await Report.findById(report._id);
    expect(reloaded.status).toBe('pending');
  });
});

describe('R6.3 paid trends refresh cannot be triggered anonymously', () => {
  test('POST /api/trends/refresh without token -> 401', async () => {
    const res = await request(app).post('/api/trends/refresh').send({});
    expect(res.status).toBe(401);
  });
});
