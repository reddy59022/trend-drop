/**
 * Collections routes: a malformed ObjectId is a client error (400), never a
 * CastError 500. `Collection.findById('not-an-id')` throws, and the generic
 * catch block answered 500 for both the path id and the body `listingId`.
 */
const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const app = require('../server.js');
const api = request(app);
const User = require('../models/User');
const Collection = require('../models/Collection');
const Listing = require('../models/Listing');

const secret = process.env.JWT_SECRET || 'fallback_secret_change_me';
const BAD_ID = 'not-an-object-id';

let token;
let userId;
let collectionId;
let listingId;

beforeAll(async () => {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/trend-drop-test');
  }
  const user = await User.create({
    _id: new mongoose.Types.ObjectId(),
    name: 'Collection Sweep User',
    email: `collection_sweep_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@test.com`,
    password: 'password123',
    emailVerified: true,
    authProvider: 'email',
    country: 'US',
    currency: 'USD',
  });
  userId = user._id;
  token = jwt.sign({ id: userId }, secret, { expiresIn: '1h' });

  const collection = await Collection.create({ seller: userId, name: 'Sweep collection' });
  collectionId = collection._id;

  const listing = await Listing.create({
    seller: userId,
    title: 'Collection sweep jacket',
    description: 'Sweep',
    price: 40,
    category: 'Women',
    condition: 'Good',
    quantity: 1,
    status: 'active',
    available: true,
  });
  listingId = listing._id;
});

afterAll(async () => {
  await Collection.deleteMany({ seller: userId });
  await Listing.deleteMany({ seller: userId });
  await User.deleteOne({ _id: userId });
});

describe('collections routes reject malformed ids with 400', () => {
  it('POST /api/collections/:id/listings with a malformed listingId', async () => {
    const res = await api
      .post(`/api/collections/${collectionId}/listings`)
      .set('Authorization', `Bearer ${token}`)
      .send({ listingId: BAD_ID });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/listing id/i);
  });

  it('adding the same listing twice stores it once', async () => {
    const first = await api
      .post(`/api/collections/${collectionId}/listings`)
      .set('Authorization', `Bearer ${token}`)
      .send({ listingId: String(listingId) });
    expect(first.status).toBe(200);

    const second = await api
      .post(`/api/collections/${collectionId}/listings`)
      .set('Authorization', `Bearer ${token}`)
      .send({ listingId: String(listingId) });
    expect(second.status).toBe(200);

    const stored = await Collection.findById(collectionId);
    const ids = stored.listings.map((id) => id.toString());
    expect(ids).toEqual([String(listingId)]);
  });

  it('GET /api/collections/:id with a malformed collection id', async () => {
    const res = await api.get(`/api/collections/${BAD_ID}`);
    expect(res.status).toBe(400);
  });

  it('GET /api/collections/seller/:sellerId with a malformed seller id', async () => {
    const res = await api.get(`/api/collections/seller/${BAD_ID}`);
    expect(res.status).toBe(400);
  });

  it('PUT /api/collections/:id with a malformed collection id', async () => {
    const res = await api
      .put(`/api/collections/${BAD_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Renamed' });
    expect(res.status).toBe(400);
  });

  it('DELETE /api/collections/:id with a malformed collection id', async () => {
    const res = await api
      .delete(`/api/collections/${BAD_ID}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  it('DELETE /api/collections/:id/listings/:listingId with a malformed listing id', async () => {
    const res = await api
      .delete(`/api/collections/${collectionId}/listings/${BAD_ID}`)
      .set('Authorization', `Bearer ${token}`);
    // Removing a nonexistent member is a no-op that returns the collection, but
    // a malformed id must still be a client error rather than a silent 200.
    expect(res.status).toBe(400);
  });
});
