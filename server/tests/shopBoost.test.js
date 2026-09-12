/**
 * Boost Whole Shop (Feature 3).
 *
 * When a seller enables the Shop Boost toggle, ALL of their active listings
 * are treated as BASIC (standard) boosted with the HIGHEST priority so they
 * surface first in feeds/search — and every sale of a shop-boosted item
 * accrues the standard 10% boost fee to the platform.
 */
const mongoose = require('mongoose');
const request = require('supertest');
const app = require('../server');
const User = require('../models/User');
const Listing = require('../models/Listing');
const ShopBoost = require('../models/ShopBoost');
const Transaction = require('../models/Transaction');
const Payout = require('../models/Payout');
const jwt = require('jsonwebtoken');

const { SHOP_BOOST_PRIORITY_SCORE } = require('../services/shopBoostService');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';
const mkEmail = (p) => `${p}_shop_${Date.now()}@test.com`;

const testUserIds = [];
const testListingIds = [];

async function makeUser(name, email) {
  const u = await User.create({
    name, email: email.toLowerCase(), password: 'password123', emailVerified: true,
    authProvider: 'email', country: 'US', currency: 'USD',
    shippingAddress: { fullName: name, street1: '1 St', city: 'C', state: 'CA', postalCode: '90210', country: 'US' },
  });
  testUserIds.push(u._id);
  const token = jwt.sign({ id: u._id }, JWT_SECRET, { expiresIn: '30d' });
  return { user: u, token };
}

async function makeListing(seller, title, price = 50) {
  const l = await Listing.create({
    seller: seller._id, title, description: 'd', price, category: 'Men',
    condition: 'Good', currency: 'USD', available: true, sold: false,
    quantity: 5, shipsFrom: 'US', weight: 0.5,
  });
  testListingIds.push(l._id);
  return l;
}

