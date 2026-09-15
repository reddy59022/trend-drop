const mongoose = require('mongoose');
const request = require('supertest');
const app = require('../server');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Auction = require('../models/Auction');
const Message = require('../models/Message');
const jwt = require('jsonwebtoken');
const { getJwtSecret } = require('../config/security');

const JWT_SECRET = getJwtSecret();
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

describe('ZD18 — sold or auctioned listings cannot be hard-deleted by the seller', () => {
  test('deleting a sold listing is rejected', async () => {
    const seller = await makeUser('ZDDel1', `zddel1_${Date.now()}@test.com`);
    const listing = await makeListing(seller.user, 60);
    await Listing.findByIdAndUpdate(listing._id, { sold: true, available: false, quantitySold: 2 });
    const r = await request(app).delete(`/api/listings/${listing._id}`)
      .set('Authorization', 'Bearer ' + seller.token);
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).toMatch(/sold|orders|auction/i);
    const stillThere = await Listing.findById(listing._id);
    expect(stillThere).not.toBeNull();
  });

  test('deleting a listing with an active auction is rejected', async () => {
    const seller = await makeUser('ZDDel2', `zddel2_${Date.now()}@test.com`);
    const listing = await makeListing(seller.user, 60);
    const now = Date.now();
    await Auction.create({
      listing: listing._id, seller: seller.user._id,
      startTime: new Date(now - 3600 * 1000), endTime: new Date(now + 3600 * 1000),
      reservePrice: 10, currency: 'USD', currentBid: 0, status: 'active', bids: [],
    });
    const r = await request(app).delete(`/api/listings/${listing._id}`)
      .set('Authorization', 'Bearer ' + seller.token);
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).toMatch(/auction/i);
    const stillThere = await Listing.findById(listing._id);
    expect(stillThere).not.toBeNull();
  });

  test('deleting an unsold, un-auctioned listing still works (regression guard)', async () => {
    const seller = await makeUser('ZDDel3', `zddel3_${Date.now()}@test.com`);
    const listing = await makeListing(seller.user, 60);
    const r = await request(app).delete(`/api/listings/${listing._id}`)
      .set('Authorization', 'Bearer ' + seller.token);
    expect(r.status).toBe(200);
    const gone = await Listing.findById(listing._id);
    expect(gone).toBeNull();
  });
});

describe('ZD19 — inventory sync validates input and listing ownership', () => {
  test('missing items array is rejected with 400 (not a 500 crash)', async () => {
    const seller = await makeUser('ZDInv1', `zdinv1_${Date.now()}@test.com`);
    const r = await request(app).post('/api/inventory/sync')
      .set('Authorization', 'Bearer ' + seller.token)
      .send({ warehouse: 'WH1' });
    expect(r.status).toBe(400);
  });

  test('invalid listing id is rejected with 400', async () => {
    const seller = await makeUser('ZDInv2', `zdinv2_${Date.now()}@test.com`);
    const r = await request(app).post('/api/inventory/sync')
      .set('Authorization', 'Bearer ' + seller.token)
      .send({ warehouse: 'WH1', items: [{ listingId: 'not-an-objectid', quantity: 3 }] });
    expect(r.status).toBe(400);
  });

  test('syncing inventory for a listing you do not own is rejected', async () => {
    const owner = await makeUser('ZDInv3', `zdinv3_${Date.now()}@test.com`);
    const stranger = await makeUser('ZDInv4', `zdinv4_${Date.now()}@test.com`);
    const listing = await makeListing(owner.user, 60);
    const r = await request(app).post('/api/inventory/sync')
      .set('Authorization', 'Bearer ' + stranger.token)
      .send({ warehouse: 'WH1', items: [{ listingId: listing._id.toString(), quantity: 3 }] });
    expect([400, 403]).toContain(r.status);
    const Inventory = require('../models/Inventory');
    const row = await Inventory.findOne({ seller: stranger.user._id, listing: listing._id });
    expect(row).toBeNull();
  });

  test('negative quantity is rejected', async () => {
    const seller = await makeUser('ZDInv5', `zdinv5_${Date.now()}@test.com`);
    const listing = await makeListing(seller.user, 60);
    const r = await request(app).post('/api/inventory/sync')
      .set('Authorization', 'Bearer ' + seller.token)
      .send({ warehouse: 'WH1', items: [{ listingId: listing._id.toString(), quantity: -5 }] });
    expect(r.status).toBe(400);
  });

  test('valid sync for own listing still works (regression guard)', async () => {
    const seller = await makeUser('ZDInv6', `zdinv6_${Date.now()}@test.com`);
    const listing = await makeListing(seller.user, 60);
    const r = await request(app).post('/api/inventory/sync')
      .set('Authorization', 'Bearer ' + seller.token)
      .send({ warehouse: 'WH1', items: [{ listingId: listing._id.toString(), quantity: 4, sku: 'SKU1', location: 'A1' }] });
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBe(true);
  });
});


