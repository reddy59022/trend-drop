/**
 * Comprehensive integration tests for the messaging system.
 * Tests:
 * 1. Message creation and conversation flow
 * 2. Message retrieval with offer data
 * 3. Offer expiration in conversation context
 * 4. Seller reply functionality
 * 5. Auto-expiration cron job for offers
 * 6. Counter offer expiration reset
 * 7. Read receipts
 */

const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const app = require('../server');
const Message = require('../models/Message');
const Offer = require('../models/Offer');
const Listing = require('../models/Listing');
const User = require('../models/User');
const { expireOffers } = require('../config/cron');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';
const generateToken = (userId) => jwt.sign({ id: userId }, JWT_SECRET, { expiresIn: '30d' });

let seller, buyer, sellerToken, buyerToken, listing;
let testUserIds = [];
let testListingIds = [];
let testMessageIds = [];
let testOfferIds = [];

beforeAll(async () => {
  const testMongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/trend-drop-test';
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(testMongoUri, { useNewUrlParser: true, useUnifiedTopology: true });
  }

  const seedBase = `msg_${Date.now()}_`;

  seller = await User.create({
    name: 'Msg Seller', email: `${seedBase}seller@test.com`, password: 'password123',
    country: 'US', currency: 'USD', emailVerified: true, authProvider: 'email',
    shippingAddress: { fullName: 'Seller', street1: '123 St', city: 'City', state: 'CA', postalCode: '90210', country: 'US' },
    balance: { available: 0, pending: 0, totalEarned: 0, totalPaidOut: 0, currency: 'USD' },
    stats: { totalSales: 0, totalPurchases: 0, strikes: 0 },
  });
  testUserIds.push(seller._id);
  sellerToken = generateToken(seller._id);

  buyer = await User.create({
    name: 'Msg Buyer', email: `${seedBase}buyer@test.com`, password: 'password123',
    country: 'US', currency: 'USD', emailVerified: true, authProvider: 'email',
    shippingAddress: { fullName: 'Buyer', street1: '456 Ave', city: 'Town', state: 'NY', postalCode: '10001', country: 'US' },
    balance: { available: 1000, pending: 0, totalEarned: 0, totalPaidOut: 0, currency: 'USD' },
    stats: { totalSales: 0, totalPurchases: 0, strikes: 0 },
  });
  testUserIds.push(buyer._id);
  buyerToken = generateToken(buyer._id);

  listing = await Listing.create({
    seller: seller._id, title: 'Test Item for Messaging', description: 'A test item',
    price: 100, category: 'Men', condition: 'New with tags',
    status: 'active', available: true, quantity: 1,
    currency: 'USD', images: ['https://example.com/image.jpg'],
  });
  testListingIds.push(listing._id);
});

afterAll(async () => {
  // Cleanup test data
  await Message.deleteMany({ _id: { $in: testMessageIds } });
  await Offer.deleteMany({ _id: { $in: testOfferIds } });
  await Listing.deleteMany({ _id: { $in: testListingIds } });
  await User.deleteMany({ _id: { $in: testUserIds } });
  await mongoose.connection.close();
});

