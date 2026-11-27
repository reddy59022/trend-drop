/**
 * Only EasyPost-signed carrier events may advance a platform shipment.
 */
const crypto = require('crypto');
const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../server');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Transaction = require('../models/Transaction');

const SECRET = 'whsec_test_easypost';
const RUN = `epw_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
const ids = { users: [], listings: [], txns: [] };

// EasyPost's SDKs send `hmac-sha256-hex=<digest>`. Using the real wire format
// here proves the route works with production Test webhooks, not just a
// convenient bare digest.
const signed = (payload) => {
  const raw = JSON.stringify(payload);
  const digest = crypto.createHmac('sha256', SECRET).update(raw).digest('hex');
  return { raw, signature: `hmac-sha256-hex=${digest}` };
};

let transaction;

beforeAll(async () => {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/trenddrop_test');
  }
  const seller = await User.create({
    name: 'WH Seller', email: `wh_seller_${RUN}@test.com`, password: 'password123',
    emailVerified: true, country: 'US', currency: 'USD',
    shippingAddress: { fullName: 'WH Seller', street1: '9 Seller Rd', city: 'Austin', state: 'TX', postalCode: '78702', country: 'US' },
  });
  const buyer = await User.create({
    name: 'WH Buyer', email: `wh_buyer_${RUN}@test.com`, password: 'password123',
    emailVerified: true, country: 'US', currency: 'USD',
    shippingAddress: { fullName: 'WH Buyer', street1: '1 Buyer St', city: 'Austin', state: 'TX', postalCode: '78701', country: 'US' },
  });
  const listing = await Listing.create({
    seller: seller._id, title: `WH item ${RUN}`, description: 'webhook fixture', price: 40,
    category: 'Men', condition: 'Good', images: [], quantity: 1, available: false, sold: true,
    status: 'sold', weight: 0.5, shipsFrom: 'US', currency: 'USD',
  });
  ids.users.push(seller._id, buyer._id);
  ids.listings.push(listing._id);

  transaction = await Transaction.create({
    listing: listing._id,
    buyer: buyer._id,
    seller: seller._id,
    itemPrice: 40,
    currency: 'USD',
    paymentBreakdown: {
      subtotal: 40, shippingCost: 5, totalPaid: 45, sellerEarnings: 36,
      sellerCredit: 36, shippingPayout: 0, platformFee: 4,
    },
    shippingAddress: { fullName: 'WH Buyer', street1: '1 Buyer St', city: 'Austin', state: 'TX', postalCode: '78701', country: 'US' },
    sellerAddress: { street1: '9 Seller Rd', city: 'Austin', state: 'TX', postalCode: '78702', country: 'US' },
    shipping: {
      trackingNumber: 'EZWH123',
      trackerId: 'trk_wh_123',
      carrier: 'USPS',
      trackingHistory: [],
    },
    status: 'shipped',
    payment: { status: 'captured' },
  });
  ids.txns.push(transaction._id);
});

afterAll(async () => {
  await Transaction.deleteMany({ _id: { $in: ids.txns } });
  await Listing.deleteMany({ _id: { $in: ids.listings } });
  await User.deleteMany({ _id: { $in: ids.users } });
});

const postEvent = async ({ signature, raw }) => request(app)
  .post('/api/shipping/easypost-webhook')
  .set('Content-Type', 'application/json')
  .set('X-Hmac-Signature', signature)
  .send(raw);

describe('EW. EasyPost tracker webhook', () => {
  beforeEach(() => { process.env.EASYPOST_WEBHOOK_SECRET = SECRET; });
  afterEach(() => { delete process.env.EASYPOST_WEBHOOK_SECRET; });

  test('rejects a bad signature', async () => {
    const body = { description: 'tracker.updated', result: { id: 'trk_wh_123', status: 'delivered' } };
    const { raw } = signed(body);
    const res = await postEvent({ signature: 'deadbeef', raw });
    expect(res.status).toBe(403);
  });

  test('carrier delivery advances the order and records history', async () => {
    const body = {
      description: 'tracker.updated',
      result: {
        id: 'trk_wh_123',
        tracking_code: 'EZWH123',
        status: 'delivered',
        tracking_details: [{
          status: 'delivered', message: 'Delivered, front door',
          datetime: '2026-11-26T18:00:00Z',
          tracking_location: { city: 'Austin', state: 'TX' },
        }],
      },
    };
    const { raw, signature } = signed(body);
    const res = await postEvent({ signature, raw });
    expect(res.status).toBe(200);
    expect(res.body.advanced).toBe(true);

    const saved = await Transaction.findById(transaction._id);
    expect(saved.status).toBe('delivered');
    expect(saved.shipping.actualDelivery).toBeTruthy();
    expect(saved.shipping.trackingHistory.at(-1).status).toBe('delivered');
  });

  test('replayed events are idempotent and never regress a delivered order', async () => {
    const body = {
      description: 'tracker.updated',
      result: {
        id: 'trk_wh_123',
        status: 'in_transit',
        tracking_details: [{
          status: 'in_transit', message: 'In transit',
          datetime: '2026-11-26T12:00:00Z',
        }],
      },
    };
    const { raw, signature } = signed(body);
    const res = await postEvent({ signature, raw });
    expect(res.status).toBe(200);
    expect(res.body.advanced).toBe(false);
    const saved = await Transaction.findById(transaction._id);
    expect(saved.status).toBe('delivered');
  });

  test('a signed Test tracker event walks the canonical carrier states', async () => {
    const base = transaction.toObject();
    delete base._id;
    delete base.createdAt;
    delete base.updatedAt;
    delete base.__v;
    const flow = await Transaction.create({
      ...base,
      status: 'paid',
      shipping: {
        trackingNumber: 'EZWHFLOW',
        trackerId: 'trk_wh_flow',
        carrier: 'USPS',
        trackingHistory: [],
      },
    });
    ids.txns.push(flow._id);

    const events = [
      ['in_transit', '2026-11-26T10:00:00Z', 'in_transit'],
      ['available_for_pickup', '2026-11-26T11:00:00Z', 'in_transit'],
      ['out_for_delivery', '2026-11-26T12:00:00Z', 'out_for_delivery'],
      ['delivered', '2026-11-26T13:00:00Z', 'delivered'],
    ];
    for (const [trackerStatus, datetime, expectedLifecycle] of events) {
      const body = {
        description: 'tracker.updated',
        result: {
          id: 'trk_wh_flow',
          tracking_code: 'EZWHFLOW',
          status: trackerStatus,
          tracking_details: [{
            status: trackerStatus,
            message: `Carrier scan: ${trackerStatus}`,
            datetime,
            tracking_location: { city: 'Austin', state: 'TX' },
          }],
        },
      };
      const { raw, signature } = signed(body);
      const res = await postEvent({ signature, raw });
      expect(res.status).toBe(200);
      expect(res.body.matched).toBe(true);
      expect(res.body.lifecycleStatus).toBe(expectedLifecycle);
      expect(res.body.advanced).toBe(true);
    }

    const saved = await Transaction.findById(flow._id);
    expect(saved.status).toBe('delivered');
    expect(saved.shipping.actualDelivery).toBeTruthy();
    expect(saved.shipping.trackingHistory.map((event) => event.status)).toEqual([
      'in_transit', 'in_transit_local', 'out_for_delivery', 'delivered',
    ]);
  });

  test('a late carrier replay cannot undo a buyer confirmation', async () => {
    const confirmed = await Transaction.findById(transaction._id);
    confirmed.status = 'buyer_confirmed';
    confirmed.buyerConfirmed = { received: true, confirmedAt: new Date() };
    await confirmed.save();

    const body = {
      description: 'tracker.updated',
      result: {
        id: 'trk_wh_123',
        status: 'delivered',
        tracking_details: [{
          status: 'delivered', message: 'Late replay',
          datetime: '2026-11-26T19:00:00Z',
        }],
      },
    };
    const { raw, signature } = signed(body);
    const res = await postEvent({ signature, raw });
    expect(res.status).toBe(200);
    expect(res.body.advanced).toBe(false);
    expect((await Transaction.findById(transaction._id)).status).toBe('buyer_confirmed');
  });

  test('fails closed in production when no webhook secret is configured', async () => {
    delete process.env.EASYPOST_WEBHOOK_SECRET;
    const body = { description: 'tracker.updated', result: { id: 'trk_wh_123', status: 'delivered' } };
    const { raw, signature } = signed(body);
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const res = await postEvent({ signature, raw });
      expect(res.status).toBe(503);
    } finally {
      process.env.NODE_ENV = previous;
    }
  });
});
