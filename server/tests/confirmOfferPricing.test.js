/**
 * Money-matrix round 4 — single-item confirm (/api/payments/confirm):
 *
 *  1. OFFER PRICING PARITY: create-intent prices an accepted offer at the
 *     negotiated amount. Confirm used to price from listing.price alone, so
 *     every offer purchase failed the amount gate (or credited list-price
 *     earnings against an offer-price capture). Confirm must record and pay
 *     out at whichever legitimate server-computed price the intent was
 *     actually authorized for.
 *
 *  2. NO-LOSS STRANDED-INTENT GUARD: create-intent authorizes (live Stripe
 *     charges) at creation time. A terminal refusal at confirm must return
 *     the money — but ONLY when the intent funds exactly one unit of exactly
 *     one listing (nothing else could ever consume it). Multi-unit/multi-line
 *     cart intents must be left for confirm-batch.
 *
 *  3. MONEY ZERO-SUM: what the buyer pays splits exactly into seller payout
 *     + shipping pass-through + platform commission + buyer protection.
 */
const mongoose = require('mongoose');
const request = require('supertest');
const app = require('../server');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Transaction = require('../models/Transaction');
const Payout = require('../models/Payout');
const Offer = require('../models/Offer');
const jwt = require('jsonwebtoken');
const { getJwtSecret } = require('../config/security');
const { calculatePaymentBreakdown } = require('../config/payments');

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

