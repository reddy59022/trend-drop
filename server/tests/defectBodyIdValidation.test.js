/**
 * API contract sweep: a malformed ObjectId in a request BODY is a client
 * error, never a server error.
 *
 * Path ids are covered by assertObjectId, but body ids (listingId,
 * transactionId, ...) are validated per route. A route that forwards
 * `req.body.listingId` straight into a Mongoose query turns `"not-an-id"` into
 * a CastError and the catch block answers 500. This suite pins "no 5xx" for the
 * body-id surface; the exact 4xx code is route-specific.
 */
const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const app = require('../server.js');
const api = request(app);
const User = require('../models/User');

const secret = process.env.JWT_SECRET || 'fallback_secret_change_me';
const BAD_ID = 'not-an-object-id';

let token;

beforeAll(async () => {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/trend-drop-test');
  }
  const user = await User.create({
    _id: new mongoose.Types.ObjectId(),
    name: 'Body Sweep User',
    email: `body_sweep_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@test.com`,
    password: 'password123',
    emailVerified: true,
    authProvider: 'email',
    country: 'US',
    currency: 'USD',
    shippingAddress: { fullName: 'Sweep', street1: '1 St', city: 'City', state: 'CA', postalCode: '90210', country: 'US' },
  });
  token = jwt.sign({ id: user._id }, secret, { expiresIn: '1h' });
});

const post = (url, body) => api
  .post(url)
  .set('Authorization', `Bearer ${token}`)
  .send(body);

const CASES = [
  ['/api/wishlist', { listingId: BAD_ID }],
  ['/api/offers', { listingId: BAD_ID, amount: 10 }],
  ['/api/cart/items', { listingId: BAD_ID, quantity: 1 }],
  ['/api/recently-viewed', { listingId: BAD_ID }],
  ['/api/comments', { listingId: BAD_ID, text: 'hello' }],
  ['/api/returns', { transactionId: BAD_ID, reason: 'Not as described' }],
  ['/api/shipping-insurance', { transactionId: BAD_ID, coverageType: 'standard' }],
  ['/api/virtual-try-on/session', { listingId: BAD_ID }],
  ['/api/payments/create-intent', { listingId: BAD_ID }],
  ['/api/auctions', { listingId: BAD_ID, startTime: new Date().toISOString(), endTime: new Date(Date.now() + 86400000).toISOString() }],
  ['/api/ratings', { transactionId: BAD_ID, rating: 5, comment: 'x' }],
];

describe('malformed body ids never produce a 5xx', () => {
  test.each(CASES)('%s', async (url, body) => {
    const res = await post(url, body);
    expect(res.status).toBeLessThan(500);
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
