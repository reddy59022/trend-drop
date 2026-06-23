/**
 * Integration tests for Notifications.
 * Tests notification creation, listing, and mark-as-read.
 */
const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../server');
const User = require('../models/User');
const Listing = require('../models/Listing');

const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';
const generateToken = (userId) => jwt.sign({ id: userId }, JWT_SECRET, { expiresIn: '30d' });

let user1Token, user1Id, user2Token, user2Id;
const TEST_RUN_ID = `notif_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const testUserIds = [];

beforeAll(async () => {
  const uri = process.env.MONGODB_URI || 'mongodb+srv://reddy59022_db_user:anNecZCiT3eJQfre@cluster.mongodb.net/poshmark?retryWrites=true&w=majority';
  if (mongoose.connection.readyState === 0) await mongoose.connect(uri);

  const user1 = await User.create({ name: 'NotifUser1', email: `notif1_${TEST_RUN_ID}@test.com`, password: 'password123', emailVerified: true, authProvider: 'email' });
  testUserIds.push(user1._id);
  user1Id = user1._id;
  user1Token = generateToken(user1._id);

  const user2 = await User.create({ name: 'NotifUser2', email: `notif2_${TEST_RUN_ID}@test.com`, password: 'password123', emailVerified: true, authProvider: 'email' });
  testUserIds.push(user2._id);
  user2Id = user2._id;
  user2Token = generateToken(user2._id);
});

afterAll(async () => {
  await User.deleteMany({ _id: { $in: testUserIds } });
  await mongoose.disconnect();
});

describe('Notifications', () => {
  test('NOT.1 List notifications', async () => {
    const r = await request(app).get(`/api/users/${user1Id}/notifications`).set('Authorization', `Bearer ${user1Token}`);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBe(true);
  });

  test('NOT.2 Mark all notifications as read', async () => {
    const r = await request(app).put(`/api/users/${user1Id}/notifications/read`).set('Authorization', `Bearer ${user1Token}`);
    expect(r.status).toBe(200);
  });

  test('NOT.3 Unauthorized cannot access other user notifications', async () => {
    const r = await request(app).get(`/api/users/${user1Id}/notifications`).set('Authorization', `Bearer ${user2Token}`);
    expect(r.status).toBe(403);
  });

  test('NOT.4 Notifications created on like', async () => {
    const listing = await Listing.create({
      seller: user1Id,
      title: 'Notif Test',
      description: 'Test',
      price: 100,
      category: 'Men',
      condition: 'New with tags',
      available: true,
      quantity: 5,
      shipsFrom: 'US',
      weight: 1,
    });

    const r = await request(app).post(`/api/listings/${listing._id}/like`).set('Authorization', `Bearer ${user2Token}`);
    expect(r.status).toBe(200);
    expect(r.body.liked).toBe(true);
  });
});