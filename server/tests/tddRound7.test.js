/* TDD Round 7 RED tests — comment integrity gaps.
 *
 * Business reading: comments are public social proof on a listing. Two gaps:
 *  - C1: POST /api/comments/:listingId accepts unbounded text. The Comment
 *    model caps at 500 chars, so a long comment explodes into a Mongoose
 *    ValidationError -> 500. A client error must be 400, and nothing persisted.
 *  - C2: DELETE /api/comments/:id only allows the author. A seller cannot
 *    remove abusive comments on their OWN listing, and thread children are
 *    orphaned (replies keep a dangling parentId). Rule: author OR listing
 *    seller may delete; deleting a parent cascades to its reply subtree.
 */
const mongoose = require('mongoose');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../server');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Comment = require('../models/Comment');

const SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';
const RUN = `r7_${Date.now()}`;
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
    title: 'R7 Item',
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

let seller;
let buyer;
let sellerToken;
let buyerToken;
let listing;

beforeAll(async () => {
  if (mongoose.connection.readyState !== 1) await mongoose.connect(process.env.MONGO_URI);
  seller = await mkUser('R7 Seller', 'r7sell');
  buyer = await mkUser('R7 Buyer', 'r7buy');
  sellerToken = jwt.sign({ id: seller._id }, SECRET, { expiresIn: '30d' });
  buyerToken = jwt.sign({ id: buyer._id }, SECRET, { expiresIn: '30d' });
  listing = await mkListing(seller._id);
});

afterAll(async () => {
  await Comment.deleteMany({ userId: { $in: U } });
  await Listing.deleteMany({ _id: { $in: L } });
  await User.deleteMany({ _id: { $in: U } });
});

describe('R7.1 over-long comments are rejected with 400, nothing persisted', () => {
  test('POST 2000-char comment -> 400, no comment saved', async () => {
    const before = await Comment.countDocuments({ listingId: listing._id });
    const res = await request(app)
      .post(`/api/comments/${listing._id}`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ text: 'x'.repeat(2000) });
    expect(res.status).toBe(400);
    expect(await Comment.countDocuments({ listingId: listing._id })).toBe(before);
  });
});

describe('R7.2 listing seller can moderate comments on their own listing', () => {
  test('seller DELETE buyer comment -> 200, comment gone', async () => {
    const c = await Comment.create({ listingId: listing._id, userId: buyer._id, text: 'spammy' });
    const res = await request(app)
      .delete(`/api/comments/${c._id}`)
      .set('Authorization', `Bearer ${sellerToken}`);
    expect(res.status).toBe(200);
    expect(await Comment.findById(c._id)).toBeNull();
  });

  test('unrelated third party still cannot delete -> 403', async () => {
    const third = await mkUser('R7 Third', 'r7third');
    const thirdToken = jwt.sign({ id: third._id }, SECRET, { expiresIn: '30d' });
    const c = await Comment.create({ listingId: listing._id, userId: buyer._id, text: 'keep me' });
    const res = await request(app)
      .delete(`/api/comments/${c._id}`)
      .set('Authorization', `Bearer ${thirdToken}`);
    expect(res.status).toBe(403);
    expect(await Comment.findById(c._id)).toBeTruthy();
    await Comment.deleteOne({ _id: c._id });
  });
});

describe('R7.3 deleting a parent comment cascades to its replies', () => {
  test('author deletes parent -> replies removed, parent refs cleaned', async () => {
    const parent = await Comment.create({ listingId: listing._id, userId: buyer._id, text: 'parent' });
    const reply = await Comment.create({
      listingId: listing._id,
      userId: seller._id,
      text: 'child reply',
      parentId: parent._id,
    });
    await Comment.findByIdAndUpdate(parent._id, { $push: { replies: reply._id } });

    const res = await request(app)
      .delete(`/api/comments/${parent._id}`)
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(res.status).toBe(200);
    expect(await Comment.findById(parent._id)).toBeNull();
    expect(await Comment.findById(reply._id)).toBeNull();
  });
});