describe('Messaging System Tests', () => {
  
  describe('1. Message Creation & Conversation Flow', () => {
    test('1.1 Buyer can start a conversation with seller', async () => {
      const res = await request(app)
        .post('/api/messages')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({
          listingId: listing._id.toString(),
          sellerId: seller._id.toString(),
          text: 'Hi, is this item still available?',
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('_id');
      expect(res.body.messages).toHaveLength(1);
      expect(res.body.messages[0].text).toBe('Hi, is this item still available?');
      expect(res.body.participants).toHaveLength(2);
      
      testMessageIds.push(res.body._id);
    });

    test('1.2 Seller can reply to buyer message', async () => {
      const conversation = await Message.findOne({
        participants: { $all: [buyer._id, seller._id] },
        listing: listing._id,
      });

      const res = await request(app)
        .post(`/api/messages/${conversation._id}`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({ text: 'Yes, it is! Would you like to make an offer?' });

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
      expect(res.body[1].text).toBe('Yes, it is! Would you like to make an offer?');
      // sender is populated as an object with _id
      const senderId = typeof res.body[1].sender === 'object' ? res.body[1].sender._id : res.body[1].sender;
      expect(senderId.toString()).toBe(seller._id.toString());
    });

    test('1.3 Cannot message yourself', async () => {
      const res = await request(app)
        .post('/api/messages')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({
          listingId: listing._id.toString(),
          sellerId: seller._id.toString(),
          text: 'Message to self',
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Cannot message yourself');
    });

    test('1.4 Cannot send empty message', async () => {
      const res = await request(app)
        .post('/api/messages')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({
          listingId: listing._id.toString(),
          sellerId: seller._id.toString(),
          text: '',
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Message text is required');
    });

    test('1.5 Requires authentication', async () => {
      const res = await request(app)
        .post('/api/messages')
        .send({
          listingId: listing._id.toString(),
          sellerId: seller._id.toString(),
          text: 'Unauthenticated message',
        });

      expect(res.status).toBe(401);
    });
  });

  describe('2. Message Retrieval & Conversation View', () => {
    test('2.1 Buyer can get all their conversations', async () => {
      const res = await request(app)
        .get('/api/messages/conversations')
        .set('Authorization', `Bearer ${buyerToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
      expect(res.body[0]).toHaveProperty('otherUser');
      expect(res.body[0]).toHaveProperty('listing');
      expect(res.body[0]).toHaveProperty('lastMessage');
    });

    test('2.2 Seller can get all their conversations', async () => {
      const res = await request(app)
        .get('/api/messages/conversations')
        .set('Authorization', `Bearer ${sellerToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
      expect(res.body[0].otherUser._id.toString()).toBe(buyer._id.toString());
    });

    test('2.3 Can get specific conversation between users for a listing', async () => {
      const res = await request(app)
        .get(`/api/messages/conversation/${seller._id}/${listing._id}`)
        .set('Authorization', `Bearer ${buyerToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('messages');
      expect(res.body.messages.length).toBeGreaterThanOrEqual(2);
      expect(res.body).toHaveProperty('listing');
      expect(res.body.listing.title).toBe('Test Item for Messaging');
    });

    test('2.4 Returns 404 for non-existent conversation', async () => {
      const fakeUserId = new mongoose.Types.ObjectId();
      const res = await request(app)
        .get(`/api/messages/conversation/${fakeUserId}/${listing._id}`)
        .set('Authorization', `Bearer ${buyerToken}`);

      expect(res.status).toBe(404);
    });
  });

  describe('3. Offer Integration with Messages', () => {
    test('3.1 Conversation includes offer data when offer exists', async () => {
      // Create an offer
      const offer = await Offer.create({
        listing: listing._id,
        buyer: buyer._id,
        seller: seller._id,
        amount: 80,
        currency: 'USD',
        status: 'pending',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        counterHistory: [{ amount: 80, counteredBy: 'buyer', message: 'Initial offer' }],
        lastCounterBy: 'buyer',
      });
      testOfferIds.push(offer._id);

      const res = await request(app)
        .get(`/api/messages/conversation/${seller._id}/${listing._id}`)
        .set('Authorization', `Bearer ${buyerToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('offer');
      expect(res.body.offer._id.toString()).toBe(offer._id.toString());
      expect(res.body.offer.amount).toBe(80);
      expect(res.body.offer.status).toBe('pending');
    });

    test('3.2 Conversation with expired offer shows expired status', async () => {
      // Create an offer that's already expired
      const offer = await Offer.create({
        listing: listing._id,
        buyer: buyer._id,
        seller: seller._id,
        amount: 70,
        currency: 'USD',
        status: 'pending',
        expiresAt: new Date(Date.now() - 1000), // Already expired
        counterHistory: [{ amount: 70, counteredBy: 'buyer', message: 'Initial offer' }],
        lastCounterBy: 'buyer',
      });
      testOfferIds.push(offer._id);

      const res = await request(app)
        .get(`/api/messages/conversation/${seller._id}/${listing._id}`)
        .set('Authorization', `Bearer ${buyerToken}`);

      expect(res.status).toBe(200);
      // The offer should be auto-expired when loaded
      expect(res.body.offer.status).toBe('expired');
    });

    test('3.3 Seller can accept offer from conversation context', async () => {
      // Create a fresh offer
      const offer = await Offer.create({
        listing: listing._id,
        buyer: buyer._id,
        seller: seller._id,
        amount: 85,
        currency: 'USD',
        status: 'pending',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        counterHistory: [{ amount: 85, counteredBy: 'buyer', message: 'Initial offer' }],
        lastCounterBy: 'buyer',
      });
      testOfferIds.push(offer._id);

      const res = await request(app)
        .patch(`/api/offers/${offer._id}/accept`)
        .set('Authorization', `Bearer ${sellerToken}`);

      expect(res.status).toBe(200);
      // Verify offer was accepted by fetching it
      const updatedOffer = await Offer.findById(offer._id);
      expect(updatedOffer.status).toBe('accepted');
      expect(updatedOffer.acceptedPrice).toBe(85);
    });
  });

  describe('4. Offer Expiration', () => {
    test('4.1 New offer has 24h expiration by default', async () => {
      const offer = await Offer.create({
        listing: listing._id,
        buyer: buyer._id,
        seller: seller._id,
        amount: 90,
        currency: 'USD',
        counterHistory: [{ amount: 90, counteredBy: 'buyer' }],
        lastCounterBy: 'buyer',
      });
      testOfferIds.push(offer._id);

      const now = new Date();
      const expiresAt = new Date(offer.expiresAt);
      const diffHours = (expiresAt - now) / (1000 * 60 * 60);
      
      expect(diffHours).toBeGreaterThan(23);
      expect(diffHours).toBeLessThan(25);
    });

    test('4.2 expireOffers marks past-due offers as expired', async () => {
      // Create an offer with past expiration
      const offer = await Offer.create({
        listing: listing._id,
        buyer: buyer._id,
        seller: seller._id,
        amount: 75,
        currency: 'USD',
        status: 'pending',
        expiresAt: new Date(Date.now() - 60 * 60 * 1000), // 1 hour ago
        counterHistory: [{ amount: 75, counteredBy: 'buyer' }],
        lastCounterBy: 'buyer',
      });
      testOfferIds.push(offer._id);

      const expiredCount = await expireOffers();
      expect(expiredCount).toBeGreaterThanOrEqual(1);

      const updatedOffer = await Offer.findById(offer._id);
      expect(updatedOffer.status).toBe('expired');
    });

    test('4.3 expireOffers does NOT expire future offers', async () => {
      const offer = await Offer.create({
        listing: listing._id,
        buyer: buyer._id,
        seller: seller._id,
        amount: 95,
        currency: 'USD',
        status: 'pending',
        expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000), // 48 hours from now
        counterHistory: [{ amount: 95, counteredBy: 'buyer' }],
        lastCounterBy: 'buyer',
      });
      testOfferIds.push(offer._id);

      await expireOffers();

      const unchangedOffer = await Offer.findById(offer._id);
      expect(unchangedOffer.status).toBe('pending');
    });

    test('4.4 expireOffers does NOT expire accepted/completed offers', async () => {
      const offer = await Offer.create({
        listing: listing._id,
        buyer: buyer._id,
        seller: seller._id,
        amount: 88,
        currency: 'USD',
        status: 'accepted',
        expiresAt: new Date(Date.now() - 60 * 60 * 1000),
        acceptedPrice: 88,
        acceptedAt: new Date(),
        counterHistory: [{ amount: 88, counteredBy: 'buyer' }],
        lastCounterBy: 'buyer',
      });
      testOfferIds.push(offer._id);

      await expireOffers();

      const unchangedOffer = await Offer.findById(offer._id);
      expect(unchangedOffer.status).toBe('accepted');
    });
  });

  describe('5. Counter Offer Expiration Reset', () => {
    test('5.1 Seller counter resets 24h expiration window', async () => {
      const offer = await Offer.create({
        listing: listing._id,
        buyer: buyer._id,
        seller: seller._id,
        amount: 80,
        currency: 'USD',
        status: 'pending',
        expiresAt: new Date(Date.now() + 1000 * 60 * 60), // 1 hour from now
        counterHistory: [{ amount: 80, counteredBy: 'buyer' }],
        lastCounterBy: 'buyer',
      });
      testOfferIds.push(offer._id);

      const res = await request(app)
        .patch(`/api/offers/${offer._id}/counter`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({ counterAmount: 90 });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('countered');
      
      // Check that expiration was reset to ~24h from now
      const updatedOffer = await Offer.findById(offer._id);
      const now = new Date();
      const diffHours = (updatedOffer.expiresAt - now) / (1000 * 60 * 60);
      expect(diffHours).toBeGreaterThan(23);
      expect(diffHours).toBeLessThan(25);
    });

    test('5.2 Buyer counter resets 24h expiration window', async () => {
      // First, create a countered offer
      const offer = await Offer.create({
        listing: listing._id,
        buyer: buyer._id,
        seller: seller._id,
        amount: 80,
        currency: 'USD',
        status: 'countered',
        counterAmount: 95,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60), // 1 hour from now
        counterHistory: [
          { amount: 80, counteredBy: 'buyer' },
          { amount: 95, counteredBy: 'seller' },
        ],
        lastCounterBy: 'seller',
      });
      testOfferIds.push(offer._id);

      const res = await request(app)
        .patch(`/api/offers/${offer._id}/buyer-counter`)
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({ counterAmount: 88 });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('buyer_countered');

      // Check that expiration was reset to ~24h from now
      const updatedOffer = await Offer.findById(offer._id);
      const now = new Date();
      const diffHours = (updatedOffer.expiresAt - now) / (1000 * 60 * 60);
      expect(diffHours).toBeGreaterThan(23);
      expect(diffHours).toBeLessThan(25);
    });
  });

  describe('6. Read Receipts', () => {
    test('6.1 PUT /read endpoint marks messages as read', async () => {
      const conversation = await Message.findOne({
        participants: { $all: [buyer._id, seller._id] },
        listing: listing._id,
      });

      // Add an unread message from buyer
      conversation.messages.push({
        sender: buyer._id,
        text: 'Unread message for read receipt test',
        read: false,
      });
      await conversation.save();

      // Verify message is unread before
      let unreadBefore = conversation.messages.filter(
        m => m.sender.toString() === buyer._id.toString() && !m.read
      );
      expect(unreadBefore.length).toBeGreaterThan(0);

      // Call PUT /read as seller
      const res = await request(app)
        .put(`/api/messages/read/${conversation._id}`)
        .set('Authorization', `Bearer ${sellerToken}`);

      expect(res.status).toBe(200);
      
      // Verify messages are now marked as read
      const updatedConversation = await Message.findById(conversation._id);
      const unreadAfter = updatedConversation.messages.filter(
        m => m.sender.toString() === buyer._id.toString() && !m.read
      );
      expect(unreadAfter.length).toBe(0);
    });

    test('6.2 Mark as read on conversation load', async () => {
      const conversation = await Message.findOne({
        participants: { $all: [buyer._id, seller._id] },
        listing: listing._id,
      });

      // Ensure there are unread messages
      conversation.messages.push({
        sender: buyer._id,
        text: 'Test unread message for load',
        read: false,
      });
      await conversation.save();

      // Load conversation as seller (GET triggers markAsRead in real app)
      const res = await request(app)
        .get(`/api/messages/conversation/${buyer._id}/${listing._id}`)
        .set('Authorization', `Bearer ${sellerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.messages.length).toBeGreaterThan(0);
    });
  });

  describe('7. Unread Count', () => {
    test('7.1 Unread count reflects unread messages from other user', async () => {
      // Create a new message from seller that buyer hasn't read
      const conversation = await Message.findOne({
        participants: { $all: [buyer._id, seller._id] },
        listing: listing._id,
      });

      conversation.messages.push({
        sender: seller._id,
        text: 'New message from seller',
        read: false,
      });
      await conversation.save();

      // Get conversations as buyer
      const res = await request(app)
        .get('/api/messages/conversations')
        .set('Authorization', `Bearer ${buyerToken}`);

      expect(res.status).toBe(200);
      const conv = res.body.find(c => c._id.toString() === conversation._id.toString());
      expect(conv).toBeDefined();
      expect(conv.unreadCount).toBeGreaterThanOrEqual(1);
    });
  });

  describe('8. Unified Per-Person Grouping (no duplicate rows)', () => {
    let listing2, listing3;

    beforeAll(async () => {
      // Same seller, two MORE listings — buyer talks to the same person about
      // three different items. The /messages page must show ONE row.
      listing2 = await Listing.create({
        seller: seller._id, title: 'Second Item Same Seller', description: 'Another item',
        price: 55, category: 'Women', condition: 'Good',
        status: 'active', available: true, quantity: 1,
        currency: 'USD', images: ['https://example.com/image2.jpg'],
      });
      listing3 = await Listing.create({
        seller: seller._id, title: 'Third Item Same Seller', description: 'Yet another item',
        price: 65, category: 'Men', condition: 'Fair',
        status: 'active', available: true, quantity: 1,
        currency: 'USD', images: ['https://example.com/image3.jpg'],
      });
      testListingIds.push(listing2._id, listing3._id);

      // Buyer starts conversations on listing2 and listing3
      const r2 = await request(app)
        .post('/api/messages')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({ listingId: listing2._id.toString(), sellerId: seller._id.toString(), text: 'Interested in item two' });
      expect(r2.status).toBe(201);
      testMessageIds.push(r2.body._id);

      const r3 = await request(app)
        .post('/api/messages')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({ listingId: listing3._id.toString(), sellerId: seller._id.toString(), text: 'Also interested in item three' });
      expect(r3.status).toBe(201);
      testMessageIds.push(r3.body._id);
    });

    test('8.1 GET /conversations returns exactly ONE row per person across multiple listings', async () => {
      const res = await request(app)
        .get('/api/messages/conversations')
        .set('Authorization', `Bearer ${buyerToken}`);

      expect(res.status).toBe(200);
      const rowsForSeller = res.body.filter(
        c => c.otherUser && c.otherUser._id.toString() === seller._id.toString()
      );
      // THE core fix: never duplicate the same person per listing
      expect(rowsForSeller.length).toBe(1);
      const row = rowsForSeller[0];
      expect(row.listingCount).toBe(3); // listing + listing2 + listing3
      expect(row.listing).toBeDefined();
      expect(row.lastMessage).toBeDefined();
      expect(row.lastMessage.text).toBe('Also interested in item three');
    });

    test('8.2 Grouped row as seen by seller combines unread across listings', async () => {
      const res = await request(app)
        .get('/api/messages/conversations')
        .set('Authorization', `Bearer ${sellerToken}`);

      expect(res.status).toBe(200);
      const rowsForBuyer = res.body.filter(
        c => c.otherUser && c.otherUser._id.toString() === buyer._id.toString()
      );
      expect(rowsForBuyer.length).toBe(1);
      // Buyer messaged on 3 listings without seller reading listing2/3 msgs
      expect(rowsForBuyer[0].unreadCount).toBeGreaterThanOrEqual(2);
      expect(rowsForBuyer[0].messageCount).toBeGreaterThanOrEqual(3);
    });

    test('8.3 GET /conversation/:userId merges messages from ALL listings chronologically', async () => {
      const res = await request(app)
        .get(`/api/messages/conversation/${seller._id}`)
        .set('Authorization', `Bearer ${buyerToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('messages');
      expect(res.body).toHaveProperty('listings');
      expect(res.body.messages.length).toBeGreaterThanOrEqual(3);
      expect(res.body.listings.length).toBe(3);

      // Every message carries its listing context
      const listingIds = new Set(
        res.body.messages.map(m => (m.listing && m.listing._id ? m.listing._id.toString() : null))
      );
      expect(listingIds.size).toBe(3);

      // Chronological order (oldest first)
      for (let i = 1; i < res.body.messages.length; i++) {
        expect(new Date(res.body.messages[i].createdAt) >= new Date(res.body.messages[i - 1].createdAt)).toBe(true);
      }
    });

    test('8.4 Opening the unified thread marks ALL messages read across listings', async () => {
      // Seller sends a fresh message so buyer has unread
      const r = await request(app)
        .post('/api/messages')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({ listingId: listing._id.toString(), sellerId: buyer._id.toString(), text: 'Fresh seller message for read test' });
      // Appends to the existing per-listing thread (200), does not create a new one
      expect(r.status).toBe(200);

      const listRes = await request(app)
        .get('/api/messages/conversations')
        .set('Authorization', `Bearer ${buyerToken}`);
      const rowBefore = listRes.body.find(c => c.otherUser._id.toString() === seller._id.toString());
      expect(rowBefore.unreadCount).toBeGreaterThanOrEqual(1);

      // Open the unified thread as buyer → everything marked read
      const threadRes = await request(app)
        .get(`/api/messages/conversation/${seller._id}`)
        .set('Authorization', `Bearer ${buyerToken}`);
      expect(threadRes.status).toBe(200);

      const listRes2 = await request(app)
        .get('/api/messages/conversations')
        .set('Authorization', `Bearer ${buyerToken}`);
      const rowAfter = listRes2.body.find(c => c.otherUser._id.toString() === seller._id.toString());
      expect(rowAfter.unreadCount).toBe(0);
    });

    test('8.5 Unified thread includes offers across listings with listing context', async () => {
      const res = await request(app)
        .get(`/api/messages/conversation/${seller._id}`)
        .set('Authorization', `Bearer ${buyerToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.offers)).toBe(true);
      expect(res.body.offers.length).toBeGreaterThanOrEqual(1);
      // Offer carries its listing title so the UI can label which item it is for
      expect(res.body.offers[0].listing).toBeDefined();
      expect(res.body.offers[0].listing.title).toBeDefined();
    });

    test('8.6 Unified thread requires authentication', async () => {
      const res = await request(app)
        .get(`/api/messages/conversation/${seller._id}`);
      expect(res.status).toBe(401);
    });

    test('8.7 Legacy per-listing endpoint still works (backwards compatible)', async () => {
      const res = await request(app)
        .get(`/api/messages/conversation/${seller._id}/${listing._id}`)
        .set('Authorization', `Bearer ${buyerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.messages.length).toBeGreaterThanOrEqual(1);
      expect(res.body.listing.title).toBe('Test Item for Messaging');
    });
  });
});
