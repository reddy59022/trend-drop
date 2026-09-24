/**
 * Settlement idempotency (regression suite).
 *
 * Completing an order moves real money: the seller's escrowed earnings go
 * pending → available (minus the 10% rolling reserve). Five different code
 * paths can perform that release for the same transaction — the nightly cron,
 * the manual `auto-complete` endpoint, the `auto-process` endpoint, the
 * `reject-return` settlement, and the escrow dispute resolution.
 *
 * Every one of those paths is *retryable*: if a later step (buyer stats, the
 * final status write, the payout record) fails, the route/cron releases its
 * claim so the operation can be attempted again. That is the correct
 * behaviour — but it only works if the release itself is idempotent. It was
 * not: `releaseSellerEarnings` is a blind `$inc`/`$add` pipeline, so a retry
 * after a failure that happened *after* the money moved credited the seller a
 * second time. The platform paid the same sale twice, and the duplicated
 * `balance.reserveReleaseDate` entry also queued a second reserve payout.
 *
 * These tests drive each path into that exact failure mode (a write fails
 * immediately after the release) and assert the money moved exactly once while
 * the order still reaches `completed` on the retry.
 */
const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const app = require('../server');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Transaction = require('../models/Transaction');
const Payout = require('../models/Payout');
const Return = require('../models/Return');
const { orderStates } = require('../config/orderLifecycle');
const { autoProcessOrders } = require('../config/cron');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';
const tokenFor = (id) => jwt.sign({ id }, JWT_SECRET, { expiresIn: '30d' });

const TEST_RUN_ID = `settleidem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

// Fixture money: 92 escrowed → 9.20 reserve → 82.80 available.
const EARNINGS = 92;
const RESERVE = 9.2;
const AVAILABLE = 82.8;

const daysAgo = (days) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);

/**
 * Fail fast when a route neither responds nor throws — a route whose catch
 * block throws leaves the request hanging, which would otherwise burn the
 * whole jest timeout.
 */
const withTimeout = (promise, ms = 5000, label = 'route') => {
  let timer;
  const guard = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} did not respond within ${ms}ms`)), ms);
  });
  return Promise.race([promise, guard]).finally(() => clearTimeout(timer));
};

/**
 * Make the Nth save() of ONE user fail, and only that one: every later save of
 * the same document succeeds, so the retry inside the same test is a normal
 * run. Targeting by id (not by call position) keeps the test independent of
 * iteration order, and `failOn` picks which write breaks when a route saves
 * the same user both before and after the release.
 */
const poisonUserSaves = (userId, failOn = 1) => {
  const realSave = User.prototype.save;
  let seen = 0;
  jest.spyOn(User.prototype, 'save').mockImplementation(async function save(...args) {
    if (String(this._id) === String(userId)) {
      seen += 1;
      if (seen === failOn) throw new Error('db unavailable');
    }
    return realSave.apply(this, args);
  });
};

/** A seller/buyer/listing triple owned by this test only, so balance arithmetic is exact. */
const makeWorld = async (label) => {
  const seller = await User.create({
    name: `Settlement Seller ${label}`,
    email: `settleseller_${label}_${TEST_RUN_ID}@test.com`,
    password: 'password123',
    emailVerified: true,
    authProvider: 'email',
    country: 'US',
    currency: 'USD',
    role: 'user',
    // Past the new-seller hold, otherwise funds stay parked in pending.
    stats: { totalSales: 10, totalPurchases: 0, strikes: 0 },
    // Escrowed state: the purchase path credits `pending` only — totalEarned is
    // incremented by the release, so a second release shows up here too.
    balance: { available: 0, pending: EARNINGS, totalEarned: 0, totalPaidOut: 0, currency: 'USD' },
  });
  const buyer = await User.create({
    name: `Settlement Buyer ${label}`,
    email: `settlebuyer_${label}_${TEST_RUN_ID}@test.com`,
    password: 'password123',
    emailVerified: true,
    authProvider: 'email',
    country: 'US',
    currency: 'USD',
    role: 'user',
    balance: { available: 0, pending: 0, totalEarned: 0, totalPaidOut: 0, currency: 'USD' },
  });
  const listing = await Listing.create({
    seller: seller._id,
    title: `Settlement Item ${label} ${TEST_RUN_ID}`,
    description: 'Fixture listing for settlement idempotency tests',
    price: 100,
    category: 'Men',
    condition: 'New with tags',
    available: true,
    sold: false,
    quantity: 5,
    shipsFrom: 'US',
    weight: 1,
  });
  return { seller, buyer, listing, sellerToken: tokenFor(seller._id) };
};

