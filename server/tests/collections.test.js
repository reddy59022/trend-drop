/**
 * Integration tests for Seller Collections / Storefront endpoints.
 * Tests CRUD for collections, adding/removing listings, visibility rules.
 */
const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../server');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Collection = require('../models/Collection');

const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';
const generateToken = (userId) => jwt.sign({ id: userId }, JWT_SECRET, { expiresIn: '30d' });

let sellerToken, sellerId, buyerToken, buyerId, listingId;
const TEST_RUN_ID = `col_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const testUserIds = [];
const testListingIds = [];
const testCollectionIds = [];

beforeAll(async () => {
  const uri = process.env.MONGODB_URI || 'mongodb+srv://reddy59022_db_user:anNecZCiT3eJQfre@cluster.mongodb.net/poshmark?retryWrites=true&w=majority';
  if (mongoose.connection.readyState === 0) await mongoose.connect(uri);

  const seller = await User.create({ name: 'CollSeller', email: `seller_${TEST_RUN_ID}@test.com`, password: 'password123', emailVerified: true, authProvider: 'email', country: 'US', currency: 'USD' });
  testUserIds.push(seller._id); sellerId = seller._id; sellerToken = generateToken(seller._id);

  const buyer = await User.create({ name: 'CollBuyer', email: `buyer_${TEST_RUN_ID}@test.com`, password: 'password123', emailVerified: true, authProvider: 'email', country: 'US', currency: 'USD' });
  testUserIds.push(buyer._id); buyerId = buyer._id; buyerToken = generateToken(buyer._id);

  const listing = await Listing.create({ seller: sellerId, title: 'Coll Test Item', description: 'Desc', price: 100, category: 'Men', condition: 'New with tags', available: true, quantity: 5, shipsFrom: 'US', weight: 1 });
  testListingIds.push(listing._id); listingId = listing._id;
});

afterAll(async () => {
  await Collection.deleteMany({ _id: { $in: testCollectionIds } });
  await Listing.deleteMany({ _id: { $in: testListingIds } });
  await User.deleteMany({ _id: { $in: testUserIds } });
  await mongoose.disconnect();
});

describe('Collection CRUD', () => {
  let collectionId;

  test('COL.1 Create collection', async () => {
    const r = await request(app).post('/api/collections').set('Authorization', `Bearer ${sellerToken}`).send({ name: 'Summer Picks', description: 'My summer collection' });
    expect(r.status).toBe(201);
    expect(r.body.name).toBe('Summer Picks');
    collectionId = r.body._id;
    testCollectionIds.push(collectionId);
  });

  test('COL.2 Create collection requires name', async () => {
    const r = await request(app).post('/api/collections').set('Authorization', `Bearer ${sellerToken}`).send({});
    expect(r.status).toBe(400);
  });

  test('COL.3 Get collection with listings', async () => {
    const r = await request(app).get(`/api/collections/${collectionId}`);
    expect(r.status).toBe(200);
    expect(r.body.name).toBe('Summer Picks');
    expect(r.body.seller).toBeDefined();
  });

  test('COL.4 Update collection', async () => {
    const r = await request(app).put(`/api/collections/${collectionId}`).set('Authorization', `Bearer ${sellerToken}`).send({ name: 'Winter Picks', description: 'Updated' });
    expect(r.status).toBe(200);
    expect(r.body.name).toBe('Winter Picks');
  });
});

describe('Collection Listings', () => {
  let collectionId;

  beforeAll(async () => {
    const r = await request(app).post('/api/collections').set('Authorization', `Bearer ${sellerToken}`).send({ name: 'Test Coll', description: 'D' });
    collectionId = r.body._id;
    testCollectionIds.push(collectionId);
  });

  test('COL.5 Add listing to collection', async () => {
    const r = await request(app).post(`/api/collections/${collectionId}/listings`).set('Authorization', `Bearer ${sellerToken}`).send({ listingId });
    expect(r.status).toBe(200);
  });

  test('COL.6 Collection shows added listing', async () => {
    const r = await request(app).get(`/api/collections/${collectionId}`);
    expect(r.body.listings?.length || r.body.items?.length || 0).toBeGreaterThanOrEqual(1);
  });

  test('COL.7 Remove listing from collection', async () => {
    const r = await request(app).delete(`/api/collections/${collectionId}/listings/${listingId}`).set('Authorization', `Bearer ${sellerToken}`);
    expect(r.status).toBe(200);
  });
});

describe('Collection Authorization & Visibility', () => {
  test('COL.8 Seller collections public', async () => {
    const r = await request(app).get(`/api/collections/seller/${sellerId}`);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBe(true);
  });

  test('COL.9 Non-owner cannot edit', async () => {
    const r = await request(app).post('/api/collections').set('Authorization', `Bearer ${buyerToken}`).send({ name: 'Hacked', description: 'Bad' });
    // Buyer can create their own collection
    expect(r.status).toBe(201);
    const colId = r.body._id;
    testCollectionIds.push(colId);

    // But buyer cannot edit seller's collection
    const r2 = await request(app).post(`/api/collections/${colId}/listings`).set('Authorization', `Bearer ${sellerToken}`).send({ listingId });
    expect(r2.status).toBe(403);
  });

  test('COL.10 Delete collection', async () => {
    const r = await request(app).post('/api/collections').set('Authorization', `Bearer ${sellerToken}`).send({ name: 'ToDelete', description: 'D' });
    const colId = r.body._id;
    const r2 = await request(app).delete(`/api/collections/${colId}`).set('Authorization', `Bearer ${sellerToken}`);
    expect(r2.status).toBe(200);
  });
});