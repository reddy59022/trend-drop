/**
 * TRACKING WEBHOOK + AUTO-TRACK DELIVERED — regression for Bugs B3 & B5.
 *
 * B3: there was NO way to advance a shipment to 'delivered' over the API
 * (auto-track capped at in_transit_local; no carrier webhook existed), so the
 * post-fulfillment business (receive order, returns on delivered, disputes)
 * was unreachable outside the cron time-windows.
 *
 * B5: the auto-track 'delivered' branch called deliveryDate.setDate(...),
 * which is NOT a JS Date method and would throw the moment it was reached.
 *
 * The fix adds an idempotent, signed carrier webhook
 *   POST /api/shipping/tracking-event  { transactionId, status, ... }
 * (x-tracking-secret header) that advances a shipment along the tracking
 * statuses including 'delivered', and makes auto-track reach delivered.
 */
const mongoose = require('mongoose');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../server');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Transaction = require('../models/Transaction');
const { orderStates } = require('../config/orderLifecycle');

const SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';
const WEBHOOK_SECRET = process.env.TRACKING_WEBHOOK_SECRET || 'trenddrop-tracking-dev';
const RUN = `tw_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
const mkEmail = (p) => `${p}_${RUN}@test.com`;

let seller, buyer, buyerToken;
const testUserIds = [];
const testListingIds = [];

async function mkUser(name, p) {
  const u = await User.create({
    name, email: mkEmail(p), password: 'password123', emailVerified: true, authProvider: 'email',
    country: 'US', currency: 'USD',
    shippingAddress: { fullName: name, street1: '1 St', city: 'C', state: 'S', postalCode: '00000', country: 'US' },
    balance: { available: 0, pending: 0, totalEarned: 0, totalPaidOut: 0, currency: 'USD' },
    stats: { totalSales: 5, totalPurchases: 0, strikes: 0 },
  });
  testUserIds.push(u._id);
  return u;
}

async function mkListing() {
  const l = await Listing.create({
    seller: seller._id, title: `TW Item ${RUN}`, description: 'd', price: 50,
    category: 'Men', condition: 'New with tags', available: true, sold: false,
    quantity: 5, shipsFrom: 'US', currency: 'USD',
  });
  testListingIds.push(l._id);
  return l;
}

async function mkShippedTxn(overrides = {}) {
  const listing = await mkListing();
  return Transaction.create({
    listing: listing._id,
    buyer: buyer._id,
    seller: seller._id,
    itemPrice: 50,
    currency: 'USD',
    paymentBreakdown: { subtotal: 50, shippingCost: 5, buyerProtectionFee: 2.5, buyerProtectionPercent: 5, tax: 0, totalPaid: 57.5, platformFee: 4, platformFeePercent: 8, shippingPayout: 5, sellerEarnings: 46 },
    shippingAddress: { fullName: 'TW Buyer', street1: '1 St', city: 'C', state: 'S', postalCode: '00000', country: 'US' },
    shipping: { carrier: 'USPS', trackingNumber: `TW${Date.now()}`, trackingUrl: 'https://tracking.example.com', labelCreated: true, labelCreatedDate: new Date(), estimatedDelivery: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000), service: 'Priority', trackingHistory: [] },
    status: orderStates.SHIPPED,
    payout: { status: 'pending', transactionId: `pi_tw_${Date.now()}` },
    autoTracking: { enabled: true, lastChecked: new Date(), nextCheck: new Date(Date.now() + 86400000), attempts: 0 },
    ...overrides,
  });
}

function webhook(transactionId, status, overrides = {}, opts = {}) {
  const body = { transactionId, status, ...overrides };
  let r = request(app).post('/api/shipping/tracking-event');
  // Default to the correct secret; tests override with a wrong/missing one.
  if (opts.noSecret) {
    // no x-tracking-secret header at all
  } else {
    r = r.set('x-tracking-secret', opts.secret || WEBHOOK_SECRET);
  }
  return r.send(body);
}

beforeAll(async () => {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/trenddrop_test');
  }
  seller = await mkUser('TW Seller', 'seller');
  buyer = await mkUser('TW Buyer', 'buyer');
  buyerToken = jwt.sign({ id: buyer._id }, SECRET, { expiresIn: '30d' });
});

afterAll(async () => {
  await Transaction.deleteMany({ $or: [{ buyer: { $in: testUserIds } }, { seller: { $in: testUserIds } }] });
  await Listing.deleteMany({ _id: { $in: testListingIds } });
  await User.deleteMany({ _id: { $in: testUserIds } });
});

describe('TW · Tracking webhook advances a shipment to delivered', () => {
  test('TW.1 delivered event transitions shipped -> delivered + sets actualDelivery', async () => {
    const txn = await mkShippedTxn();
    const res = await webhook(txn._id, 'delivered');
    expect(res.status).toBe(200);
    const after = await Transaction.findById(txn._id);
    expect(after.status).toBe('delivered');
    expect(after.shipping.actualDelivery).toBeTruthy();
    expect(after.shipping.trackingHistory.length).toBeGreaterThanOrEqual(1);
    expect(after.shipping.trackingHistory[after.shipping.trackingHistory.length - 1].status).toBe('delivered');
  });

  test('TW.2 stepwise in_transit then delivered', async () => {
    const txn = await mkShippedTxn();
    const r1 = await webhook(txn._id, 'in_transit');
    expect(r1.status).toBe(200);
    expect((await Transaction.findById(txn._id)).status).toBe('in_transit');
    const r2 = await webhook(txn._id, 'delivered');
    expect(r2.status).toBe(200);
    expect((await Transaction.findById(txn._id)).status).toBe('delivered');
  });

  test('TW.3 idempotent: repeating delivered does not error or regress', async () => {
    const txn = await mkShippedTxn();
    await webhook(txn._id, 'delivered');
    const res = await webhook(txn._id, 'delivered');
    expect(res.status).toBe(200);
    const after = await Transaction.findById(txn._id);
    expect(after.status).toBe('delivered');
    expect(after.shipping.actualDelivery).toBeTruthy();
  });

  test('TW.4 invalid status is rejected (400)', async () => {
    const txn = await mkShippedTxn();
    const res = await webhook(txn._id, 'not-a-real-status');
    expect(res.status).toBe(400);
    expect((await Transaction.findById(txn._id)).status).toBe('shipped');
  });

  test('TW.5 wrong/missing secret is rejected (401/403)', async () => {
    const txn = await mkShippedTxn();
    const wrong = await webhook(txn._id, 'delivered', {}, { secret: 'wrong-secret' });
    expect([401, 403]).toContain(wrong.status);
    const missing = await webhook(txn._id, 'delivered', {}, { noSecret: true });
    expect([401, 403]).toContain(missing.status);
    expect((await Transaction.findById(txn._id)).status).toBe('shipped');
  });

  test('TW.6 unknown transaction is 404', async () => {
    const res = await webhook(new mongoose.Types.ObjectId(), 'delivered');
    expect(res.status).toBe(404);
  });

  test('TW.7 auto-track reaches delivered after 7 days (B5 regression: no setDate crash)', async () => {
    const txn = await mkShippedTxn({
      'shipping.labelCreatedDate': new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
    });
    const res = await request(app).post('/api/shipping/auto-track');
    expect(res.status).toBe(200);
    const after = await Transaction.findById(txn._id);
    expect(after.status).toBe('delivered');
    expect(after.shipping.actualDelivery).toBeTruthy();
  });
});

