/**
 * Revenue integrity after platform-owned EasyPost shipping.
 *
 * These tests pin the money rules that the EasyPost switch introduced:
 *   - a listing-level free-shipping promise is honored even below the
 *     threshold rate table's free-shipping price;
 *   - postage is funded by the buyer's shipping charge first, then the seller,
 *     and an underfunded label is refused;
 *   - cancelling an order requests a carrier refund for the unused label and a
 *     closed order can never buy another one;
 *   - seller earnings quotes never include postage.
 */
const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const app = require('../server');
const authorizedPaymentIntent = require('./helpers/authorizedPayment');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Transaction = require('../models/Transaction');
const Return = require('../models/Return');
const { allocatePostage, requirePostageFunded } = require('../utils/postageFunding');
const { chargeSellerPostage } = require('../utils/balances');
const { labelCostFromFees } = require('../services/easypostService');

const PASS = 'password123';
let seller;
let buyer;
let sellerToken;
let buyerToken;

const createUser = async (name, email) => {
  const user = await User.create({
    name,
    email: email.toLowerCase(),
    password: PASS,
    emailVerified: true,
    authProvider: 'email',
    country: 'US',
    currency: 'USD',
    shippingAddress: {
      fullName: name, street1: '1 Test St', city: 'Austin', state: 'TX',
      postalCode: '78701', country: 'US',
    },
    balance: { available: 0, pending: 0, totalEarned: 0, totalPaidOut: 0, currency: 'USD' },
    stats: {
      totalSales: 0, totalPurchases: 0, totalListings: 0,
      avgRating: 0, ratingCount: 0, responseRate: 100, shipTime: 3, strikes: 0,
    },
  });
  const token = jwt.sign(
    { id: user._id },
    process.env.JWT_SECRET || 'fallback_secret_change_me',
    { expiresIn: '30d' },
  );
  return { user, token };
};

const createListing = (overrides = {}) => Listing.create({
  seller: seller._id,
  title: 'Postage revenue test',
  description: 'Revenue regression listing',
  price: 20,
  category: 'Men',
  condition: 'New with tags',
  available: true,
  sold: false,
  quantity: 1,
  shipsFrom: 'US',
  weight: 2,
  shipping: { domestic: true, international: false, freeShipping: false },
  ...overrides,
});

const buy = (listingId) => request(app)
  .post('/api/transactions')
  .set('Authorization', `Bearer ${buyerToken}`)
  .send({
    paymentIntentId: authorizedPaymentIntent(),
    listingId,
    shippingAddress: {
      fullName: 'Buyer', street1: '456 St', city: 'New York',
      state: 'NY', postalCode: '10001', country: 'US',
    },
    buyerCountry: 'US',
  });

beforeAll(async () => {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/trenddrop_test';
  if (mongoose.connection.readyState === 0) await mongoose.connect(uri);
  await Promise.all([
    User.deleteMany({ email: /postage_revenue_test/ }),
    Listing.deleteMany({ title: 'Postage revenue test' }),
    Transaction.deleteMany({ 'paymentBreakdown.note': 'postage_revenue_test' }),
  ]);
  ({ user: seller, token: sellerToken } = await createUser('PostageSeller', 'seller_postage_revenue_test@test.com'));
  ({ user: buyer, token: buyerToken } = await createUser('PostageBuyer', 'buyer_postage_revenue_test@test.com'));
});

afterAll(async () => {
  await Promise.all([
    User.deleteMany({ email: /postage_revenue_test/ }),
    Listing.deleteMany({ title: 'Postage revenue test' }),
  ]);
});

describe('postage funding allocation', () => {
  test('charges the seller only for postage the buyer shipping charge does not cover', () => {
    const funded = allocatePostage({ labelCost: 8, buyerShipping: 5, sellerEarnings: 10 });
    expect(funded.sellerSubsidy).toBe(3);
    expect(funded.sellerEarningsAfterPostage).toBe(7);
    expect(funded.platformPostageMargin).toBe(0);
    expect(funded.shortfall).toBe(0);
  });

  test('keeps a positive shipping margin when the carrier rate is below the charge', () => {
    const funded = allocatePostage({ labelCost: 5, buyerShipping: 8, sellerEarnings: 10 });
    expect(funded.sellerSubsidy).toBe(0);
    expect(funded.sellerEarningsAfterPostage).toBe(10);
    expect(funded.platformPostageMargin).toBe(3);
  });

  test('actual label cost includes EasyPost insurance fees, not just the rate', () => {
    expect(labelCostFromFees([
      { type: 'PostageFee', amount: '8.20000', charged: true, refunded: false },
      { type: 'InsuranceFee', amount: '1.00000', charged: true, refunded: false },
      { type: 'LabelFee', amount: '0.00000', charged: true, refunded: false },
    ], 8.2)).toBe(9.2);
    // Refunded fees are not a current cost.
    expect(labelCostFromFees([
      { type: 'PostageFee', amount: '8.20000', charged: true, refunded: true },
    ], 8.2)).toBe(8.2);
  });

  test('refuses a label neither the buyer nor the seller can fund', () => {
    expect(() => requirePostageFunded({ labelCost: 25, buyerShipping: 0, sellerEarnings: 10 }))
      .toThrow(/cannot be funded/);
  });

  test('a seller-fault return postage charge can make pending negative so it is not written off', async () => {
    const account = await createUser('PostageDebt', 'debt_postage_revenue_test@test.com');
    await User.updateOne(
      { _id: account.user._id },
      { $set: { 'balance.available': 3, 'balance.pending': 2 } },
    );
    await chargeSellerPostage(account.user._id, 10);
    const after = await User.findById(account.user._id).lean();
    expect(after.balance.available).toBe(0);
    expect(after.balance.pending).toBe(-5);
    await User.deleteOne({ _id: account.user._id });
  });
});

