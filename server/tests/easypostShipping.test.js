/**
 * EasyPost is the only shipping provider and the platform owns postage.
 *
 * These tests exercise the real HTTP client against a mocked transport:
 *   1. a shipment is rated and bought, producing a printable label;
 *   2. a provider failure aborts checkout BEFORE capture with no order,
 *      inventory or seller-credit side effects, and releases the hold;
 *   3. production with no API key fails closed;
 *   4. the seller is credited earnings only (postage belongs to the platform).
 */
const mongoose = require('mongoose');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../server');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Transaction = require('../models/Transaction');
const Payout = require('../models/Payout');
const { calculatePaymentBreakdown } = require('../config/payments');
const {
  createShippingLabel,
  refundShippingLabel,
  labelCostFromFees,
  ShippingProviderError,
} = require('../services/easypostService');
const { sellerParcelAddress } = require('../services/shippingPurchase');

const SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';
const RUN = `ep_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
const mkEmail = (p) => `${p}_${RUN}@test.com`;
const US_ADDRESS = {
  fullName: 'EP Buyer', street1: '1 Main St', city: 'Austin', state: 'TX',
  postalCode: '78701', country: 'US', phone: '555-0100',
};

const users = [];
const listings = [];

const makeUser = async (name, tag) => {
  const user = await User.create({
    name,
    email: mkEmail(tag),
    password: 'password123',
    emailVerified: true,
    authProvider: 'email',
    country: 'US',
    currency: 'USD',
    shippingAddress: {
      fullName: name, street1: '9 Seller Rd', city: 'Austin', state: 'TX',
      postalCode: '78702', country: 'US', phone: '555-0101',
    },
    balance: { available: 0, pending: 0, totalEarned: 0, totalPaidOut: 0, currency: 'USD' },
    stats: { totalSales: 1, totalPurchases: 0, strikes: 0 },
  });
  users.push(user._id);
  return user;
};

const makeListing = async (seller) => {
  const listing = await Listing.create({
    seller: seller._id,
    title: `EP item ${RUN}`,
    description: 'EasyPost fixture',
    price: 40,
    category: 'Men',
    condition: 'Good',
    images: [],
    quantity: 1,
    available: true,
    sold: false,
    status: 'active',
    weight: 0.5,
    shipsFrom: 'US',
    currency: 'USD',
  });
  listings.push(listing._id);
  return listing;
};

const mockIntent = ({ buyer, listing, status = 'requires_capture' }) => {
  const breakdown = calculatePaymentBreakdown(listing.price, 'US', 'US', listing.weight || 0.5);
  const id = `pi_ep_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  if (!global.__mockPaymentIntents) global.__mockPaymentIntents = {};
  global.__mockPaymentIntents[id] = {
    id,
    status,
    amount: Math.round(breakdown.buyer.totalPaid * 100),
    currency: 'usd',
    metadata: {
      buyerId: String(buyer._id),
      itemIds: String(listing._id),
      totalUnits: '1',
    },
  };
  return { id, breakdown };
};

const okResponse = (payload) => ({
  ok: true,
  status: 200,
  text: async () => JSON.stringify(payload),
});
const errResponse = (status, message = 'provider down') => ({
  ok: false,
  status,
  text: async () => JSON.stringify({ error: { message } }),
});

const happyFetch = () => jest.fn(async (url) => {
  if (String(url).endsWith('/shipments')) {
    return okResponse({
      id: 'shp_ep_test',
      rates: [
        { id: 'rate_ep_ground', carrier: 'USPS', service: 'Ground Advantage', rate: '7.50', delivery_days: 4 },
        { id: 'rate_ep_express', carrier: 'USPS', service: 'Priority', rate: '12.00', delivery_days: 2 },
      ],
    });
  }
  if (String(url).includes('/shipments/shp_ep_test/buy')) {
    return okResponse({
      id: 'shp_ep_test',
      tracking_code: 'EZTESTTRACK123',
      postage_label: { label_url: 'https://easypost.test/labels/shp_ep_test.pdf' },
      tracker: { id: 'trk_ep_test', public_url: 'https://easypost.test/track/EZTESTTRACK123' },
      selected_rate: { carrier: 'USPS', service: 'Ground Advantage', rate: '7.50' },
    });
  }
  if (String(url).endsWith('/refund')) return okResponse({ status: 'submitted' });
  return errResponse(404, 'unexpected URL');
});

let originalKey;
let originalFetch;

