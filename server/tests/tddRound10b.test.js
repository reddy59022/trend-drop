/* TDD Round 10 RED tests (part 2) — vendor invite + shared-inventory guards. */
const mongoose = require('mongoose');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../server');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Vendor = require('../models/Vendor');

const SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';
const RUN = `r10b_${Date.now()}`;
const U = [];
const L = [];

async function mkUser(name, prefix) {
  const u = await User.create({
    name, email: `${prefix}_${RUN}@test.com`, password: 'password123',
    emailVerified: true, authProvider: 'email', country: 'US', currency: 'USD',
    shippingAddress: { fullName: name, street1: '1 St', city: 'C', state: 'S', postalCode: '0', country: 'US' },
    balance: { available: 0, pending: 0, totalEarned: 0, totalPaidOut: 0, currency: 'USD' },
  });
  U.push(u._id);
  return u;
}

let owner;
let stranger;
let partner;
let ownerToken;
let strangerToken;
let listing;
let vendor;

beforeAll(async () => {
  if (mongoose.connection.readyState !== 1) await mongoose.connect(process.env.MONGO_URI);
  owner = await mkUser('R10B Owner', 'r10bown');
  stranger = await mkUser('R10B Stranger', 'r10bstr');
  partner = await mkUser('R10B Partner', 'r10bpar');
  ownerToken = jwt.sign({ id: owner._id }, SECRET, { expiresIn: '30d' });
  strangerToken = jwt.sign({ id: stranger._id }, SECRET, { expiresIn: '30d' });
  listing = await Listing.create({
    seller: owner._id, title: 'R10B Item', description: 'd', price: 60,
    category: 'Men', condition: 'New with tags', quantity: 5,
    available: true, sold: false, status: 'active', shipsFrom: 'US',
    currency: 'USD', weight: 0.5,
  });
  L.push(listing._id);
  vendor = await Vendor.create({
    listing: listing._id,
    sellers: [{ seller: owner._id, commission: 50, isPrimary: true }],
    sharedInventory: 5,
  });
});

afterAll(async () => {
  await Vendor.deleteMany({ listing: { $in: L } });
  await Listing.deleteMany({ _id: { $in: L } });
  await User.deleteMany({ _id: { $in: U } });
});

describe('R10.2 vendor invites validate member + commission', () => {
  test('duplicate invite of existing member -> 400, single member row', async () => {
    const before = (await Vendor.findById(vendor._id)).sellers.length;
    const res = await request(app).post(`/api/vendors/${vendor._id}/invite`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ sellerId: owner._id.toString(), commission: 20 });
    expect(res.status).toBe(400);
    expect((await Vendor.findById(vendor._id)).sellers.length).toBe(before);
  });

  test('ghost seller -> 404, members unchanged', async () => {
    const ghost = new mongoose.Types.ObjectId().toString();
    const before = (await Vendor.findById(vendor._id)).sellers.length;
    const res = await request(app).post(`/api/vendors/${vendor._id}/invite`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ sellerId: ghost, commission: 20 });
    expect(res.status).toBe(404);
    expect((await Vendor.findById(vendor._id)).sellers.length).toBe(before);
  });

  test('outsider (non-member) cannot invite -> 403', async () => {
    const res = await request(app).post(`/api/vendors/${vendor._id}/invite`)
      .set('Authorization', `Bearer ${strangerToken}`)
      .send({ sellerId: partner._id.toString(), commission: 20 });
    expect(res.status).toBe(403);
  });
});

describe('R10.3 shared inventory rejects bad quantities', () => {
  test.each([['negative', -3], ['NaN string', 'lots']])(
    'quantity %s -> 400, inventory unchanged',
    async (_label, quantity) => {
      const res = await request(app).put('/api/vendors/shared-inventory')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ listingId: listing._id.toString(), quantity });
      expect(res.status).toBe(400);
      expect((await Vendor.findById(vendor._id)).sharedInventory).toBe(5);
    }
  );
});