/** A `buyer_confirmed` order whose return windows have both expired. */
const createConfirmedTxn = (world, overrides = {}) =>
  Transaction.create({
    listing: world.listing._id,
    buyer: world.buyer._id,
    seller: world.seller._id,
    itemPrice: 100,
    currency: 'USD',
    quantity: 1,
    paymentBreakdown: {
      subtotal: 100,
      shippingCost: 10,
      buyerProtectionFee: 5,
      buyerProtectionPercent: 5,
      tax: 0,
      totalPaid: 115,
      platformFee: 8,
      platformFeePercent: 8,
      shippingPayout: 10,
      sellerEarnings: EARNINGS,
    },
    shipping: {
      carrier: 'USPS',
      trackingNumber: `TRK-${TEST_RUN_ID}`,
      labelCreated: true,
      labelCreatedDate: daysAgo(7),
      actualDelivery: daysAgo(6),
      trackingHistory: [],
    },
    status: orderStates.BUYER_CONFIRMED,
    buyerConfirmed: { received: true, confirmedAt: daysAgo(4) },
    payout: { status: 'pending', transactionId: '' },
    ...overrides,
  });

/**
 * The contract under test: the seller was credited for this sale exactly once
 * (money, reserve queue, and counters), and the order reached `completed`.
 */
const expectSettledExactlyOnce = async (sellerId, txnId) => {
  const seller = await User.findById(sellerId);
  expect(seller.balance.available).toBeCloseTo(AVAILABLE, 2);
  expect(seller.balance.pending).toBe(0);
  expect(seller.balance.totalEarned).toBeCloseTo(EARNINGS, 2);
  expect(seller.balance.reserve).toBeCloseTo(RESERVE, 2);
  // The rolling-reserve queue is what a later cron job pays out. A duplicated
  // entry means the reserve is released twice as well.
  expect(seller.balance.reserveReleaseDate).toHaveLength(1);
  expect(seller.stats.totalSales).toBe(11);

  const txn = await Transaction.findById(txnId);
  expect(txn.status).toBe(orderStates.COMPLETED);
  expect(txn.completionProcessing).toBe(false);

  const payouts = await Payout.find({ transaction: txnId });
  expect(payouts).toHaveLength(1);
  expect(payouts[0].status).toBe('completed');
};

/** Assert the first attempt really did move the money (otherwise the test is vacuous). */
const expectCreditedOnce = async (sellerId) => {
  const seller = await User.findById(sellerId);
  expect(seller.balance.available).toBeCloseTo(AVAILABLE, 2);
  expect(seller.balance.reserveReleaseDate).toHaveLength(1);
};

beforeAll(async () => {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/trend-drop-test';
  if (mongoose.connection.readyState === 0) await mongoose.connect(uri);
});

afterAll(async () => {
  // jest.setup.js clears the DB between files; this keeps a standalone run tidy.
  await Transaction.deleteMany({});
  await Return.deleteMany({});
  await Listing.deleteMany({});
  await User.deleteMany({});
});

