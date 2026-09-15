const mongoose = require('mongoose');
const request = require('supertest');
const app = require('../server');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Transaction = require('../models/Transaction');
const Auction = require('../models/Auction');
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
  title: `ZeroDefect ${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
  description: 'Zero-defect sweep listing',
  price, currency: 'USD', category: 'Men', size: 'M', condition: 'New with tags',
  images: ['https://example.com/p.jpg'], seller: seller._id, available: true,
  quantity: 5, shipsFrom: 'US',
});

const authorizedPaymentIntent = () => {
  const pi = 'pi_mock_' + Date.now() + Math.random().toString(36).slice(2, 9);
  global.__mockPaymentIntents = global.__mockPaymentIntents || {};
  global.__mockPaymentIntents[pi] = { id: pi, status: 'succeeded', amount: 20000, currency: 'usd', metadata: {} };
  return pi;
};

const buyOne = async (buyerToken, listing) => {
  const r = await request(app).post('/api/transactions')
    .set('Authorization', 'Bearer ' + buyerToken)
    .send({ paymentIntentId: authorizedPaymentIntent(), listingId: listing._id, shippingAddress: { ...US }, buyerCountry: 'US' });
  expect(r.status).toBe(201);
  return r.body;
};

beforeAll(async () => {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/trend-drop-test');
  }
});

describe('ZD1 — loyalty /earn must not accept arbitrary client-supplied amounts', () => {
  test('negative amount is rejected', async () => {
    const u = await makeUser('ZDLoy1', `zdloy1_${Date.now()}@test.com`);
    const r = await request(app).post('/api/loyalty/earn')
      .set('Authorization', 'Bearer ' + u.token)
      .send({ amount: -1000000, reason: 'hax' });
    expect(r.status).toBe(400);
  });

  test('unbounded huge amount is rejected', async () => {
    const u = await makeUser('ZDLoy2', `zdloy2_${Date.now()}@test.com`);
    const r = await request(app).post('/api/loyalty/earn')
      .set('Authorization', 'Bearer ' + u.token)
      .send({ amount: 1000000000, reason: 'hax' });
    expect(r.status).toBe(400);
  });

  test('missing reason is rejected', async () => {
    const u = await makeUser('ZDLoy3', `zdloy3_${Date.now()}@test.com`);
    const r = await request(app).post('/api/loyalty/earn')
      .set('Authorization', 'Bearer ' + u.token)
      .send({ amount: 10 });
    expect(r.status).toBe(400);
  });

  test('unknown reason is rejected', async () => {
    const u = await makeUser('ZDLoy4', `zdloy4_${Date.now()}@test.com`);
    const r = await request(app).post('/api/loyalty/earn')
      .set('Authorization', 'Bearer ' + u.token)
      .send({ amount: 10, reason: 'definitely-not-a-real-reason' });
    expect(r.status).toBe(400);
  });
});


describe('ZD2 — referral self-use and double-claim', () => {
  test('a user cannot apply their own referral code', async () => {
    const u = await makeUser('ZDRef1', `zdref1_${Date.now()}@test.com`);
    const g = await request(app).post('/api/referrals/generate')
      .set('Authorization', 'Bearer ' + u.token).send({});
    const code = g.body.referral.code;
    const r = await request(app).post('/api/referrals/apply')
      .send({ code, userId: u.user._id.toString() });
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).toMatch(/own/i);
  });

  test('referral reward cannot be claimed twice', async () => {
    const referrer = await makeUser('ZDRef2', `zdref2_${Date.now()}@test.com`);
    const g = await request(app).post('/api/referrals/generate')
      .set('Authorization', 'Bearer ' + referrer.token).send({});
    const code = g.body.referral.code;
    const referred = await makeUser('ZDRef3', `zdref3_${Date.now()}@test.com`);
    const a = await request(app).post('/api/referrals/apply')
      .send({ code, userId: referred.user._id.toString() });
    expect(a.status).toBe(200);
    const c1 = await request(app).post('/api/referrals/claim')
      .set('Authorization', 'Bearer ' + referrer.token).send({});
    expect(c1.status).toBe(200);
    const c2 = await request(app).post('/api/referrals/claim')
      .set('Authorization', 'Bearer ' + referrer.token).send({});
    expect(c2.status).toBe(400);
    expect(JSON.stringify(c2.body)).toMatch(/already|claimed/i);
  });
});

describe('ZD3 — ratings only for completed purchases and valid range', () => {
  test('cannot review an order that is not completed', async () => {
    const seller = await makeUser('ZDRat1', `zdrat1_${Date.now()}@test.com`);
    const buyer = await makeUser('ZDRat2', `zdrat2_${Date.now()}@test.com`);
    const listing = await makeListing(seller.user, 50);
    const txn = await buyOne(buyer.token, listing);
    expect(txn.status).not.toBe('completed');
    const r = await request(app).post('/api/ratings')
      .set('Authorization', 'Bearer ' + buyer.token)
      .send({ listingId: listing._id.toString(), rating: 5, review: 'great' });
    expect(r.status).toBe(400);
  });

  test('out-of-range rating is rejected with 400 (not 500)', async () => {
    const seller = await makeUser('ZDRat3', `zdrat3_${Date.now()}@test.com`);
    const buyer = await makeUser('ZDRat4', `zdrat4_${Date.now()}@test.com`);
    const listing = await makeListing(seller.user, 50);
    const txn = await buyOne(buyer.token, listing);
    await Transaction.findByIdAndUpdate(txn._id, { status: 'completed' });
    const r = await request(app).post('/api/ratings')
      .set('Authorization', 'Bearer ' + buyer.token)
      .send({ listingId: listing._id.toString(), rating: 99, review: 'x' });
    expect(r.status).toBe(400);
  });
});

describe('ZD4 — auction close is idempotent', () => {
  test('closing an already-closed auction returns 400, not success', async () => {
    const seller = await makeUser('ZDAuc1', `zdauc1_${Date.now()}@test.com`);
    const listing = await makeListing(seller.user, 80);
    const now = Date.now();
    const auction = await Auction.create({
      listing: listing._id, seller: seller.user._id,
      startTime: new Date(now - 7200 * 1000), endTime: new Date(now - 3600 * 1000),
      reservePrice: 10, currency: 'USD', currentBid: 0, status: 'active', bids: [],
    });
    const c1 = await request(app).post(`/api/auctions/${auction._id}/close`)
      .set('Authorization', 'Bearer ' + seller.token).send({});
    expect(c1.status).toBe(200);
    const countAfterFirst = await Transaction.countDocuments({ auction: auction._id });
    const c2 = await request(app).post(`/api/auctions/${auction._id}/close`)
      .set('Authorization', 'Bearer ' + seller.token).send({});
    expect(c2.status).toBe(400);
    expect(JSON.stringify(c2.body)).toMatch(/already|closed/i);
    const countAfterSecond = await Transaction.countDocuments({ auction: auction._id });
    expect(countAfterSecond).toBe(countAfterFirst);
  }, 30000);
});

describe('ZD5 — escrow amount must match the transaction value', () => {
  test('escrow amount diverging from totalPaid is rejected', async () => {
    const seller = await makeUser('ZDEsc1', `zdesc1_${Date.now()}@test.com`);
    const buyer = await makeUser('ZDEsc2', `zdesc2_${Date.now()}@test.com`);
    const listing = await makeListing(seller.user, 600);
    const txn = await buyOne(buyer.token, listing);
    const totalPaid = txn.paymentBreakdown.totalPaid;
    expect(totalPaid).toBeGreaterThan(500);
    const r = await request(app).post('/api/escrow/initiate')
      .set('Authorization', 'Bearer ' + buyer.token)
      .send({ transactionId: txn._id, amount: totalPaid + 50 });
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).toMatch(/match/i);
  });

  test('escrow succeeds when amount matches totalPaid (regression guard)', async () => {
    const seller = await makeUser('ZDEsc3', `zdesc3_${Date.now()}@test.com`);
    const buyer = await makeUser('ZDEsc4', `zdesc4_${Date.now()}@test.com`);
    const listing = await makeListing(seller.user, 600);
    const txn = await buyOne(buyer.token, listing);
    const totalPaid = txn.paymentBreakdown.totalPaid;
    expect(totalPaid).toBeGreaterThan(500);
    const r = await request(app).post('/api/escrow/initiate')
      .set('Authorization', 'Bearer ' + buyer.token)
      .send({ transactionId: txn._id, amount: totalPaid });
    expect(r.status).toBe(200);
    expect(r.body.transaction.escrow.status).toBe('active');
  });
});

describe('ZD8 — offer counters must be positive (no zero/negative counters)', () => {
  const makeOffer = async (buyerToken, listing, amount) => {
    const r = await request(app).post('/api/offers')
      .set('Authorization', 'Bearer ' + buyerToken)
      .send({ listingId: listing._id.toString(), amount });
    expect(r.status).toBe(201);
    return r.body.offer || r.body;
  };

  test('seller counter of zero is rejected', async () => {
    const seller = await makeUser('ZDOffer1', `zdoffer1_${Date.now()}@test.com`);
    const buyer = await makeUser('ZDOffer2', `zdoffer2_${Date.now()}@test.com`);
    const listing = await makeListing(seller.user, 100);
    const offer = await makeOffer(buyer.token, listing, 60);
    const r = await request(app).patch(`/api/offers/${offer._id}/counter`)
      .set('Authorization', 'Bearer ' + seller.token)
      .send({ counterAmount: 0 });
    expect(r.status).toBe(400);
  });

  test('seller counter below buyer offer is rejected', async () => {
    const seller = await makeUser('ZDOffer3', `zdoffer3_${Date.now()}@test.com`);
    const buyer = await makeUser('ZDOffer4', `zdoffer4_${Date.now()}@test.com`);
    const listing = await makeListing(seller.user, 100);
    const offer = await makeOffer(buyer.token, listing, 60);
    const r = await request(app).patch(`/api/offers/${offer._id}/counter`)
      .set('Authorization', 'Bearer ' + seller.token)
      .send({ counterAmount: 10 });
    expect(r.status).toBe(400);
  });
});

describe('ZD9 — loyalty redeem guards (no negative or over-balance redemption)', () => {
  test('redeeming a negative amount is rejected', async () => {
    const u = await makeUser('ZDRedeem1', `zdredeem1_${Date.now()}@test.com`);
    await request(app).post('/api/loyalty/earn')
      .set('Authorization', 'Bearer ' + u.token)
      .send({ purchaseAmount: 200, reason: 'purchase' });
    const r = await request(app).post('/api/loyalty/redeem')
      .set('Authorization', 'Bearer ' + u.token)
      .send({ amount: -500 });
    expect(r.status).toBe(400);
  });

  test('redeeming more than the balance is rejected', async () => {
    const u = await makeUser('ZDRedeem2', `zdredeem2_${Date.now()}@test.com`);
    await request(app).post('/api/loyalty/earn')
      .set('Authorization', 'Bearer ' + u.token)
      .send({ purchaseAmount: 50, reason: 'purchase' });
    const r = await request(app).post('/api/loyalty/redeem')
      .set('Authorization', 'Bearer ' + u.token)
      .send({ amount: 999999 });
    expect(r.status).toBe(400);
  });
});


describe('ZD10 — suspended users are locked out at the auth gate', () => {
  test('suspended user token is rejected with 403', async () => {
    const u = await makeUser('ZDSus1', `zdsus1_${Date.now()}@test.com`);
    u.user.role = 'suspended';
    await u.user.save();
    const r = await request(app).get('/api/loyalty/')
      .set('Authorization', 'Bearer ' + u.token);
    expect(r.status).toBe(403);
    expect(JSON.stringify(r.body)).toMatch(/suspend/i);
  });

  test('active user still passes the gate (regression guard)', async () => {
    const u = await makeUser('ZDSus2', `zdsus2_${Date.now()}@test.com`);
    const r = await request(app).get('/api/loyalty/')
      .set('Authorization', 'Bearer ' + u.token);
    expect(r.status).toBe(200);
  });
});

describe('ZD11 — offer amounts cannot exceed the listing price by an absurd margin', () => {
  test('offer of 100x listing price is rejected', async () => {
    const seller = await makeUser('ZDOffer1', `zdoffer1_${Date.now()}@test.com`);
    const buyer = await makeUser('ZDOffer2', `zdoffer2_${Date.now()}@test.com`);
    const listing = await makeListing(seller.user, 50);
    const r = await request(app).post('/api/offers')
      .set('Authorization', 'Bearer ' + buyer.token)
      .send({ listingId: listing._id.toString(), amount: 5000 });
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).toMatch(/exceed/i);
  });

  test('offer at listing price still succeeds (regression guard)', async () => {
    const seller = await makeUser('ZDOffer3', `zdoffer3_${Date.now()}@test.com`);
    const buyer = await makeUser('ZDOffer4', `zdoffer4_${Date.now()}@test.com`);
    const listing = await makeListing(seller.user, 50);
    const r = await request(app).post('/api/offers')
      .set('Authorization', 'Bearer ' + buyer.token)
      .send({ listingId: listing._id.toString(), amount: 45 });
    expect(r.status).toBe(201);
  });
});

describe('ZD12 — message text is bounded', () => {
  test('10KB message body is rejected with 400 (not persisted)', async () => {
    const a = await makeUser('ZDMsg1', `zdmsg1_${Date.now()}@test.com`);
    const b = await makeUser('ZDMsg2', `zdmsg2_${Date.now()}@test.com`);
    const listing = await makeListing(a.user, 50);
    const r = await request(app).post('/api/messages')
      .set('Authorization', 'Bearer ' + b.token)
      .send({ listingId: listing._id.toString(), sellerId: a.user._id.toString(), text: 'x'.repeat(10240) });
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).toMatch(/long|length|characters/i);
  });
});

describe('ZD13 — admin cannot demote themselves (lockout guard)', () => {
  test('admin demoting their own account is rejected', async () => {
    const admin = await makeUser('ZDAdm1', `zdadm1_${Date.now()}@test.com`);
    admin.user.role = 'admin';
    await admin.user.save();
    const target = await makeUser('ZDAdm2', `zdadm2_${Date.now()}@test.com`);
    void target;
    const r = await request(app).put(`/api/admin/users/${admin.user._id}/role`)
      .set('Authorization', 'Bearer ' + admin.token)
      .send({ role: 'user' });
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).toMatch(/own|self|demote/i);
    const fresh = await User.findById(admin.user._id);
    expect(fresh.role).toBe('admin');
  });
});

describe('ZD14 — no second spend of the same loyalty points (redeem validation)', () => {
  test('negative redeem mints points instead of spending them', async () => {
    const u = await makeUser('ZDLoyR1', `zdloyr1_${Date.now()}@test.com`);
    const earn = await request(app).post('/api/loyalty/earn')
      .set('Authorization', 'Bearer ' + u.token)
      .send({ reason: 'signup' });
    expect(earn.status).toBe(200);
    const before = earn.body.points;
    const r = await request(app).post('/api/loyalty/redeem')
      .set('Authorization', 'Bearer ' + u.token)
      .send({ amount: -100 });
    expect(r.status).toBe(400);
    const after = await request(app).get('/api/loyalty')
      .set('Authorization', 'Bearer ' + u.token);
    expect(after.body.points).toBe(before);
  });

  test('zero and non-numeric redeem amounts are rejected', async () => {
    const u = await makeUser('ZDLoyR2', `zdloyr2_${Date.now()}@test.com`);
    await request(app).post('/api/loyalty/earn')
      .set('Authorization', 'Bearer ' + u.token)
      .send({ reason: 'signup' });
    for (const amount of [0, 'lots', NaN]) {
      const r = await request(app).post('/api/loyalty/redeem')
        .set('Authorization', 'Bearer ' + u.token)
        .send({ amount });
      expect(r.status).toBe(400);
    }
  });
});

describe('ZD15 — cart quantity must be a positive integer within stock', () => {
  test('zero, negative and fractional quantities are rejected', async () => {
    const seller = await makeUser('ZDCart1', `zdcart1_${Date.now()}@test.com`);
    const buyer = await makeUser('ZDCart2', `zdcart2_${Date.now()}@test.com`);
    const listing = await makeListing(seller.user, 50);
    for (const quantity of [0, -2, 1.5]) {
      const r = await request(app).post('/api/cart/items')
        .set('Authorization', 'Bearer ' + buyer.token)
        .send({ listingId: listing._id.toString(), quantity });
      expect(r.status).toBe(400);
    }
  });

  test('quantity above stock is rejected', async () => {
    const seller = await makeUser('ZDCart3', `zdcart3_${Date.now()}@test.com`);
    const buyer = await makeUser('ZDCart4', `zdcart4_${Date.now()}@test.com`);
    const listing = await makeListing(seller.user, 50);
    const r = await request(app).post('/api/cart/items')
      .set('Authorization', 'Bearer ' + buyer.token)
      .send({ listingId: listing._id.toString(), quantity: 9999 });
    expect(r.status).toBe(400);
  });
});

describe('ZD16 — bids must be finite numbers above current bid', () => {
  test('string bid that coerces below minimum must not be stored', async () => {
    const seller = await makeUser('ZDBid1', `zdbid1_${Date.now()}@test.com`);
    const bidder = await makeUser('ZDBid2', `zdbid2_${Date.now()}@test.com`);
    const listing = await makeListing(seller.user, 80);
    const now = Date.now();
    const auction = await Auction.create({
      listing: listing._id, seller: seller.user._id,
      startTime: new Date(now - 3600 * 1000), endTime: new Date(now + 3600 * 1000),
      reservePrice: 10, currency: 'USD', currentBid: 50, status: 'active', bids: [],
    });
    const before = auction.currentBid;
    const r = await request(app).post(`/api/auctions/${auction._id}/bids`)
      .set('Authorization', 'Bearer ' + bidder.token)
      .send({ amount: 'not-a-number' });
    expect(r.status).toBe(400);
    const reloaded = await Auction.findById(auction._id);
    expect(reloaded.currentBid).toBe(before);
    expect(reloaded.bids).toHaveLength(0);
  });
});

describe('ZD17 — bulk/offer discounts can never drive a price below $1', () => {
  test('percentage above 100 is rejected, not applied', async () => {
    const seller = await makeUser('ZDDisc1', `zddisc1_${Date.now()}@test.com`);
    const listing = await makeListing(seller.user, 50);
    const r = await request(app).post('/api/offers/to-likers')
      .set('Authorization', 'Bearer ' + seller.token)
      .send({ listingId: listing._id.toString(), discountType: 'percentage', discountValue: 150 });
    expect(r.status).toBe(400);
    const reloaded = await Listing.findById(listing._id);
    expect(Number(reloaded.price)).toBe(50);
  });

  test('fixed discount larger than the price is rejected, not applied', async () => {
    const seller = await makeUser('ZDDisc2', `zddisc2_${Date.now()}@test.com`);
    const listing = await makeListing(seller.user, 50);
    const r = await request(app).post('/api/offers/to-likers')
      .set('Authorization', 'Bearer ' + seller.token)
      .send({ listingId: listing._id.toString(), discountType: 'fixed', discountValue: 9999 });
    expect(r.status).toBe(400);
  });
});