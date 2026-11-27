/**
 * EasyPost sandbox + Stripe Connect boundary.
 *
 * Stripe Connect does not rate, buy, or track shipments. TrendDrop keeps one
 * platform-owned EasyPost account and uses the TEST key only when explicitly
 * running in sandbox mode. These tests prove the key isolation, the live-mode
 * guard, and the authenticated state driver used for full lifecycle testing.
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
  shippingProviderStatus,
} = require('../services/easypostService');
const { getJwtSecret } = require('../config/security');

const RUN = `eps_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
const email = (part) => `${part}_${RUN}@test.com`;
const US_ADDRESS = {
  fullName: 'Sandbox Buyer', street1: '1 Main St', city: 'Austin',
  state: 'TX', postalCode: '78701', country: 'US',
};
const ids = { users: [], listings: [], transactions: [] };

const savedEnv = {};
const ENV_KEYS = [
  'NODE_ENV', 'STRIPE_SECRET_KEY', 'EASYPOST_MODE', 'EASYPOST_API_KEY',
  'EASYPOST_TEST_API_KEY', 'SHIPPING_MOCK_MODE', 'E2E_IN_MEMORY',
];

const makeUser = async (name, part) => {
  const user = await User.create({
    name, email: email(part), password: 'password123', country: 'US',
    currency: 'USD', emailVerified: true, authProvider: 'email',
    shippingAddress: { ...US_ADDRESS, fullName: name },
  });
  ids.users.push(user._id);
  return user;
};

const makeListing = async (seller) => {
  const listing = await Listing.create({
    seller: seller._id, title: `Sandbox item ${RUN}`, description: 'sandbox fixture',
    price: 40, currency: 'USD', category: 'Men', condition: 'Good',
    images: [], quantity: 5, available: true, sold: false, status: 'active',
    weight: 0.5, shipsFrom: 'US',
  });
  ids.listings.push(listing._id);
  return listing;
};

const makeTransaction = async (seller, buyer, listing, status = 'paid') => {
  const txn = await Transaction.create({
    listing: listing._id,
    buyer: buyer._id,
    seller: seller._id,
    itemPrice: 40,
    currency: 'USD',
    paymentBreakdown: { subtotal: 40, shippingCost: 5, totalPaid: 45, sellerEarnings: 36 },
    shippingAddress: { ...US_ADDRESS },
    sellerAddress: { ...US_ADDRESS, fullName: seller.name },
    shipping: { carrier: 'USPS', trackingNumber: `EZSB${Date.now()}`, trackingHistory: [] },
    status,
    payment: { status: 'captured' },
  });
  ids.transactions.push(txn._id);
  return txn;
};

const tokenFor = (user) => jwt.sign({ id: user._id }, getJwtSecret(), { expiresIn: '30d' });

beforeAll(async () => {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/trend-drop-test');
  }
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
});

beforeEach(() => {
  process.env.NODE_ENV = 'test';
  process.env.STRIPE_SECRET_KEY = 'trenddrop_hermetic';
  process.env.EASYPOST_MODE = 'sandbox';
  process.env.EASYPOST_TEST_API_KEY = 'ep_test_sandbox';
  delete process.env.EASYPOST_API_KEY;
  delete process.env.SHIPPING_MOCK_MODE;
  delete process.env.E2E_IN_MEMORY;
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

afterAll(async () => {
  await Transaction.deleteMany({ _id: { $in: ids.transactions } });
  await Listing.deleteMany({ _id: { $in: ids.listings } });
  await User.deleteMany({ _id: { $in: ids.users } });
});

describe('EasyPost sandbox configuration', () => {
  test('reports the platform-owned sandbox without leaking a key', async () => {
    const status = shippingProviderStatus();
    expect(status).toMatchObject({
      provider: 'easypost',
      mode: 'sandbox',
      platformManaged: true,
      configured: true,
    });
    expect(JSON.stringify(status)).not.toContain('ep_test_sandbox');

    const res = await request(app).get('/api/shipping/provider');
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('sandbox');
    expect(res.body.platformManaged).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain('ep_test_sandbox');
  });

  test('uses EASYPOST_TEST_API_KEY for sandbox labels, not the production key', async () => {
    const previous = process.env.EASYPOST_API_KEY;
    process.env.EASYPOST_API_KEY = 'ep_prod_should_not_be_used';
    const fetchMock = jest.fn(async (url) => {
      if (String(url).endsWith('/shipments')) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            id: 'shp_sandbox',
            rates: [{ id: 'rate_sandbox', carrier: 'USPS', service: 'Ground', rate: '7.50' }],
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          id: 'shp_sandbox',
          tracking_code: 'EZSANDBOX1',
          postage_label: { label_url: 'https://easypost.test/labels/sandbox.pdf' },
          tracker: { id: 'trk_sandbox' },
        }),
      };
    });
    const originalFetch = global.fetch;
    global.fetch = fetchMock;
    try {
      const label = await createShippingLabel({
        fromAddress: { ...US_ADDRESS, fullName: 'Seller' },
        toAddress: US_ADDRESS,
        weightKg: 0.5,
        reference: 'sandbox:key-isolation',
      });
      expect(label.provider).toBe('easypost');
      const auth = fetchMock.mock.calls[0][1].headers.Authorization;
      expect(Buffer.from(auth.replace(/^Basic /, ''), 'base64').toString()).toBe('ep_test_sandbox:');
    } finally {
      global.fetch = originalFetch;
      if (previous === undefined) delete process.env.EASYPOST_API_KEY;
      else process.env.EASYPOST_API_KEY = previous;
    }
  });

  test('explicit sandbox with no test key fails closed instead of using mock labels', async () => {
    delete process.env.EASYPOST_TEST_API_KEY;
    const status = shippingProviderStatus();
    expect(status.mode).toBe('sandbox');
    expect(status.configured).toBe(false);
    await expect(createShippingLabel({
      fromAddress: { ...US_ADDRESS, fullName: 'Seller' },
      toAddress: US_ADDRESS,
      weightKg: 0.5,
    })).rejects.toMatchObject({
      code: 'EASYPOST_NOT_CONFIGURED',
      message: expect.stringMatching(/EASYPOST_TEST_API_KEY/),
    });
  });

  test('live Stripe keys cannot buy sandbox labels', async () => {
    process.env.NODE_ENV = 'production';
    process.env.STRIPE_SECRET_KEY = ['sk', 'live', 'sandbox_probe'].join('_');
    process.env.EASYPOST_TEST_API_KEY = 'ep_test_sandbox';
    const originalFetch = global.fetch;
    const fetchMock = jest.fn();
    global.fetch = fetchMock;
    try {
      await expect(createShippingLabel({
        fromAddress: { ...US_ADDRESS, fullName: 'Seller' },
        toAddress: US_ADDRESS,
        weightKg: 0.5,
      })).rejects.toMatchObject({ code: 'EASYPOST_SANDBOX_FORBIDDEN' });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      global.fetch = originalFetch;
    }
  });
});

describe('Sandbox full shipment lifecycle', () => {
  let seller;
  let buyer;
  let listing;
  let buyerToken;

  beforeAll(async () => {
    seller = await makeUser('Sandbox Seller', 'seller');
    buyer = await makeUser('Sandbox Buyer User', 'buyer');
    listing = await makeListing(seller);
    buyerToken = tokenFor(buyer);
  });

  test('drives every outbound state through the authenticated sandbox driver', async () => {
    const txn = await makeTransaction(seller, buyer, listing);
    const advance = (status) => request(app)
      .post('/api/shipping/sandbox/advance')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ transactionId: String(txn._id), status, description: `Sandbox ${status}` });

    const labelCreated = await advance('label_created');
    expect(labelCreated.status).toBe(200);
    expect(labelCreated.body.advanced).toBe(false);
    expect((await Transaction.findById(txn._id)).status).toBe('paid');

    for (const status of ['picked_up', 'in_transit', 'in_transit_local', 'out_for_delivery', 'delivered']) {
      const res = await advance(status);
      expect(res.status).toBe(200);
      expect(res.body.sandbox).toBe(true);
    }

    const after = await Transaction.findById(txn._id);
    expect(after.status).toBe('delivered');
    expect(after.shipping.actualDelivery).toBeTruthy();
    expect(after.shipping.trackingHistory.map((event) => event.status)).toEqual([
      'label_created', 'picked_up', 'in_transit', 'in_transit_local',
      'out_for_delivery', 'delivered',
    ]);

    // Exceptions are recorded for support but must never regress delivery.
    const exception = await advance('exception');
    expect(exception.status).toBe(200);
    expect(exception.body.advanced).toBe(false);
    expect((await Transaction.findById(txn._id)).status).toBe('delivered');
  });

  test('supports returned and rejects unauthorized or invalid transitions', async () => {
    const txn = await makeTransaction(seller, buyer, listing);
    const buyerAdvance = (status) => request(app)
      .post('/api/shipping/sandbox/advance')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ transactionId: String(txn._id), status });

    expect((await buyerAdvance('picked_up')).status).toBe(200);
    expect((await buyerAdvance('exception')).body.advanced).toBe(false);
    expect((await buyerAdvance('returned')).status).toBe(200);
    expect((await Transaction.findById(txn._id)).status).toBe('returned');

    const stranger = await makeUser('Sandbox Stranger', 'stranger');
    const forbidden = await request(app)
      .post('/api/shipping/sandbox/advance')
      .set('Authorization', `Bearer ${tokenFor(stranger)}`)
      .send({ transactionId: String(txn._id), status: 'in_transit' });
    expect(forbidden.status).toBe(403);

    const invalid = await buyerAdvance('not_a_carrier_state');
    expect(invalid.status).toBe(400);
  });

  test('buyer checkout, platform label, every carrier state, and receipt work together', async () => {
    const checkoutListing = await makeListing(seller);
    const pi = `pi_sandbox_flow_${Date.now()}`;
    const breakdown = calculatePaymentBreakdown(checkoutListing.price, 'US', 'US', 0.5);
    global.__mockPaymentIntents = global.__mockPaymentIntents || {};
    global.__mockPaymentIntents[pi] = {
      id: pi,
      status: 'requires_capture',
      amount: Math.round(breakdown.buyer.totalPaid * 100),
      currency: 'usd',
      metadata: {
        buyerId: String(buyer._id),
        itemIds: String(checkoutListing._id),
        totalUnits: '1',
      },
    };
    const originalFetch = global.fetch;
    global.fetch = jest.fn(async (url) => {
      if (String(url).endsWith('/shipments')) {
        return {
          ok: true, status: 200, text: async () => JSON.stringify({
            id: 'shp_flow',
            rates: [{ id: 'rate_flow', carrier: 'USPS', service: 'Ground', rate: '7.50' }],
          }),
        };
      }
      if (String(url).includes('/buy')) {
        return {
          ok: true, status: 200, text: async () => JSON.stringify({
            id: 'shp_flow', tracking_code: 'EZFLOW1',
            postage_label: { label_url: 'https://easypost.test/labels/flow.pdf' },
            tracker: { id: 'trk_flow' },
          }),
        };
      }
      return { ok: true, status: 200, text: async () => JSON.stringify({ status: 'submitted' }) };
    });

    let txn;
    try {
      const checkout = await request(app)
        .post('/api/payments/confirm-batch')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({
          paymentIntentId: pi,
          items: [{ listingId: String(checkoutListing._id), quantity: 1 }],
          shippingAddress: { ...US_ADDRESS },
        });
      expect(checkout.status).toBe(201);
      txn = await Transaction.findOne({ 'paymentBreakdown.paymentIntentId': pi });
      expect(txn.shipping.provider).toBe('easypost');
      expect(txn.shipping.trackingNumber).toBe('EZFLOW1');

      for (const status of ['picked_up', 'in_transit', 'out_for_delivery', 'delivered']) {
        const res = await request(app)
          .post('/api/shipping/sandbox/advance')
          .set('Authorization', `Bearer ${buyerToken}`)
          .send({ transactionId: String(txn._id), status });
        expect(res.status).toBe(200);
      }

      const confirmed = await request(app)
        .post('/api/shipping/confirm-received')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({ transactionId: String(txn._id) });
      expect(confirmed.status).toBe(200);
      expect((await Transaction.findById(txn._id)).status).toBe('buyer_confirmed');
      expect(await Payout.countDocuments({ transaction: txn._id })).toBe(1);
    } finally {
      global.fetch = originalFetch;
      if (txn?._id) await Payout.deleteMany({ transaction: txn._id });
    }
  });

  test('sandbox driver is unavailable on a production provider deployment', async () => {
    process.env.EASYPOST_MODE = 'production';
    process.env.EASYPOST_API_KEY = 'ep_prod_key';
    const txn = await makeTransaction(seller, buyer, listing);

    const res = await request(app)
      .post('/api/shipping/sandbox/advance')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ transactionId: String(txn._id), status: 'delivered' });
    expect(res.status).toBe(404);
    expect((await Transaction.findById(txn._id)).status).toBe('paid');
  });
});