beforeEach(async () => {
  // Each test builds its own world; leftover orders must not be picked up by
  // the cron job running inside the next test.
  await Transaction.deleteMany({});
  await Payout.deleteMany({});
  await Return.deleteMany({});
  await Listing.deleteMany({});
  await User.deleteMany({});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('Order settlement must be exactly-once', () => {
  test('SID.1 nightly cron retry does not pay the seller twice', async () => {
    const world = await makeWorld('cron');
    const txn = await createConfirmedTxn(world);

    // The release succeeds; the buyer's stats write right after it fails.
    poisonUserSaves(world.buyer._id, 1);

    await withTimeout(autoProcessOrders(), 5000, 'autoProcessOrders');

    const halfway = await Transaction.findById(txn._id);
    expect(halfway.status).toBe(orderStates.BUYER_CONFIRMED);
    expect(halfway.completionProcessing).toBe(false);
    await expectCreditedOnce(world.seller._id);

    // Cron runs again (next night, or an operator retry) and must finish the
    // order without paying for it a second time.
    await withTimeout(autoProcessOrders(), 5000, 'autoProcessOrders retry');

    await expectSettledExactlyOnce(world.seller._id, txn._id);
  });

  test('SID.2 manual auto-complete retry does not pay the seller twice', async () => {
    const world = await makeWorld('manual');
    const txn = await createConfirmedTxn(world);
    poisonUserSaves(world.buyer._id, 1);

    const first = await withTimeout(
      request(app)
        .post(`/api/orders/${txn._id}/auto-complete`)
        .set('Authorization', `Bearer ${world.sellerToken}`)
        .send({}),
      5000,
      'auto-complete',
    );
    expect(first.status).toBe(500);
    await expectCreditedOnce(world.seller._id);

    const retry = await withTimeout(
      request(app)
        .post(`/api/orders/${txn._id}/auto-complete`)
        .set('Authorization', `Bearer ${world.sellerToken}`)
        .send({}),
      5000,
      'auto-complete retry',
    );
    // The retry must succeed (the money is already with the seller) ...
    expect(retry.status).toBe(200);

    // ... and settle exactly once.
    await expectSettledExactlyOnce(world.seller._id, txn._id);
  });

  test('SID.3 auto-process retry does not pay the seller twice', async () => {
    const world = await makeWorld('autoprocess');
    const txn = await createConfirmedTxn(world);

    // In this path the seller document itself is saved right after the release.
    poisonUserSaves(world.seller._id, 1);

    const first = await withTimeout(
      request(app).post('/api/orders/auto-process').send({}),
      5000,
      'auto-process',
    );
    expect(first.status).toBe(200);
    await expectCreditedOnce(world.seller._id);

    const retry = await withTimeout(
      request(app).post('/api/orders/auto-process').send({}),
      5000,
      'auto-process retry',
    );
    expect(retry.status).toBe(200);
    expect(retry.body.autoCompleted).toBe(1);

    await expectSettledExactlyOnce(world.seller._id, txn._id);
  });

  test('SID.4 rejected-return settlement retry does not pay the seller twice', async () => {
    const world = await makeWorld('rejectreturn');
    // A rejected return finalizes as a completed sale: the seller keeps the
    // money. The route may only be reached from `return_requested`.
    const txn = await createConfirmedTxn(world, { status: orderStates.RETURN_REQUESTED });

    // This route saves the buyer once *before* the release (the rejection
    // notice) and once after it, so the failure has to land on the second save.
    poisonUserSaves(world.buyer._id, 2);

    const first = await withTimeout(
      request(app)
        .post(`/api/orders/${txn._id}/reject-return`)
        .set('Authorization', `Bearer ${world.sellerToken}`)
        .send({ reason: 'Item was returned damaged' }),
      5000,
      'reject-return',
    );
    expect(first.status).toBe(500);
    await expectCreditedOnce(world.seller._id);

    const retry = await withTimeout(
      request(app)
        .post(`/api/orders/${txn._id}/reject-return`)
        .set('Authorization', `Bearer ${world.sellerToken}`)
        .send({ reason: 'Item was returned damaged' }),
      5000,
      'reject-return retry',
    );
    expect(retry.status).toBe(200);

    await expectSettledExactlyOnce(world.seller._id, txn._id);
  });
});
