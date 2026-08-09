/**
 * Comprehensive integration tests for the offer negotiation flow.
 * Tests the state machine, multi-round negotiation, currency handling,
 * price consistency, and revenue protection.
 * 
 * State machine:
 *   pending → countered → buyer_countered → countered → ... → accepted
 *   pending → accepted (seller accepts original offer)
 *   pending → declined
 *   countered → accepted (buyer accepts seller's counter)
 *   buyer_countered → accepted (seller accepts buyer's counter)
 *   buyer_countered → declined
 */

const request = require('supertest');
const app = require('../server');
const mongoose = require('mongoose');
const Offer = require('../models/Offer');
const Listing = require('../models/Listing');
const User = require('../models/User');
const Transaction = require('../models/Transaction');

// Helper to create JWT token
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';
const generateToken = (userId) => jwt.sign({ id: userId }, JWT_SECRET, { expiresIn: '30d' });

let seller, buyer, sellerToken, buyerToken, listing;

// Track all test-created IDs for targeted cleanup (only delete data created by THIS test run)
const testUserIds = [];
const testListingIds = [];

beforeAll(async () => {
  const testMongoUri = process.env.MONGODB_URI || "mongodb://localhost:27017/trend-drop-test";
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(testMongoUri, { useNewUrlParser: true, useUnifiedTopology: true });
  }
  
  // Create users with passwords >= 6 chars
  seller = await User.create({
    name: 'TestSeller',
    email: 'seller_offers_test@example.com',
    password: 'password123',
    emailVerified: true,
    country: 'US',
    currency: 'USD',
  });
  testUserIds.push(seller._id);
  buyer = await User.create({
    name: 'TestBuyer',
    email: 'buyer_offers_test@example.com',
    password: 'password123',
    emailVerified: true,
    country: 'US',
    currency: 'USD',
  });
  testUserIds.push(buyer._id);
  
  sellerToken = generateToken(seller._id);
  buyerToken = generateToken(buyer._id);
  
  listing = await Listing.create({
    seller: seller._id,
    title: 'Test Item for Offers',
    description: 'Test description for offer flow testing',
    category: 'Electronics',
    condition: 'New with tags',
    price: 100,
    currency: 'USD',
    available: true,
    quantity: 5,
    shipsFrom: 'US',
    weight: 1,
  });
  testListingIds.push(listing._id);
});

afterAll(async () => {
  // Targeted cleanup: only delete data created by THIS test run
  await Offer.deleteMany({ $or: [{ listing: { $in: testListingIds } }, { buyer: { $in: testUserIds } }, { seller: { $in: testUserIds } }] });
  await Listing.deleteMany({ _id: { $in: testListingIds } });
  await User.deleteMany({ _id: { $in: testUserIds } });
  await Transaction.deleteMany({ $or: [{ listing: { $in: testListingIds } }, { buyer: { $in: testUserIds } }, { seller: { $in: testUserIds } }] });
  // Do NOT disconnect — jest.setup.js afterAll cleans DB between files
});

describe('Offer State Machine Validation', () => {
  let offerId;

  test('SM.1 Buyer creates an offer (pending)', async () => {
    const res = await request(app)
      .post('/api/offers')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ listingId: listing._id, amount: 80 });
    expect(res.status).toBe(201);
    expect(res.body.amount).toBe(80);
    expect(res.body.status).toBe('pending');
    expect(res.body.currency).toBe('USD');
    offerId = res.body._id;
  });

  test('SM.2 Seller counters (pending → countered)', async () => {
    const res = await request(app)
      .patch(`/api/offers/${offerId}/counter`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ counterAmount: 90 });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('countered');
    expect(res.body.counterAmount).toBe(90);
  });

  test('SM.3 Seller cannot counter again (countered state is not counterable)', async () => {
    const res = await request(app)
      .patch(`/api/offers/${offerId}/counter`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ counterAmount: 95 });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('Cannot counter');
  });

  test('SM.4 Buyer counters (countered → buyer_countered) — must be between 80 and 90', async () => {
    const res = await request(app)
      .patch(`/api/offers/${offerId}/buyer-counter`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ counterAmount: 85 }); // must be > 80 (original) and < 90 (seller counter)
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('buyer_countered');
    expect(res.body.counterAmount).toBe(85);
  });

  test('SM.5 Buyer cannot counter again (buyer_countered state invalid for buyer-counter)', async () => {
    const res = await request(app)
      .patch(`/api/offers/${offerId}/buyer-counter`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ counterAmount: 87 });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('You can only counter when the seller has countered');
  });

  test('SM.6 Seller counters again (buyer_countered → countered) — multi-round works', async () => {
    const res = await request(app)
      .patch(`/api/offers/${offerId}/counter`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ counterAmount: 88 }); // must be > 85 (buyer counter)
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('countered');
    expect(res.body.counterAmount).toBe(88);
  });

  test('SM.7 Buyer accepts counter (countered → accepted)', async () => {
    const res = await request(app)
      .patch(`/api/offers/${offerId}/accept-counter`)
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.offer.status).toBe('accepted');
    expect(res.body.finalPrice).toBe(88);
  });

  test('SM.8 Cannot accept counter on accepted offer', async () => {
    const res = await request(app)
      .patch(`/api/offers/${offerId}/accept-counter`)
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(res.status).toBe(400);
  });
});

