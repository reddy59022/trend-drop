/**
 * Offer Counter-Offer Chain Tests (v14.0)
 * 
 * Tests the full counter-offer flow:
 * - Buyer makes offer
 * - Seller counters
 * - Buyer counters back
 * - Multiple rounds of counter-offers
 * - Seller accepts buyer's counter
 * - Buyer accepts seller's counter
 * - Offer-transaction linking
 */
const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../server');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Offer = require('../models/Offer');

let sellerToken, buyerToken, sellerId, buyerId, listingId;
const PASS = 'password123';

// Track all test-created IDs for targeted cleanup (only delete data created by THIS test run)
const testUserIds = [];
const testListingIds = [];
const mkEmail = p => `${p}_offerchain_${Date.now()}@test.com`;

async function createUser(name, email, overrides = {}) {
  const u = await User.create({
    name, email: email.toLowerCase(), password: PASS,
    emailVerified: true, authProvider: 'email',
    country: 'US', currency: 'USD',
    shippingAddress: { fullName: name, street1: '123 Main St', city: 'Austin', state: 'TX', postalCode: '78701', country: 'US' },
    balance: { available: 0, pending: 0, totalEarned: 0, totalPaidOut: 0, currency: 'USD' },
    stats: { totalSales: 0, totalPurchases: 0, strikes: 0 },
    ...overrides,
  });
  const jwt = require('jsonwebtoken');
  const token = jwt.sign({ id: u._id }, process.env.JWT_SECRET || 'fallback_secret_change_me', { expiresIn: '30d' });
  return { user: u, token };
}

beforeAll(async () => {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/trend-drop-test';
  if (mongoose.connection.readyState === 0) await mongoose.connect(uri);
  
  // Cleanup
  const re = /offerchain_|OfferChain/;
  await Promise.all([
    User.deleteMany({ email: re }),
    Listing.deleteMany({ title: re }),
    Offer.deleteMany({ $or: [{ listing: { $in: testListingIds } }, { buyer: { $in: testUserIds } }, { seller: { $in: testUserIds } }] }),
  ]);
  
  // Create users
  const { user: s, token: st } = await createUser('OfferChainSeller', mkEmail('seller'));
  sellerId = s._id;
  sellerToken = st;
  
  const { user: b, token: bt } = await createUser('OfferChainBuyer', mkEmail('buyer'));
  buyerId = b._id;
  buyerToken = bt;
  
  // Create listing
  const listing = await Listing.create({
    seller: sellerId,
    title: 'OfferChain Test Item',
    description: 'Test desc',
    price: 100,
    category: 'Men',
    condition: 'New with tags',
    available: true,
    sold: false,
    quantity: 5,
    shipsFrom: 'US',
    weight: 1,
  });
  listingId = listing._id;
});

afterAll(async () => {
  const re = /offerchain_|OfferChain/;
  await Promise.all([
    User.deleteMany({ email: re }),
    Listing.deleteMany({ title: re }),
    Offer.deleteMany({ $or: [{ listing: { $in: testListingIds } }, { buyer: { $in: testUserIds } }, { seller: { $in: testUserIds } }] }),
  ]);
  await mongoose.disconnect();
});

