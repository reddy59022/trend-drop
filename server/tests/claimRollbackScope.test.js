/**
 * Failed-settlement retryability (regression suite).
 *
 * Every money-moving route claims its work first — an atomic
 * `findOneAndUpdate` that flips a `*Processing` flag (or advances a Return's
 * status) so a duplicate click / cron retry cannot settle the same order
 * twice. If a LATER step fails, the route's catch block is supposed to release
 * that claim so the operation stays retryable.
 *
 * All of those rollback guards used to read a variable declared *inside* the
 * `try` block (`let txn` / `let returnRequest` / `let event`). `let` is
 * block-scoped, so the catch could never see the binding:
 *
 *   - guards written as `typeof txn !== 'undefined' && txn?.…` silently
 *     evaluated to false → the rollback was skipped and the record stayed
 *     claimed forever (a stuck order can never be retried or refunded);
 *   - guards that dereferenced the variable directly threw a ReferenceError
 *     *from inside the catch*, so the request never answered at all and the
 *     failure surfaced only as an unhandled rejection.
 *
 * These tests drive each route into that exact failure mode (a database write
 * after the claim fails) and assert the user-visible contract: a clean HTTP
 * error, and a record left retryable.
 */
const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const app = require('../server');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Transaction = require('../models/Transaction');
const Return = require('../models/Return');
const { orderStates } = require('../config/orderLifecycle');
const { autoProcessOrders, releaseReserves } = require('../config/cron');
const authorizedPaymentIntent = require('./helpers/authorizedPayment');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';
const tokenFor = (id) => jwt.sign({ id }, JWT_SECRET, { expiresIn: '30d' });

