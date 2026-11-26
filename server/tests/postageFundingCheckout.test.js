/**
 * Integration proof for platform postage funding with a REAL non-zero label
 * cost. The normal mock provider charges $0, which would hide the leak where a
 * free-shipping sale left TrendDrop paying postage out of platform revenue.
 */
jest.mock('../services/easypostService', () => {
  const actual = jest.requireActual('../services/easypostService');
  const label = (cost) => ({
    trackingNumber: 'EZPOSTAGEFUND001',
    carrier: 'USPS',
    carrierCode: 'USPS',
    service: 'Ground Advantage',
    trackingUrl: 'https://easypost.test/track',
    labelUrl: 'https://easypost.test/label.pdf',
    labelPdfUrl: 'https://easypost.test/label.pdf',
    cost,
    provider: 'easypost',
    shipmentId: 'shp_postage_funding_test',
    rateId: 'rate_postage_funding_test',
    trackerId: 'trk_postage_funding_test',
    estimatedDelivery: new Date(Date.now() + 5 * 86400000),
    status: 'label_created',
    statusHistory: [],
  });
  return {
    ...actual,
    createShippingLabel: jest.fn(async ({ declaredValue }) => label(5)),
    refundShippingLabel: jest.fn(async () => ({ refunded: true, status: 'submitted' })),
  };
});

const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const app = require('../server');
const authorizedPaymentIntent = require('./helpers/authorizedPayment');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Transaction = require('../models/Transaction');
const { calculatePaymentBreakdown } = require('../config/payments');
const { refundShippingLabel } = require('../services/easypostService');

const PASS = 'password123';
let seller;
let buyer;
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

beforeAll(async () => {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/trenddrop_test';
  if (mongoose.connection.readyState === 0) await mongoose.connect(uri);
  await Promise.all([
    User.deleteMany({ email: /postage_funding_checkout/ }),
    Listing.deleteMany({ title: /Postage funding checkout/ }),
  ]);
  ({ user: seller } = await createUser('FundingSeller', 'seller_postage_funding_checkout@test.com'));
  ({ user: buyer, token: buyerToken } = await createUser('FundingBuyer', 'buyer_postage_funding_checkout@test.com'));
});

afterAll(async () => {
  await Promise.all([
    User.deleteMany({ email: /postage_funding_checkout/ }),
    Listing.deleteMany({ title: /Postage funding checkout/ }),
    Transaction.deleteMany({ seller: seller._id }),
  ]);
});

test('a $5 label on a free-shipping sale is deducted from seller earnings, not platform revenue', async () => {
  const listing = await Listing.create({
    seller: seller._id,
    title: 'Postage funding checkout',
    description: 'Free shipping but carrier charges $5',
    price: 20,
    category: 'Men',
    condition: 'New with tags',
    available: true,
    sold: false,
    quantity: 1,
    shipsFrom: 'US',
    weight: 2,
    shipping: { domestic: true, international: false, freeShipping: true },
  });

  const res = await request(app)
    .post('/api/transactions')
    .set('Authorization', `Bearer ${buyerToken}`)
    .send({
      paymentIntentId: authorizedPaymentIntent(),
      listingId: listing._id,
      shippingAddress: {
        fullName: 'Buyer', street1: '456 St', city: 'New York',
        state: 'NY', postalCode: '10001', country: 'US',
      },
      buyerCountry: 'US',
    });

  expect(res.status).toBe(201);
  const bd = res.body.paymentBreakdown;
  expect(bd.shippingCost).toBe(0);
  expect(bd.labelCost).toBe(5);
  expect(bd.sellerPostageSubsidy).toBe(5);
  expect(bd.sellerEarnings).toBe(13.4);
  expect(bd.sellerCredit).toBe(13.4);

  const account = await User.findById(seller._id).lean();
  expect(account.balance.pending).toBe(13.4);
});

test('a single free-shipping sale that cannot fund its label is refused before capture', async () => {
  const listing = await Listing.create({
    seller: seller._id,
    title: 'Postage funding checkout unfundable',
    description: 'A $5 label cannot be funded by a $1 sale',
    price: 1,
    category: 'Men',
    condition: 'New with tags',
    available: true,
    sold: false,
    quantity: 1,
    shipsFrom: 'US',
    weight: 1,
    shipping: { domestic: true, international: false, freeShipping: true },
  });
  const intentId = authorizedPaymentIntent();
  const breakdown = calculatePaymentBreakdown(1, 'US', 'US', 1, 1, { freeShipping: true });
  global.__mockPaymentIntents[intentId] = {
    ...global.__mockPaymentIntents[intentId],
    amount: Math.round(breakdown.buyer.totalPaid * 100),
    metadata: { buyerId: String(buyer._id), itemIds: String(listing._id) },
  };

  const res = await request(app)
    .post('/api/payments/confirm')
    .set('Authorization', `Bearer ${buyerToken}`)
    .send({
      paymentIntentId: intentId,
      listingId: listing._id,
      shippingAddress: {
        fullName: 'Buyer', street1: '456 St', city: 'New York',
        state: 'NY', postalCode: '10001', country: 'US',
      },
      buyerCountry: 'US',
    });

  expect(res.status).toBe(422);
  expect(res.body.code).toBe('SHIPPING_BUDGET_INSUFFICIENT');
  expect(await Transaction.findOne({ listing: listing._id })).toBeNull();
  expect(refundShippingLabel).toHaveBeenCalledWith('shp_postage_funding_test');
});

test('a batch line that cannot fund its label is refused before capture', async () => {
  const listing = await Listing.create({
    seller: seller._id,
    title: 'Postage funding checkout batch unfundable',
    description: 'A $5 label cannot be funded by a $1 sale',
    price: 1,
    category: 'Men',
    condition: 'New with tags',
    available: true,
    sold: false,
    quantity: 1,
    shipsFrom: 'US',
    weight: 1,
    shipping: { domestic: true, international: false, freeShipping: true },
  });
  const intentId = authorizedPaymentIntent();
  const breakdown = calculatePaymentBreakdown(1, 'US', 'US', 1, 1, { freeShipping: true });
  global.__mockPaymentIntents[intentId] = {
    ...global.__mockPaymentIntents[intentId],
    amount: Math.round(breakdown.buyer.totalPaid * 100),
    metadata: {
      buyerId: String(buyer._id),
      itemIds: String(listing._id),
      totalUnits: '1',
    },
  };

  const res = await request(app)
    .post('/api/payments/confirm-batch')
    .set('Authorization', `Bearer ${buyerToken}`)
    .send({
      paymentIntentId: intentId,
      items: [{ listingId: String(listing._id), quantity: 1 }],
      shippingAddress: {
        fullName: 'Buyer', street1: '456 St', city: 'New York',
        state: 'NY', postalCode: '10001', country: 'US',
      },
    });

  expect(res.status).toBe(422);
  expect(res.body.code).toBe('SHIPPING_BUDGET_INSUFFICIENT');
  expect(await Transaction.findOne({ listing: listing._id })).toBeNull();
  expect(refundShippingLabel).toHaveBeenCalledWith('shp_postage_funding_test');
});