beforeAll(async () => {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/trenddrop_test');
  }
  originalKey = process.env.EASYPOST_API_KEY;
  originalFetch = global.fetch;
});

beforeEach(() => {
  // Force the live code path; fetch is always mocked, never the network.
  process.env.EASYPOST_API_KEY = 'ep_test_key';
  global.fetch = happyFetch();
});

afterEach(() => {
  if (originalKey === undefined) delete process.env.EASYPOST_API_KEY;
  else process.env.EASYPOST_API_KEY = originalKey;
  global.fetch = originalFetch;
});

afterAll(async () => {
  if (originalKey === undefined) delete process.env.EASYPOST_API_KEY;
  else process.env.EASYPOST_API_KEY = originalKey;
  global.fetch = originalFetch;
  await Payout.deleteMany({ seller: { $in: users } });
  await Transaction.deleteMany({ $or: [{ buyer: { $in: users } }, { seller: { $in: users } }] });
  await Listing.deleteMany({ _id: { $in: listings } });
  await User.deleteMany({ _id: { $in: users } });
});

describe('EP.0 seller address compatibility', () => {
  test('legacy `street` and an empty fullName still produce a usable parcel origin', () => {
    const address = sellerParcelAddress({
      name: 'Alex Rivera',
      shippingAddress: {
        street: '123 Sunset Blvd', city: 'Los Angeles', state: 'CA',
        postalCode: '90028', country: 'US', fullName: '', street1: '',
      },
    }, 'US');
    expect(address.fullName).toBe('Alex Rivera');
    expect(address.street1).toBe('123 Sunset Blvd');
    expect(address.city).toBe('Los Angeles');
  });
});

