/**
 * Red tests proving auction double-sell defects.
 *
 * DEFECT 1 — an auction can be opened for a listing that is already sold.
 *   POST /api/auctions only checks ownership and that no auction exists yet;
 *   it never checks that the listing is actually for sale. A sold item can be
 *   auctioned, and closing that auction creates a brand-new unpaid order for
 *   merchandise the seller no longer has.
 *
 * DEFECT 2 — closing an auction does not re-check the listing, so an item
 *   sold through the normal catalog while the auction was running is sold a
 *   SECOND time: the close handler marks it sold again and mints another
 *   transaction for the auction winner. One physical item, two orders, and a
 *   buyer who can never receive it.
 *
 * The correct contract: a listing that is no longer available cannot be
 * auctioned, and an auction that closes after its listing was sold elsewhere
 * closes WITHOUT a winner (no listing mutation, no transaction, no "you won"
 * notification).
 */
const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const app = require('../server.js');
const api = request(app);
const User = require('../models/User');
const Listing = require('../models/Listing');
const Auction = require('../models/Auction');
const Transaction = require('../models/Transaction');

const secret = process.env.JWT_SECRET || 'fallback_secret_change_me';

let seller;
let bidder;
let sellerToken;

const makeListing = (overrides = {}) => Listing.create({
  seller: seller._id,
  title: 'Auction Item',
  description: 'Listing used by the auction defect suite',
  price: 100,
  category: 'Men',
  condition: 'Good',
  quantity: 1,
  available: true,
  sold: false,
  status: 'active',
  shipsFrom: 'US',
  weight: 1,
  weightUnit: 'kg',
  images: [],
  ...overrides,
});

beforeAll(async () => {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/trend-drop-test');
  }
  const seed = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  seller = await User.create({
    _id: new mongoose.Types.ObjectId(),
    name: 'Auction Seller',
    email: `auction_seller_${seed}@test.com`,
    password: 'password123',
    emailVerified: true,
    authProvider: 'email',
    country: 'US',
    currency: 'USD',
  });
  bidder = await User.create({
    _id: new mongoose.Types.ObjectId(),
    name: 'Auction Bidder',
    email: `auction_bidder_${seed}@test.com`,
    password: 'password123',
    emailVerified: true,
    authProvider: 'email',
    country: 'US',
    currency: 'USD',
  });
  sellerToken = jwt.sign({ id: seller._id }, secret, { expiresIn: '1h' });
});

afterAll(async () => {
  await Transaction.deleteMany({ seller: seller._id });
  await Auction.deleteMany({ seller: seller._id });
  await Listing.deleteMany({ seller: seller._id });
});

describe('DEFECT: auctions must never sell an item twice', () => {
  test('AU.1 creating an auction for an already-sold listing is rejected', async () => {
    const sold = await makeListing({ title: 'Already Sold', sold: true, available: false });

    const res = await api
      .post('/api/auctions')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({
        listingId: String(sold._id),
        startTime: new Date().toISOString(),
        endTime: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        reservePrice: 100,
      });

    expect(res.status).toBe(400);
    expect(await Auction.countDocuments({ listing: sold._id })).toBe(0);
  });

  test('AU.2 closing an auction whose listing sold elsewhere creates no second order', async () => {
    const listing = await makeListing({ title: 'Double Sell' });
    const auction = await Auction.create({
      listing: listing._id,
      seller: seller._id,
      startTime: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      endTime: new Date(Date.now() - 60 * 1000), // already ended
      reservePrice: 100,
      currentBid: 120,
      currency: 'USD',
      status: 'active',
      bids: [{ bidder: bidder._id, amount: 120, currency: 'USD' }],
    });

    // The item is sold through the normal catalog while the auction runs.
    await Listing.updateOne({ _id: listing._id }, { $set: { sold: true, available: false } });

    const res = await api
      .post(`/api/auctions/${auction._id}/close`)
      .set('Authorization', `Bearer ${sellerToken}`);

    expect(res.status).toBe(200);
    // No second order may be minted for the same physical item.
    expect(await Transaction.countDocuments({ auction: auction._id })).toBe(0);
    expect(res.body.transaction).toBeUndefined();

    const closed = await Auction.findById(auction._id);
    expect(closed.status).toBe('closed');
    expect(closed.winner).toBeNull();
    expect(closed.winningBid).toBe(0);

    const after = await Listing.findById(listing._id);
    expect(after.sold).toBe(true);
  });

  test('AU.3 REGRESSION GUARD: a healthy auction still produces its winner order', async () => {
    const listing = await makeListing({ title: 'Healthy Auction' });
    const auction = await Auction.create({
      listing: listing._id,
      seller: seller._id,
      startTime: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      endTime: new Date(Date.now() - 60 * 1000),
      reservePrice: 100,
      currentBid: 150,
      currency: 'USD',
      status: 'active',
      bids: [{ bidder: bidder._id, amount: 150, currency: 'USD' }],
    });

    const res = await api
      .post(`/api/auctions/${auction._id}/close`)
      .set('Authorization', `Bearer ${sellerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.transaction).toBeDefined();
    expect(await Transaction.countDocuments({ auction: auction._id })).toBe(1);
    const closed = await Auction.findById(auction._id);
    expect(String(closed.winner)).toBe(String(bidder._id));
    expect(closed.winningBid).toBe(150);
  });
});
