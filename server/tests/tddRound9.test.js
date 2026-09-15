/* TDD Round 9 RED tests — price-history integrity gaps.
 *
 * Business reading: price history is buyer-facing proof ("was $80, now $60")
 * and powers price-drop notifications. But POST /api/pricehistory lets ANY
 * authenticated user append ANY price to ANY listing: no listing existence
 * check (ghost ids 500), no numeric validation (NaN/negative/zero persist as
 * fake history), and no seller-ownership check (a stranger can forge a fake
 * price drop on your listing to trigger bogus liker notifications).
 * Rule: listing must exist (404), price must be a finite number >= 1 (400),
 * and only the listing's seller may record history (403).
 */
const mongoose = require('mongoose');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../server');
const User = require('../models/User');
const Listing = require('../models/Listing');
const PriceHistory = require('../models/PriceHistory');

const SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';
const RUN = `r9_${Date.now()}`;
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
    title: 'R9 Item',
    description: 'd',
    price: 80,
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

let seller;
let stranger;
let sellerToken;
let strangerToken;
let listing;

beforeAll(async () => {
  if (mongoose.connection.readyState !== 1) await mongoose.connect(process.env.MONGO_URI);
  seller = await mkUser('R9 Seller', 'r9sell');
  stranger = await mkUser('R9 Stranger', 'r9str');
  sellerToken = jwt.sign({ id: seller._id }, SECRET, { expiresIn: '30d' });
  strangerToken = jwt.sign({ id: stranger._id }, SECRET, { expiresIn: '30d' });
  listing = await mkListing(seller._id);
});

afterAll(async () => {
  await PriceHistory.deleteMany({ listing: { $in: L } });
  await Listing.deleteMany({ _id: { $in: L } });
  await User.deleteMany({ _id: { $in: U } });
});

describe('R9.1 forged price history by non-seller is rejected', () => {
  test('stranger POST fake price drop -> 403, nothing recorded', async () => {
    const before = await PriceHistory.countDocuments({ listing: listing._id });
    const res = await request(app)
      .post('/api/pricehistory')
      .set('Authorization', `Bearer ${strangerToken}`)
      .send({ listingId: listing._id.toString(), price: 10 });
    expect(res.status).toBe(403);
    expect(await PriceHistory.countDocuments({ listing: listing._id })).toBe(before);
  });
});

describe('R9.2 non-numeric / non-positive prices are rejected with 400', () => {
  test.each([['NaN string', 'not-a-number'], ['negative', -5], ['zero', 0]])(
    'price %s -> 400, nothing recorded',
    async (_label, price) => {
      const before = await PriceHistory.countDocuments({ listing: listing._id });
      const res = await request(app)
        .post('/api/pricehistory')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({ listingId: listing._id.toString(), price });
      expect(res.status).toBe(400);
      expect(await PriceHistory.countDocuments({ listing: listing._id })).toBe(before);
    }
  );
});

describe('R9.3 ghost listing ids are rejected with 404 (not 500)', () => {
  test('valid-but-nonexistent listing -> 404', async () => {
    const ghost = new mongoose.Types.ObjectId().toString();
    const res = await request(app)
      .post('/api/pricehistory')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ listingId: ghost, price: 60 });
    expect(res.status).toBe(404);
  });
});
