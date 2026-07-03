// Auction Service Tests - v27.0
const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../server.js');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Auction = require('../models/Auction');
const jwt = require('jsonwebtoken');

let sellerToken;
let buyerToken;
let sellerId;
let buyerId;
let listingId;
let auctionId;

async function createUser(email, role = 'user') {
  const dummyId = new mongoose.Types.ObjectId();
  return await User.create({
    _id: dummyId,
    name: 'TestUser',
    email: email,
    password: 'hashed',
    emailVerified: true,
    authProvider: 'email',
    role,
    country: 'US',
    currency: 'USD',
    balance: { available: 1000, pending: 0 },
  });
}

describe('Auction/Bidding System', () => {
  beforeEach(async () => {
    const seller = await createUser(`seller_auction_${Date.now()}@example.com`);
    sellerId = seller._id;
    const buyer = await createUser(`buyer_auction_${Date.now()}@example.com`);
    buyerId = buyer._id;
    
    const secret = process.env.JWT_SECRET || 'fallback_secret_change_me';
    sellerToken = jwt.sign({ id: sellerId }, secret, { expiresIn: '1h' });
    buyerToken = jwt.sign({ id: buyerId }, secret, { expiresIn: '1h' });
  });

  afterEach(async () => {
    await Auction.deleteMany({ _id: { $in: [auctionId] } });
    await Listing.deleteMany({ _id: { $in: [listingId] } });
    await User.deleteMany({ _id: { $in: [sellerId, buyerId] } });
  });

  describe('POST /api/auctions', () => {
    it('AUCTION.1 should require authentication', async () => {
      const res = await request(app)
        .post('/api/auctions')
        .send({
          listingId,
          startTime: new Date(),
          endTime: new Date(Date.now() + 24 * 60 * 60 * 1000),
          reservePrice: 100,
        });

      expect(res.statusCode).toBe(401);
    });

    it('AUCTION.2 should create auction for existing listing', async () => {
      // Create a listing first
      const listing = await Listing.create({
        title: 'Auction Item',
        description: 'Item for auction',
        price: 100,
        category: 'Men',
        condition: 'Good',
        seller: sellerId,
        available: true,
        sold: false,
        status: 'active',
      });
      listingId = listing._id;

      const res = await request(app)
        .post('/api/auctions')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({
          listingId,
          startTime: new Date(),
          endTime: new Date(Date.now() + 24 * 60 * 60 * 1000),
          reservePrice: 100,
        });

      expect(res.statusCode).toBe(201);
      expect(res.body.auction).toBeDefined();
      expect(res.body.auction.listing).toBe(listingId.toString());
      expect(res.body.auction.status).toBe('active');
      auctionId = res.body.auction._id;
    });

    it('AUCTION.3 should validate end time is after start time', async () => {
      const listing = await Listing.create({
        title: 'Auction Item',
        description: 'Item for auction',
        price: 100,
        category: 'Men',
        condition: 'Good',
        seller: sellerId,
        available: true,
        sold: false,
        status: 'active',
      });
      listingId = listing._id;

      const res = await request(app)
        .post('/api/auctions')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({
          listingId,
          startTime: new Date(Date.now() + 24 * 60 * 60 * 1000),
          endTime: new Date(),
          reservePrice: 100,
        });

      expect(res.statusCode).toBe(400);
      expect(res.body.message).toContain('end time must be after start time');
    });

    it('AUCTION.4 should only allow seller to create auction for their listing', async () => {
      const listing = await Listing.create({
        title: 'Auction Item',
        description: 'Item for auction',
        price: 100,
        category: 'Men',
        condition: 'Good',
        seller: sellerId,
        available: true,
        sold: false,
        status: 'active',
      });
      listingId = listing._id;

      // Create another seller
      const otherSeller = await createUser(`other_auction_${Date.now()}@example.com`);
      const otherToken = jwt.sign({ id: otherSeller._id }, process.env.JWT_SECRET || 'fallback_secret_change_me', { expiresIn: '1h' });

      const res = await request(app)
        .post('/api/auctions')
        .set('Authorization', `Bearer ${otherToken}`)
        .send({
          listingId,
          startTime: new Date(),
          endTime: new Date(Date.now() + 24 * 60 * 60 * 1000),
          reservePrice: 100,
        });

      expect(res.statusCode).toBe(403);
      
      await User.deleteOne({ _id: otherSeller._id });
    });
  });

  describe('POST /api/auctions/:id/bids', () => {
    it('AUCTION.5 should require authentication to place bid', async () => {
      const listing = await Listing.create({
        title: 'Auction Item',
        description: 'Item for auction',
        price: 100,
        category: 'Men',
        condition: 'Good',
        seller: sellerId,
        available: true,
        sold: false,
        status: 'active',
      });

      const auction = await Auction.create({
        listing: listing._id,
        seller: sellerId,
        startTime: new Date(Date.now() - 60 * 60 * 1000),
        endTime: new Date(Date.now() + 24 * 60 * 60 * 1000),
        reservePrice: 100,
        status: 'active',
      });
      auctionId = auction._id;

      const res = await request(app)
        .post(`/api/auctions/${auctionId}/bids`)
        .send({ amount: 150 });

      expect(res.statusCode).toBe(401);
    });

    it('AUCTION.6 should place bid on active auction', async () => {
      const listing = await Listing.create({
        title: 'Auction Item',
        description: 'Item for auction',
        price: 100,
        category: 'Men',
        condition: 'Good',
        seller: sellerId,
        available: true,
        sold: false,
        status: 'active',
      });

      const auction = await Auction.create({
        listing: listing._id,
        seller: sellerId,
        startTime: new Date(Date.now() - 60 * 60 * 1000),
        endTime: new Date(Date.now() + 24 * 60 * 60 * 1000),
        reservePrice: 100,
        currentBid: 100,
        status: 'active',
      });
      auctionId = auction._id;

      const res = await request(app)
        .post(`/api/auctions/${auctionId}/bids`)
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({ amount: 150 });

      expect(res.statusCode).toBe(200);
      expect(res.body.auction.currentBid).toBe(150);
    });

    it('AUCTION.7 should require bid higher than current bid', async () => {
      const listing = await Listing.create({
        title: 'Auction Item',
        description: 'Item for auction',
        price: 100,
        category: 'Men',
        condition: 'Good',
        seller: sellerId,
        available: true,
        sold: false,
        status: 'active',
      });

      const auction = await Auction.create({
        listing: listing._id,
        seller: sellerId,
        startTime: new Date(Date.now() - 60 * 60 * 1000),
        endTime: new Date(Date.now() + 24 * 60 * 60 * 1000),
        reservePrice: 100,
        currentBid: 150,
        status: 'active',
      });
      auctionId = auction._id;

      const res = await request(app)
        .post(`/api/auctions/${auctionId}/bids`)
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({ amount: 100 });

      expect(res.statusCode).toBe(400);
      expect(res.body.message).toContain('must be higher');
    });

    it('AUCTION.8 should not allow bid below reserve price', async () => {
      const listing = await Listing.create({
        title: 'Auction Item',
        description: 'Item for auction',
        price: 100,
        category: 'Men',
        condition: 'Good',
        seller: sellerId,
        available: true,
        sold: false,
        status: 'active',
      });

      const auction = await Auction.create({
        listing: listing._id,
        seller: sellerId,
        startTime: new Date(Date.now() - 60 * 60 * 1000),
        endTime: new Date(Date.now() + 24 * 60 * 60 * 1000),
        reservePrice: 200,
        currentBid: 150,
        status: 'active',
      });
      auctionId = auction._id;

      const res = await request(app)
        .post(`/api/auctions/${auctionId}/bids`)
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({ amount: 180 });

      expect(res.statusCode).toBe(400);
      expect(res.body.message).toContain('reserve price');
    });
  });

  describe('GET /api/auctions', () => {
    it('AUCTION.9 should return active auctions', async () => {
      const listing = await Listing.create({
        title: 'Auction Item',
        description: 'Item for auction',
        price: 100,
        category: 'Men',
        condition: 'Good',
        seller: sellerId,
        available: true,
        sold: false,
        status: 'active',
      });

      await Auction.create({
        listing: listing._id,
        seller: sellerId,
        startTime: new Date(Date.now() - 60 * 60 * 1000),
        endTime: new Date(Date.now() + 24 * 60 * 60 * 1000),
        reservePrice: 100,
        status: 'active',
      });

      const res = await request(app)
        .get('/api/auctions')
        .query({ status: 'active' });

      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.body.auctions)).toBe(true);
    });

    it('AUCTION.10 should return auction details with bids', async () => {
      const listing = await Listing.create({
        title: 'Auction Item',
        description: 'Item for auction',
        price: 100,
        category: 'Men',
        condition: 'Good',
        seller: sellerId,
        available: true,
        sold: false,
        status: 'active',
      });

      const auction = await Auction.create({
        listing: listing._id,
        seller: sellerId,
        startTime: new Date(Date.now() - 60 * 60 * 1000),
        endTime: new Date(Date.now() + 24 * 60 * 60 * 1000),
        reservePrice: 100,
        status: 'active',
        bids: [{
          bidder: buyerId,
          amount: 150,
          timestamp: new Date(),
        }],
        currentBid: 150,
      });
      auctionId = auction._id;

      const res = await request(app)
        .get(`/api/auctions/${auctionId}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.auction.bids).toBeDefined();
      expect(res.body.auction.bids.length).toBe(1);
    });
  });

  describe('POST /api/auctions/:id/close', () => {
    it('AUCTION.11 should close expired auction', async () => {
      const listing = await Listing.create({
        title: 'Auction Item',
        description: 'Item for auction',
        price: 100,
        category: 'Men',
        condition: 'Good',
        seller: sellerId,
        available: true,
        sold: false,
        status: 'active',
      });

      const auction = await Auction.create({
        listing: listing._id,
        seller: sellerId,
        startTime: new Date(Date.now() - 48 * 60 * 60 * 1000),
        endTime: new Date(Date.now() - 60 * 60 * 1000), // Already ended
        reservePrice: 100,
        status: 'active',
        currentBid: 150,
        bids: [{
          bidder: buyerId,
          amount: 150,
          timestamp: new Date(),
        }],
      });
      auctionId = auction._id;

      const res = await request(app)
        .post(`/api/auctions/${auctionId}/close`)
        .set('Authorization', `Bearer ${sellerToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.auction.status).toBe('closed');
    });

    it('AUCTION.12 should only allow seller or admin to close auction', async () => {
      const listing = await Listing.create({
        title: 'Auction Item',
        description: 'Item for auction',
        price: 100,
        category: 'Men',
        condition: 'Good',
        seller: sellerId,
        available: true,
        sold: false,
        status: 'active',
      });

      const auction = await Auction.create({
        listing: listing._id,
        seller: sellerId,
        startTime: new Date(Date.now() - 48 * 60 * 60 * 1000),
        endTime: new Date(Date.now() - 60 * 60 * 1000),
        reservePrice: 100,
        status: 'active',
      });
      auctionId = auction._id;

      const res = await request(app)
        .post(`/api/auctions/${auctionId}/close`)
        .set('Authorization', `Bearer ${buyerToken}`);

      expect(res.statusCode).toBe(403);
    });
  });

  describe('GET /api/auctions/settings', () => {
    it('AUCTION.13 should return auction settings', async () => {
      const res = await request(app).get('/api/auctions/settings');

      expect(res.statusCode).toBe(200);
      expect(res.body.minBidIncrement).toBeDefined();
      expect(res.body.maxAuctionDuration).toBeDefined();
    });
  });
});