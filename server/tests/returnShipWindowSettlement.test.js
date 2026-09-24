/**
 * Abandoned-return settlement (regression suite).
 *
 * A seller accepts a return; the buyer then never ships the item inside the
 * return ship window. The sale stands, so the cron sets the transaction back to
 * `completed` — but it never moved the seller's money, and the completion job
 * cannot either (its watch-list is `buyer_confirmed`, so an order that was
 * already flipped to `completed` is never looked at again). For any order that
 * was still un-completed when the return was opened, the earnings sat in
 * `balance.pending` forever.
 *
 * Paying it out is only correct for THAT case, though: a return can also be
 * opened on an order that already paid its seller. These tests pin both
 * directions — the seller is paid exactly once, never twice — including the
 * ledger shapes legacy rows have (no release marker).
 */
const mongoose = require('mongoose');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Transaction = require('../models/Transaction');
const Payout = require('../models/Payout');
const { orderStates, timeWindows } = require('../config/orderLifecycle');
const { autoProcessReturns } = require('../config/cron');

const TEST_RUN_ID = `abandoned_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const EARNINGS = 92;
const RESERVE = 9.2;
const AVAILABLE = 82.8;

/** Comfortably past the ship window regardless of its configured length. */
const shippedWindowExpired = () =>
  new Date(Date.now() - timeWindows.RETURN_SHIP_WINDOW - 24 * 60 * 60 * 1000);

const makeWorld = async (label, balance) => {
  const seller = await User.create({
    name: `Abandoned Seller ${label}`,
    email: `abandonedseller_${label}_${TEST_RUN_ID}@test.com`,
    password: 'password123',
    emailVerified: true,
    authProvider: 'email',
    country: 'US',
    currency: 'USD',
    role: 'user',
    stats: { totalSales: 10, totalPurchases: 0, strikes: 0 },
    balance: {
      available: 0,
      pending: EARNINGS,
      totalEarned: 0,
      totalPaidOut: 0,
      currency: 'USD',
      ...balance,
    },
  });
  const buyer = await User.create({
    name: `Abandoned Buyer ${label}`,
    email: `abandonedbuyer_${label}_${TEST_RUN_ID}@test.com`,
    password: 'password123',
    emailVerified: true,
    authProvider: 'email',
    country: 'US',
    currency: 'USD',
    role: 'user',
  });
  const listing = await Listing.create({
    seller: seller._id,
    title: `Abandoned Item ${label} ${TEST_RUN_ID}`,
    description: 'Fixture listing for abandoned-return settlement tests',
    price: 100,
    category: 'Men',
    condition: 'New with tags',
    available: true,
    sold: false,
    quantity: 5,
    shipsFrom: 'US',
    weight: 1,
  });
  return { seller, buyer, listing };
};

/** A return the seller accepted, whose buyer never shipped the item. */
const createAcceptedReturn = (world, overrides = {}) =>
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
      labelCreatedDate: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      actualDelivery: new Date(Date.now() - 9 * 24 * 60 * 60 * 1000),
      trackingHistory: [],
    },
    status: orderStates.RETURN_ACCEPTED,
    returnDetails: { requestedAt: shippedWindowExpired(), acceptedAt: shippedWindowExpired() },
    payout: { status: 'pending', transactionId: '' },
    ...overrides,
  });

const createPayout = (world, txn, status) =>
  Payout.create({
    seller: world.seller._id,
    transaction: txn._id,
    listing: world.listing._id,
    salePrice: 100,
    commissionRate: 0.08,
    commissionAmount: 8,
    payoutAmount: EARNINGS,
    status,
    ...(status === 'completed' ? { paidAt: new Date() } : {}),
  });

beforeAll(async () => {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/trend-drop-test';
  if (mongoose.connection.readyState === 0) await mongoose.connect(uri);
});

afterAll(async () => {
  await Transaction.deleteMany({});
  await Payout.deleteMany({});
  await Listing.deleteMany({});
  await User.deleteMany({});
});

beforeEach(async () => {
  await Transaction.deleteMany({});
  await Payout.deleteMany({});
  await Listing.deleteMany({});
  await User.deleteMany({});
});

describe('An abandoned return must not strand the seller earnings', () => {
  test('RSW.1 the sale stands and the seller is paid exactly once', async () => {
    const world = await makeWorld('pays');
    const txn = await createAcceptedReturn(world);

    const result = await autoProcessReturns();
    const after = await Transaction.findById(txn._id);
    expect(after.status).toBe(orderStates.COMPLETED);
    expect(after.returnDetails.autoExpired).toBe(true);

    // The buyer kept the item, so the seller keeps the money — and this is the
    // only code path left that can move it.
    const paid = await User.findById(world.seller._id);
    expect(paid.balance.available).toBeCloseTo(AVAILABLE, 2);
    expect(paid.balance.pending).toBe(0);
    expect(paid.balance.totalEarned).toBeCloseTo(EARNINGS, 2);
    expect(paid.balance.reserve).toBeCloseTo(RESERVE, 2);
    expect(paid.balance.reserveReleaseDate).toHaveLength(1);

    const payouts = await Payout.find({ transaction: txn._id });
    expect(payouts).toHaveLength(1);
    expect(payouts[0].status).toBe('completed');

    // The job reports what it expired so the hourly run is observable.
    expect(result.expired).toBe(1);

    // Rerunning the job (or the next hourly tick) must not pay for the sale
    // twice — nor queue a second rolling-reserve release.
    await autoProcessReturns();
    const stillPaid = await User.findById(world.seller._id);
    expect(stillPaid.balance.available).toBeCloseTo(AVAILABLE, 2);
    expect(stillPaid.balance.reserveReleaseDate).toHaveLength(1);
    expect(await Payout.countDocuments({ transaction: txn._id })).toBe(1);
  });

  test('RSW.2 a return opened on an already-released order is not paid twice', async () => {
    const world = await makeWorld('release-marker');
    // A return opened *after* the sale completed (completed → return_requested
    // is a legal transition): the escalation here is `return_accepted`, exactly
    // like a return opened before completion.
    const txn = await createAcceptedReturn(world);
    await User.updateOne(
      { _id: world.seller._id },
      {
        $set: { 'balance.available': AVAILABLE, 'balance.pending': 0, 'balance.totalEarned': EARNINGS, 'balance.reserve': RESERVE },
        $addToSet: { 'balance.settledTransactions': String(txn._id) },
      },
    );
    await createPayout(world, txn, 'completed');

    await autoProcessReturns();

    const after = await User.findById(world.seller._id);
    expect(after.balance.available).toBeCloseTo(AVAILABLE, 2);
    expect(after.balance.reserve).toBeCloseTo(RESERVE, 2);
    expect(after.balance.reserveReleaseDate || []).toHaveLength(0);
    expect(await Payout.countDocuments({ transaction: txn._id })).toBe(1);
  });

  test('RSW.3 a legacy paid order (no release marker) is still not paid twice', async () => {
    const world = await makeWorld('legacy', {
      pending: 0,
      totalEarned: EARNINGS,
      reserve: RESERVE,
      available: AVAILABLE,
    });
    const txn = await createAcceptedReturn(world);
    // Orders settled before the release marker existed have only the payout
    // ledger to prove the seller was already paid.
    await createPayout(world, txn, 'completed');

    await autoProcessReturns();

    const after = await User.findById(world.seller._id);
    expect(after.balance.available).toBeCloseTo(AVAILABLE, 2);
    expect(after.balance.pending).toBe(0);
  });

  test('RSW.4 funds still withheld by a settlement hold are not released early', async () => {
    const world = await makeWorld('held');
    const txn = await createAcceptedReturn(world, {
      settlementHold: {
        reason: 'new_seller',
        releaseAfter: new Date(Date.now() + 24 * 60 * 60 * 1000),
        releasedAt: null,
      },
    });
    await createPayout(world, txn, 'pending');

    await autoProcessReturns();

    // The order finalizes, but a hold is a scheduled payout, not a lost one:
    // the hold sweep stays in charge of when it is paid.
    const after = await Transaction.findById(txn._id);
    expect(after.status).toBe(orderStates.COMPLETED);
    expect(after.settlementHold.releasedAt).toBeFalsy();

    const held = await User.findById(world.seller._id);
    expect(held.balance.available).toBe(0);
    expect(held.balance.pending).toBeCloseTo(EARNINGS, 2);
  });
});