describe('checkout postage revenue', () => {
  test('a free-shipping listing below the threshold charges the buyer no shipping', async () => {
    const listing = await createListing({
      price: 20,
      weight: 2,
      shipping: { domestic: true, international: false, freeShipping: true },
    });
    const res = await buy(listing._id);
    expect(res.status).toBe(201);
    expect(res.body.paymentBreakdown.shippingCost).toBe(0);
    expect(res.body.paymentBreakdown.shippingPayout).toBe(0);
    expect(res.body.paymentBreakdown.sellerEarnings).toBeGreaterThan(0);
    expect(res.body.paymentBreakdown.labelCost).toBe(0);
  });

  test('cancelling a paid order requests a label refund and closes label purchasing', async () => {
    const listing = await createListing();
    const purchased = await buy(listing._id);
    expect(purchased.status).toBe(201);
    const txnId = purchased.body._id || purchased.body.transaction?._id;

    const cancelled = await request(app)
      .post(`/api/orders/${txnId}/cancel`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ reason: 'Postage revenue cleanup' });
    expect(cancelled.status).toBe(200);

    const closed = await Transaction.findById(txnId).lean();
    expect(closed.status).toBe('cancelled_by_buyer');
    expect(closed.shipping.voided).toBe(true);
    expect(closed.shipping.labelRefunded).toBe(true);
    expect(closed.shipping.labelRefundPending).toBe(false);

    const relabel = await request(app)
      .post(`/api/shipping/label/${txnId}`)
      .set('Authorization', `Bearer ${sellerToken}`);
    expect(relabel.status).toBe(409);
    expect(relabel.body.code).toBe('SHIPPING_ORDER_CLOSED');
  });

  test('approving a seller-fault return recovers the outbound label from the seller', async () => {
    const listing = await createListing();
    const purchased = await buy(listing._id);
    expect(purchased.status).toBe(201);
    const txnId = purchased.body._id || purchased.body.transaction?._id;
    await Transaction.updateOne(
      { _id: txnId },
      { $set: { status: 'return_requested', 'shipping.labelCost': 6 } },
    );
    const returnDoc = await Return.create({
      transaction: txnId,
      buyer: buyer._id,
      seller: seller._id,
      listing: listing._id,
      reason: 'Defective',
      returnShippingResponsibility: 'seller',
    });
    const before = await User.findById(seller._id).lean();
    const approved = await request(app)
      .put(`/api/returns/${returnDoc._id}/approve`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({});
    expect(approved.status).toBe(200);
    const after = await User.findById(seller._id).lean();
    expect(Math.round((before.balance.pending - after.balance.pending) * 100) / 100).toBe(6);
    const saved = await Return.findById(returnDoc._id).lean();
    expect(saved.postageChargedToSeller).toBe(6);
  });

  test('a buyer-remorse return withholds the prepaid return label from the refund', async () => {
    const listing = await createListing();
    const purchased = await buy(listing._id);
    expect(purchased.status).toBe(201);
    const txnId = purchased.body._id || purchased.body.transaction?._id;
    await Transaction.updateOne(
      { _id: txnId },
      { $set: { status: 'return_in_transit' } },
    );
    const returnDoc = await Return.create({
      transaction: txnId,
      buyer: buyer._id,
      seller: seller._id,
      listing: listing._id,
      reason: 'Changed mind',
      status: 'shipped',
      returnShippingResponsibility: 'buyer',
      labelCost: 8,
      returnTrackingNumber: 'RETURN123',
    });
    const received = await request(app)
      .put(`/api/returns/${returnDoc._id}/receive`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ inspectionNotes: 'Received' });
    expect(received.status).toBe(200);
    expect(received.body.refundAmount).toBe(12);
  });

  test('the seller earnings quote excludes buyer-paid postage', async () => {
    const res = await request(app)
      .post('/api/shipping/calculate-breakdown')
      .send({ itemPrice: 20, fromCountry: 'US', toCountry: 'US', weightKg: 2, platformFeePercent: 8 });
    expect(res.status).toBe(200);
    expect(res.body.buyer.shippingCost).toBeGreaterThan(0);
    expect(res.body.seller.shippingPayout).toBe(0);
    expect(res.body.seller.sellerEarnings).toBe(18.4);
  });
});