describe('EP.1 provider client', () => {
  test('buys the cheapest rate and returns a canonical label', async () => {
    const label = await createShippingLabel({
      fromAddress: {
        fullName: 'Seller', street1: '9 Seller Rd', city: 'Austin', state: 'TX', postalCode: '78702', country: 'US',
      },
      toAddress: US_ADDRESS,
      weightKg: 0.5,
      reference: 'test:1',
    });
    expect(label.provider).toBe('easypost');
    expect(label.trackingNumber).toBe('EZTESTTRACK123');
    expect(label.labelUrl).toBe('https://easypost.test/labels/shp_ep_test.pdf');
    expect(label.cost).toBe(7.5);
    expect(label.shipmentId).toBe('shp_ep_test');
    const buyCall = global.fetch.mock.calls.find(([url]) => String(url).includes('/buy'));
    const requestBody = JSON.parse(buyCall[1].body);
    expect(requestBody.rate.id).toBe('rate_ep_ground');
  });

  test('provider errors are typed and retryable for 5xx', async () => {
    global.fetch = jest.fn(async () => errResponse(503));
    await expect(createShippingLabel({
      fromAddress: { name: 'Seller', street1: '1 St', city: 'Austin', state: 'TX', zip: '78702', country: 'US' },
      toAddress: US_ADDRESS,
      weightKg: 1,
      reference: 'test:2',
    })).rejects.toMatchObject({
      name: 'ShippingProviderError',
      code: 'SHIPPING_PROVIDER_UNAVAILABLE',
      retryable: true,
    });
  });

  test('incomplete addresses fail before any provider request', async () => {
    await expect(createShippingLabel({
      fromAddress: { name: 'Seller', city: 'Austin', country: 'US' },
      toAddress: US_ADDRESS,
      weightKg: 1,
    })).rejects.toBeInstanceOf(ShippingProviderError);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('production without a key fails closed when Stripe is live', async () => {
    delete process.env.EASYPOST_API_KEY;
    const previous = process.env.NODE_ENV;
    const previousStripe = process.env.STRIPE_SECRET_KEY;
    process.env.NODE_ENV = 'production';
    delete process.env.STRIPE_SECRET_KEY;
    try {
      await expect(createShippingLabel({
        fromAddress: { name: 'Seller', street1: '1 St', city: 'Austin', state: 'TX', zip: '78702', country: 'US' },
        toAddress: US_ADDRESS,
        weightKg: 1,
      })).rejects.toMatchObject({ code: 'EASYPOST_NOT_CONFIGURED' });
      expect(global.fetch).not.toHaveBeenCalled();
    } finally {
      process.env.NODE_ENV = previous;
      if (previousStripe === undefined) delete process.env.STRIPE_SECRET_KEY;
      else process.env.STRIPE_SECRET_KEY = previousStripe;
    }
  });

  test('production on Stripe TEST keys uses mock labels until EasyPost is configured', async () => {
    delete process.env.EASYPOST_API_KEY;
    const previous = process.env.NODE_ENV;
    const previousStripe = process.env.STRIPE_SECRET_KEY;
    process.env.NODE_ENV = 'production';
    process.env.STRIPE_SECRET_KEY = 'sk_test_easypost_mock_probe';
    try {
      const label = await createShippingLabel({
        fromAddress: { name: 'Seller', street1: '1 St', city: 'Austin', state: 'TX', zip: '78702', country: 'US' },
        toAddress: US_ADDRESS,
        weightKg: 1,
      });
      expect(label.provider).toBe('mock');
      expect(label.trackingNumber).toMatch(/^EZ/);
      expect(global.fetch).not.toHaveBeenCalled();
    } finally {
      process.env.NODE_ENV = previous;
      if (previousStripe === undefined) delete process.env.STRIPE_SECRET_KEY;
      else process.env.STRIPE_SECRET_KEY = previousStripe;
    }
  });

  test('the recorded label cost includes insurance and other charged fees', () => {
    expect(labelCostFromFees([
      { type: 'PostageFee', amount: '7.50000', charged: true, refunded: false },
      { type: 'InsuranceFee', amount: '1.00000', charged: true, refunded: false },
    ], 7.5)).toBe(8.5);
    expect(labelCostFromFees([
      { type: 'PostageFee', amount: '7.50000', charged: true, refunded: true },
    ], 7.5)).toBe(7.5);
  });

  test('an unusable label response refunds the postage before throwing', async () => {
    global.fetch = jest.fn(async (url) => {
      if (String(url).endsWith('/shipments')) {
        return okResponse({
          id: 'shp_incomplete',
          rates: [
            { id: 'rate_incomplete', carrier: 'USPS', service: 'Ground', rate: '7.50' },
          ],
        });
      }
      if (String(url).includes('/shipments/shp_incomplete/buy')) {
        return okResponse({ id: 'shp_incomplete', tracking_code: '', postage_label: {} });
      }
      if (String(url).endsWith('/refund')) return okResponse({ status: 'submitted' });
      return errResponse(404);
    });

    await expect(createShippingLabel({
      fromAddress: { name: 'Seller', street1: '1 St', city: 'Austin', state: 'TX', zip: '78702', country: 'US' },
      toAddress: US_ADDRESS,
      weightKg: 1,
      reference: 'test:incomplete',
    })).rejects.toMatchObject({
      code: 'SHIPPING_LABEL_INCOMPLETE',
      shipmentId: 'shp_incomplete',
      labelRefunded: true,
    });
    expect(global.fetch.mock.calls.some(([url]) => String(url).endsWith('/refund'))).toBe(true);
  });

  test('refunds are requested against the shipment id', async () => {
    const refund = await refundShippingLabel('shp_ep_test');
    expect(refund.refunded).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/shipments/shp_ep_test/refund'),
      expect.objectContaining({ method: 'POST' }),
    );
  });
});

describe('EP.2 label failure cannot place an order or charge the buyer', () => {
  test('confirm-batch releases the hold and writes nothing when EasyPost fails', async () => {
    const seller = await makeUser('EP Seller 1', 'seller1');
    const buyer = await makeUser('EP Buyer 1', 'buyer1');
    const listing = await makeListing(seller);
    const token = jwt.sign({ id: buyer._id }, SECRET, { expiresIn: '30d' });
    const { id: intentId } = mockIntent({ buyer, listing });
    const sellerBefore = (await User.findById(seller._id)).balance.pending;

    global.fetch = jest.fn(async () => errResponse(503));

    const res = await request(app)
      .post('/api/payments/confirm-batch')
      .set('Authorization', `Bearer ${token}`)
      .send({
        paymentIntentId: intentId,
        items: [{ listingId: String(listing._id), quantity: 1 }],
        shippingAddress: { ...US_ADDRESS },
      });

    expect(res.status).toBe(502);
    expect(res.body.code).toMatch(/SHIPPING/);
    expect(await Transaction.findOne({ listing: listing._id })).toBeNull();
    expect(await Payout.findOne({ seller: seller._id })).toBeNull();
    const afterListing = await Listing.findById(listing._id);
    expect(afterListing.quantity).toBe(1);
    expect(afterListing.sold).toBe(false);
    expect(afterListing.available).toBe(true);
    expect((await User.findById(seller._id)).balance.pending).toBe(sellerBefore);
    // Authorization was released, never captured.
    expect(global.__mockPaymentIntents[intentId].status).toBe('canceled');
  });

  test('single confirm releases the hold and writes nothing when EasyPost fails', async () => {
    const seller = await makeUser('EP Seller 3', 'seller3');
    const buyer = await makeUser('EP Buyer 3', 'buyer3');
    const listing = await makeListing(seller);
    const token = jwt.sign({ id: buyer._id }, SECRET, { expiresIn: '30d' });
    const { id: intentId } = mockIntent({ buyer, listing, status: 'succeeded' });
    global.fetch = jest.fn(async () => errResponse(503));
    const { fullName, ...addressWithoutName } = US_ADDRESS;

    const res = await request(app)
      .post('/api/payments/confirm')
      .set('Authorization', `Bearer ${token}`)
      .send({
        paymentIntentId: intentId,
        listingId: String(listing._id),
        shippingAddress: addressWithoutName,
      });

    expect(res.status).toBe(502);
    expect(await Transaction.findOne({ listing: listing._id })).toBeNull();
    // Already-captured mock is refunded, never left charged.
    expect(global.__mockPaymentIntents[intentId].status).toBe('refunded');
    expect((await Listing.findById(listing._id)).quantity).toBe(1);
  });

  test('a post-label database failure refunds the label even if that refund fails', async () => {
    const seller = await makeUser('EP Seller 5', 'seller5');
    const buyer = await makeUser('EP Buyer 5', 'buyer5');
    const listing = await makeListing(seller);
    const token = jwt.sign({ id: buyer._id }, SECRET, { expiresIn: '30d' });
    const { id: intentId } = mockIntent({ buyer, listing });

    global.fetch = jest.fn(async (url) => {
      if (String(url).endsWith('/shipments')) {
        return okResponse({
          id: 'shp_ep_rollback',
          rates: [{ id: 'rate_ep_rollback', carrier: 'USPS', service: 'Ground', rate: '6.00' }],
        });
      }
      if (String(url).includes('/buy')) {
        return okResponse({
          id: 'shp_ep_rollback',
          tracking_code: 'EZROLLBACK',
          postage_label: { label_url: 'https://easypost.test/labels/rollback.pdf' },
          tracker: { id: 'trk_rollback' },
        });
      }
      // Both the carrier refund and every later call fail.
      return errResponse(503);
    });
    const inventorySpy = jest.spyOn(Listing, 'findOneAndUpdate')
      .mockRejectedValueOnce(new Error('db unavailable'));
    let res;
    try {
      res = await request(app)
        .post('/api/payments/confirm')
        .set('Authorization', `Bearer ${token}`)
        .send({
          paymentIntentId: intentId,
          listingId: String(listing._id),
          shippingAddress: { ...US_ADDRESS },
        });
    } finally {
      inventorySpy.mockRestore();
    }

    expect(res.status).toBe(500);
    expect(global.fetch.mock.calls.some(([url]) => String(url).endsWith('/refund'))).toBe(true);
    expect(await Transaction.findOne({ listing: listing._id })).toBeNull();
  });

  test('a captured-intent batch label failure refunds instead of releasing', async () => {
    const seller = await makeUser('EP Seller 6', 'seller6');
    const buyer = await makeUser('EP Buyer 6', 'buyer6');
    const listing = await makeListing(seller);
    const token = jwt.sign({ id: buyer._id }, SECRET, { expiresIn: '30d' });
    const { id: intentId } = mockIntent({ buyer, listing, status: 'succeeded' });
    global.fetch = jest.fn(async () => errResponse(503));

    const res = await request(app)
      .post('/api/payments/confirm-batch')
      .set('Authorization', `Bearer ${token}`)
      .send({
        paymentIntentId: intentId,
        items: [{ listingId: String(listing._id), quantity: 1 }],
        shippingAddress: { ...US_ADDRESS },
      });

    expect(res.status).toBe(502);
    expect(global.__mockPaymentIntents[intentId].status).toBe('refunded');
    expect(await Transaction.findOne({ listing: listing._id })).toBeNull();
  });

  test('an unauthorized single confirm without a body address uses the saved address', async () => {
    const seller = await makeUser('EP Seller 7', 'seller7');
    const buyer = await makeUser('EP Buyer 7', 'buyer7');
    const listing = await makeListing(seller);
    const token = jwt.sign({ id: buyer._id }, SECRET, { expiresIn: '30d' });
    const { id: intentId } = mockIntent({ buyer, listing });
    global.fetch = jest.fn(async () => errResponse(503));

    const res = await request(app)
      .post('/api/payments/confirm')
      .set('Authorization', `Bearer ${token}`)
      .send({ paymentIntentId: intentId, listingId: String(listing._id) });

    expect(res.status).toBe(502);
    expect(global.__mockPaymentIntents[intentId].status).toBe('canceled');
    expect(await Transaction.findOne({ listing: listing._id })).toBeNull();
  });

  test('a later label failure in a batch refunds labels already bought', async () => {
    const seller = await makeUser('EP Seller 4', 'seller4');
    const buyer = await makeUser('EP Buyer 4', 'buyer4');
    const first = await makeListing(seller);
    const second = await makeListing(seller);
    const token = jwt.sign({ id: buyer._id }, SECRET, { expiresIn: '30d' });
    const intentId = `pi_ep_multi_${Date.now()}`;
    if (!global.__mockPaymentIntents) global.__mockPaymentIntents = {};
    global.__mockPaymentIntents[intentId] = {
      id: intentId,
      status: 'requires_capture',
      metadata: {
        buyerId: String(buyer._id),
        itemIds: `${first._id},${second._id}`,
        totalUnits: '2',
      },
    };

    let shipmentCalls = 0;
    global.fetch = jest.fn(async (url) => {
      if (String(url).endsWith('/shipments')) {
        shipmentCalls += 1;
        if (shipmentCalls > 1) return errResponse(503);
        return okResponse({
          id: 'shp_ep_first',
          rates: [{ id: 'rate_ep_first', carrier: 'USPS', service: 'Ground', rate: '6.00' }],
        });
      }
      if (String(url).includes('/buy')) {
        return okResponse({
          id: 'shp_ep_first',
          tracking_code: 'EZFIRSTLABEL',
          postage_label: { label_url: 'https://easypost.test/labels/first.pdf' },
          tracker: { id: 'trk_first' },
        });
      }
      if (String(url).endsWith('/refund')) return okResponse({ status: 'submitted' });
      return errResponse(404);
    });

    const res = await request(app)
      .post('/api/payments/confirm-batch')
      .set('Authorization', `Bearer ${token}`)
      .send({
        paymentIntentId: intentId,
        items: [
          { listingId: String(first._id), quantity: 1 },
          { listingId: String(second._id), quantity: 1 },
        ],
        shippingAddress: { ...US_ADDRESS },
      });

    expect(res.status).toBe(502);
    expect(global.fetch.mock.calls.some(([url]) => String(url).endsWith('/refund'))).toBe(true);
    expect(await Transaction.countDocuments({ listing: { $in: [first._id, second._id] } })).toBe(0);
    expect((await Listing.findById(first._id)).quantity).toBe(1);
    expect((await Listing.findById(second._id)).quantity).toBe(1);
  });

  test('create-intent tolerates legacy sellers with no country or parcel weight', async () => {
    const seller = await makeUser('EP Seller 10', 'seller10');
    const buyer = await makeUser('EP Buyer 10', 'buyer10');
    const listing = await makeListing(seller);
    await User.collection.updateOne({ _id: seller._id }, { $set: { country: '' } });
    await Listing.collection.updateOne(
      { _id: listing._id },
      { $set: { shipsFrom: '', weight: 0 } },
    );
    const token = jwt.sign({ id: buyer._id }, SECRET, { expiresIn: '30d' });

    const res = await request(app)
      .post('/api/payments/create-intent')
      .set('Authorization', `Bearer ${token}`)
      .send({ items: [{ listingId: String(listing._id), quantity: 1 }] });

    expect(res.status).toBe(200);
    expect(res.body.amount).toBeGreaterThan(0);
  });

  test('batch resolves a legacy seller origin and the buyer saved country', async () => {
    const seller = await makeUser('EP Seller 11', 'seller11');
    const buyer = await makeUser('EP Buyer 11', 'buyer11');
    const listing = await makeListing(seller);
    await User.collection.updateOne({ _id: seller._id }, { $set: { country: '' } });
    const token = jwt.sign({ id: buyer._id }, SECRET, { expiresIn: '30d' });
    const intentId = `pi_ep_origin_${Date.now()}`;
    global.__mockPaymentIntents = global.__mockPaymentIntents || {};
    global.__mockPaymentIntents[intentId] = { id: intentId, status: 'requires_capture' };

    const res = await request(app)
      .post('/api/payments/confirm-batch')
      .set('Authorization', `Bearer ${token}`)
      .send({
        paymentIntentId: intentId,
        items: [{ listingId: String(listing._id), quantity: 1 }],
      });

    expect(res.status).toBe(201);
    const txn = await Transaction.findOne({ listing: listing._id });
    expect(txn.shipping.provider).toBe('easypost');
    expect(txn.shippingAddress.country).toBe('US');
  });

  test('batch without a body address or intent amount uses saved address and plan total', async () => {
    const seller = await makeUser('EP Seller 8', 'seller8');
    const buyer = await makeUser('EP Buyer 8', 'buyer8');
    const listing = await makeListing(seller);
    const token = jwt.sign({ id: buyer._id }, SECRET, { expiresIn: '30d' });
    const intentId = `pi_ep_legacy_${Date.now()}`;
    if (!global.__mockPaymentIntents) global.__mockPaymentIntents = {};
    global.__mockPaymentIntents[intentId] = { id: intentId, status: 'requires_capture' };

    const res = await request(app)
      .post('/api/payments/confirm-batch')
      .set('Authorization', `Bearer ${token}`)
      .send({
        paymentIntentId: intentId,
        items: [{ listingId: String(listing._id), quantity: 1 }],
      });

    expect(res.status).toBe(201);
    const txn = await Transaction.findOne({ listing: listing._id });
    expect(txn.shippingAddress.street1).toBe('9 Seller Rd');
    expect(txn.shipping.trackingNumber).toBe('EZTESTTRACK123');
  });

  test('single confirm falls back to the listing origin when seller country is legacy', async () => {
    const seller = await makeUser('EP Seller 9', 'seller9');
    const buyer = await makeUser('EP Buyer 9', 'buyer9');
    const listing = await makeListing(seller);
    await User.collection.updateOne({ _id: seller._id }, { $set: { country: '' } });
    const token = jwt.sign({ id: buyer._id }, SECRET, { expiresIn: '30d' });
    const { id: intentId } = mockIntent({ buyer, listing });

    const res = await request(app)
      .post('/api/payments/confirm')
      .set('Authorization', `Bearer ${token}`)
      .send({ paymentIntentId: intentId, listingId: String(listing._id) });

    expect(res.status).toBe(200);
    const txn = await Transaction.findOne({ listing: listing._id });
    expect(txn.shipping.provider).toBe('easypost');
    expect(txn.shipping.trackingNumber).toBe('EZTESTTRACK123');
  });

  test('confirm-batch buys postage before capture and credits earnings only', async () => {
    const seller = await makeUser('EP Seller 2', 'seller2');
    const buyer = await makeUser('EP Buyer 2', 'buyer2');
    const listing = await makeListing(seller);
    const token = jwt.sign({ id: buyer._id }, SECRET, { expiresIn: '30d' });
    const { id: intentId, breakdown } = mockIntent({ buyer, listing });
    const sellerBefore = (await User.findById(seller._id)).balance.pending;

    const res = await request(app)
      .post('/api/payments/confirm-batch')
      .set('Authorization', `Bearer ${token}`)
      .send({
        paymentIntentId: intentId,
        items: [{ listingId: String(listing._id), quantity: 1 }],
        shippingAddress: { ...US_ADDRESS },
      });

    expect(res.status).toBe(201);
    const txn = await Transaction.findOne({ listing: listing._id });
    expect(txn).toBeTruthy();
    expect(txn.shipping.provider).toBe('easypost');
    expect(txn.shipping.trackingNumber).toBe('EZTESTTRACK123');
    expect(txn.shipping.labelUrl).toContain('easypost.test');
    expect(txn.shipping.labelCost).toBe(7.5);
    expect(txn.paymentBreakdown.shippingPayout).toBe(0);
    expect(txn.paymentBreakdown.sellerCredit).toBe(txn.paymentBreakdown.sellerEarnings);
    expect(global.__mockPaymentIntents[intentId].status).not.toBe('canceled');
    expect(global.__mockPaymentIntents[intentId].amount_captured).toBeGreaterThan(0);
    const sellerAfter = (await User.findById(seller._id)).balance.pending;
    expect(Math.round((sellerAfter - sellerBefore) * 100) / 100)
      .toBe(txn.paymentBreakdown.sellerEarnings);
    expect(breakdown.seller.shippingPayout).toBe(0);
  });
});