describe('Full Negotiation → Transaction Flow', () => {
  let offerId;

  test('NT.1 Buyer creates offer, multi-round, seller accepts buyer counter', async () => {
    // Buyer creates offer
    const createRes = await request(app)
      .post('/api/offers')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ listingId: listing._id, amount: 70 });
    expect(createRes.status).toBe(201);
    offerId = createRes.body._id;

    // Seller counters at 85
    await request(app)
      .patch(`/api/offers/${offerId}/counter`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ counterAmount: 85 });

    // Buyer counters at 80 (must be > 70 and < 85)
    await request(app)
      .patch(`/api/offers/${offerId}/buyer-counter`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ counterAmount: 80 });

    // Seller accepts buyer's counter
    const acceptRes = await request(app)
      .patch(`/api/offers/${offerId}/seller-accept-buyer-counter`)
      .set('Authorization', `Bearer ${sellerToken}`);
    expect(acceptRes.status).toBe(200);
    expect(acceptRes.body.offer.status).toBe('accepted');
    expect(acceptRes.body.finalPrice).toBe(80);
  });

  test('NT.2 Buyer creates transaction from accepted offer at negotiated price', async () => {
    // Find the LATEST accepted offer for this buyer/listing (use the offerId from NT.1)
    const offer = await Offer.findById(offerId);
    expect(offer).toBeDefined();
    expect(offer.status).toBe('accepted');
    expect(offer.acceptedPrice).toBe(80);

    // Create transaction via offer endpoint
    const txnRes = await request(app)
      .post(`/api/transactions/offer/${offer._id}`)
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(txnRes.status).toBe(201);
    expect(txnRes.body.transaction).toBeDefined();
    expect(txnRes.body.transaction.itemPrice).toBe(80);
    expect(txnRes.body.transaction.paymentBreakdown.subtotal).toBe(80);
    
    // Verify offer is now completed
    const updatedOffer = await Offer.findById(offer._id);
    expect(updatedOffer.status).toBe('completed');
  });
});

