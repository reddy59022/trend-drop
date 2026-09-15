/* TDD Round 8 RED tests — collection write-integrity gaps.
 *
 * Business reading: a collection is a seller's storefront shelf. The
 * dedicated POST /:id/listings endpoint correctly enforces "only your own
 * listings" — but PUT /:id accepts a raw `listings` array with NO checks, so
 * a seller can inject another seller's (or nonexistent) listings onto their
 * shelf, or trash their own shelf with garbage ids (500 CastError on save).
 * Rule proven here: PUT validates every id (400 on malformed), every listing
 * must exist (404), and every listing must belong to the collection owner
 * (400) — mirroring the POST endpoint's ownership rule.
 */
const mongoose = require('mongoose');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../server');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Collection = require('../models/Collection');

const SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';
const RUN = `r8_${Date.now()}`;
const U = [];
const L = [];
const C = [];

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
    title: 'R8 Item',
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

let sellerA;
let sellerB;
let tokenA;
let collection;

beforeAll(async () => {
  if (mongoose.connection.readyState !== 1) await mongoose.connect(process.env.MONGO_URI);
  sellerA = await mkUser('R8 Seller A', 'r8a');
  sellerB = await mkUser('R8 Seller B', 'r8b');
  tokenA = jwt.sign({ id: sellerA._id }, SECRET, { expiresIn: '30d' });
  const c = await Collection.create({ seller: sellerA._id, name: 'R8 Shelf', listings: [] });
  C.push(c._id);
  collection = c;
});

afterAll(async () => {
  await Collection.deleteMany({ _id: { $in: C } });
  await Listing.deleteMany({ _id: { $in: L } });
  await User.deleteMany({ _id: { $in: U } });
});

describe('R8.1 PUT collection listings rejects another seller listing', () => {
  test("seller B's listing on seller A's shelf -> 400, shelf unchanged", async () => {
    const foreign = await mkListing(sellerB._id);
    const res = await request(app)
      .put(`/api/collections/${collection._id}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ listings: [foreign._id.toString()] });
    expect(res.status).toBe(400);
    const reloaded = await Collection.findById(collection._id);
    expect(reloaded.listings.map(String)).not.toContain(String(foreign._id));
  });
});

describe('R8.2 PUT collection listings rejects malformed ids with 400 (not 500)', () => {
  test('garbage id -> 400, shelf unchanged', async () => {
    const res = await request(app)
      .put(`/api/collections/${collection._id}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ listings: ['not-an-id'] });
    expect(res.status).toBe(400);
    expect((await Collection.findById(collection._id)).listings).toHaveLength(0);
  });
});

describe('R8.3 PUT collection listings rejects nonexistent listings', () => {
  test('valid-but-ghost id -> 404, shelf unchanged', async () => {
    const ghost = new mongoose.Types.ObjectId().toString();
    const res = await request(app)
      .put(`/api/collections/${collection._id}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ listings: [ghost] });
    expect(res.status).toBe(404);
    expect((await Collection.findById(collection._id)).listings).toHaveLength(0);
  });
});
