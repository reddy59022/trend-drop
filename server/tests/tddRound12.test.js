/* TDD Round 12 RED tests — ratings request validation.
 * R12.1 malformed listingId in the BODY must 400 (route params are guarded
 *       globally, but body values reach Transaction.findOne unvalidated and
 *       blow up as a CastError -> 500).
 * R12.2 non-string review must 400 (String cast of an object throws -> 500).
 * R12.3 documents the already-correct param guard (GET /listing/:garbage).
 */
const mongoose = require('mongoose');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../server');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Transaction = require('../models/Transaction');

const SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';
const RUN = `r12_${Date.now()}`;
const US = { fullName: 'R12', street1: '1 St', city: 'C', state: 'S', postalCode: '0', country: 'US' };
const U = [];
const L = [];

async function mkUser(name, prefix) {
  const u = await User.create({
    name, email: `${prefix}_${RUN}@test.com`, password: 'password123',
    emailVerified: true, authProvider: 'email', country: 'US', currency: 'USD',
    shippingAddress: { ...US },
    balance: { available: 0, pending: 0, totalEarned: 0, totalPaidOut: 0, currency: 'USD' },
  });
  U.push(u._id);
  return u;
}

let seller;
let buyer;
let buyerToken;
let listing;

beforeAll(async () => {
  if (mongoose.connection.readyState !== 1) await mongoose.connect(process.env.MONGO_URI);
  seller = await mkUser('R12 Seller', 'r12sell');
  buyer = await mkUser('R12 Buyer', 'r12buy');
  buyerToken = jwt.sign({ id: buyer._id }, SECRET, { expiresIn: '30d' });
  listing = await Listing.create({
    seller: seller._id, title: 'R12 Item', description: 'd', price: 50,
    category: 'Men', condition: 'New with tags', quantity: 5,
    available: true, sold: false, status: 'active', shipsFrom: 'US',
    currency: 'USD', weight: 0.5,
  });
  L.push(listing._id);
});

afterAll(async () => {
  await Transaction.deleteMany({ buyer: { $in: U } });
  await Listing.deleteMany({ _id: { $in: L } });
  await User.deleteMany({ _id: { $in: U } });
});

describe('R12.1 malformed body listingId must be 400, not 500', () => {
  test("listingId 'garbage' -> 400", async () => {
    const res = await request(app).post('/api/ratings')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ listingId: 'garbage', rating: 5, review: 'x' });
    expect(res.status).toBe(400);
  });
});

describe('R12.2 non-string review must be 400, not 500', () => {
  test('review as object -> 400', async () => {
    // Completed purchase so the transaction gate passes and the bug is in the
    // review validation, not the eligibility check.
    const pi = 'pi_r12_' + Date.now();
    global.__mockPaymentIntents = global.__mockPaymentIntents || {};
    global.__mockPaymentIntents[pi] = { id: pi, status: 'requires_capture', amount: 0, currency: 'usd', metadata: {} };
    const buy = await request(app).post('/api/transactions')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ paymentIntentId: pi, listingId: listing._id, buyerCountry: 'US', shippingAddress: { ...US } });
    expect(buy.status).toBe(201);
    await Transaction.findByIdAndUpdate(buy.body._id, { status: 'completed' });

    const res = await request(app).post('/api/ratings')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ listingId: listing._id.toString(), rating: 5, review: { evil: true } });
    expect(res.status).toBe(400);
  });
});

describe('R12.3 param-path garbage is already 400 (global ObjectId guard)', () => {
  test('GET /api/ratings/listing/garbage -> 400', async () => {
    const res = await request(app).get('/api/ratings/listing/garbage');
    expect(res.status).toBe(400);
  });
});
