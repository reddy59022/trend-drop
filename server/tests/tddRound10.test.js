/* TDD Round 10 RED tests — vendor collaboration integrity gaps (part 1).
 * V1: POST /api/vendors needs ownership + commission + existence checks.
 * V2/V3 continued in tddRound10b.test.js.
 */
const mongoose = require('mongoose');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../server');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Vendor = require('../models/Vendor');

const SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';
const RUN = `r10_${Date.now()}`;
const U = [];
const L = [];
const V = [];

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
    seller: sellerId, title: 'R10 Item', description: 'd', price: 60,
    category: 'Men', condition: 'New with tags', quantity: 5,
    available: true, sold: false, status: 'active', shipsFrom: 'US',
    currency: 'USD', weight: 0.5,
  });
  L.push(l._id);
  return l;
}

let owner;
let stranger;
let ownerToken;
let strangerToken;
let listing;

beforeAll(async () => {
  if (mongoose.connection.readyState !== 1) await mongoose.connect(process.env.MONGO_URI);
  owner = await mkUser('R10 Owner', 'r10own');
  stranger = await mkUser('R10 Stranger', 'r10str');
  ownerToken = jwt.sign({ id: owner._id }, SECRET, { expiresIn: '30d' });
  strangerToken = jwt.sign({ id: stranger._id }, SECRET, { expiresIn: '30d' });
  listing = await mkListing(owner._id);
});

afterAll(async () => {
  await Vendor.deleteMany({ listing: { $in: L } });
  await Listing.deleteMany({ _id: { $in: L } });
  await User.deleteMany({ _id: { $in: U } });
  void V;
});

describe('R10.1 vendor rows can only be opened by the listing seller with sane commission', () => {
  test("stranger claims owner's listing -> 403, no vendor row", async () => {
    const before = await Vendor.countDocuments({ listing: listing._id });
    const res = await request(app).post('/api/vendors')
      .set('Authorization', `Bearer ${strangerToken}`)
      .send({ listingId: listing._id.toString(), commission: 50 });
    expect(res.status).toBe(403);
    expect(await Vendor.countDocuments({ listing: listing._id })).toBe(before);
  });

  test.each([['over 100', 150], ['negative', -5], ['NaN string', 'lots']])(
    'commission %s -> 400, no vendor row',
    async (_label, commission) => {
      const ownListing = await mkListing(owner._id);
      const before = await Vendor.countDocuments({ listing: ownListing._id });
      const res = await request(app).post('/api/vendors')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ listingId: ownListing._id.toString(), commission });
      expect(res.status).toBe(400);
      expect(await Vendor.countDocuments({ listing: ownListing._id })).toBe(before);
    }
  );

  test('ghost listing -> 404, no vendor row', async () => {
    const ghost = new mongoose.Types.ObjectId().toString();
    const res = await request(app).post('/api/vendors')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ listingId: ghost, commission: 50 });
    expect(res.status).toBe(404);
  });
});
