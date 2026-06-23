/**
 * Integration tests for Admin Panel endpoints.
 * Tests all 13 admin endpoints including dashboard, users, listings, reports, transactions.
 * Covers authorization (admin vs non-admin), CRUD operations, and edge cases.
 */
const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../server');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Transaction = require('../models/Transaction');
const Report = require('../models/Report');

const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';
const generateToken = (userId) => jwt.sign({ id: userId }, JWT_SECRET, { expiresIn: '30d' });

let adminToken, adminId, userToken, userId, listingId;
const TEST_RUN_ID = `admin_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const testUserIds = [];
const testListingIds = [];

beforeAll(async () => {
  const uri = process.env.MONGODB_URI || 'mongodb+srv://reddy59022_db_user:anNecZCiT3eJQfre@cluster.mongodb.net/poshmark?retryWrites=true&w=majority';
  if (mongoose.connection.readyState === 0) await mongoose.connect(uri);

  // Create admin user
  const admin = await User.create({
    name: 'AdminUser',
    email: `admin_${TEST_RUN_ID}@test.com`,
    password: 'password123',
    emailVerified: true,
    role: 'admin',
    authProvider: 'email',
    country: 'US',
    currency: 'USD',
  });
  testUserIds.push(admin._id);
  adminToken = generateToken(admin._id);
  adminId = admin._id;

  // Create regular user
  const regular = await User.create({
    name: 'RegularUser',
    email: `user_${TEST_RUN_ID}@test.com`,
    password: 'password123',
    emailVerified: true,
    role: 'user',
    authProvider: 'email',
    country: 'US',
    currency: 'USD',
  });
  testUserIds.push(regular._id);
  userToken = generateToken(regular._id);
  userId = regular._id;

  // Create a test listing
  const listing = await Listing.create({
    seller: admin._id,
    title: 'Admin Test Listing',
    description: 'Test for admin panel',
    price: 100,
    category: 'Men',
    condition: 'New with tags',
    available: true,
    quantity: 5,
    shipsFrom: 'US',
    weight: 1,
  });
  testListingIds.push(listing._id);
  listingId = listing._id;

  // Create a test report with valid enum value
  await Report.create({
    reporter: userId,
    listing: listingId,
    reason: 'Other',
    description: 'Test report for admin panel',
    status: 'pending',
  });
});

afterAll(async () => {
  await Report.deleteMany({ reporter: { $in: testUserIds } });
  await Transaction.deleteMany({ buyer: { $in: testUserIds } });
  await Listing.deleteMany({ _id: { $in: testListingIds } });
  await User.deleteMany({ _id: { $in: testUserIds } });
  await mongoose.disconnect();
});

describe('Admin Authorization', () => {
  test('AD.1 Non-admin user gets 403', async () => {
    const r = await request(app).get('/api/admin/dashboard').set('Authorization', `Bearer ${userToken}`);
    expect(r.status).toBe(403);
  });

  test('AD.2 Unauthenticated gets 401', async () => {
    const r = await request(app).get('/api/admin/dashboard');
    expect(r.status).toBe(401);
  });

  test('AD.3 Admin can access dashboard', async () => {
    const r = await request(app).get('/api/admin/dashboard').set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(200);
    expect(r.body.stats).toBeDefined();
    expect(r.body.stats.totalUsers).toBeGreaterThanOrEqual(0);
  });
});

describe('Admin Dashboard', () => {
  test('AD.4 Dashboard has all required stats', async () => {
    const r = await request(app).get('/api/admin/dashboard').set('Authorization', `Bearer ${adminToken}`);
    expect(r.body.stats.totalUsers).toBeDefined();
    expect(r.body.stats.totalListings).toBeDefined();
    expect(r.body.stats.totalTransactions).toBeDefined();
    expect(r.body.stats.totalCommission).toBeDefined();
  });

  test('AD.5 Dashboard includes recent transactions', async () => {
    const r = await request(app).get('/api/admin/dashboard').set('Authorization', `Bearer ${adminToken}`);
    expect(Array.isArray(r.body.recentTransactions)).toBe(true);
  });
});

describe('Admin User Management', () => {
  test('AD.6 List users with pagination', async () => {
    const r = await request(app).get('/api/admin/users?page=1&limit=10').set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.users)).toBe(true);
    expect(r.body.totalPages).toBeGreaterThanOrEqual(1);
  });

  test('AD.7 Search users by name', async () => {
    const r = await request(app).get('/api/admin/users?search=AdminUser').set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(200);
    expect(r.body.users.length).toBeGreaterThanOrEqual(1);
  });

  test('AD.8 Filter users by role', async () => {
    const r = await request(app).get('/api/admin/users?role=admin').set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(200);
    r.body.users.forEach(u => expect(u.role).toBe('admin'));
  });

  test('AD.9 Get user details', async () => {
    const r = await request(app).get(`/api/admin/users/${userId}`).set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(200);
    expect(r.body.user).toBeDefined();
    expect(r.body.listingCount).toBeDefined();
  });

  test('AD.10 Update user role', async () => {
    const r = await request(app).put(`/api/admin/users/${userId}/role`).set('Authorization', `Bearer ${adminToken}`).send({ role: 'moderator' });
    expect(r.status).toBe(200);
    expect(r.body.user.role).toBe('moderator');
    // Reset
    await User.findByIdAndUpdate(userId, { role: 'user' });
  });

  test('AD.11 Invalid role rejected', async () => {
    const r = await request(app).put(`/api/admin/users/${userId}/role`).set('Authorization', `Bearer ${adminToken}`).send({ role: 'invalid' });
    expect(r.status).toBe(400);
  });
});

describe('Admin Listing Management', () => {
  test('AD.12 List all listings', async () => {
    const r = await request(app).get('/api/admin/listings').set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.listings)).toBe(true);
  });

  test('AD.13 Delete listing (admin override)', async () => {
    const l = await Listing.create({
      seller: adminId, title: 'Temp List', description: 'D', price: 50,
      category: 'Women', condition: 'Good', available: true, quantity: 1,
      shipsFrom: 'US', weight: 0.5,
    });
    const r = await request(app).delete(`/api/admin/listings/${l._id}`).set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(200);
  });
});

describe('Admin Report Management', () => {
  test('AD.14 List all reports', async () => {
    const r = await request(app).get('/api/admin/reports').set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.reports)).toBe(true);
  });

  test('AD.15 Resolve a report', async () => {
    const reports = (await request(app).get('/api/admin/reports').set('Authorization', `Bearer ${adminToken}`)).body.reports;
    if (reports.length > 0) {
      const r = await request(app).put(`/api/admin/reports/${reports[0]._id}/status`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'resolved' });
      expect(r.status).toBe(200);
      expect(r.body.report.status).toBe('resolved');
    }
  });

  test('AD.16 Dismiss a report', async () => {
    const reports = (await request(app).get('/api/admin/reports').set('Authorization', `Bearer ${adminToken}`)).body.reports;
    if (reports.length > 0) {
      const r = await request(app).put(`/api/admin/reports/${reports[0]._id}/status`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'dismissed' });
      expect(r.status).toBe(200);
      expect(r.body.report.status).toBe('dismissed');
    }
  });
});

describe('Admin Transaction Management', () => {
  test('AD.17 List all transactions', async () => {
    const r = await request(app).get('/api/admin/transactions').set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.transactions)).toBe(true);
  });
});

describe('Admin Auto-Suspend', () => {
  test('AD.18 Auto-suspend users with 3+ strikes', async () => {
    // Create user with 3 strikes
    const strikeUser = await User.create({
      name: 'StrikeUser',
      email: `strike_${TEST_RUN_ID}@test.com`,
      password: 'password123',
      emailVerified: true,
      role: 'user',
      stats: { strikes: 3 },
      authProvider: 'email',
    });
    testUserIds.push(strikeUser._id);

    const r = await request(app).post('/api/admin/auto-suspend').set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(200);
    expect(r.body.suspended).toBeGreaterThanOrEqual(1);

    const updated = await User.findById(strikeUser._id);
    expect(updated.role).toBe('suspended');
  });
});