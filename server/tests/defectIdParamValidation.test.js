/**
 * Red tests proving two id-bearing routes answer 500 for a malformed id.
 *
 * These routes are mounted outside the global assertObjectId path rules and
 * pass `req.params.id` straight to Mongoose:
 *
 *   POST /api/vendors/:id/invite      -> Vendor.findById('not-an-id')
 *   PATCH /api/reports/:id/status     -> Report.findByIdAndUpdate('not-an-id')
 *
 * Both throw a CastError that the catch block turns into a 500. A malformed id
 * is a client error: the rest of the API answers 400 (assertObjectId) for the
 * same input.
 */
const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const app = require('../server.js');
const api = request(app);
const User = require('../models/User');
const Listing = require('../models/Listing');
const Vendor = require('../models/Vendor');
const Report = require('../models/Report');

const secret = process.env.JWT_SECRET || 'fallback_secret_change_me';

let seller;
let sellerToken;
let admin;
let adminToken;
let listing;
let report;

beforeAll(async () => {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/trend-drop-test');
  }
  const seed = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  seller = await User.create({
    _id: new mongoose.Types.ObjectId(),
    name: 'Vendor Seller',
    email: `vendor_${seed}@test.com`,
    password: 'password123',
    emailVerified: true,
    authProvider: 'email',
    country: 'US',
    currency: 'USD',
  });
  sellerToken = jwt.sign({ id: seller._id }, secret, { expiresIn: '1h' });

  admin = await User.create({
    _id: new mongoose.Types.ObjectId(),
    name: 'Report Admin',
    email: `report_admin_${seed}@test.com`,
    password: 'password123',
    emailVerified: true,
    authProvider: 'email',
    role: 'admin',
    country: 'US',
    currency: 'USD',
  });
  adminToken = jwt.sign({ id: admin._id }, secret, { expiresIn: '1h' });

  listing = await Listing.create({
    seller: seller._id,
    title: 'Reported Item',
    description: 'Listing used by the id-validation defect suite',
    price: 25,
    category: 'Men',
    condition: 'Good',
    quantity: 1,
    available: true,
    sold: false,
    status: 'active',
    images: [],
  });

  report = await Report.create({
    reporter: admin._id,
    listing: listing._id,
    reason: 'Spam',
  });
});

afterAll(async () => {
  await Report.deleteMany({ listing: listing._id });
});

describe('DEFECT: malformed ids must be a 400, never a CastError 500', () => {
  test('ID.1 POST /api/vendors/:id/invite with a malformed id is a 400', async () => {
    const res = await api
      .post('/api/vendors/not-an-id/invite')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ sellerId: String(seller._id), commission: 10 });

    expect(res.status).toBe(400);
  });

  test('ID.2 PATCH /api/reports/:id/status with a malformed id is a 400', async () => {
    const res = await api
      .patch('/api/reports/not-an-id/status')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'resolved' });

    expect(res.status).toBe(400);
  });

  test('ID.3 REGRESSION GUARD: valid ids still follow their normal rules', async () => {
    // A real vendor id from a non-member is an authorization failure, not a 400.
    const vendor = await Vendor.create({
      listing: listing._id,
      sellers: [{ seller: admin._id, commission: 0, isPrimary: true }],
    });
    const invite = await api
      .post(`/api/vendors/${vendor._id}/invite`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ sellerId: String(seller._id), commission: 10 });
    expect(invite.status).toBe(403);

    const patched = await api
      .patch(`/api/reports/${report._id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'resolved' });
    expect(patched.status).toBe(200);
    expect(patched.body.status).toBe('resolved');
  });
});