const TEST_RUN_ID = `claimrollback_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

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
 * Make exactly ONE document's save() fail. The auto-process job iterates in
 * unspecified order, so the failure must be targeted by id rather than by
 * call position.
 */
const poisonSaveOnce = (poisonedId) => {
  const realSave = Transaction.prototype.save;
  let fired = false;
  jest.spyOn(Transaction.prototype, 'save').mockImplementation(async function save(...args) {
    if (!fired && String(this._id) === String(poisonedId)) {
      fired = true;
      throw new Error('db unavailable');
    }
    return realSave.apply(this, args);
  });
};

const confirmedLongAgo = () => ({
  buyerConfirmed: { received: true, confirmedAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000) },
});

let admin, seller, buyer;
let adminToken, sellerToken, buyerToken;
let listing;

const createUser = async (name, prefix, overrides = {}) => {
  const user = await User.create({
    name,
    email: `${prefix}_${TEST_RUN_ID}@test.com`,
    password: 'password123',
    emailVerified: true,
    authProvider: 'email',
    country: 'US',
    currency: 'USD',
    role: 'user',
    shippingAddress: {
      fullName: name,
      street1: '1 Test Way',
      city: 'Austin',
      state: 'TX',
      postalCode: '78701',
      country: 'US',
    },
    balance: { available: 0, pending: 0, totalEarned: 0, totalPaidOut: 0, currency: 'USD' },
    ...overrides,
  });
  return user;
};

const createTransaction = (status, overrides = {}) =>
  Transaction.create({
    listing: listing._id,
    buyer: buyer._id,
    seller: seller._id,
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
      sellerEarnings: 92,
    },
    shipping: {
      carrier: 'USPS',
      trackingNumber: `TRK-${TEST_RUN_ID}`,
      labelCreated: true,
      labelCreatedDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      actualDelivery: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000),
      trackingHistory: [],
    },
    status,
    payout: { status: 'pending', transactionId: '' },
    ...overrides,
  });

beforeAll(async () => {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/trend-drop-test';
  if (mongoose.connection.readyState === 0) await mongoose.connect(uri);

  admin = await createUser('Claim Admin', 'admin', { role: 'admin' });
  // totalSales >= NEW_SELLER_THRESHOLD so auto-complete is not parked on the
  // 14-day new-seller hold.
  seller = await createUser('Claim Seller', 'seller', {
    stats: { totalSales: 10, totalPurchases: 0, strikes: 0 },
    balance: { available: 0, pending: 92, totalEarned: 92, totalPaidOut: 0, currency: 'USD' },
  });
  buyer = await createUser('Claim Buyer', 'buyer');

  adminToken = tokenFor(admin._id);
  sellerToken = tokenFor(seller._id);
  buyerToken = tokenFor(buyer._id);

  listing = await Listing.create({
    seller: seller._id,
    title: `Claim Rollback Item ${TEST_RUN_ID}`,
    description: 'Fixture listing for failed-settlement retryability tests',
    price: 100,
    category: 'Men',
    condition: 'New with tags',
    available: true,
    sold: false,
    quantity: 5,
    shipsFrom: 'US',
    weight: 1,
  });
});

afterAll(async () => {
  // jest.setup.js clears the DB between files; this keeps a standalone run tidy.
  await Return.deleteMany({ seller: seller._id });
  await Transaction.deleteMany({ seller: seller._id });
  await Listing.deleteMany({ _id: listing._id });
  await User.deleteMany({ _id: { $in: [admin._id, seller._id, buyer._id] } });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('Failed settlement must leave the claim retryable', () => {
  test('CRS.1 admin refund releases the refundProcessing claim when local settlement fails', async () => {
    const paymentIntentId = authorizedPaymentIntent('succeeded');
    const txn = await createTransaction(orderStates.PAID, {
      payout: { status: 'pending', transactionId: paymentIntentId },
    });

    // Provider refund succeeds; the final settle write then fails. This is the
    // harder case: the document has already been mutated in memory, so a guard
    // that reads in-memory state would wrongly consider the refund settled.
    jest.spyOn(Transaction.prototype, 'save').mockRejectedValueOnce(new Error('db unavailable'));

    const res = await withTimeout(
      request(app)
        .post(`/api/admin/transactions/${txn._id}/refund`)
        .set('Authorization', `Bearer ${adminToken}`),
      5000,
      'admin refund',
    );

    expect(res.status).toBe(500);

    const after = await Transaction.findById(txn._id);
    // The admin must be able to retry: an unresolved claim permanently blocks it.
    expect(after.refundProcessing).toBe(false);
  });

  test('CRS.2 returns /receive reverts the Return to shipped when local settlement fails', async () => {
    const txn = await createTransaction(orderStates.REFUNDED);
    const returnRequest = await Return.create({
      transaction: txn._id,
      buyer: buyer._id,
      seller: seller._id,
      listing: listing._id,
      reason: 'Defective',
      status: 'shipped',
      refundAmount: 115,
      returnShippingResponsibility: 'seller',
    });

    // Provider refund is skipped (no intent on this order); the first unguarded
    // local write is the Return settle, which fails here.
    jest.spyOn(Return.prototype, 'save').mockRejectedValueOnce(new Error('db unavailable'));

    const res = await withTimeout(
      request(app)
        .put(`/api/returns/${returnRequest._id}/receive`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({}),
      5000,
      'returns receive',
    );

    expect(res.status).toBe(500);

    const after = await Return.findById(returnRequest._id);
    // Still 'received' means the seller can never retry the refund.
    expect(after.status).toBe('shipped');
  });

  test('CRS.3 auto-complete clears completionProcessing when releasing funds fails', async () => {
    const txn = await createTransaction(orderStates.BUYER_CONFIRMED, {
      buyerConfirmed: { received: true, confirmedAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000) },
    });

    // The final settle write fails after the in-memory flag was already cleared.
    jest.spyOn(Transaction.prototype, 'save').mockRejectedValueOnce(new Error('db unavailable'));

    const res = await withTimeout(
      request(app)
        .post(`/api/orders/${txn._id}/auto-complete`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({}),
      5000,
      'auto-complete',
    );

    expect(res.status).toBe(500);

    const after = await Transaction.findById(txn._id);
    expect(after.completionProcessing).toBe(false);
  });

  test('CRS.4 confirm-return-received clears returnProcessing when the unwind fails', async () => {
    const txn = await createTransaction(orderStates.RETURN_IN_TRANSIT);

    jest.spyOn(Transaction.prototype, 'save').mockRejectedValueOnce(new Error('db unavailable'));

    const res = await withTimeout(
      request(app)
        .post(`/api/orders/${txn._id}/confirm-return-received`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({}),
      5000,
      'confirm-return-received',
    );

    expect(res.status).toBe(500);

    const after = await Transaction.findById(txn._id);
    expect(after.returnProcessing).toBe(false);
  });

  test('CRS.5 process-return clears returnProcessing when the unwind fails', async () => {
    const txn = await createTransaction(orderStates.RETURN_DELIVERED);

    jest.spyOn(Transaction.prototype, 'save').mockRejectedValueOnce(new Error('db unavailable'));

    const res = await withTimeout(
      request(app)
        .post(`/api/orders/${txn._id}/process-return`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({}),
      5000,
      'process-return',
    );

    expect(res.status).toBe(500);

    const after = await Transaction.findById(txn._id);
    expect(after.returnProcessing).toBe(false);
  });

  test('CRS.7 auto-process isolates a failing order and leaves it retryable', async () => {
    const poisoned = await createTransaction(orderStates.BUYER_CONFIRMED, confirmedLongAgo());
    const healthy = await createTransaction(orderStates.BUYER_CONFIRMED, confirmedLongAgo());
    poisonSaveOnce(poisoned._id);

    const res = await withTimeout(
      request(app).post('/api/orders/auto-process').send({}),
      5000,
      'auto-process',
    );

    // One poisoned order must not abort the whole payout run.
    expect(res.status).toBe(200);

    const afterHealthy = await Transaction.findById(healthy._id);
    expect(afterHealthy.status).toBe(orderStates.COMPLETED);
    const paidSeller = await User.findById(seller._id);
    expect(paidSeller.balance.available).toBeGreaterThan(0);

    // ...and the poisoned order must stay retryable instead of being claimed forever.
    const afterPoisoned = await Transaction.findById(poisoned._id);
    expect(afterPoisoned.completionProcessing).toBe(false);
    expect(afterPoisoned.status).toBe(orderStates.BUYER_CONFIRMED);
  });

  test('CRS.8 nightly cron isolates a failing order and leaves it retryable', async () => {
    const poisoned = await createTransaction(orderStates.BUYER_CONFIRMED, confirmedLongAgo());
    const healthy = await createTransaction(orderStates.BUYER_CONFIRMED, confirmedLongAgo());
    poisonSaveOnce(poisoned._id);

    await withTimeout(autoProcessOrders(), 5000, 'cron autoProcessOrders');

    const afterHealthy = await Transaction.findById(healthy._id);
    expect(afterHealthy.status).toBe(orderStates.COMPLETED);

    const afterPoisoned = await Transaction.findById(poisoned._id);
    expect(afterPoisoned.completionProcessing).toBe(false);
    expect(afterPoisoned.status).toBe(orderStates.BUYER_CONFIRMED);
  });

  test('CRS.10 a failing delivery advance does not block the payout phase', async () => {
    const deliveredShipping = (tracking) => ({
      carrier: 'USPS',
      trackingNumber: tracking,
      labelCreated: true,
      labelCreatedDate: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
      actualDelivery: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000),
      trackingHistory: [],
    });

    const poisoned = await createTransaction(orderStates.DELIVERED, { shipping: deliveredShipping('POISON') });
    const healthyDelivered = await createTransaction(orderStates.DELIVERED, { shipping: deliveredShipping('HEALTHY') });
    const awaitingPayout = await createTransaction(orderStates.BUYER_CONFIRMED, confirmedLongAgo());

    const realSave = Transaction.prototype.save;
    jest.spyOn(Transaction.prototype, 'save').mockImplementation(async function save(...args) {
      if (String(this._id) === String(poisoned._id)) throw new Error('db unavailable');
      return realSave.apply(this, args);
    });

    await withTimeout(autoProcessOrders(), 5000, 'autoProcessOrders');

    // The fund-release phase must still run even though phase 1 hit a bad row.
    const paid = await Transaction.findById(awaitingPayout._id);
    expect(paid.status).toBe(orderStates.COMPLETED);

    // The other delivery still advances; the failing one stays retryable.
    const advanced = await Transaction.findById(healthyDelivered._id);
    expect(advanced.status).toBe(orderStates.BUYER_CONFIRMED);
    const stillDelivered = await Transaction.findById(poisoned._id);
    expect(stillDelivered.status).toBe(orderStates.DELIVERED);
  });

  test('CRS.9 nightly reserve release is isolated per seller', async () => {
    const maturedReserve = [{
      amount: 20,
      releaseDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
      transactionId: new mongoose.Types.ObjectId(),
    }];
    const reserveBalance = () => ({
      available: 0,
      pending: 0,
      totalEarned: 0,
      totalPaidOut: 0,
      currency: 'USD',
      reserve: 20,
      reserveReleaseDate: maturedReserve.map((e) => ({ ...e })),
    });

    // Created first so natural collection order puts the poisoned seller ahead
    // of the healthy ones.
    const poisoned = await createUser('Reserve Poisoned', 'reservepoisoned', { balance: reserveBalance() });
    const healthyA = await createUser('Reserve Healthy A', 'reservehealthya', { balance: reserveBalance() });
    const healthyB = await createUser('Reserve Healthy B', 'reservehealthyb', { balance: reserveBalance() });

    const realSave = User.prototype.save;
    jest.spyOn(User.prototype, 'save').mockImplementation(async function save(...args) {
      if (String(this._id) === String(poisoned._id)) throw new Error('db unavailable');
      return realSave.apply(this, args);
    });

    await withTimeout(releaseReserves(), 5000, 'releaseReserves');

    // Every healthy seller must still get their matured reserve...
    for (const seller of [healthyA, healthyB]) {
      const after = await User.findById(seller._id);
      expect(after.balance.available).toBe(20);
      expect(after.balance.reserveReleaseDate).toHaveLength(0);
    }

    // ...while the failing seller keeps theirs queued for the next run.
    const afterPoisoned = await User.findById(poisoned._id);
    expect(afterPoisoned.balance.available).toBe(0);
    expect(afterPoisoned.balance.reserveReleaseDate).toHaveLength(1);
  });

  test('CRS.11 cron reclaims a claim abandoned by a dead worker so the seller is paid', async () => {
    const before = await User.findById(seller._id);
    // A deploy restart / OOM kill between the claim and the release leaves the
    // flag set with nobody left to clear it. The order can then never complete
    // and the escrowed earnings are stranded.
    const txn = await createTransaction(orderStates.BUYER_CONFIRMED, {
      ...confirmedLongAgo(),
      completionProcessing: true,
      completionClaimedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    });

    await withTimeout(autoProcessOrders(), 5000, 'autoProcessOrders');

    const after = await Transaction.findById(txn._id);
    expect(after.status).toBe(orderStates.COMPLETED);
    expect(after.completionProcessing).toBe(false);

    const paid = await User.findById(seller._id);
    expect(paid.balance.available - before.balance.available).toBeCloseTo(82.8, 2);
  });

  test('CRS.12 manual auto-complete reclaims an abandoned claim instead of refusing forever', async () => {
    const before = await User.findById(seller._id);
    const txn = await createTransaction(orderStates.BUYER_CONFIRMED, {
      ...confirmedLongAgo(),
      completionProcessing: true,
      completionClaimedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    });

    const res = await withTimeout(
      request(app)
        .post(`/api/orders/${txn._id}/auto-complete`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({}),
      5000,
      'auto-complete',
    );

    expect(res.status).toBe(200);
    const after = await Transaction.findById(txn._id);
    expect(after.status).toBe(orderStates.COMPLETED);

    const paid = await User.findById(seller._id);
    expect(paid.balance.available - before.balance.available).toBeCloseTo(82.8, 2);
  });

  test('CRS.13 a live claim is not trampled by a concurrent worker', async () => {
    const before = await User.findById(seller._id);
    // Claimed a moment ago: the worker is still running, so the claim must hold.
    const txn = await createTransaction(orderStates.BUYER_CONFIRMED, {
      ...confirmedLongAgo(),
      completionProcessing: true,
      completionClaimedAt: new Date(),
    });

    await withTimeout(autoProcessOrders(), 5000, 'autoProcessOrders');

    const after = await Transaction.findById(txn._id);
    expect(after.status).toBe(orderStates.BUYER_CONFIRMED);
    expect(after.completionProcessing).toBe(true);

    const paid = await User.findById(seller._id);
    expect(paid.balance.available - before.balance.available).toBe(0);
  });

  test('CRS.6 stripe webhook answers 500 when the handler itself fails', async () => {
    jest.spyOn(Transaction, 'findOne').mockRejectedValueOnce(new Error('db unavailable'));

    const res = await withTimeout(
      request(app)
        .post('/api/payments/webhook')
        .set('stripe-signature', 'whsec_test_sig')
        .send({
          id: 'evt_claim_rollback',
          type: 'charge.dispute.created',
          data: {
            object: {
              id: 'dp_claim_rollback',
              payment_intent: 'pi_claim_rollback',
              reason: 'fraudulent',
              status: 'needs_response',
            },
          },
        }),
      5000,
      'stripe webhook',
    );

    // Stripe retries only when it gets a 5xx; a throwing catch block means no
    // response at all, so the event is silently dropped.
    expect(res.status).toBe(500);
    expect(res.body.message).toBe('Webhook handler error');
  });
});
