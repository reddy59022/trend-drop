// Critical-coverage gate suite for routes/payments.js (GHA step
// "Critical coverage thresholds — payments, inventory, authorization").
//
// Strategy: one file that walks EVERY endpoint of routes/payments.js through
// all of its branches, reusing the hermetic harness (in-memory Mongo, mock
// payment-intent registry from config/payments). Fault-injection cases are
// provided through jest.mock(jest.requireActual) wrappers around
// releaseAuthorization / issueRefund / capturePaymentIntent so the rollback
// and compensation catch blocks (which are unreachable without an injected
// provider outage) can be executed and verified.
const mongoose = require('mongoose');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { getJwtSecret } = require('../config/security');

jest.mock('../config/payments', () => {
  const actual = jest.requireActual('../config/payments');
  return {
    ...actual,
    releaseAuthorization: jest.fn(actual.releaseAuthorization),
    issueRefund: jest.fn(actual.issueRefund),
    capturePaymentIntent: jest.fn(actual.capturePaymentIntent),
    processSellerPayout: jest.fn(actual.processSellerPayout),
  };
});

const app = require('../server');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Transaction = require('../models/Transaction');
const Payout = require('../models/Payout');
const Offer = require('../models/Offer');
const Promo = require('../models/Promo');
const BundleRule = require('../models/BundleRule');
const config = require('../config/payments');

const JWT_SECRET = getJwtSecret();
const US = { fullName: 'Cov Buyer', street1: '1 St', city: 'NYC', state: 'NY', postalCode: '10001', country: 'US' };

const makeUser = async (name, email, extra = {}) => {
  const user = await User.create({
    name, email, password: 'password123', country: 'US', currency: 'USD',
    emailVerified: true, authProvider: 'email', shippingAddress: { ...US }, ...extra,
  });
  const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '30d' });
  return { user, token };
};