describe('Single Acceptance Paths', () => {
  test('AP.1 Seller accepts original pending offer (pending → accepted)', async () => {
    const createRes = await request(app)
      .post('/api/offers')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ listingId: listing._id, amount: 75 });
    expect(createRes.status).toBe(201);
    const oId = createRes.body._id;

    const res = await request(app)
      .patch(`/api/offers/${oId}/seller-accept`)
      .set('Authorization', `Bearer ${sellerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.offer.status).toBe('accepted');
    expect(res.body.finalPrice).toBe(75);
  });

  test('AP.2 Buyer accepts seller counter (countered → accepted)', async () => {
    const createRes = await request(app)
      .post('/api/offers')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ listingId: listing._id, amount: 70 });
    expect(createRes.status).toBe(201);
    const oId = createRes.body._id;

    // Seller counters
    await request(app)
      .patch(`/api/offers/${oId}/counter`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ counterAmount: 90 });

    // Buyer accepts
    const acceptRes = await request(app)
      .patch(`/api/offers/${oId}/accept-counter`)
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(acceptRes.status).toBe(200);
    expect(acceptRes.body.offer.status).toBe('accepted');
    expect(acceptRes.body.finalPrice).toBe(90);
  });

  test('AP.3 Seller declines pending offer', async () => {
    const createRes = await request(app)
      .post('/api/offers')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ listingId: listing._id, amount: 60 });
    expect(createRes.status).toBe(201);
    const oId = createRes.body._id;

    const res = await request(app)
      .patch(`/api/offers/${oId}/decline`)
      .set('Authorization', `Bearer ${sellerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('declined');
  });

  test('AP.4 Seller declines buyer counter (buyer_countered → declined)', async () => {
    const createRes = await request(app)
      .post('/api/offers')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ listingId: listing._id, amount: 65 });
    expect(createRes.status).toBe(201);
    const oId = createRes.body._id;

    // Seller counters at 80
    const counterRes = await request(app)
      .patch(`/api/offers/${oId}/counter`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ counterAmount: 80 });
    expect(counterRes.status).toBe(200);

    // Buyer counters at 75 (must be > 65 and < 80)
    const buyerCounterRes = await request(app)
      .patch(`/api/offers/${oId}/buyer-counter`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ counterAmount: 75 });
    expect(buyerCounterRes.status).toBe(200);

    // Seller declines (valid from buyer_countered)
    const res = await request(app)
      .patch(`/api/offers/${oId}/decline`)
      .set('Authorization', `Bearer ${sellerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('declined');
  });
});

describe('Invalid State Transitions', () => {
  beforeEach(async () => {
    // Clean up any existing offers for this buyer before each test
    await Offer.deleteMany({ buyer: buyer._id });
    await Transaction.deleteMany({ buyer: buyer._id });
  });

  test('IT.1 Cannot accept a declined offer', async () => {
    const createRes = await request(app)
      .post('/api/offers')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ listingId: listing._id, amount: 50 });
    expect(createRes.status).toBe(201);
    const oId = createRes.body._id;

    // Decline
    await request(app)
      .patch(`/api/offers/${oId}/decline`)
      .set('Authorization', `Bearer ${sellerToken}`);

    // Try to accept
    const res = await request(app)
      .patch(`/api/offers/${oId}/seller-accept`)
      .set('Authorization', `Bearer ${sellerToken}`);
    expect(res.status).toBe(400);
  });

  test('IT.2 Cannot counter from accepted state', async () => {
    const createRes = await request(app)
      .post('/api/offers')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ listingId: listing._id, amount: 55 });
    expect(createRes.status).toBe(201);
    const oId = createRes.body._id;

    // Seller accepts
    await request(app)
      .patch(`/api/offers/${oId}/seller-accept`)
      .set('Authorization', `Bearer ${sellerToken}`);

    // Try to counter
    const res = await request(app)
      .patch(`/api/offers/${oId}/counter`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ counterAmount: 60 });
    expect(res.status).toBe(400);
  });

  test('IT.3 Cannot accept-counter from pending state (only countered)', async () => {
    const createRes = await request(app)
      .post('/api/offers')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ listingId: listing._id, amount: 45 });
    expect(createRes.status).toBe(201);
    const oId = createRes.body._id;

    const res = await request(app)
      .patch(`/api/offers/${oId}/accept-counter`)
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(res.status).toBe(400);
  });

  test('IT.4 Seller cannot accept from buyer_countered with wrong endpoint', async () => {
    const createRes = await request(app)
      .post('/api/offers')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ listingId: listing._id, amount: 40 });
    expect(createRes.status).toBe(201);
    const oId = createRes.body._id;

    // Seller counters at 60
    await request(app)
      .patch(`/api/offers/${oId}/counter`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ counterAmount: 60 });

    // Buyer counters at 50 (must be > 40 and < 60)
    await request(app)
      .patch(`/api/offers/${oId}/buyer-counter`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ counterAmount: 50 });

    // Seller tries to use seller-accept (wrong - only for pending)
    const res = await request(app)
      .patch(`/api/offers/${oId}/seller-accept`)
      .set('Authorization', `Bearer ${sellerToken}`);
    expect(res.status).toBe(400);

    // Seller must use seller-accept-buyer-counter instead
    const res2 = await request(app)
      .patch(`/api/offers/${oId}/seller-accept-buyer-counter`)
      .set('Authorization', `Bearer ${sellerToken}`);
    expect(res2.status).toBe(200);
  });
});

describe('Authorization & Edge Cases', () => {
  beforeEach(async () => {
    // Clean up any existing offers for this buyer before each test
    await Offer.deleteMany({ buyer: buyer._id });
    await Transaction.deleteMany({ buyer: buyer._id });
  });

  test('AU.1 Buyer cannot accept their own offer (only seller can accept pending)', async () => {
    const createRes = await request(app)
      .post('/api/offers')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ listingId: listing._id, amount: 30 });
    expect(createRes.status).toBe(201);
    const oId = createRes.body._id;

    const res = await request(app)
      .patch(`/api/offers/${oId}/seller-accept`)
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(res.status).toBe(403);
  });

  test('AU.2 Seller cannot counter as buyer', async () => {
    const createRes = await request(app)
      .post('/api/offers')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ listingId: listing._id, amount: 35 });
    expect(createRes.status).toBe(201);
    const oId = createRes.body._id;

    const res = await request(app)
      .patch(`/api/offers/${oId}/buyer-counter`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ counterAmount: 50 });
    expect(res.status).toBe(403);
  });

  test('AU.3 Cannot offer on own listing', async () => {
    const res = await request(app)
      .post('/api/offers')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ listingId: listing._id, amount: 50 });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('Cannot offer on your own listing');
  });

  test('AU.4 Counter must be higher than previous', async () => {
    const createRes = await request(app)
      .post('/api/offers')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ listingId: listing._id, amount: 80 });
    expect(createRes.status).toBe(201);
    const oId = createRes.body._id;

    // Counter must be higher than 80
    const res = await request(app)
      .patch(`/api/offers/${oId}/counter`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ counterAmount: 75 });
    expect(res.status).toBe(400);
  });

  test('AU.5 Invalid counter amount rejected', async () => {
    const createRes = await request(app)
      .post('/api/offers')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ listingId: listing._id, amount: 80 });
    expect(createRes.status).toBe(201);
    const oId = createRes.body._id;

    const res = await request(app)
      .patch(`/api/offers/${oId}/counter`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ counterAmount: 0 });
    expect(res.status).toBe(400);
  });
});

describe('Currency Validation', () => {
  let jpyListing;

  beforeEach(async () => {
    // Clean up any existing offers for this buyer before each test
    await Offer.deleteMany({ buyer: buyer._id });
    await Transaction.deleteMany({ buyer: buyer._id });
  });

  beforeAll(async () => {
    jpyListing = await Listing.create({
      seller: seller._id,
      title: 'JPY Test Item',
      description: 'Test in JPY',
      category: 'Electronics', // must use valid category
      condition: 'New with tags',
      price: 10000,
      currency: 'JPY',
      available: true,
      quantity: 3,
      shipsFrom: 'JP',
      weight: 0.5,
    });
    testListingIds.push(jpyListing._id);
  });

  test('CV.1 Offer in matching currency succeeds', async () => {
    const res = await request(app)
      .post('/api/offers')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ listingId: jpyListing._id, amount: 8000, currency: 'JPY' });
    expect(res.status).toBe(201);
    expect(res.body.currency).toBe('JPY');
  });

  test('CV.2 Offer with wrong currency rejected', async () => {
    const res = await request(app)
      .post('/api/offers')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ listingId: jpyListing._id, amount: 8000, currency: 'USD' });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('Currency mismatch');
  });

  test('CV.3 Offer without currency defaults to listing currency', async () => {
    const res = await request(app)
      .post('/api/offers')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ listingId: jpyListing._id, amount: 9000 });
    expect(res.status).toBe(201);
    expect(res.body.currency).toBe('JPY');
  });
});

describe('Revenue Protection via Offers', () => {
  beforeEach(async () => {
    // Clean up any existing offers for this buyer before each test
    await Offer.deleteMany({ buyer: buyer._id });
    await Transaction.deleteMany({ buyer: buyer._id });
  });

  test('RP.1 Transaction via offer uses negotiated price in payment breakdown', async () => {
    const createRes = await request(app)
      .post('/api/offers')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ listingId: listing._id, amount: 85 });
    expect(createRes.status).toBe(201);
    const oId = createRes.body._id;

    // Seller counters at 92 (must be > 85 and < 100)
    await request(app)
      .patch(`/api/offers/${oId}/counter`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ counterAmount: 92 });

    // Buyer accepts
    await request(app)
      .patch(`/api/offers/${oId}/accept-counter`)
      .set('Authorization', `Bearer ${buyerToken}`);

    // Create transaction via the offer
    const txnRes = await request(app)
      .post(`/api/transactions/offer/${oId}`)
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(txnRes.status).toBe(201);
    const txn = txnRes.body.transaction;

    // The transaction must use the negotiated price (92), NOT the listing price (100)
    expect(txn.itemPrice).toBe(92);
    expect(txn.paymentBreakdown.subtotal).toBe(92);
    
    // Platform fee should be 8% of 92 = 7.36
    expect(txn.paymentBreakdown.platformFee).toBe(7.36);
    
    // Seller earnings = 92 - 7.36 = 84.64
    expect(txn.paymentBreakdown.sellerEarnings).toBe(84.64);

    // Total paid includes protection fee and shipping
    expect(txn.paymentBreakdown.totalPaid).toBeGreaterThan(txn.itemPrice);
  });
});