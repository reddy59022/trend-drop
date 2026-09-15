const mongoose = require('mongoose');
const request = require('supertest');
const app = require('../server');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Auction = require('../models/Auction');
const Message = require('../models/Message');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';
const US = { fullName: 'T', street1: '1 St', city: 'NYC', state: 'NY', postalCode: '10001', country: 'US' };

const makeUser = async (name, email) => {
  const user = await User.create({
    name, email, password: 'password123', country: 'US', currency: 'USD',
    emailVerified: true, authProvider: 'email',
    shippingAddress: { ...US },
  });
  const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '30d' });
  return { user, token };
};

const makeListing = (seller, price = 100) => Listing.create({
  title: `ZeroDefect2 ${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
  description: 'Zero-defect sweep wave 2',
  price, currency: 'USD', category: 'Men', size: 'M', condition: 'Good',
  images: ['https://example.com/p.jpg'], seller: seller._id, available: true,
  quantity: 5, shipsFrom: 'US',
});

beforeAll(async () => {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/trend-drop-test');
  }
});


describe('ZD6 — messages endpoints require conversation membership', () => {
  test('a stranger cannot post into someone elses conversation', async () => {
    const alice = await makeUser('ZDMsg1', `zdmsg1_${Date.now()}@test.com`);
    const bob = await makeUser('ZDMsg2', `zdmsg2_${Date.now()}@test.com`);
    const mallory = await makeUser('ZDMsg3', `zdmsg3_${Date.now()}@test.com`);
    const listing = await makeListing(alice.user, 40);
    const c = await request(app).post('/api/messages')
      .set('Authorization', 'Bearer ' + alice.token)
      .send({ listingId: listing._id.toString(), sellerId: bob.user._id.toString(), text: 'hi bob' });
    expect([200, 201]).toContain(c.status);
    const convoId = (c.body.conversation || c.body)._id;
    const r = await request(app).post(`/api/messages/${convoId}`)
      .set('Authorization', 'Bearer ' + mallory.token)
      .send({ text: 'mallory was here' });
    expect([403, 404]).toContain(r.status);
  });

  test('a stranger cannot mark someone elses conversation read', async () => {
    const alice = await makeUser('ZDMsg4', `zdmsg4_${Date.now()}@test.com`);
    const bob = await makeUser('ZDMsg5', `zdmsg5_${Date.now()}@test.com`);
    const mallory = await makeUser('ZDMsg6', `zdmsg6_${Date.now()}@test.com`);
    const listing = await makeListing(alice.user, 40);
    const c = await request(app).post('/api/messages')
      .set('Authorization', 'Bearer ' + alice.token)
      .send({ listingId: listing._id.toString(), sellerId: bob.user._id.toString(), text: 'hi again' });
    expect([200, 201]).toContain(c.status);
    const convoId = (c.body.conversation || c.body)._id;
    const r = await request(app).put(`/api/messages/read/${convoId}`)
      .set('Authorization', 'Bearer ' + mallory.token).send({});
    expect([403, 404]).toContain(r.status);
  });

  test('message text is length-capped', async () => {
    const alice = await makeUser('ZDMsg7', `zdmsg7_${Date.now()}@test.com`);
    const bob = await makeUser('ZDMsg8', `zdmsg8_${Date.now()}@test.com`);
    const listing = await makeListing(alice.user, 40);
    const c = await request(app).post('/api/messages')
      .set('Authorization', 'Bearer ' + alice.token)
      .send({ listingId: listing._id.toString(), sellerId: bob.user._id.toString(), text: 'x'.repeat(6000) });
    expect(c.status).toBe(400);
    expect(JSON.stringify(c.body)).toMatch(/long|length|5000/i);
  });

  test('member reply still works (regression guard)', async () => {
    const alice = await makeUser('ZDMsg9', `zdmsg9_${Date.now()}@test.com`);
    const bob = await makeUser('ZDMsg10', `zdmsg10_${Date.now()}@test.com`);
    const listing = await makeListing(alice.user, 40);
    const c = await request(app).post('/api/messages')
      .set('Authorization', 'Bearer ' + alice.token)
      .send({ listingId: listing._id.toString(), sellerId: bob.user._id.toString(), text: 'hello' });
    expect([200, 201]).toContain(c.status);
    const convoId = (c.body.conversation || c.body)._id;
    const r = await request(app).post(`/api/messages/${convoId}`)
      .set('Authorization', 'Bearer ' + bob.token)
      .send({ text: 'hi alice' });
    expect(r.status).toBe(200);
  });
});

describe('ZD7 — offer amounts cannot be negative', () => {
  test('negative offer amount is rejected', async () => {
    const seller = await makeUser('ZDOffer1', `zdoffer1_${Date.now()}@test.com`);
    const buyer = await makeUser('ZDOffer2', `zdoffer2_${Date.now()}@test.com`);
    const listing = await makeListing(seller.user, 100);
    const r = await request(app).post('/api/offers')
      .set('Authorization', 'Bearer ' + buyer.token)
      .send({ listingId: listing._id.toString(), amount: -50 });
    expect(r.status).toBe(400);
  });
});

describe('ZD8 — auction bids must be integers', () => {
  test('fractional bid below the $1 increment is rejected', async () => {
    const seller = await makeUser('ZDAuc2', `zdauc2_${Date.now()}@test.com`);
    const bidder = await makeUser('ZDAuc3', `zdauc3_${Date.now()}@test.com`);
    const listing = await makeListing(seller.user, 80);
    const now = Date.now();
    const auction = await Auction.create({
      listing: listing._id, seller: seller.user._id,
      startTime: new Date(now - 3600 * 1000), endTime: new Date(now + 3600 * 1000),
      reservePrice: 10, currency: 'USD', currentBid: 50, status: 'active', bids: [],
    });
    const r = await request(app).post(`/api/auctions/${auction._id}/bids`)
      .set('Authorization', 'Bearer ' + bidder.token)
      .send({ amount: 50.5 });
    expect(r.status).toBe(400);
  });

describe('ZD9 — loyalty earn is server-authoritative, redeem is validated', () => {
  test('earn ignores client-supplied amount: referral grants fixed 100 pts', async () => {
    const u = await makeUser('ZDLoyR1', `zdloyr1_${Date.now()}@test.com`);
    const r = await request(app).post('/api/loyalty/earn')
      .set('Authorization', 'Bearer ' + u.token)
      .send({ amount: 999999, purchaseAmount: 999999, reason: 'referral' });
    expect(r.status).toBe(200);
    expect(r.body.points).toBe(100);
  });

  test('earn purchase derives from purchaseAmount, capped per event', async () => {
    const u = await makeUser('ZDLoyR2', `zdloyr2_${Date.now()}@test.com`);
    const r = await request(app).post('/api/loyalty/earn')
      .set('Authorization', 'Bearer ' + u.token)
      .send({ amount: 999999999, purchaseAmount: 250, reason: 'purchase' });
    expect(r.status).toBe(200);
    expect(r.body.points).toBe(250);
  });

  test('redeem rejects non-positive amounts', async () => {
    const u = await makeUser('ZDLoyR3', `zdloyr3_${Date.now()}@test.com`);
    const r = await request(app).post('/api/loyalty/redeem')
      .set('Authorization', 'Bearer ' + u.token)
      .send({ amount: -50 });
    expect(r.status).toBe(400);
  });

  test('redeem rejects more than the balance', async () => {
    const u = await makeUser('ZDLoyR4', `zdloyr4_${Date.now()}@test.com`);
    const r = await request(app).post('/api/loyalty/redeem')
      .set('Authorization', 'Bearer ' + u.token)
      .send({ amount: 50 });
    expect(r.status).toBe(400);
  });

  test('earn then redeem full balance works (regression guard)', async () => {
    const u = await makeUser('ZDLoyR5', `zdloyr5_${Date.now()}@test.com`);
    const e = await request(app).post('/api/loyalty/earn')
      .set('Authorization', 'Bearer ' + u.token)
      .send({ purchaseAmount: 200, reason: 'purchase' });
    expect(e.status).toBe(200);
    expect(e.body.points).toBe(200);
    const r = await request(app).post('/api/loyalty/redeem')
      .set('Authorization', 'Bearer ' + u.token)
      .send({ amount: 200 });
    expect(r.status).toBe(200);
    expect(r.body.discount).toBeCloseTo(2.0);
    expect(r.body.points).toBe(0);
  });
});

describe('ZD10 — auction creation is validated', () => {
  test('endTime before startTime is rejected', async () => {
    const seller = await makeUser('ZDAucC1', `zdaucc1_${Date.now()}@test.com`);
    const listing = await makeListing(seller.user, 80);
    const now = Date.now();
    const r = await request(app).post('/api/auctions')
      .set('Authorization', 'Bearer ' + seller.token)
      .send({
        listingId: listing._id.toString(),
        startTime: new Date(now + 7200 * 1000).toISOString(),
        endTime: new Date(now + 3600 * 1000).toISOString(),
        reservePrice: 10, currency: 'USD',
      });
    expect(r.status).toBe(400);
  });

  test('non-seller cannot auction someone elses listing', async () => {
    const seller = await makeUser('ZDAucC2', `zdaucc2_${Date.now()}@test.com`);
    const stranger = await makeUser('ZDAucC3', `zdaucc3_${Date.now()}@test.com`);
    const listing = await makeListing(seller.user, 80);
    const now = Date.now();
    const r = await request(app).post('/api/auctions')
      .set('Authorization', 'Bearer ' + stranger.token)
      .send({
        listingId: listing._id.toString(),
        startTime: new Date(now - 1000).toISOString(),
        endTime: new Date(now + 3600 * 1000).toISOString(),
        reservePrice: 10, currency: 'USD',
      });
    expect(r.status).toBe(403);
  });
});
});
