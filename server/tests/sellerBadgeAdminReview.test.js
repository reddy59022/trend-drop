const mongoose = require('mongoose');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../server');
const User = require('../models/User');
const SellerBadge = require('../models/SellerBadge');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';
const tokenFor = (id) => jwt.sign({ id }, JWT_SECRET, { expiresIn: '30d' });

let admin;
let seller;
let adminToken;
let sellerToken;

beforeAll(async () => {
  admin = await User.create({
    name: 'Badge Admin', email: `badge-admin-${Date.now()}@test.com`, password: 'password123',
    country: 'US', currency: 'USD', emailVerified: true, authProvider: 'email', role: 'admin',
  });
  seller = await User.create({
    name: 'Badge Applicant', email: `badge-applicant-${Date.now()}@test.com`, password: 'password123',
    country: 'US', currency: 'USD', emailVerified: true, authProvider: 'email', role: 'user',
  });
  adminToken = tokenFor(admin._id);
  sellerToken = tokenFor(seller._id);
  await SellerBadge.create({ userId: seller._id, verificationRequested: true });
});

afterAll(async () => {
  await SellerBadge.deleteMany({ userId: { $in: [admin._id, seller._id] } });
  await User.deleteMany({ _id: { $in: [admin._id, seller._id] } });
  await mongoose.connection.close();
});

test('seller badge review rejects non-admin approval attempts', async () => {
  const response = await request(app)
    .put(`/api/admin/seller-badges/${seller._id}/verification`)
    .set('Authorization', `Bearer ${sellerToken}`)
    .send({ decision: 'approve' });

  expect(response.status).toBe(403);
});

test('admin approval grants verification benefits and records reviewer', async () => {
  const response = await request(app)
    .put(`/api/admin/seller-badges/${seller._id}/verification`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ decision: 'approve' });

  expect(response.status).toBe(200);
  expect(response.body.badge.isVerified).toBe(true);
  expect(response.body.badge.verificationRequested).toBe(false);
  expect(response.body.badge.benefits.reducedFees).toBe(true);
  expect(response.body.badge.benefits.prioritySupport).toBe(true);
  expect(response.body.badge.verificationReviewedBy).toBe(String(admin._id));
});

test('admin rejection clears pending state and records the reason', async () => {
  await SellerBadge.findOneAndUpdate(
    { userId: seller._id },
    { verificationRequested: true, isVerified: false, verifiedAt: null }
  );

  const response = await request(app)
    .put(`/api/admin/seller-badges/${seller._id}/verification`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ decision: 'reject', reason: 'Identity document is not legible' });

  expect(response.status).toBe(200);
  expect(response.body.badge.isVerified).toBe(false);
  expect(response.body.badge.verificationRequested).toBe(false);
  expect(response.body.badge.verificationRejectionReason).toBe('Identity document is not legible');
});