describe('Offer Counter-Offer Chain (v14.0)', () => {
  
  describe('Initial Offer Creation', () => {
    test('buyer can create an offer', async () => {
      const res = await request(app)
        .post('/api/offers')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({ listingId, amount: 70, message: 'Would you take $70?' });
      
      expect(res.status).toBe(201);
      expect(res.body.amount).toBe(70);
      expect(res.body.status).toBe('pending');
      
      // Verify in database
      const offer = await Offer.findById(res.body._id);
      expect(offer.counterHistory).toHaveLength(1);
      expect(offer.counterHistory[0].counteredBy).toBe('buyer');
      expect(offer.counterHistory[0].amount).toBe(70);
      expect(offer.lastCounterBy).toBe('buyer');
    });

    test('buyer cannot create duplicate active offer', async () => {
      const res = await request(app)
        .post('/api/offers')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({ listingId, amount: 75 });
      
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/already have an active offer/i);
    });
  });

  describe('Seller Counter-Offer', () => {
    let offerId;
    
    beforeAll(async () => {
      const offer = await Offer.findOne({ listing: listingId, buyer: buyerId, status: 'pending' });
      offerId = offer._id;
    });

    test('seller can counter buyer offer', async () => {
      const res = await request(app)
        .patch(`/api/offers/${offerId}/counter`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({ counterAmount: 85, message: 'How about $85?' });
      
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('countered');
      expect(res.body.counterAmount).toBe(85);
      
      // Verify in database
      const offer = await Offer.findById(offerId);
      expect(offer.counterHistory).toHaveLength(2);
      expect(offer.counterHistory[1].counteredBy).toBe('seller');
      expect(offer.counterHistory[1].amount).toBe(85);
      expect(offer.lastCounterBy).toBe('seller');
    });

    test('seller cannot counter again without buyer response', async () => {
      const res = await request(app)
        .patch(`/api/offers/${offerId}/counter`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({ counterAmount: 90 });
      
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/cannot counter in current state/i);
    });
  });

  describe('Buyer Counter Back', () => {
    let offerId;
    
    beforeAll(async () => {
      const offer = await Offer.findOne({ listing: listingId, buyer: buyerId, status: 'countered' });
      offerId = offer._id;
    });

    test('buyer can counter seller counter', async () => {
      const res = await request(app)
        .patch(`/api/offers/${offerId}/buyer-counter`)
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({ counterAmount: 80, message: 'I can do $80' });
      
      if (res.status !== 200) {
        console.log('Buyer counter error:', res.body);
      }
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('buyer_countered');
      expect(res.body.counterAmount).toBe(80);
      
      // Verify in database
      const offer = await Offer.findById(offerId);
      expect(offer.counterHistory).toHaveLength(3);
      expect(offer.counterHistory[2].counteredBy).toBe('buyer');
      expect(offer.counterHistory[2].amount).toBe(80);
      expect(offer.lastCounterBy).toBe('buyer');
    });
  });

  describe('Multiple Counter-Offer Rounds', () => {
    let offerId;
    
    beforeAll(async () => {
      // Create a fresh offer for this test
      const newListing = await Listing.create({
        seller: sellerId,
        title: 'OfferChain Multi Round',
        description: 'Test',
        price: 200,
        category: 'Men',
        condition: 'New with tags',
        available: true,
        sold: false,
        quantity: 1,
        shipsFrom: 'US',
        weight: 1,
      });
      
      const offerRes = await request(app)
        .post('/api/offers')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({ listingId: newListing._id, amount: 120 });
      offerId = offerRes.body._id;
    });

    test('full chain: buyer 120 -> seller 160 -> buyer 140 -> seller 150 -> buyer accepts', async () => {
      // Round 1: Seller counters at 160
      let res = await request(app)
        .patch(`/api/offers/${offerId}/counter`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({ counterAmount: 160 });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('countered');
      
      let offer = await Offer.findById(offerId);
      expect(offer.counterHistory).toHaveLength(2);
      
      // Round 2: Buyer counters at 140
      res = await request(app)
        .patch(`/api/offers/${offerId}/buyer-counter`)
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({ counterAmount: 140 });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('buyer_countered');
      
      offer = await Offer.findById(offerId);
      expect(offer.counterHistory).toHaveLength(3);
      
      // Round 3: Seller counters at 150
      res = await request(app)
        .patch(`/api/offers/${offerId}/counter`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({ counterAmount: 150 });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('countered');
      
      offer = await Offer.findById(offerId);
      expect(offer.counterHistory).toHaveLength(4);
      
      // Buyer accepts at 150
      res = await request(app)
        .patch(`/api/offers/${offerId}/accept-counter`)
        .set('Authorization', `Bearer ${buyerToken}`);
      expect(res.status).toBe(200);
      
      offer = await Offer.findById(offerId);
      expect(offer.status).toBe('accepted');
      expect(offer.acceptedPrice).toBe(150);
      expect(offer.acceptedAt).toBeDefined();
      expect(offer.acceptedBy).toBe('buyer');
      expect(res.body.finalPrice).toBe(150);
    });
  });

  describe('Seller Accepts Buyer Counter', () => {
    let offerId;
    
    beforeAll(async () => {
      // Create a fresh offer
      const newListing = await Listing.create({
        seller: sellerId,
        title: 'OfferChain Seller Accept',
        description: 'Test',
        price: 150,
        category: 'Men',
        condition: 'New with tags',
        available: true,
        sold: false,
        quantity: 1,
        shipsFrom: 'US',
        weight: 1,
      });
      
      const offerRes = await request(app)
        .post('/api/offers')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({ listingId: newListing._id, amount: 100 });
      offerId = offerRes.body._id;
      
      // Seller counters
      await request(app)
        .patch(`/api/offers/${offerId}/counter`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({ counterAmount: 130 });
      
      // Buyer counters back
      await request(app)
        .patch(`/api/offers/${offerId}/buyer-counter`)
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({ counterAmount: 115 });
    });

    test('seller can accept buyer counter', async () => {
      const res = await request(app)
        .patch(`/api/offers/${offerId}/seller-accept-buyer-counter`)
        .set('Authorization', `Bearer ${sellerToken}`);
      
      expect(res.status).toBe(200);
      expect(res.body.offer.status).toBe('accepted');
      expect(res.body.offer.acceptedPrice).toBe(115);
      expect(res.body.offer.acceptedAt).toBeDefined();
      expect(res.body.offer.acceptedBy).toBe('seller');
      expect(res.body.finalPrice).toBe(115);
    });
  });

  describe('Seller Accepts Original Offer', () => {
    let offerId;
    
    beforeAll(async () => {
      const newListing = await Listing.create({
        seller: sellerId,
        title: 'OfferChain Direct Accept',
        description: 'Test',
        price: 100,
        category: 'Men',
        condition: 'New with tags',
        available: true,
        sold: false,
        quantity: 1,
        shipsFrom: 'US',
        weight: 1,
      });
      
      const offerRes = await request(app)
        .post('/api/offers')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({ listingId: newListing._id, amount: 80 });
      offerId = offerRes.body._id;
    });

    test('seller can accept original offer without countering', async () => {
      const res = await request(app)
        .patch(`/api/offers/${offerId}/seller-accept`)
        .set('Authorization', `Bearer ${sellerToken}`);
      
      expect(res.status).toBe(200);
      expect(res.body.offer.status).toBe('accepted');
      expect(res.body.offer.acceptedPrice).toBe(80);
      expect(res.body.offer.acceptedAt).toBeDefined();
      expect(res.body.offer.acceptedBy).toBe('seller');
      expect(res.body.finalPrice).toBe(80);
    });
  });

  describe('Offer Decline', () => {
    test('seller can decline pending offer', async () => {
      const newListing = await Listing.create({
        seller: sellerId,
        title: 'OfferChain Decline',
        description: 'Test',
        price: 100,
        category: 'Men',
        condition: 'New with tags',
        available: true,
        sold: false,
        quantity: 1,
        shipsFrom: 'US',
        weight: 1,
      });
      
      const offerRes = await request(app)
        .post('/api/offers')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({ listingId: newListing._id, amount: 50 });
      
      const res = await request(app)
        .patch(`/api/offers/${offerRes.body._id}/decline`)
        .set('Authorization', `Bearer ${sellerToken}`);
      
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('declined');
    });

    test('seller can decline buyer counter', async () => {
      const newListing = await Listing.create({
        seller: sellerId,
        title: 'OfferChain Decline Counter',
        description: 'Test',
        price: 100,
        category: 'Men',
        condition: 'New with tags',
        available: true,
        sold: false,
        quantity: 1,
        shipsFrom: 'US',
        weight: 1,
      });
      
      // Create offer, seller counters, buyer counters back
      const offerRes = await request(app)
        .post('/api/offers')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({ listingId: newListing._id, amount: 60 });
      
      await request(app)
        .patch(`/api/offers/${offerRes.body._id}/counter`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({ counterAmount: 80 });
      
      await request(app)
        .patch(`/api/offers/${offerRes.body._id}/buyer-counter`)
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({ counterAmount: 70 });
      
      // Seller declines buyer's counter
      const res = await request(app)
        .patch(`/api/offers/${offerRes.body._id}/decline`)
        .set('Authorization', `Bearer ${sellerToken}`);
      
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('declined');
    });
  });

  describe('Offer Completion', () => {
    test('accepted offer can be marked as completed', async () => {
      const newListing = await Listing.create({
        seller: sellerId,
        title: 'OfferChain Complete',
        description: 'Test',
        price: 100,
        category: 'Men',
        condition: 'New with tags',
        available: true,
        sold: false,
        quantity: 1,
        shipsFrom: 'US',
        weight: 1,
      });
      
      const offerRes = await request(app)
        .post('/api/offers')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({ listingId: newListing._id, amount: 80 });
      
      // Seller accepts
      await request(app)
        .patch(`/api/offers/${offerRes.body._id}/seller-accept`)
        .set('Authorization', `Bearer ${sellerToken}`);
      
      const fakeTxnId = new mongoose.Types.ObjectId();
      
      const res = await request(app)
        .patch(`/api/offers/${offerRes.body._id}/complete`)
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({ transactionId: fakeTxnId });
      
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('completed');
      expect(res.body.transaction).toBe(fakeTxnId.toString());
    });
  });

  describe('Authorization Checks', () => {
    test('buyer cannot accept their own counter', async () => {
      const newListing = await Listing.create({
        seller: sellerId,
        title: 'OfferChain Auth Test',
        description: 'Test',
        price: 100,
        category: 'Men',
        condition: 'New with tags',
        available: true,
        sold: false,
        quantity: 1,
        shipsFrom: 'US',
        weight: 1,
      });
      
      const offerRes = await request(app)
        .post('/api/offers')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({ listingId: newListing._id, amount: 70 });
      
      // Seller counters
      await request(app)
        .patch(`/api/offers/${offerRes.body._id}/counter`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({ counterAmount: 85 });
      
      // Buyer counters back
      await request(app)
        .patch(`/api/offers/${offerRes.body._id}/buyer-counter`)
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({ counterAmount: 80 });
      
      // Buyer tries to accept their own counter (should fail)
      const res = await request(app)
        .patch(`/api/offers/${offerRes.body._id}/accept-counter`)
        .set('Authorization', `Bearer ${buyerToken}`);
      
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/seller has not made a counter/i);
    });

    test('seller cannot counter from countered state', async () => {
      const newListing = await Listing.create({
        seller: sellerId,
        title: 'OfferChain Auth Test 2',
        description: 'Test',
        price: 100,
        category: 'Men',
        condition: 'New with tags',
        available: true,
        sold: false,
        quantity: 1,
        shipsFrom: 'US',
        weight: 1,
      });
      
      const offerRes = await request(app)
        .post('/api/offers')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({ listingId: newListing._id, amount: 70 });
      
      // Seller counters
      await request(app)
        .patch(`/api/offers/${offerRes.body._id}/counter`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({ counterAmount: 85 });
      
      // Seller tries to counter again (should fail - waiting for buyer)
      const res = await request(app)
        .patch(`/api/offers/${offerRes.body._id}/counter`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({ counterAmount: 90 });
      
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/cannot counter in current state/i);
    });
  });
});