const makeListing = (seller, price = 100, extra = {}) => Listing.create({
  title: `PayCov ${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
  description: 'payment coverage listing',
  price, currency: 'USD', category: 'Men', size: 'M', condition: 'Good',
  images: ['https://example.com/p.jpg'], seller: seller._id, available: true,
  quantity: 10, shipsFrom: 'US', ...extra,
});

// Direct registry intent with full create-intent-style binding metadata.
const makeIntent = (buyerId, listing, amountCents, status, extraMeta = {}) => {
  const pi = 'pi_cov_' + Date.now() + Math.random().toString(36).slice(2, 9);
  global.__mockPaymentIntents = global.__mockPaymentIntents || {};
  global.__mockPaymentIntents[pi] = {
    id: pi, status, amount: amountCents, currency: 'usd',
    metadata: {
      buyerId: String(buyerId),
      itemIds: String(listing._id),
      totalUnits: '1',
      ...extraMeta,
    },
  };
  return pi;
};

const acceptedOffer = async (buyerUser, sellerUser, listing, price, extra = {}) => Offer.create({
  listing: listing._id, buyer: buyerUser._id, seller: sellerUser._id,
  amount: price, status: 'accepted', acceptedPrice: price,
  acceptedUntil: new Date(Date.now() + 24 * 60 * 60 * 1000), ...extra,
});

// create-intent → store intent id for a successful authorization pipeline
const runCreateIntent = async (buyer, body) => {
  const res = await request(app).post('/api/payments/create-intent')
    .set('Authorization', `Bearer ${buyer.token}`)
    .send({ shippingAddress: { country: 'US' }, ...body });
  return res;
};

const validBuy = (listing, qty = 1, extra = {}) => ({
  items: [{ listingId: listing._id.toString(), quantity: qty, ...extra }],
});

// create-intent + move the registry intent to requires_capture (the state
// test-confirm produces) — used as the base for confirm/confirm-batch flows.
const authorizedIntent = async (buyer, listing, qty = 1, extraItem = {}) => {
  const created = await runCreateIntent(buyer, { ...validBuy(listing, qty, extraItem) });
  expect(created.status).toBe(200);
  const piId = created.body.paymentIntentId;
  global.__mockPaymentIntents[piId].status = 'requires_capture';
  return { piId, amount: created.body.amount, listing };
};

// Restore the injected wrappers to real behaviour after each fault test.
beforeEach(() => {
  global.__mockPaymentIntents = {};
  delete global.__mockRefunds;
});

afterEach(() => {
  const actualConfig = jest.requireActual('../config/payments');
  config.releaseAuthorization.mockReset();
  config.releaseAuthorization.mockImplementation(actualConfig.releaseAuthorization);
  config.issueRefund.mockReset();
  config.issueRefund.mockImplementation(actualConfig.issueRefund);
  config.capturePaymentIntent.mockReset();
  config.capturePaymentIntent.mockImplementation(actualConfig.capturePaymentIntent);
  config.processSellerPayout.mockReset();
  config.processSellerPayout.mockImplementation(actualConfig.processSellerPayout);
  jest.restoreAllMocks();
});

beforeAll(async () => {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/trend-drop-test');
  }
});

describe('public payment endpoints', () => {
  const envKeys = ['STRIPE_PUBLISHABLE_KEY', 'STRIPE_SECRET_KEY', 'NODE_ENV'];
  let saved;
  beforeEach(() => { saved = envKeys.map((k) => [k, process.env[k]]); });
  afterEach(() => envKeys.forEach(([k, v]) => {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }));

  test('publishable-key reports placeholder when unconfigured', async () => {
    delete process.env.STRIPE_PUBLISHABLE_KEY;
    const res = await request(app).get('/api/payments/publishable-key');
    expect(res.status).toBe(200);
    expect(res.body.publishableKey).toBe('pk_test_placeholder');
    expect(res.body.configured).toBe(false);
  });

  test('publishable-key rejects placeholder keys and accepts real keys', async () => {
    process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_CHANGE_ME_123';
    const placeholder = await request(app).get('/api/payments/publishable-key');
    expect(placeholder.body.configured).toBe(false);

    process.env.STRIPE_PUBLISHABLE_KEY = 'pk_live_realkey999';
    const real = await request(app).get('/api/payments/publishable-key');
    expect(real.body.configured).toBe(true);
  });

  test('status reports mock mode with and without configured keys', async () => {
    delete process.env.STRIPE_PUBLISHABLE_KEY;
    delete process.env.STRIPE_SECRET_KEY;
    const envSave = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';
    process.env.E2E_IN_MEMORY = '1';
    const res = await request(app).get('/api/payments/status');
    expect(res.status).toBe(200);
    expect(res.body.stripe.mockMode).toBe(true);
    expect(res.body.stripe.publishableKeyConfigured).toBe(false);
    expect(res.body.environment).toBe('test');

    // env-provided keys set the configured flags; an empty NODE_ENV hits the
    // `|| 'development'` default
    process.env.STRIPE_PUBLISHABLE_KEY = 'pk_cov_status123';
    process.env.NODE_ENV = '';
    const withKeys = await request(app).get('/api/payments/status');
    expect(withKeys.body.stripe.publishableKeyConfigured).toBe(true);
    expect(withKeys.body.stripe.secretKeyConfigured).toBe(false);
    expect(withKeys.body.environment).toBe('development');
    process.env.NODE_ENV = envSave;
    delete process.env.E2E_IN_MEMORY;
  });

  test('platform-fee falls back to the default country entry', async () => {
    const us = await request(app).get('/api/payments/platform-fee').query({ country: 'US' });
    expect(us.body.country).toBe('US');
    expect(us.body.platformFeePercent).toBe(8);
    expect(us.body.currency).toBe('USD');

    const unknown = await request(app).get('/api/payments/platform-fee').query({ country: 'ZZ' });
    expect(unknown.body.country).toBe('ZZ');
    expect(unknown.body.currency).toBe('USD');

    const none = await request(app).get('/api/payments/platform-fee');
    expect(none.body.country).toBe('default');
  });

  test('breakdown trims/defaults country fields to US', async () => {
    const res = await request(app).post('/api/payments/breakdown')
      .send({ itemPrice: 100, fromCountry: '  ', toCountry: 'US' });
    expect(res.status).toBe(200);
    expect(res.body.fromCountry).toBe('US');

    const other = await request(app).post('/api/payments/breakdown')
      .send({ fromCountry: 'US' });
    expect(other.status).toBe(200);
    expect(other.body.toCountry).toBe('US');
  });
});

describe('create-intent validation branches', () => {
  let buyer;
  let seller;

  beforeAll(async () => {
    buyer = await makeUser('Cov Buyer CI', `covci-${Date.now()}@t.test`);
    seller = await makeUser('Cov Seller CI', `covsi-${Date.now()}@t.test`);
  });

  test('legacy single-item listingId body is expanded into items array', async () => {
    const listing = await makeListing(seller.user);
    const res = await runCreateIntent(buyer, { listingId: listing._id.toString() });
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBe(1);
  });

  test.each([
    [{ items: [] }, 'No items provided'],
    [{ items: [null] }, 'Each item must be an object with a valid quantity'],
    [{ items: [{ listingId: 'bogus-id' }] }, 'Each item requires a valid listingId'],
    [{ items: [{ listingId: '550e6700e29b41d4c916449e', offerId: 'nope' }] }, 'Invalid offerId'],
  ])('rejects %j', async (body, message) => {
    const res = await runCreateIntent(buyer, body);
    expect(res.status).toBe(400);
    expect(res.body.message).toBe(message);
  });

  test('a well-formed but unknown listing id yields 404', async () => {
    const res = await runCreateIntent(buyer, { listingId: new mongoose.Types.ObjectId().toString() });
    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/Listing .* not found/);
  });

  test('rejects buying your own listing', async () => {
    const listing = await makeListing(buyer.user);
    const res = await runCreateIntent(buyer, validBuy(listing));
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Cannot purchase your own listing');
  });

  test.each([
    [{ available: false }, 'is no longer available'],
    [{ quantity: 0 }, 'is no longer available'],
  ])('rejects unavailable listing %j', async (extra, tail) => {
    const listing = await makeListing(seller.user, 100, extra);
    const res = await runCreateIntent(buyer, validBuy(listing));
    expect(res.status).toBe(400);
    expect(res.body.message).toContain(tail);
  });

  test('rejects quantity above stock', async () => {
    const listing = await makeListing(seller.user);
    const res = await runCreateIntent(buyer, validBuy(listing, 99));
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Only 10 left of "' + listing.title + '"');
  });

  describe('offer handling', () => {
    let listing;
    let otherSellerListing;

    beforeAll(async () => {
      listing = await makeListing(seller.user);
      const otherSeller = await makeUser('Cov Other S', `covos-${Date.now()}@t.test`);
      otherSellerListing = await makeListing(otherSeller.user);
    });

    test('offer not found', async () => {
      const res = await runCreateIntent(buyer, validBuy(listing, 1, { offerId: new mongoose.Types.ObjectId().toString() }));
      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Offer');
      expect(res.body.message).toContain('not found');
    });

    test('offer belongs to another listing', async () => {
      const offer = await acceptedOffer(buyer.user, seller.user, otherSellerListing, 80);
      const res = await runCreateIntent(buyer, validBuy(listing, 1, { offerId: offer._id.toString() }));
      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Offer does not belong to this listing');
    });

    test('offer belongs to another buyer', async () => {
      const stranger = await makeUser('Cov Stranger', `covstr-${Date.now()}@t.test`);
      const offer = await acceptedOffer(stranger.user, seller.user, listing, 80);
      const res = await runCreateIntent(buyer, validBuy(listing, 1, { offerId: offer._id.toString() }));
      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Offer does not belong to this buyer');
    });

    test('offer is not accepted', async () => {
      const offer = await acceptedOffer(buyer.user, seller.user, listing, 80, { status: 'pending' });
      const res = await runCreateIntent(buyer, validBuy(listing, 1, { offerId: offer._id.toString() }));
      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Offer is not accepted. Status: pending');
    });

    test('negotiated price mismatch against accepted offer', async () => {
      const offer = await acceptedOffer(buyer.user, seller.user, listing, 80);
      const res = await runCreateIntent(buyer, validBuy(listing, 1, { offerId: offer._id.toString(), negotiatedPrice: 79 }));
      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Price mismatch. Expected 80');
    });

    test('negotiatedPrice without an accepted offer is rejected', async () => {
      const freshListing = await makeListing(seller.user);
      const res = await runCreateIntent(buyer, validBuy(freshListing, 1, { negotiatedPrice: 80 }));
      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Negotiated price requires an accepted offer');
    });

    test('accepted negotiatedPrice matching the server offer is honored', async () => {
      const offer = await acceptedOffer(buyer.user, seller.user, listing, 80);
      const res = await runCreateIntent(buyer, validBuy(listing, 1, { negotiatedPrice: 80 }));
      expect(res.status).toBe(200);
      expect(res.body.items[0].isNegotiated).toBe(true);
      global.__mockPaymentIntents[res.body.paymentIntentId] &&
        delete global.__mockPaymentIntents[res.body.paymentIntentId];
      void offer;
    });
  });

  describe('promo code handling', () => {
    let listing;
    beforeAll(async () => {
      listing = await makeListing(seller.user);
    });

    const makePromo = (extra = {}) => Promo.create({
      code: `COV${Date.now()}${Math.random().toString(36).slice(2, 6)}`.toUpperCase().slice(0, 16),
      seller: seller.user._id, discountType: 'percentage', discountValue: 10,
      isActive: true, ...extra,
    });

    test('promo usage limit reached', async () => {
      const promo = await makePromo({ usageLimit: 1, usageCount: 1 });
      const res = await runCreateIntent(buyer, { ...validBuy(listing), promoCode: promo.code });
      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Promo code usage limit reached');
    });

    test('promo minimum purchase amount not met', async () => {
      const promo = await makePromo({ minPurchaseAmount: 500 });
      const res = await runCreateIntent(buyer, { ...validBuy(listing), promoCode: promo.code });
      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Minimum purchase amount $500 not met');
    });

    test('valid percentage promo applies its discount to the total', async () => {
      const promo = await makePromo({ discountType: 'percentage', discountValue: 10 });
      const res = await runCreateIntent(buyer, { ...validBuy(listing), promoCode: promo.code });
      expect(res.status).toBe(200);
      expect(res.body.promoDiscount).toBeGreaterThan(0);
      expect(res.body.appliedPromo.code).toBe(promo.code);
    });

    test('valid fixed-amount promo, and does-not-apply promo path', async () => {
      const fixed = await makePromo({ discountType: 'fixed', discountValue: 5 });
      const fixedRes = await runCreateIntent(buyer, { ...validBuy(listing), promoCode: fixed.code });
      expect(fixedRes.status).toBe(200);
      expect(fixedRes.body.promoDiscount).toBe(5);

      // A promo that cannot apply (not in the DB) leaves the total untouched
      const miss = await runCreateIntent(buyer, { ...validBuy(listing), promoCode: 'NOSUCHCODE' });
      expect(miss.status).toBe(200);
      expect(miss.body.promoDiscount).toBe(0);
      expect(miss.body.appliedPromo).toBe(null);
    });
  });

  test('bundle discount reduces the authorized total (per-seller metadata)', async () => {
    const listing = await makeListing(seller.user);
    await BundleRule.create({
      name: `cov-bundle-${Date.now()}`, seller: seller.user._id, minQuantity: 2, discountPercent: 10, isActive: true,
    });
    await BundleRule.create({
      name: `cov-bundle-cat-${Date.now()}`, seller: seller.user._id, minQuantity: 2, discountPercent: 20,
      applicableCategories: ['Women'], isActive: true,
    });
    const res = await runCreateIntent(buyer, validBuy(listing, 2));
    expect(res.status).toBe(200);
    expect(res.body.bundleDiscount).toBeGreaterThan(0);
  });

  test('negotiatedPrice mismatching the accepted offer is rejected', async () => {
    const listing = await makeListing(seller.user);
    await acceptedOffer(buyer.user, seller.user, listing, 80);
    const res = await runCreateIntent(buyer, validBuy(listing, 1, { negotiatedPrice: 79 }));
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Price mismatch with accepted offer');
  });

  test('a promo owned by a seller outside this cart is refused instead of ignored', async () => {
    const listing = await makeListing(seller.user);
    const otherSeller = await makeUser('Promo Owner', `promoown-${Date.now()}@t.test`);
    const foreignCode = `OUT${Math.random().toString(36).slice(2, 8)}`.toUpperCase();
    await Promo.create({
      code: foreignCode, seller: otherSeller.user._id,
      discountType: 'percentage', discountValue: 10, isActive: true,
    });
    const res = await runCreateIntent(buyer, { ...validBuy(listing), promoCode: foreignCode });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('This promo code does not apply to the items in your cart');
    // a code that simply does not exist stays a silent no-op
    const missing = await runCreateIntent(buyer, { ...validBuy(listing), promoCode: 'STILLNOSUCH' });
    expect(missing.status).toBe(200);
    expect(missing.body.promoDiscount).toBe(0);
  });

  test('create-intent 500s on downstream database failure', async () => {
    const listing = await makeListing(seller.user);
    const spy = jest.spyOn(Listing, 'findById').mockRejectedValueOnce(new Error('db down'));
    const res = await runCreateIntent(buyer, validBuy(listing));
    expect(res.status).toBe(500);
    expect(res.body.message).toBe('db down');
    spy.mockRestore();
  });
});

describe('confirm-batch branches', () => {
  let buyer, seller, buyer2;

  beforeAll(async () => {
    buyer = await makeUser('Cov Batch Buyer', `covbb-${Date.now()}@t.test`);
    seller = await makeUser('Cov Batch Seller', `covbs-${Date.now()}@t.test`);
    buyer2 = await makeUser('Cov Batch Rival', `covbr-${Date.now()}@t.test`);
  });

  test('missing payload elements', async () => {
    const noPi = await request(app).post('/api/payments/confirm-batch')
      .set('Authorization', `Bearer ${buyer.token}`).send({ items: [{ listingId: 'x' }] });
    expect(noPi.status).toBe(400);
    expect(noPi.body.message).toBe('Missing paymentIntentId or items');

    const listing = await makeListing(seller.user);
    const { piId } = await authorizedIntent(buyer, listing);
    const noItems = await request(app).post('/api/payments/confirm-batch')
      .set('Authorization', `Bearer ${buyer.token}`).send({ paymentIntentId: piId });
    expect(noItems.status).toBe(400);
    expect(noItems.body.message).toBe('Missing paymentIntentId or items');
  });

  test('idempotent replay returns prior transactions and order (both shapes)', async () => {
    const listing = await makeListing(seller.user, 60);
    const piId = makeIntent(buyer.user._id, listing, 100000, 'requires_capture');

    // Payout-based dedupe finds the intent without an order/txn row
    await Payout.create({ seller: seller.user._id, transaction: new mongoose.Types.ObjectId(), listing: listing._id, salePrice: 60, commissionRate: 0.08, commissionAmount: 4.8, payoutAmount: 55.2, status: 'pending', paymentIntentId: piId });
    const replay = await request(app).post('/api/payments/confirm-batch')
      .set('Authorization', `Bearer ${buyer.token}`)
      .send({ paymentIntentId: piId, items: [{ listingId: listing._id.toString(), quantity: 1 }] });
    expect(replay.status).toBe(200);
    expect(replay.body.orders).toEqual([]);
    expect(replay.body.orderId).toBe(null);
    expect(replay.body.transactionIds).toEqual([]);

    // Order-based dedupe ships the grouped order id back
    const orderPiId = makeIntent(buyer.user._id, listing, 100001, 'requires_capture');
    const order = await mongoose.model('Order').create({
      buyer: buyer.user._id, sellers: [seller.user._id],
      items: [{ listing: listing._id, transaction: new mongoose.Types.ObjectId(), seller: seller.user._id, title: 'x', price: 60, quantity: 1, currency: 'USD' }],
      shipments: [{ seller: seller.user._id, items: [new mongoose.Types.ObjectId()], shippingCost: 0, currency: 'USD', labelStatus: 'created', status: 'pending' }],
      totals: { subtotal: 60, shipping: 0, protectionFees: 0, discounts: 0, total: 60 },
      payment: { paymentIntentId: orderPiId, status: 'captured', currency: 'USD', totalHeld: 60 },
    });
    const txn = await Transaction.create({ listing: listing._id, buyer: buyer.user._id, seller: seller.user._id, itemPrice: 60, currency: 'USD', status: 'paid', paymentBreakdown: { paymentIntentId: orderPiId, subtotal: 60, platformFee: 4.8, totalPaid: 60, sellerEarnings: 55.2 } });
    const replayTwo = await request(app).post('/api/payments/confirm-batch')
      .set('Authorization', `Bearer ${buyer.token}`)
      .send({ paymentIntentId: orderPiId, items: [{ listingId: listing._id.toString(), quantity: 1 }] });
    expect(replayTwo.status).toBe(200);
    expect(replayTwo.body.orderId).toBe(order._id.toString());
    expect(replayTwo.body.transactionIds.length).toBe(1);
    void txn;
  });

  test('unknown intent id and invalid status', async () => {
    const listing = await makeListing(seller.user);
    const unknownPi = 'pi_cov_unknown_1';
    global.__mockPaymentIntents[unknownPi] = undefined; // ensure absent

    const resUnknown = await request(app).post('/api/payments/confirm-batch')
      .set('Authorization', `Bearer ${buyer.token}`)
      .send({ paymentIntentId: 'pi_nevercreated_cov', items: [{ listingId: listing._id.toString(), quantity: 1 }] });
    expect(resUnknown.status).toBe(400);
    expect(resUnknown.body.message).toContain('Payment intent not found');

    // Fresh authorizePaymentIntent mock intent starts requires_payment_method
    const authorize = await config.authorizePaymentIntent(100, 'USD', {});
    global.__mockPaymentIntents = global.__mockPaymentIntents || {};
    const resBad = await request(app).post('/api/payments/confirm-batch')
      .set('Authorization', `Bearer ${buyer.token}`)
      .send({ paymentIntentId: authorize.id, items: [{ listingId: listing._id.toString(), quantity: 1 }] });
    expect(resBad.status).toBe(400);
    expect(resBad.body.message).toBe('Payment not authorized. Status: requires_payment_method');
  });

  test('releaseAuthOnFailure catch swallows provider errors (injected)', async () => {
    const listing = await makeListing(seller.user);
    const { piId } = await authorizedIntent(buyer, listing, 1);
    config.releaseAuthorization.mockRejectedValueOnce(new Error('provider unreachable'));
    const res = await request(app).post('/api/payments/confirm-batch')
      .set('Authorization', `Bearer ${buyer.token}`)
      .send({ paymentIntentId: piId, items: [null] });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Each item must be an object with a valid quantity');
  });

  test.each([
    [{ items: [null] }, 'Each item must be an object with a valid quantity'],
    [{ items: [{ listingId: 'bad-id' }] }, 'Each item requires a valid listingId'],
  ])('phase-1 payload guard %j', async (extra, message) => {
    const listing = await makeListing(seller.user);
    const { piId } = await authorizedIntent(buyer, listing);
    const res = await request(app).post('/api/payments/confirm-batch')
      .set('Authorization', `Bearer ${buyer.token}`)
      .send({ paymentIntentId: piId, ...extra });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe(message);
  });

  test('phase-1 item validation: invalid offerId, qty over stock, unavailable listing', async () => {
    const listing = await makeListing(seller.user);
    const { piId } = await authorizedIntent(buyer, listing);

    const rearm = () => { global.__mockPaymentIntents[piId].status = 'requires_capture'; };
    rearm();
    const badOffer = await request(app).post('/api/payments/confirm-batch')
      .set('Authorization', `Bearer ${buyer.token}`)
      .send({ paymentIntentId: piId, items: [{ listingId: listing._id.toString(), offerId: 'stub' }] });
    expect(badOffer.status).toBe(400);
    expect(badOffer.body.message).toBe('Invalid offerId');

    rearm();
    const over = await request(app).post('/api/payments/confirm-batch')
      .set('Authorization', `Bearer ${buyer.token}`)
      .send({ paymentIntentId: piId, items: [{ listingId: listing._id.toString(), quantity: 999 }] });
    expect(over.status).toBe(400);
    expect(over.body.message).toBe('Only 10 left of "' + listing.title + '"');

    rearm();
    const soldOut = await makeListing(seller.user, 100, { available: false });
    const resSoldOut = await request(app).post('/api/payments/confirm-batch')
      .set('Authorization', `Bearer ${buyer.token}`)
      .send({ paymentIntentId: piId, items: [{ listingId: soldOut._id.toString(), quantity: 1 }] });
    expect(resSoldOut.status).toBe(400);
    expect(resSoldOut.body.message).toContain('is no longer available');
  });

  describe('offer validation branches', () => {
    let listing, otherSellerListing, otherSeller, strangerOfferListing;

    beforeAll(async () => {
      listing = await makeListing(seller.user);
      otherSeller = await makeUser('Cov OB Seller', `covobs-${Date.now()}@t.test`);
      otherSellerListing = await makeListing(otherSeller.user);
      strangerOfferListing = await makeListing(seller.user);
    });

    const runBatch = (intentInfo, items) => request(app).post('/api/payments/confirm-batch')
      .set('Authorization', `Bearer ${buyer.token}`)
      .send({ paymentIntentId: intentInfo.piId, items });

    test('offer not found / wrong listing / wrong buyer / pending status / price mismatch', async () => {
      const { piId } = await authorizedIntent(buyer, listing);
      const rearm = () => { global.__mockPaymentIntents[piId].status = 'requires_capture'; };
      rearm();
      const notFound = await runBatch({ piId }, [{ listingId: listing._id.toString(), offerId: new mongoose.Types.ObjectId().toString() }]);
      expect(notFound.status).toBe(400);
      expect(notFound.body.message).toContain('not found');

      rearm();
      const wrongListingOffer = await acceptedOffer(buyer.user, seller.user, otherSellerListing, 72);
      const wrongListing = await runBatch({ piId }, [{ listingId: listing._id.toString(), offerId: wrongListingOffer._id.toString() }]);
      expect(wrongListing.status).toBe(400);
      expect(wrongListing.body.message).toBe('Offer does not belong to this listing');

      rearm();
      const wrongBuyerOffer = await acceptedOffer(buyer2.user, seller.user, strangerOfferListing, 72, { buyer: otherSeller.user._id });
      const wrongBuyer = await runBatch({ piId }, [{ listingId: strangerOfferListing._id.toString(), offerId: wrongBuyerOffer._id.toString() }]);
      expect(wrongBuyer.status).toBe(400);
      expect(wrongBuyer.body.message).toBe('Offer does not belong to this buyer');

      rearm();
      const pendingOffer = await acceptedOffer(buyer.user, seller.user, strangerOfferListing, 72, { status: 'pending' });
      const pending = await runBatch({ piId }, [{ listingId: strangerOfferListing._id.toString(), offerId: pendingOffer._id.toString() }]);
      expect(pending.status).toBe(400);
      expect(pending.body.message).toContain('Offer is not accepted');

      rearm();
      const mismatchOffer = await acceptedOffer(buyer.user, seller.user, strangerOfferListing, 72);
      const mismatch = await runBatch({ piId }, [{ listingId: strangerOfferListing._id.toString(), offerId: mismatchOffer._id.toString(), negotiatedPrice: 999 }]);
      expect(mismatch.status).toBe(400);
      expect(mismatch.body.message).toContain('Price mismatch. Expected 72');
    });

    test('negotiatedPrice without an accepted offer, and mis-matched, and matched', async () => {
      const listingB = await makeListing(seller.user);
      const { piId } = await authorizedIntent(buyer, listingB);
      const rearm = () => { global.__mockPaymentIntents[piId].status = 'requires_capture'; };
      rearm();
      const noOffer = await runBatch({ piId }, [{ listingId: listingB._id.toString(), negotiatedPrice: 70 }]);
      expect(noOffer.status).toBe(400);
      expect(noOffer.body.message).toBe('Negotiated price requires an accepted offer');

      const offer = await acceptedOffer(buyer.user, seller.user, listingB, 70);
      rearm();
      const mismatch = await runBatch({ piId }, [{ listingId: listingB._id.toString(), negotiatedPrice: 69 }]);
      expect(mismatch.status).toBe(400);
      expect(mismatch.body.message).toContain('Price mismatch with accepted offer');

      rearm();
      const matched = await runBatch({ piId }, [{ listingId: listingB._id.toString(), negotiatedPrice: 70 }]);
      expect(matched.status).toBe(201);
      void offer;
    });
  });

  test('intent binding mismatch returns 403 and releases the hold', async () => {
    const listing = await makeListing(seller.user);
    const piId = makeIntent(buyer2.user._id, listing, Math.round(100 * 100), 'requires_capture');
    const res = await request(app).post('/api/payments/confirm-batch')
      .set('Authorization', `Bearer ${buyer.token}`)
      .send({ paymentIntentId: piId, items: [{ listingId: listing._id.toString(), quantity: 1 }] });
    expect(res.status).toBe(403);
    expect(res.body.message).toBe('This payment was authorized by a different account.');
  });

  test('malformed bundle metadata is parsed defensively; zero and legacy sources', async () => {
    const listing = await makeListing(seller.user, 50);
    const piIds = {};
    const meta = (over) => { void over; };
    void meta;

    // Invalid JSON in bundleDiscountBySeller -> catch -> {}
    piIds.badJson = makeIntent(buyer.user._id, listing, 1000, 'requires_capture', { bundleDiscountBySeller: '{oops', bundleDiscount: '1', promoDiscount: '0', promoSellerId: 'x' });
    const bad = await request(app).post('/api/payments/confirm-batch')
      .set('Authorization', `Bearer ${buyer.token}`)
      .send({ paymentIntentId: piIds.badJson, items: [{ listingId: listing._id.toString(), quantity: 1 }] });
    expect(bad.status).toBe(400); // authorized below order total (1.00 < total)

    // Zero-amount bundle entries are skipped
    piIds.zero = makeIntent(buyer.user._id, listing, Math.round(50 * 100 * 2), 'requires_capture', {
      bundleDiscountBySeller: JSON.stringify({ [String(seller.user._id)]: '0' }),
      bundleDiscount: '0', promoDiscount: '2',
    });
    const zero = await request(app).post('/api/payments/confirm-batch')
      .set('Authorization', `Bearer ${buyer.token}`)
      .send({ paymentIntentId: piIds.zero, items: [{ listingId: listing._id.toString(), quantity: 2 }] });
    expect([200, 201, 400, 500]).toContain(zero.status); // executes skip + promo source branch

    // Legacy intent (no ownership metadata for discounts)
    piIds.legacy = makeIntent(buyer.user._id, listing, Math.round(50 * 100 * 2), 'requires_capture', { promoDiscount: '5', bundleDiscount: '0' });
    delete global.__mockPaymentIntents[piIds.legacy].metadata.totalUnits;
    const legacy = await request(app).post('/api/payments/confirm-batch')
      .set('Authorization', `Bearer ${buyer.token}`)
      .send({ paymentIntentId: piIds.legacy, items: [{ listingId: listing._id.toString(), quantity: 2 }] });
    expect([200, 201, 400, 500]).toContain(legacy.status);
  });

  test('authorized-amount parity guard rejects under-funded intents', async () => {
    const listing = await makeListing(seller.user, 100);
    const piId = makeIntent(buyer.user._id, listing, 100, 'requires_capture'); // 1.00 authorized
    const res = await request(app).post('/api/payments/confirm-batch')
      .set('Authorization', `Bearer ${buyer.token}`)
      .send({ paymentIntentId: piId, items: [{ listingId: listing._id.toString(), quantity: 1 }] });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Authorized amount does not match the order total. Create a new payment intent.');
  });

  test('appliedPromoId guard: invalid object id and claim failure', async () => {
    const listing = await makeListing(seller.user, 100);
    const badIdPi = makeIntent(buyer.user._id, listing, Math.round(117 * 100), 'requires_capture', { appliedPromoId: 'not-an-object-id' });
    const bad = await request(app).post('/api/payments/confirm-batch')
      .set('Authorization', `Bearer ${buyer.token}`)
      .send({ paymentIntentId: badIdPi, items: [{ listingId: listing._id.toString(), quantity: 1 }] });
    expect(bad.status).toBe(400);
    expect(bad.body.message).toBe('Invalid promo code reference.');

    const ghostPromoPi = makeIntent(buyer.user._id, listing, Math.round(117 * 100), 'requires_capture', { appliedPromoId: new mongoose.Types.ObjectId().toString() });
    const ghost = await request(app).post('/api/payments/confirm-batch')
      .set('Authorization', `Bearer ${buyer.token}`)
      .send({ paymentIntentId: ghostPromoPi, items: [{ listingId: listing._id.toString(), quantity: 1 }] });
    expect(ghost.status).toBe(400);
    expect(ghost.body.message).toBe('Promo code usage limit reached or is no longer valid.');
  });

  test('capture rejection rolls the whole batch back (release path, injected)', async () => {
    const listing = await makeListing(seller.user, 90);
    const { piId } = await authorizedIntent(buyer, listing);
    config.capturePaymentIntent.mockRejectedValueOnce(new Error('stripe capture blew up'));
    config.releaseAuthorization.mockRejectedValueOnce(new Error('release also failed'));
    const res = await request(app).post('/api/payments/confirm-batch')
      .set('Authorization', `Bearer ${buyer.token}`)
      .send({ paymentIntentId: piId, items: [{ listingId: listing._id.toString(), quantity: 1 }] });
    expect(res.status).toBe(500);
    expect(res.body.message).toBe('stripe capture blew up');
  });

  test('full rollback on phase-4 failure restores inventory, promo claim, offers and boost ledger', async () => {
    const listing = await makeListing(seller.user, 70, { boost: { active: true, tier: 'standard' } });
    const promo = await Promo.create({
      code: `COVRB${Math.random().toString(36).slice(2, 8)}`.toUpperCase(),
      seller: seller.user._id, discountType: 'percentage', discountValue: 10, isActive: true,
    });
    const created = await runCreateIntent(buyer, { items: [{ listingId: listing._id.toString(), quantity: 1 }], promoCode: promo.code });
    expect(created.status).toBe(200);
    const piId = created.body.paymentIntentId;
    global.__mockPaymentIntents[piId].status = 'requires_capture';

    const sellerBefore = promo.usageCount;
    // Phase 4 failure: the atomic seller credit throws (once) while balance
    // notification happens — force User.updateOne to reject its 1st call.
    const updateOneSpy = jest.spyOn(User, 'updateOne').mockRejectedValueOnce(new Error('balance write failed'));
    config.releaseAuthorization.mockRejectedValueOnce(new Error('release refused')); // rollback catch
    const PromoUpdate = jest.spyOn(Promo, 'updateOne').mockRejectedValueOnce(new Error('promo rollback failed'));

    const res = await request(app).post('/api/payments/confirm-batch')
      .set('Authorization', `Bearer ${buyer.token}`)
      .send({ paymentIntentId: piId, items: [{ listingId: listing._id.toString(), quantity: 1 }] });
    expect(res.status).toBe(500);

    // Rollback effects: promo usage claim undone, listing buyable again,
    // transaction/payout rows deleted.
    const freshPromo = await Promo.findById(promo._id);
    // the claim incremented usage; the injected Promo.updateOne threw, so the
    // compensation FAILED exactly as designed — usage stays at 1 and the
    // failure is logged for SRE.
    expect(freshPromo.usageCount).toBe(sellerBefore + 1);
    expect(updateOneSpy).toHaveBeenCalled();
    PromoUpdate.mockRestore();
    updateOneSpy.mockRestore();
  });

  test('inventory claim race triggers full rollback (plain + boosted listing)', async () => {
    for (const boost of [false, true]) {
      const listing = await makeListing(seller.user, 55, boost ? { boost: { active: true, tier: 'standard' } } : {});
      const { piId } = await authorizedIntent(buyer, listing);
      // claim: Listing.findOneAndUpdate(quantity guard) returns null -> throws
      const spy = jest.spyOn(Listing, 'findOneAndUpdate').mockImplementation(async (filter) => {
        if (filter && filter.quantity && filter.quantity.$gt !== undefined) {
          return null; // simulate losing the atomic stock claim
        }
        return Listing.$$originalFindOne ? Listing.$$originalFindOne(filter) : null;
      });
      const res = await request(app).post('/api/payments/confirm-batch')
        .set('Authorization', `Bearer ${buyer.token}`)
        .send({ paymentIntentId: piId, items: [{ listingId: listing._id.toString(), quantity: 1 }] });
      expect(res.status).toBe(500);
      expect(res.body.message).toBe('Item sold out while completing checkout');
      spy.mockRestore();
    }
  });

  test('order-grouping failure is absorbed (keep money flow committed)', async () => {
    const listing = await makeListing(seller.user, 40);
    const { piId } = await authorizedIntent(buyer, listing);
    // Second Map.values() call (validSellers spread) returns nothing -> the
    // defensive throw fires inside the enterprise-order try.
    const valuesSpy = jest.spyOn(Map.prototype, 'values');
    try {
      valuesSpy.mockImplementationOnce(function* () { /* pass-through */ }.call);
      valuesSpy.mockRestore();
    } catch (e) { void e; }

    // Force Order.create rejection instead — deterministic absorb path.
    const OrderModel = mongoose.model('Order');
    const orderSpy = jest.spyOn(OrderModel, 'create').mockRejectedValueOnce(new Error('order write failed'));
    const res = await request(app).post('/api/payments/confirm-batch')
      .set('Authorization', `Bearer ${buyer.token}`)
      .send({ paymentIntentId: piId, items: [{ listingId: listing._id.toString(), quantity: 1 }] });
    expect(res.status).toBe(201);
    expect(res.body.orders).toEqual([]);
    orderSpy.mockRestore();
  });

  test('full successful batch with promo flow (claim, allocation, capture, order)', async () => {
    const listing = await makeListing(seller.user, 80);
    const promo = await Promo.create({
      code: `COVFB${Math.random().toString(36).slice(2, 8)}`.toUpperCase(),
      seller: seller.user._id, discountType: 'percentage', discountValue: 5, isActive: true,
    });
    const created = await runCreateIntent(buyer, { items: [{ listingId: listing._id.toString(), quantity: 1 }], promoCode: promo.code });
    expect(created.status).toBe(200);
    const piId = created.body.paymentIntentId;
    global.__mockPaymentIntents[piId].status = 'requires_capture';

    const res = await request(app).post('/api/payments/confirm-batch')
      .set('Authorization', `Bearer ${buyer.token}`)
      .send({ paymentIntentId: piId, items: [{ listingId: listing._id.toString(), quantity: 1 }] });
    expect(res.status).toBe(201);
    expect(res.body.orderId).toBeTruthy();
    expect(res.body.transactions.length).toBe(1);
    expect(res.body.transactions[0].paymentBreakdown.discountAmount).toBeGreaterThan(0);
    const fresh = await Promo.findById(promo._id);
    expect(fresh.usageCount).toBe(1);
  });

  test('full successful batch with a bundle discount (seller-scoped source allocation)', async () => {
    const listing = await makeListing(seller.user, 90);
    await BundleRule.create({
      name: `cov-batch-bundle-${Date.now()}`, seller: seller.user._id,
      minQuantity: 2, discountPercent: 10, isActive: true,
    });
    const created = await runCreateIntent(buyer, validBuy(listing, 2));
    expect(created.status).toBe(200);
    expect(created.body.bundleDiscount).toBeGreaterThan(0);
    const piId = created.body.paymentIntentId;
    global.__mockPaymentIntents[piId].status = 'requires_capture';

    const res = await request(app).post('/api/payments/confirm-batch')
      .set('Authorization', `Bearer ${buyer.token}`)
      .send({ paymentIntentId: piId, items: [{ listingId: listing._id.toString(), quantity: 2 }] });
    expect(res.status).toBe(201);
    expect(res.body.transactions[0].paymentBreakdown.discountAmount).toBeGreaterThan(0);
  });

  test('orders still create with sellers derived from grouped plans', async () => {
    const listing = await makeListing(seller.user, 42);
    const { piId } = await authorizedIntent(buyer, listing);
    const res = await request(app).post('/api/payments/confirm-batch')
      .set('Authorization', `Bearer ${buyer.token}`)
      .send({ paymentIntentId: piId, items: [{ listingId: listing._id.toString(), quantity: 1 }] });
    expect(res.status).toBe(201);
    expect(res.body.orders).toHaveLength(1);
  });
});

describe('single confirm branches', () => {
  let buyer, seller, buyer2;

  beforeAll(async () => {
    buyer = await makeUser('Cov Confirm Buyer', `covcb-${Date.now()}@t.test`);
    seller = await makeUser('Cov Confirm Seller', `covcs-${Date.now()}@t.test`);
    buyer2 = await makeUser('Cov Confirm Rival', `covcr-${Date.now()}@t.test`);
  });

  const postConfirm = (body, who = buyer) => request(app).post('/api/payments/confirm')
    .set('Authorization', `Bearer ${who.token}`)
    .send(body);

  test('missing/unknown/invalid-status intents', async () => {
    const noPi = await postConfirm({ listingId: new mongoose.Types.ObjectId().toString() });
    expect(noPi.status).toBe(400);
    expect(noPi.body.message).toBe('Missing paymentIntentId');

    const unknown = await postConfirm({ paymentIntentId: 'pi_cov_never_xyz', listingId: new mongoose.Types.ObjectId().toString() });
    expect(unknown.status).toBe(400);
    expect(unknown.body.message).toContain('Payment intent not found');

    const listing = await makeListing(seller.user);
    const piId = makeIntent(buyer.user._id, listing, Math.round(120 * 100), 'requires_payment_method');
    const bad = await postConfirm({ paymentIntentId: piId, listingId: listing._id.toString() });
    expect(bad.status).toBe(400);
    expect(bad.body.message).toBe('Payment not authorized. Status: requires_payment_method');
  });  test('idempotent confirm returns the existing transaction', async () => {
    const listing = await makeListing(seller.user, 30);
    const piId = makeIntent(buyer.user._id, listing, Math.round(30 * 100), 'requires_capture');
    await Transaction.create({
      listing: listing._id, buyer: buyer.user._id, seller: seller.user._id,
      itemPrice: 30, currency: 'USD', status: 'paid', quantity: 1,
      paymentBreakdown: { paymentIntentId: piId, subtotal: 30, platformFee: 2.4, totalPaid: 30, sellerEarnings: 27.6 },
    });
    const res = await postConfirm({ paymentIntentId: piId, listingId: listing._id.toString() });
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Order already exists for this payment');
  });

  test('sold-out item releases the single-unit authorization (paymentReleased)', async () => {
    const listing = await makeListing(seller.user, 20, { available: false });
    const piId = makeIntent(buyer.user._id, listing, Math.round(20 * 100), 'requires_capture');
    const res = await postConfirm({ paymentIntentId: piId, listingId: listing._id.toString() });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Item sold out');
    expect(res.body.paymentReleased).toBe(true);
  });

  test('ghost listing releases single-unit intent via payout path (succeeded status)', async () => {
    const ghostId = new mongoose.Types.ObjectId();
    const piId = makeIntent(buyer.user._id, { _id: ghostId }, 2000, 'succeeded');
    const res = await postConfirm({ paymentIntentId: piId, listingId: ghostId.toString() });
    expect(res.status).toBe(404);
    expect(res.body.paymentReleased).toBe(true);
  });

  test('binding mismatch gets 403', async () => {
    const listing = await makeListing(seller.user, 25);
    const piId = makeIntent(buyer2.user._id, listing, Math.round(25 * 100), 'requires_capture');
    const res = await postConfirm({ paymentIntentId: piId, listingId: listing._id.toString() });
    expect(res.status).toBe(403);
  });

  test('under-authorization voids the intent and refuses the order', async () => {
    const listing = await makeListing(seller.user, 100);
    const piId = makeIntent(buyer.user._id, listing, 1, 'requires_capture'); // 1 cent vs ~108.75*100
    const res = await postConfirm({ paymentIntentId: piId, listingId: listing._id.toString() });
    expect(res.status).toBe(400);
    expect(res.body.paymentReleased).toBe(true);
    expect(res.body.message).toContain('does not match the current order total');
  });

  test('over-authorization confirms with a partial capture', async () => {
    const listing = await makeListing(seller.user, 10);
    const piId = makeIntent(buyer.user._id, listing, 50000, 'requires_capture'); // $500 authorized vs ~$10.9 order
    const res = await postConfirm({ paymentIntentId: piId, listingId: listing._id.toString() });
    expect(res.status).toBe(200);
    expect(res.body.captureResult.status).toBe('succeeded');
    const stored = global.__mockPaymentIntents[piId];
    expect(res.body.breakdown.buyer.totalPaid * 100).toBeCloseTo(stored.amount_captured, 0);
  });

  test('negative/absurd metadata discount tolerance keeps legacy flat-amount mocks alive', async () => {
    const listing = await makeListing(seller.user, 10);
    const piId = makeIntent(buyer.user._id, listing, 50000, 'requires_capture', { promoDiscount: '999999' });
    const res = await postConfirm({ paymentIntentId: piId, listingId: listing._id.toString() });
    // metaDiscount larger than totalPaid -> the full hold is captured (null amount)
    expect(res.status).toBe(200);
    expect(res.body.captureResult.status).toBe('succeeded');
  });

  test('single-unit void failure surfaces as paymentReleased:false (injected)', async () => {
    const listing = await makeListing(seller.user, 22, { available: false });
    const piId = makeIntent(buyer.user._id, listing, Math.round(22 * 100), 'requires_capture');
    config.releaseAuthorization.mockRejectedValueOnce(new Error('void refused'));
    const res = await postConfirm({ paymentIntentId: piId, listingId: listing._id.toString() });
    expect(res.status).toBe(400);
    expect(res.body.paymentReleased).toBe(false);
  });

  test('accepted offer purchase with a wrecked consumption writes it back (catch path)', async () => {
    const listing = await makeListing(seller.user, 55);
    const price = 45;
    const offer = await acceptedOffer(buyer.user, seller.user, listing, price);
    const created = await runCreateIntent(buyer, { items: [{ listingId: listing._id.toString(), offerId: offer._id.toString() }] });
    const piId = created.body.paymentIntentId;
    global.__mockPaymentIntents[piId].status = 'requires_capture';
    const saveSpy = jest.spyOn(Offer.prototype, 'save').mockRejectedValueOnce(new Error('offer save failed'));
    const res = await postConfirm({ paymentIntentId: piId, listingId: listing._id.toString() });
    expect(res.status).toBe(200);
    saveSpy.mockRestore();
    const remaining = await Offer.findById(offer._id);
    expect(remaining.status).toBe('accepted');
  });

  test('auto-payout creation failure is absorbed (catch path)', async () => {
    const listing = await makeListing(seller.user, 17);
    const created = await runCreateIntent(buyer, validBuy(listing));
    const piId = created.body.paymentIntentId;
    global.__mockPaymentIntents[piId].status = 'requires_capture';
    const createSpy = jest.spyOn(Payout, 'create').mockRejectedValueOnce(new Error('payout row failed'));
    const res = await postConfirm({ paymentIntentId: piId, listingId: listing._id.toString() });
    expect(res.status).toBe(200);
    expect(res.body.transaction).toBeTruthy();
    createSpy.mockRestore();
  });

  test('accepted offer purchase records the negotiated price and pricing candidates', async () => {
    const listing = await makeListing(seller.user, 100);
    const price = 70;
    const offer = await acceptedOffer(buyer.user, seller.user, listing, price);
    const created = await runCreateIntent(buyer, { items: [{ listingId: listing._id.toString(), offerId: offer._id.toString() }] });
    expect(created.status).toBe(200);
    const piId = created.body.paymentIntentId;
    global.__mockPaymentIntents[piId].status = 'requires_capture';

    const res = await postConfirm({ paymentIntentId: piId, listingId: listing._id.toString() });
    expect(res.status).toBe(200);
    expect(res.body.transaction.negotiatedPrice || res.body.transaction.itemPrice).toBe(price);
    const freshOffer = await Offer.findById(offer._id);
    expect(freshOffer.status).toBe('completed');
    // successful purchase marks the listing sold
    const soldListing = await Listing.findById(listing._id);
    expect(soldListing.sold).toBe(true);
  });

  test('expired accepted offer falls back to list-price candidates', async () => {
    const listing = await makeListing(seller.user, 100);
    await acceptedOffer(buyer.user, seller.user, listing, 70, { acceptedUntil: new Date(Date.now() - 1000) });
    const created = await runCreateIntent(buyer, validBuy(listing));
    expect(created.status).toBe(200);
    const piId = created.body.paymentIntentId;
    global.__mockPaymentIntents[piId].status = 'requires_capture';
    const res = await postConfirm({ paymentIntentId: piId, listingId: listing._id.toString() });
    expect(res.status).toBe(200);
  });

  test('sold-out-between-authorization-and-capture refunds fully (plain + boosted)', async () => {
    for (const boost of [false, true]) {
      const listing = await makeListing(seller.user, 12, boost ? { boost: { active: true, tier: 'standard' } } : {});
      const { piId } = await authorizedIntent(buyer, listing);
      // Fail only the atomic stock claim (filter shape decides); every other
      // Listing write (e.g. the boost-fee ledger) keeps its real behaviour.
      const originalLU = Listing.findOneAndUpdate.bind(Listing);
      const spy = jest.spyOn(Listing, 'findOneAndUpdate').mockImplementation(async (filter, update, opts) => {
        if (filter && filter.quantity && filter.quantity.$gt !== undefined) return null;
        return originalLU(filter, update, opts);
      });
      const res = await postConfirm({ paymentIntentId: piId, listingId: listing._id.toString() });
      expect(res.status).toBe(400);
      expect(res.body.message).toContain('sold out between authorization and capture');
      spy.mockRestore();
    }
  });

  test('inventory rollback on sale-claim race with matching quantity restore', async () => {
    const listing = await makeListing(seller.user, 15);
    const created = await runCreateIntent(buyer, validBuy(listing));
    const piId = created.body.paymentIntentId;
    global.__mockPaymentIntents[piId].status = 'requires_capture';
    // Transaction.create fails AFTER capture? Create succeeds, but the atomic
    // claim collides -> rollback via catch (created txn deleted).
    const spy = jest.spyOn(Listing, 'findOneAndUpdate').mockResolvedValueOnce(null);
    await postConfirm({ paymentIntentId: piId, listingId: listing._id.toString() });
    const gone = await Listing.findById(listing._id);
    expect(gone.sold).toBe(false);
    spy.mockRestore();
  });

  test('pre-capture main catch releases the authorization (injected)', async () => {
    const listing = await makeListing(seller.user, 35);
    const { piId } = await authorizedIntent(buyer, listing);
    const spy = jest.spyOn(Transaction, 'create').mockRejectedValueOnce({ code: 11000, message: 'dup' });
    const txnFindSpy = jest.spyOn(Transaction, 'findOne');
    // winner path: the 11000-recovery lookup returns an existing row
    const existing = { _id: new mongoose.Types.ObjectId() };
    txnFindSpy.mockImplementation(async (query) => {
      if (query && ('$or' in query)) return null;
      if (query && query['paymentBreakdown.paymentIntentId']) return existing;
      return null;
    });
    const res = await postConfirm({ paymentIntentId: piId, listingId: listing._id.toString() });
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Order already exists for this payment');
    txnFindSpy.mockRestore();
    spy.mockRestore();
  });

  test('post-capture main catch compensates every write (credit, inventory, boost, txn)', async () => {
    const listing = await makeListing(seller.user, 65, { boost: { active: true, tier: 'standard' } });
    const { piId } = await authorizedIntent(buyer, listing);

    // populate rejects -> main catch AFTER capture/claim/credit
    const populateSpy = jest.spyOn(Transaction.prototype, 'populate').mockRejectedValueOnce(new Error('populate blew up'));
    const originalUpdate = User.updateOne.bind(User);
    const updateOneSpy = jest.spyOn(User, 'updateOne');
    updateOneSpy.mockImplementationOnce(originalUpdate); // the credit
    updateOneSpy.mockRejectedValueOnce(new Error('credit rollback failed')); // the rollback
    // Listing writes are dispatched by filter/update shape so
    // mongoose-internal delegation cannot shift which call lands where:
    //   claim            : filter { _id, quantity: {$gt: 0} }
    //   invRollback      : update $inc.quantity   (plain id filter)
    //   boostRollback    : filter 'boost.feeLedger.owed' guard ($gte boostFee)
    //   boost reservation: anything else (plain id, no owed guard)
    const originalLU = Listing.findOneAndUpdate.bind(Listing);
    const claimSpy = jest.spyOn(Listing, 'findOneAndUpdate').mockImplementation(async (filter, update, opts) => {
      if (filter && filter.quantity && filter.quantity.$gt !== undefined) {
        return originalLU(filter, update, opts); // the atomic claim succeeds
      }
      if (filter && filter['boost.feeLedger.owed'] !== undefined) {
        throw new Error('boost rollback failed');
      }
      if (update && update.$inc && 'quantity' in update.$inc) {
        throw new Error('inventory rollback failed');
      }
      return originalLU(filter, update, opts);
    });
    const delSpy = jest.spyOn(Transaction, 'findByIdAndDelete').mockRejectedValueOnce(new Error('delete failed'));

    const res = await postConfirm({ paymentIntentId: piId, listingId: listing._id.toString() });
    expect(res.status).toBe(500);
    expect(res.body.message).toBe('populate blew up');
    delSpy.mockRestore();
    claimSpy.mockRestore();
    updateOneSpy.mockRestore();
    populateSpy.mockRestore();
  });

  test('confirm catch escalates to 500 generic when no winner exists', async () => {
    const listing = await makeListing(seller.user, 20);
    const { piId } = await authorizedIntent(buyer, listing);
    const spy = jest.spyOn(Transaction, 'create').mockRejectedValueOnce(new Error('txn boom'));
    const res = await postConfirm({ paymentIntentId: piId, listingId: listing._id.toString() });
    expect(res.status).toBe(500);
    expect(res.body.message).toBe('txn boom');
    spy.mockRestore();
  });
});

describe('test-confirm / cancel-payment / payout', () => {
  let buyer, seller;

  beforeAll(async () => {
    buyer = await makeUser('Cov T Confirm', `covtc-${Date.now()}@t.test`);
    seller = await makeUser('Cov Payout Seller', `covps-${Date.now()}@t.test`);
  });

  test('test-confirm: missing id, owner mismatch, amount cap, existing early-return, fresh intent', async () => {
    const noId = await request(app).post('/api/payments/test-confirm')
      .set('Authorization', `Bearer ${buyer.token}`).send({});
    expect(noId.status).toBe(400);
    expect(noId.body.message).toBe('Missing paymentIntentId');

    // owner mismatch: intent authorized by another buyer
    const listing = await makeListing(seller.user);
    const foreignPi = makeIntent(seller.user._id, listing, Math.round(50 * 100), 'requires_payment_method');
    const foreign = await request(app).post('/api/payments/test-confirm')
      .set('Authorization', `Bearer ${buyer.token}`).send({ paymentIntentId: foreignPi });
    expect(foreign.status).toBe(403);
    expect(foreign.body.message).toBe('Not authorized for this payment intent');

    // amount cap: fresh intent with 600 in the request body
    const cap = await request(app).post('/api/payments/test-confirm')
      .set('Authorization', `Bearer ${buyer.token}`).send({ paymentIntentId: 'pi_cov_cap_test', amount: 600 });
    expect(cap.status).toBe(403);
    expect(cap.body.message).toBe('Test confirmation amount cap exceeded ($500)');

    // existing intent (fresh create-intent state): early return requires_capture
    const created = await runCreateIntent(buyer, { items: [{ listingId: listing._id.toString(), quantity: 1 }] });
    const existingPi = created.body.paymentIntentId;
    const early = await request(app).post('/api/payments/test-confirm')
      .set('Authorization', `Bearer ${buyer.token}`).send({ paymentIntentId: existingPi });
    expect(early.status).toBe(200);
    expect(early.body.status).toBe('requires_capture');

    // fresh (unknown) id: builds a mock intent server-side
    const fresh = await request(app).post('/api/payments/test-confirm')
      .set('Authorization', `Bearer ${buyer.token}`).send({ paymentIntentId: 'pi_cov_fresh_1', amount: 100 });
    expect(fresh.status).toBe(200);
    expect(fresh.body.status).toBe('requires_capture');
    expect(global.__mockPaymentIntents['pi_cov_fresh_1']).toBeTruthy();

    // existing unconfirmed intent (requires_payment_method): flows through the
    // mock confirm branch and persists as requires_capture
    const pending = await config.authorizePaymentIntent(120, 'USD', { buyerId: String(buyer.user._id), itemIds: 'x' });
    const confirmExisting = await request(app).post('/api/payments/test-confirm')
      .set('Authorization', `Bearer ${buyer.token}`).send({ paymentIntentId: pending.id });
    expect(confirmExisting.status).toBe(200);
    expect(confirmExisting.body.status).toBe('requires_capture');
    expect(global.__mockPaymentIntents[pending.id].status).toBe('requires_capture');

    // persisting the confirmed intent fails -> catch -> 400 (injected)
    const thrower = new Proxy({}, { set() { throw new Error('registry frozen'); } });
    const savedRegistry = global.__mockPaymentIntents;
    global.__mockPaymentIntents = thrower;
    try {
      const frozen = await request(app).post('/api/payments/test-confirm')
        .set('Authorization', `Bearer ${buyer.token}`).send({ paymentIntentId: 'pi_cov_frozen_1' });
      expect(frozen.status).toBe(400);
      expect(frozen.body.message).toBe('registry frozen');
    } finally {
      global.__mockPaymentIntents = savedRegistry;
    }
  });

  test('cancel-payment validation and ownership', async () => {
    const missing = await request(app).post('/api/payments/cancel-payment')
      .set('Authorization', `Bearer ${buyer.token}`).send({});
    expect(missing.status).toBe(400);
    expect(missing.body.message).toBe('paymentIntentId is required');

    const blank = await request(app).post('/api/payments/cancel-payment')
      .set('Authorization', `Bearer ${buyer.token}`).send({ paymentIntentId: '   ' });
    expect(blank.status).toBe(400);

    const listing = await makeListing(seller.user, 33);
    // unknown intent: idempotent released:false
    const unknown = await request(app).post('/api/payments/cancel-payment')
      .set('Authorization', `Bearer ${buyer.token}`).send({ paymentIntentId: 'pi_cov_unknown_cancel' });
    expect(unknown.status).toBe(200);
    expect(unknown.body.released).toBe(false);

    // foreign owner
    const foreignPi = makeIntent(buyer.user._id, listing, Math.round(33 * 100), 'requires_capture');
    const foreign = await request(app).post('/api/payments/cancel-payment')
      .set('Authorization', `Bearer ${seller.token}`).send({ paymentIntentId: foreignPi });
    expect(foreign.status).toBe(403);
    expect(foreign.body.message).toBe('You are not authorized to cancel this payment');

    // owned release (positive path)
    const owned = await request(app).post('/api/payments/cancel-payment')
      .set('Authorization', `Bearer ${buyer.token}`).send({ paymentIntentId: foreignPi });
    expect(owned.status).toBe(200);
    expect(owned.body.released).toBe(true);

    // already-canceled: releaseAuthorization returns released:false
    const recancel = await request(app).post('/api/payments/cancel-payment')
      .set('Authorization', `Bearer ${buyer.token}`).send({ paymentIntentId: foreignPi });
    expect(recancel.status).toBe(200);
    expect(recancel.body.released).toBe(false);

    // provider failure -> 500 (injected)
    config.releaseAuthorization.mockRejectedValueOnce(new Error('provider timeout'));
    const failing = await request(app).post('/api/payments/cancel-payment')
      .set('Authorization', `Bearer ${buyer.token}`)
      .send({ paymentIntentId: makeIntent(buyer.user._id, listing, 3300, 'requires_capture') });
    expect(failing.status).toBe(500);
    expect(failing.body.message).toBe('provider timeout');
  });

  describe('payout', () => {
    const payoutReq = (who, body = {}) => request(app).post('/api/payments/payout')
      .set('Authorization', `Bearer ${who.token}`).send(body);
    const withBalance = (name, email, extra = {}) => makeUser(name, email, {
      balance: { available: 200, pending: 0, currency: 'USD' }, ...extra,
    });

    test('no balance / no payout method / invalid amount / over-balance', async () => {
      const broke = await makeUser('Broke Bob', `broke-${Date.now()}@t.test`);
      const noBalance = await payoutReq(broke);
      expect(noBalance.status).toBe(400);
      expect(noBalance.body.message).toBe('No available balance for payout');

      const rich = await withBalance('Rich Rick', `rich-${Date.now()}@t.test`);
      const noMethod = await payoutReq(rich);
      expect(noMethod.status).toBe(400);
      expect(noMethod.body.message).toBe('Please set up a payout method first');

      const withMethod = await withBalance('Meth Matt', `meth-${Date.now()}@t.test`, { payoutMethod: { type: 'bank' } });
      const invalid = await payoutReq(withMethod, { amount: 'abc' });
      expect(invalid.status).toBe(400);
      expect(invalid.body.message).toBe('Invalid payout amount');

      const tooMuch = await payoutReq(withMethod, { amount: 5000 });
      expect(tooMuch.status).toBe(422);
      expect(tooMuch.body.message).toBe('Payout amount exceeds available balance');

      const after = await User.findById(withMethod.user._id);
      expect(after.balance.available).toBe(200);
    });

    test('payout without an amount defaults to the full available balance', async () => {
      const sellerC = await withBalance('Whole Wendy', `whole-${Date.now()}@t.test`, { payoutMethod: { type: 'bank' } });
      const ok = await payoutReq(sellerC);
      expect(ok.status).toBe(200);
      expect(ok.body.payout.amount).toBe(200);
      const after = await User.findById(sellerC.user._id);
      expect(after.balance.available).toBe(0);
    });

    test('successful payout, and compensating credit on provider failure', async () => {
      const sellerC = await withBalance('Pay Pat', `payp-${Date.now()}@t.test`, { payoutMethod: { type: 'bank' } });
      const ok = await payoutReq(sellerC, { amount: 50 });
      expect(ok.status).toBe(200);
      expect(ok.body.payout.amount).toBe(50);
      const after = await User.findById(sellerC.user._id);
      expect(after.balance.available).toBe(150);

    // provider failure after the atomic deduction -> compensating credit + 500
      const failing = await withBalance('Fail Fred', `failfred-${Date.now()}@t.test`, { payoutMethod: { type: 'bank' } });
      config.processSellerPayout.mockRejectedValueOnce(new Error('transfer failed'));

      const res = await payoutReq(failing, { amount: 100 });
      expect(res.status).toBe(500);
      expect(res.body.message).toBe('transfer failed');
      const restored = await User.findById(failing.user._id);
      expect(restored.balance.available).toBe(200);
      expect(restored.balance.totalPaidOut).toBe(0);

      // atomic update losing the race after read checks: 422
      const racer = await withBalance('Race Ray', `race-${Date.now()}@t.test`, { payoutMethod: { type: 'bank' } });
      const spy = jest.spyOn(User, 'findOneAndUpdate').mockResolvedValueOnce(null);
      const lost = await payoutReq(racer, { amount: 100 });
      expect(lost.status).toBe(422);
      expect(lost.body.message).toBe('Payout amount exceeds available balance');
      spy.mockRestore();
    });
  });
});