function mockPi(status = 'succeeded') {
  const id = `pi_sb_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  if (!global.__mockPaymentIntents) global.__mockPaymentIntents = {};
  global.__mockPaymentIntents[id] = { id, status };
  return id;
}

let seller, sellerToken, buyer, buyerToken;
let plainSeller, plainSellerToken, outsider, outsiderToken;

beforeAll(async () => {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/trenddrop_test');
  }
  const s = await makeUser('ShopSeller', mkEmail('seller'));
  seller = s.user; sellerToken = s.token;
  const b = await makeUser('ShopBuyer', mkEmail('buyer'));
  buyer = b.user; buyerToken = b.token;
  const ps = await makeUser('PlainSeller', mkEmail('plain'));
  plainSeller = ps.user; plainSellerToken = ps.token;
  const o = await makeUser('Outsider', mkEmail('outsider'));
  outsider = o.user; outsiderToken = o.token;
});

afterAll(async () => {
  await ShopBoost.deleteMany({ seller: { $in: testUserIds } });
  await Transaction.deleteMany({ $or: [{ listing: { $in: testListingIds } }, { seller: { $in: testUserIds } }, { buyer: { $in: testUserIds } }] });
  await Payout.deleteMany({ seller: { $in: testUserIds } });
  await Listing.deleteMany({ _id: { $in: testListingIds } });
  await User.deleteMany({ _id: { $in: testUserIds } });
});

describe('Feature 3 — Boost whole shop', () => {
  let seededListingIds = [];

  beforeAll(async () => {
    seededListingIds.push((await makeListing(seller, 'Shop A', 100))._id);
    seededListingIds.push((await makeListing(seller, 'Shop B', 80))._id);
    seededListingIds.push((await makeListing(plainSeller, 'Plain C', 60))._id);
  });

  test('SB.1 POST /api/shop-boost requires authentication (401)', async () => {
    const res = await request(app).post('/api/shop-boost');
    expect(res.status).toBe(401);
  });

  test('SB.2 POST /api/shop-boost activates the shop at standard tier', async () => {
    const res = await request(app)
      .post('/api/shop-boost')
      .set('Authorization', `Bearer ${sellerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.shopBoost.active).toBe(true);
    expect(res.body.shopBoost.tier).toBe('standard');
    expect(res.body.shopBoost.feePercent).toBe(10);
    expect(new Date(res.body.shopBoost.endDate).getTime()).toBeGreaterThan(Date.now());
  });

  test('SB.3 Activating shop boost marks ALL of the seller\'s listings boosted (standard, max priority)', async () => {
    const listings = await Listing.find({ seller: seller._id, _id: { $in: seededListingIds } });
    expect(listings).toHaveLength(2);
    for (const l of listings) {
      expect(l.boost.active).toBe(true);
      expect(l.boost.tier).toBe('standard');
      expect(l.boost.priorityScore).toBe(SHOP_BOOST_PRIORITY_SCORE);
      expect(l.boost.source).toBe('shop');
    }
  });

  test('SB.4 New listing created while shop boost is active is auto-boosted (no boost fields sent)', async () => {
    const res = await request(app)
      .post('/api/listings')
      .set('Authorization', `Bearer ${sellerToken}`)
      .field('title', 'Auto Boosted New Item')
      .field('description', 'created while shop boost active')
      .field('price', '70')
      .field('category', 'Home')
      .field('condition', 'New with tags')
      .field('shipsFrom', 'US');

    expect(res.status).toBe(201);
    const l = res.body.listing;
    expect(l.boost.active).toBe(true);
    expect(l.boost.tier).toBe('standard');
    expect(l.boost.priorityScore).toBe(SHOP_BOOST_PRIORITY_SCORE);
  });

  test('SB.5 Feed GET /api/listings default sort surfaces shop-boosted listings first with boosted:true', async () => {
    const res = await request(app)
      .get('/api/listings?sort=newest&limit=20')
      .set('X-Country-Code', 'US');
    expect(res.status).toBe(200);
    const listings = res.body.listings;
    expect(listings.length).toBeGreaterThan(0);
    const shopIdx = listings.findIndex((l) => l.title === 'Shop A' || l.title === 'Shop B' || l.title === 'Auto Boosted New Item');
    const plainIdx = listings.findIndex((l) => l.title === 'Plain C');
    expect(shopIdx).not.toBe(-1);
    // Shop-boosted listing must out-rank a non-boosted listing
    if (plainIdx !== -1) {
      expect(shopIdx).toBeLessThan(plainIdx);
    }
    // Every shop-boosted doc carries boosted:true
    const boostedDoc = listings.find((l) => l.title === 'Shop A');
    if (boostedDoc) {
      expect(boostedDoc.boosted).toBe(true);
    }
  });

  test('SB.6 Individual premium boost on top of shop boost keeps max priority (source=both)', async () => {
    const premiumListingId = seededListingIds[0]; // Shop A
    const res = await request(app)
      .post(`/api/listings/${premiumListingId}/boost`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ tier: 'premium', durationDays: 14 });
    expect(res.status).toBe(200);

    const l = await Listing.findById(premiumListingId);
    expect(l.boost.active).toBe(true);
    expect(l.boost.tier).toBe('premium');
    expect(l.boost.source).toBe('both');
    expect(l.boost.priorityScore).toBe(SHOP_BOOST_PRIORITY_SCORE);
  });

  test('SB.7 PATCH /api/shop-boost/deactivate reverts shop-only listings; preserves individual boosts', async () => {
    const res = await request(app)
      .patch('/api/shop-boost/deactivate')
      .set('Authorization', `Bearer ${sellerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.shopBoost.active).toBe(false);

    const shopOnly = await Listing.findById(seededListingIds[1]); // Shop B
    expect(shopOnly.boost.active).toBe(false);
    expect(shopOnly.boost.source).toBe('');

    const bothListing = await Listing.findById(seededListingIds[0]); // Shop A + premium
    expect(bothListing.boost.active).toBe(true);
    expect(bothListing.boost.tier).toBe('premium');
    expect(bothListing.boost.source).toBe('listing');
  });

  test('SB.8 Deactivating is self-scoped - another user cannot disable a seller shop boost', async () => {
    // Re-activate the seller's shop boost (was deactivated in SB.7).
    await request(app).post('/api/shop-boost').set('Authorization', `Bearer ${sellerToken}`);

    // Outsider tries to deactivate — only acts on their own (inactive) record.
    const res = await request(app)
      .patch('/api/shop-boost/deactivate')
      .set('Authorization', `Bearer ${outsiderToken}`);
    expect(res.status).toBe(200);
    expect(res.body.shopBoost.active).toBe(false);

    // The seller's shop boost is untouched.
    const pub = await request(app).get(`/api/shop-boost/status/${seller._id}`);
    expect(pub.status).toBe(200);
    expect(pub.body.active).toBe(true);
  });

  test('SB.9 GET /api/shop-boost reflects current status; public status endpoint works', async () => {
    const mine = await request(app).get('/api/shop-boost').set('Authorization', `Bearer ${plainSellerToken}`);
    expect(mine.status).toBe(200);
    expect(mine.body.shopBoost.active).toBe(false);

    const pub = await request(app).get(`/api/shop-boost/status/${seller._id}`);
    expect(pub.status).toBe(200);
    // Seller's boost was re-activated in SB.8 and is still live.
    expect(pub.body.active).toBe(true);
  });

  test('SB.10 Sale of a shop-boosted item accrues the 10% boost fee (platform revenue)', async () => {
    // Re-activate, then buy the auto-boosted listing at 70 → fee 7.00
    await request(app).post('/api/shop-boost').set('Authorization', `Bearer ${sellerToken}`);
    const listing = await Listing.findOne({ title: 'Auto Boosted New Item' });
    expect(listing.boost.active).toBe(true);

    const before = (await Listing.findById(listing._id)).boost.feeLedger.owed;
    const pi = mockPi();
    const res = await request(app)
      .post('/api/payments/confirm-batch')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({
        paymentIntentId: pi,
        items: [{ listingId: listing._id, quantity: 1 }],
        shippingAddress: { fullName: 'Buyer', street1: '1 St', city: 'NY', country: 'US', postalCode: '10001' },
      });
    expect(res.status).toBe(201);

    const after = (await Listing.findById(listing._id)).boost.feeLedger.owed;
    expect(Math.round((after - before) * 100) / 100).toBe(7); // 10% of 70
  });
});