const makeListing = (seller, price = 100, extra = {}) => Listing.create({
  title: `ConfirmOffer ${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
  description: 'confirm offer pricing listing',
  price, currency: 'USD', category: 'Men', size: 'M', condition: 'Good',
  images: ['https://example.com/p.jpg'], seller: seller._id, available: true,
  quantity: 10, shipsFrom: 'US', ...extra,
});

const mockIntent = (buyerId, listingIds, { status = 'succeeded', amount = 0, extraMeta = {} } = {}) => {
  const pi = 'pi_confirmoffer_' + Date.now() + Math.random().toString(36).slice(2, 9);
  global.__mockPaymentIntents = global.__mockPaymentIntents || {};
  global.__mockPaymentIntents[pi] = {
    id: pi, status, amount, currency: 'usd',
    metadata: {
      buyerId: buyerId.toString(),
      itemIds: listingIds.join(','),
      totalUnits: '1',
      ...extraMeta,
    },
  };
  return pi;
};

const acceptedOffer = async (buyer, seller, listing, price, extra = {}) => Offer.create({
  listing: listing._id, buyer: buyer.user._id, seller: seller.user._id,
  amount: price, status: 'accepted', acceptedPrice: price,
  acceptedUntil: new Date(Date.now() + 24 * 60 * 60 * 1000), ...extra,
});

const round2 = (n) => Math.round(n * 100) / 100;
const cents = (n) => Math.round(n * 100);

beforeAll(async () => {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/trend-drop-test');
  }
});

describe('MM.1 — offer purchase through single confirm prices and pays out at the OFFER price', () => {
  test('create-intent(offerId) → test-confirm → confirm records/pays the negotiated price with exact zero-sum', async () => {
    const seller = await makeUser('MM1 seller', `mm1_seller_${Date.now()}@test.com`);
    const buyer = await makeUser('MM1 buyer', `mm1_buyer_${Date.now()}@test.com`);
    const listing = await makeListing(seller.user, 80);
    const offer = await acceptedOffer(buyer, seller, listing, 60);

    const created = await request(app).post('/api/payments/create-intent')
      .set('Authorization', `Bearer ${buyer.token}`)
      .send({
        items: [{ listingId: listing._id.toString(), offerId: offer._id.toString() }],
        shippingAddress: { ...US }, buyerCountry: 'US',
      });
    expect(created.status).toBe(200);
    const { paymentIntentId } = created.body;

    const tc = await request(app).post('/api/payments/test-confirm')
      .set('Authorization', `Bearer ${buyer.token}`)
      .send({ paymentIntentId });
    expect(tc.status).toBe(200);

    const sellerBefore = (await User.findById(seller.user._id)).balance?.pending || 0;

    const res = await request(app).post('/api/payments/confirm')
      .set('Authorization', `Bearer ${buyer.token}`)
      .send({ paymentIntentId, listingId: listing._id.toString(), shippingAddress: { ...US } });

    expect(res.status).toBe(200);
    const tx = res.body.transaction;

    // The negotiated price is the sale price — never list price
    expect(tx.itemPrice).toBe(60);

    // Independent policy oracle for the same sale
    const bd = calculatePaymentBreakdown(60, 'US', 'US', 0.5);
    expect(tx.paymentBreakdown.subtotal).toBe(60);
    expect(tx.paymentBreakdown.shippingCost).toBe(bd.buyer.shippingCost);
    expect(tx.paymentBreakdown.buyerProtectionFee).toBe(bd.buyer.buyerProtectionFee);
    expect(tx.paymentBreakdown.platformFee).toBe(bd.seller.platformFee);
    expect(tx.paymentBreakdown.totalPaid).toBe(bd.buyer.totalPaid);

    // Fee policy: 8% platform (clamped), 5% buyer protection on item price
    expect(tx.paymentBreakdown.platformFee).toBe(round2(60 * 0.08));
    expect(tx.paymentBreakdown.buyerProtectionFee).toBe(round2(60 * 0.05));
    expect(tx.paymentBreakdown.platformFeePercent).toBe(8);
    expect(tx.paymentBreakdown.buyerProtectionPercent).toBe(5);

    // ZERO-SUM: buyer pays exactly seller payout + shipping + commission + protection
    const pb = tx.paymentBreakdown;
    expect(round2(pb.sellerEarnings + pb.shippingPayout + pb.platformFee + pb.buyerProtectionFee))
      .toBe(round2(pb.totalPaid));
    expect(pb.sellerEarnings).toBe(round2(60 - pb.platformFee));
    expect(pb.shippingPayout).toBe(pb.shippingCost);

    // Payout row mirrors the transaction exactly
    const payout = await Payout.findOne({ paymentIntentId });
    expect(payout).toBeTruthy();
    expect(payout.salePrice).toBe(60);
    expect(payout.commissionAmount).toBe(pb.platformFee);
    expect(payout.payoutAmount).toBe(pb.sellerEarnings);

    // Seller is credited exactly the recorded earnings
    const sellerAfter = (await User.findById(seller.user._id)).balance?.pending || 0;
    expect(round2(sellerAfter - sellerBefore)).toBe(round2(pb.sellerEarnings));

    // The negotiated deal is consumed exactly once
    const offerAfter = await Offer.findById(offer._id);
    expect(offerAfter.status).toBe('completed');
    expect(String(offerAfter.transaction)).toBe(String(tx._id));
  });
});

describe('MM.2 — regression: a LIST-priced intent still records at list price even when an accepted offer exists', () => {
  test('the exact-cent authorization match prefers the price the buyer actually authorized', async () => {
    const seller = await makeUser('MM2 seller', `mm2_seller_${Date.now()}@test.com`);
    const buyer = await makeUser('MM2 buyer', `mm2_buyer_${Date.now()}@test.com`);
    const listing = await makeListing(seller.user, 100);
    await acceptedOffer(buyer, seller, listing, 60); // stale/unused accepted offer

    const bd = calculatePaymentBreakdown(100, 'US', 'US', 0.5);
    const pi = mockIntent(buyer.user._id, [listing._id.toString()], {
      status: 'requires_capture', amount: cents(bd.buyer.totalPaid),
    });

    const res = await request(app).post('/api/payments/confirm')
      .set('Authorization', `Bearer ${buyer.token}`)
      .send({ paymentIntentId: pi, listingId: listing._id.toString(), shippingAddress: { ...US } });

    expect(res.status).toBe(200);
    expect(res.body.transaction.itemPrice).toBe(100);
    expect(res.body.transaction.paymentBreakdown.totalPaid).toBe(bd.buyer.totalPaid);
  });
});

describe('MM.3 — an expired accepted offer can never fund a purchase; the money is returned', () => {
  test('offer-priced intent + expired deal → 400, payment released, no transaction', async () => {
    const seller = await makeUser('MM3 seller', `mm3_seller_${Date.now()}@test.com`);
    const buyer = await makeUser('MM3 buyer', `mm3_buyer_${Date.now()}@test.com`);
    const listing = await makeListing(seller.user, 80);
    await acceptedOffer(buyer, seller, listing, 60, {
      acceptedUntil: new Date(Date.now() - 60 * 60 * 1000), // expired 1h ago
    });

    const offerBd = calculatePaymentBreakdown(60, 'US', 'US', 0.5);
    const pi = mockIntent(buyer.user._id, [listing._id.toString()], {
      status: 'succeeded', amount: cents(offerBd.buyer.totalPaid),
    });

    const res = await request(app).post('/api/payments/confirm')
      .set('Authorization', `Bearer ${buyer.token}`)
      .send({ paymentIntentId: pi, listingId: listing._id.toString(), shippingAddress: { ...US } });

    expect(res.status).toBe(400);
    expect(res.body.paymentReleased).toBe(true);
    expect(await Transaction.countDocuments({ 'paymentBreakdown.paymentIntentId': pi })).toBe(0);
    expect(['refunded', 'canceled', 'cancelled']).toContain(global.__mockPaymentIntents[pi].status);
  });
});

describe('MM.4/5 — the stranded-intent void only fires for single-unit single-listing intents', () => {
  test('MM.4 multi-unit cart intent is never voided by single confirm (confirm-batch owns it)', async () => {
    const seller = await makeUser('MM4 seller', `mm4_seller_${Date.now()}@test.com`);
    const buyer = await makeUser('MM4 buyer', `mm4_buyer_${Date.now()}@test.com`);
    const listing = await makeListing(seller.user, 100);
    const pi = mockIntent(buyer.user._id, [listing._id.toString()], {
      status: 'succeeded', amount: 100, // under-authorized → terminal mismatch
      extraMeta: { totalUnits: '2' },
    });

    const res = await request(app).post('/api/payments/confirm')
      .set('Authorization', `Bearer ${buyer.token}`)
      .send({ paymentIntentId: pi, listingId: listing._id.toString(), shippingAddress: { ...US } });

    expect(res.status).toBe(400);
    expect(res.body.paymentReleased).toBe(false);
    // untouched: confirm-batch can still fulfil or release this intent
    expect(global.__mockPaymentIntents[pi].status).toBe('succeeded');
  });

  test('MM.5 the same under-authorized INTENT for one unit IS returned to the buyer', async () => {
    const seller = await makeUser('MM5 seller', `mm5_seller_${Date.now()}@test.com`);
    const buyer = await makeUser('MM5 buyer', `mm5_buyer_${Date.now()}@test.com`);
    const listing = await makeListing(seller.user, 100);
    const pi = mockIntent(buyer.user._id, [listing._id.toString()], {
      status: 'succeeded', amount: 100, // terminal: nothing can consume this
    });

    const res = await request(app).post('/api/payments/confirm')
      .set('Authorization', `Bearer ${buyer.token}`)
      .send({ paymentIntentId: pi, listingId: listing._id.toString(), shippingAddress: { ...US } });

    expect(res.status).toBe(400);
    expect(res.body.paymentReleased).toBe(true);
    expect(await Transaction.countDocuments({ 'paymentBreakdown.paymentIntentId': pi })).toBe(0);
    expect(global.__mockPaymentIntents[pi].status).toBe('refunded');
  });

  test('MM.5b a held authorization (requires_capture) is RELEASED, not refunded', async () => {
    const seller = await makeUser('MM5b seller', `mm5b_seller_${Date.now()}@test.com`);
    const buyer = await makeUser('MM5b buyer', `mm5b_buyer_${Date.now()}@test.com`);
    const listing = await makeListing(seller.user, 100);
    const pi = mockIntent(buyer.user._id, [listing._id.toString()], {
      status: 'requires_capture', amount: 100,
    });

    const res = await request(app).post('/api/payments/confirm')
      .set('Authorization', `Bearer ${buyer.token}`)
      .send({ paymentIntentId: pi, listingId: listing._id.toString(), shippingAddress: { ...US } });

    expect(res.status).toBe(400);
    expect(res.body.paymentReleased).toBe(true);
    expect(global.__mockPaymentIntents[pi].status).toBe('canceled');
    expect(global.__mockRefunds?.[pi]).toBeFalsy();
  });
});

describe('MM.6 — sold out at confirm time returns the money too', () => {
  test('a taken payment for a now-sold listing is released, not stranded', async () => {
    const seller = await makeUser('MM6 seller', `mm6_seller_${Date.now()}@test.com`);
    const buyer = await makeUser('MM6 buyer', `mm6_buyer_${Date.now()}@test.com`);
    const listing = await makeListing(seller.user, 100, { sold: true, available: false });
    const pi = mockIntent(buyer.user._id, [listing._id.toString()], {
      status: 'succeeded', amount: 20000,
    });

    const res = await request(app).post('/api/payments/confirm')
      .set('Authorization', `Bearer ${buyer.token}`)
      .send({ paymentIntentId: pi, listingId: listing._id.toString(), shippingAddress: { ...US } });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Item sold out');
    expect(res.body.paymentReleased).toBe(true);
    expect(await Transaction.countDocuments({ 'paymentBreakdown.paymentIntentId': pi })).toBe(0);
    expect(global.__mockPaymentIntents[pi].status).toBe('refunded');
  });

  test('a legacy intent without totalUnits metadata is refused but never auto-voided', async () => {
    const seller = await makeUser('MM6b seller', `mm6b_seller_${Date.now()}@test.com`);
    const buyer = await makeUser('MM6b buyer', `mm6b_buyer_${Date.now()}@test.com`);
    const listing = await makeListing(seller.user, 100, { sold: true, available: false });
    const pi = mockIntent(buyer.user._id, [listing._id.toString()], {
      status: 'succeeded', amount: 20000, extraMeta: { totalUnits: undefined },
    });
    delete global.__mockPaymentIntents[pi].metadata.totalUnits;

    const res = await request(app).post('/api/payments/confirm')
      .set('Authorization', `Bearer ${buyer.token}`)
      .send({ paymentIntentId: pi, listingId: listing._id.toString(), shippingAddress: { ...US } });

    expect(res.status).toBe(400);
    expect(res.body.paymentReleased).toBe(false);
    expect(global.__mockPaymentIntents[pi].status).toBe('succeeded');
  });
});

describe('MM.7 — create-intent stamps totalUnits (the void-safety contract)', () => {
  test('one unit and two units are distinguishable from intent metadata', async () => {
    const seller = await makeUser('MM7 seller', `mm7_seller_${Date.now()}@test.com`);
    const buyer = await makeUser('MM7 buyer', `mm7_buyer_${Date.now()}@test.com`);
    const listing = await makeListing(seller.user, 30);

    const one = await request(app).post('/api/payments/create-intent')
      .set('Authorization', `Bearer ${buyer.token}`)
      .send({ items: [{ listingId: listing._id.toString(), quantity: 1 }], shippingAddress: { ...US }, buyerCountry: 'US' });
    expect(one.status).toBe(200);
    expect(global.__mockPaymentIntents[one.body.paymentIntentId].metadata.totalUnits).toBe('1');

    const two = await request(app).post('/api/payments/create-intent')
      .set('Authorization', `Bearer ${buyer.token}`)
      .send({ items: [{ listingId: listing._id.toString(), quantity: 2 }], shippingAddress: { ...US }, buyerCountry: 'US' });
    expect(two.status).toBe(200);
    expect(global.__mockPaymentIntents[two.body.paymentIntentId].metadata.totalUnits).toBe('2');
  });
});

describe('MM.9 — the shipping label reimbursement reaches the seller', () => {
  test('a paid-shipping sale credits earnings + shippingPayout (the buyer paid both)', async () => {
    const seller = await makeUser('MM9 seller', `mm9_seller_${Date.now()}@test.com`);
    const buyer = await makeUser('MM9 buyer', `mm9_buyer_${Date.now()}@test.com`);
    // $20 is below the $50 domestic free-shipping threshold → shipping charged
    const listing = await makeListing(seller.user, 20);
    const bd = calculatePaymentBreakdown(20, 'US', 'US', 0.5);
    expect(bd.buyer.shippingCost).toBeGreaterThan(0);

    const pi = mockIntent(buyer.user._id, [listing._id.toString()], {
      status: 'requires_capture', amount: cents(bd.buyer.totalPaid),
    });
    const sellerBefore = (await User.findById(seller.user._id)).balance?.pending || 0;

    const res = await request(app).post('/api/payments/confirm')
      .set('Authorization', `Bearer ${buyer.token}`)
      .send({ paymentIntentId: pi, listingId: listing._id.toString(), shippingAddress: { ...US } });

    expect(res.status).toBe(200);
    const pb = res.body.transaction.paymentBreakdown;
    const sellerAfter = (await User.findById(seller.user._id)).balance?.pending || 0;
    const credited = round2(sellerAfter - sellerBefore);

    // The seller receives earnings + the label-cost reimbursement the buyer
    // paid — never just the earnings leg (that stranded the shipping money).
    expect(pb.shippingPayout).toBe(bd.buyer.shippingCost);
    expect(credited).toBe(round2(pb.sellerEarnings + pb.shippingPayout));
    expect(credited).toBe(round2(bd.seller.sellerEarnings + bd.buyer.shippingCost));
    // The row stamps the credited amount so every later release/clawback is
    // symmetric with this credit.
    expect(pb.sellerCredit).toBe(round2(pb.sellerEarnings + pb.shippingPayout));
  });
});

describe('MM.10 — sellerSaleTotal: one amount for credit, release and clawback', () => {
  const { sellerSaleTotal } = require('../utils/balances');

  test('stamped rows move exactly what the sale credited', () => {
    expect(sellerSaleTotal({
      subtotal: 20, platformFee: 1.6, boostFee: 0, shippingPayout: 4.39, sellerEarnings: 18.4, sellerCredit: 22.79,
    })).toBe(22.79);
  });

  test('historic rows move raw sellerEarnings — exactly what they were credited', () => {
    // Pre-fix shape A row: the sale credited only the earnings leg (the old
    // bug) — reversals must match the credit, never invent the missing 4.39.
    expect(sellerSaleTotal({
      subtotal: 20, platformFee: 1.6, boostFee: 0, shippingPayout: 4.39, sellerEarnings: 18.4,
    })).toBe(18.4);
    // Pre-fix shape B row: shipping already folded into sellerEarnings.
    expect(sellerSaleTotal({
      subtotal: 20, platformFee: 1.6, boostFee: 0, shippingPayout: 4.39, sellerEarnings: 22.79,
    })).toBe(22.79);
  });

  test('a zero credit is a stamp, not a missing one', () => {
    expect(sellerSaleTotal({ subtotal: 20, platformFee: 20, shippingPayout: 4.39, sellerEarnings: 0, sellerCredit: 0 })).toBe(0);
  });

  test('rows without any breakdown move nothing', () => {
    expect(sellerSaleTotal(undefined)).toBe(0);
    expect(sellerSaleTotal(null)).toBe(0);
  });
});

describe('MM.8 — multi-unit confirm never over-charges (capture capped at the order total)', () => {
  test('an over-authorized intent captures only what the order charges', async () => {
    const seller = await makeUser('MM8 seller', `mm8_seller_${Date.now()}@test.com`);
    const buyer = await makeUser('MM8 buyer', `mm8_buyer_${Date.now()}@test.com`);
    const listing = await makeListing(seller.user, 40);
    const bd = calculatePaymentBreakdown(40, 'US', 'US', 0.5);

    const pi = mockIntent(buyer.user._id, [listing._id.toString()], {
      status: 'requires_capture', amount: 45000, // $450 hold for a ~$42 order
    });

    const res = await request(app).post('/api/payments/confirm')
      .set('Authorization', `Bearer ${buyer.token}`)
      .send({ paymentIntentId: pi, listingId: listing._id.toString(), shippingAddress: { ...US } });

    expect(res.status).toBe(200);
    const tx = res.body.transaction;
    expect(tx.paymentBreakdown.totalPaid).toBe(bd.buyer.totalPaid);
    // The order total is what the seller/platform accounting is built on —
    // the extra authorization headroom is never booked as revenue.
    expect(round2(tx.paymentBreakdown.sellerEarnings + tx.paymentBreakdown.shippingPayout
      + tx.paymentBreakdown.platformFee + tx.paymentBreakdown.buyerProtectionFee))
      .toBe(round2(tx.paymentBreakdown.totalPaid));
  });
});
