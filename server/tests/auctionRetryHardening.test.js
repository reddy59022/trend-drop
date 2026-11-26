/**
 * TDD round: a failed winner-order creation must not permanently close an
 * auction without an order. Retrying /close must create the missing order once.
 */
const mongoose = require('mongoose');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../server');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Auction = require('../models/Auction');
const Transaction = require('../models/Transaction');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';
const tokenFor = (user) => jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '30d' });
const created = { users: [], listings: [], auctions: [], transactions: [] };

const makeUser = async (label) => {
  const user = await User.create({
    name: `${label} User`,
    email: `${label}_${Date.now()}_${Math.random().toString(36).slice(2)}@test.com`,
    password: 'password123',
    country: 'US',
    currency: 'USD',
    emailVerified: true,
    authProvider: 'email',
    shippingAddress: { fullName: label, street1: '1 Main St', city: 'City', state: 'CA', postalCode: '90210', country: 'US' },
  });
  created.users.push(user._id);
  return user;
};

beforeAll(async () => {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/trenddrop_test');
  }
});

afterAll(async () => {
  await Transaction.deleteMany({ _id: { $in: created.transactions } });
  await Transaction.deleteMany({ auction: { $in: created.auctions } });
  await Auction.deleteMany({ _id: { $in: created.auctions } });
  await Listing.deleteMany({ _id: { $in: created.listings } });
  await User.deleteMany({ _id: { $in: created.users } });
  await mongoose.connection.close();
});

describe('AR.1 auction close is retryable after order creation fails', () => {
  test('the first close fails, the retry creates exactly one order and finalizes', async () => {
    const seller = await makeUser('auction_retry_seller');
    const bidder = await makeUser('auction_retry_bidder');
    const listing = await Listing.create({
      seller: seller._id,
      title: 'Auction retry item',
      description: 'Fixture',
      price: 50,
      category: 'Men',
      condition: 'Good',
      images: ['https://example.com/item.jpg'],
      quantity: 1,
      available: true,
      sold: false,
      status: 'active',
      currency: 'USD',
    });
    created.listings.push(listing._id);

    const auction = await Auction.create({
      listing: listing._id,
      seller: seller._id,
      startTime: new Date(Date.now() - 2 * 60 * 60 * 1000),
      endTime: new Date(Date.now() - 60 * 60 * 1000),
      reservePrice: 40,
      currentBid: 60,
      currency: 'USD',
      status: 'active',
      bids: [{ bidder: bidder._id, amount: 60, currency: 'USD' }],
    });
    created.auctions.push(auction._id);

    const createSpy = jest.spyOn(Transaction, 'create').mockRejectedValueOnce(new Error('simulated db failure'));
    const first = await request(app)
      .post(`/api/auctions/${auction._id}/close`)
      .set('Authorization', `Bearer ${tokenFor(seller)}`);
    expect(first.status).toBe(500);

    const second = await request(app)
      .post(`/api/auctions/${auction._id}/close`)
      .set('Authorization', `Bearer ${tokenFor(seller)}`);
    expect(second.status).toBe(200);
    expect(second.body.transaction).toBeDefined();
    createSpy.mockRestore();

    const stored = await Auction.findById(auction._id);
    expect(stored.status).toBe('closed');
    expect(stored.closeFinalized).toBe(true);
    expect(stored.winner.toString()).toBe(String(bidder._id));

    const orders = await Transaction.find({ auction: auction._id });
    expect(orders).toHaveLength(1);
    created.transactions.push(orders[0]._id);

    const third = await request(app)
      .post(`/api/auctions/${auction._id}/close`)
      .set('Authorization', `Bearer ${tokenFor(seller)}`);
    expect(third.status).toBe(400);
    expect(await Transaction.countDocuments({ auction: auction._id })).toBe(1);
  });
});