describe('ZD20 — boost duration is enforced within configured bounds', () => {
  test('negative duration is rejected', async () => {
    const seller = await makeUser('ZDBoost1', `zdboost1_${Date.now()}@test.com`);
    const listing = await makeListing(seller.user, 60);
    const r = await request(app).post(`/api/listings/${listing._id}/boost`)
      .set('Authorization', 'Bearer ' + seller.token)
      .send({ tier: 'standard', durationDays: -5 });
    expect(r.status).toBe(400);
  });

  test('duration beyond the 30-day maximum is rejected', async () => {
    const seller = await makeUser('ZDBoost2', `zdboost2_${Date.now()}@test.com`);
    const listing = await makeListing(seller.user, 60);
    const r = await request(app).post(`/api/listings/${listing._id}/boost`)
      .set('Authorization', 'Bearer ' + seller.token)
      .send({ tier: 'standard', durationDays: 100000 });
    expect(r.status).toBe(400);
  });

  test('non-numeric duration is rejected', async () => {
    const seller = await makeUser('ZDBoost3', `zdboost3_${Date.now()}@test.com`);
    const listing = await makeListing(seller.user, 60);
    const r = await request(app).post(`/api/listings/${listing._id}/boost`)
      .set('Authorization', 'Bearer ' + seller.token)
      .send({ tier: 'standard', durationDays: 'fortnight' });
    expect(r.status).toBe(400);
  });

  test('in-range duration still boosts (regression guard)', async () => {
    const seller = await makeUser('ZDBoost4', `zdboost4_${Date.now()}@test.com`);
    const listing = await makeListing(seller.user, 60);
    const r = await request(app).post(`/api/listings/${listing._id}/boost`)
      .set('Authorization', 'Bearer ' + seller.token)
      .send({ tier: 'standard', durationDays: 14 });
    expect(r.status).toBe(200);
    expect(r.body.boost.active).toBe(true);
  });
});


describe('ZD21 — only the seller (or admin) can process a payout', () => {
  const completeTxn = async (seller, buyer, listing) => {
    const Transaction = require('../models/Transaction');
    return Transaction.create({
      listing: listing._id, buyer: buyer.user._id, seller: seller.user._id,
      itemPrice: 100, currency: 'USD',
      paymentBreakdown: { subtotal: 100, shippingCost: 0, buyerProtectionFee: 0, tax: 0, totalPaid: 100, platformFee: 8, platformFeePercent: 8, shippingPayout: 0, sellerEarnings: 92 },
      status: 'completed',
    });
  };

  test('a random authenticated user cannot process someone else\'s payout', async () => {
    const seller = await makeUser('ZDPay1', `zdpay1_${Date.now()}@test.com`);
    const buyer = await makeUser('ZDPay2', `zdpay2_${Date.now()}@test.com`);
    const attacker = await makeUser('ZDPay3', `zdpay3_${Date.now()}@test.com`);
    const listing = await makeListing(seller.user, 100);
    const txn = await completeTxn(seller, buyer, listing);
    const r = await request(app).post(`/api/payouts/process/${txn._id}`)
      .set('Authorization', 'Bearer ' + attacker.token);
    expect([403, 401]).toContain(r.status);
    const Payout = require('../models/Payout');
    const payout = await Payout.findOne({ transaction: txn._id });
    expect(payout).toBeNull();
  });

  test('the seller can still process their own payout (regression guard)', async () => {
    const seller = await makeUser('ZDPay4', `zdpay4_${Date.now()}@test.com`);
    const buyer = await makeUser('ZDPay5', `zdpay5_${Date.now()}@test.com`);
    const listing = await makeListing(seller.user, 100);
    const txn = await completeTxn(seller, buyer, listing);
    const r = await request(app).post(`/api/payouts/process/${txn._id}`)
      .set('Authorization', 'Bearer ' + seller.token);
    expect(r.status).toBe(201);
    expect(r.body.payout.payoutAmount).toBeGreaterThan(0);
  });
});

describe('ZD22 — closet pagination is clamped (no 500s / unbounded dumps)', () => {
  test('page=0 does not crash', async () => {
    const seller = await makeUser('ZDPage1', `zdpage1_${Date.now()}@test.com`);
    await makeListing(seller.user, 30);
    const r = await request(app).get(`/api/users/${seller.user._id}/closet?page=0&limit=5`);
    expect(r.status).toBe(200);
  });

  test('limit=1000000 is clamped, not honored', async () => {
    const seller = await makeUser('ZDPage2', `zdpage2_${Date.now()}@test.com`);
    for (let i = 0; i < 55; i++) {
      await makeListing(seller.user, 30 + i);
    }
    const r = await request(app).get(`/api/users/${seller.user._id}/closet?page=1&limit=1000000`);
    expect(r.status).toBe(200);
    expect(r.body.listings.length).toBeLessThanOrEqual(50);
  });
});


