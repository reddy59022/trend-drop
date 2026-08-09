/**
 * Integration tests for Messages (compliance tests for BUSINESS_RULES.md §16-22)
 * Covers conversation creation, sending, mark-as-read, authorization.
 */
const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../server');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Message = require('../models/Message');

const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';
const generateToken = (userId) => jwt.sign({ id: userId }, JWT_SECRET, { expiresIn: '30d' });

let sellerToken, sellerId, buyerToken, buyerId, listingId;
const TEST_RUN_ID = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const testUserIds = [];
const testListingIds = [];
const testMessageIds = [];

beforeAll(async () => {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/trend-drop-test';
  if (mongoose.connection.readyState === 0) await mongoose.connect(uri);

  const seller = await User.create({ name: 'MsgSeller', email: `msgs_${TEST_RUN_ID}@test.com`, password: 'password123', emailVerified: true, authProvider: 'email' });
  testUserIds.push(seller._id); sellerId = seller._id; sellerToken = generateToken(seller._id);

  const buyer = await User.create({ name: 'MsgBuyer', email: `msgb_${TEST_RUN_ID}@test.com`, password: 'password123', emailVerified: true, authProvider: 'email' });
  testUserIds.push(buyer._id); buyerId = buyer._id; buyerToken = generateToken(buyer._id);

  const listing = await Listing.create({ seller: sellerId, title: 'Msg Test', description: 'Desc', price: 100, category: 'Men', condition: 'New with tags', available: true, quantity: 5, shipsFrom: 'US', weight: 1 });
  testListingIds.push(listing._id); listingId = listing._id;
});

afterAll(async () => {
  await Message.deleteMany({ _id: { $in: testMessageIds } });
  await Listing.deleteMany({ _id: { $in: testListingIds } });
  await User.deleteMany({ _id: { $in: testUserIds } });
  // Do NOT disconnect — jest.setup.js afterAll cleans DB between files
});

describe('Messages', () => {
  test('MSG.1 Buyer can start conversation with seller about listing', async () => {
    const r = await request(app).post('/api/messages').set('Authorization', `Bearer ${buyerToken}`).send({ sellerId, listingId, text: 'Is this still available?' });
    expect(r.status).toBe(201);
    expect(r.body.participants).toBeDefined();
    testMessageIds.push(r.body._id);
  });

  test('MSG.2 Cannot message self', async () => {
    const r = await request(app).post('/api/messages').set('Authorization', `Bearer ${buyerToken}`).send({ sellerId: buyerId, listingId, text: 'Self msg' });
    expect(r.status).toBe(400);
    expect(r.body.message).toBe('Cannot message yourself');
  });

  test('MSG.3 Unauthenticated cannot send messages', async () => {
    const r = await request(app).post('/api/messages').send({ sellerId, listingId, text: 'Hack' });
    expect(r.status).toBe(401);
  });

  test('MSG.4 Get conversations list', async () => {
    const r = await request(app).get('/api/messages/conversations').set('Authorization', `Bearer ${buyerToken}`);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBe(true);
  });

  test('MSG.5 Mark conversation as read', async () => {
    const conv = (await request(app).get('/api/messages/conversations').set('Authorization', `Bearer ${buyerToken}`)).body;
    if (conv.length > 0) {
      const r = await request(app).put(`/api/messages/read/${conv[0]._id}`).set('Authorization', `Bearer ${buyerToken}`);
      expect(r.status).toBe(200);
    }
  });
});