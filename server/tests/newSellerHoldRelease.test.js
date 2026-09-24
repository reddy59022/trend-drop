/**
 * New-seller hold release (regression suite).
 *
 * A seller whose account is younger than 14 days and who has fewer than 5
 * sales is supposed to have their earnings *held* — the completion paths set
 * `canRelease = false` and leave the money in `balance.pending`.
 *
 * The hold was only ever a decision to skip the release, never a scheduled
 * event: nothing recorded when the money became releasable and no job ever came
 * back for it. Since the order is already `completed`, the seller cannot use
 * `POST /auto-complete` either (`completed → completed` is not a transition),
 * so every new seller's first sales sat in `pending` forever and could never be
 * cashed out.
 *
 * These tests assert the two halves of the contract: completion records the
 * hold, and the sweep pays it out exactly once — after the hold expires.
 */
const mongoose = require('mongoose');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Transaction = require('../models/Transaction');
const Payout = require('../models/Payout');
const { orderStates, timeWindows } = require('../config/orderLifecycle');
const { autoProcessOrders, releaseHeldSettlements } = require('../config/cron');

const TEST_RUN_ID = `newhold_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const EARNINGS = 92;
const RESERVE = 9.2;
const AVAILABLE = 82.8;
const DAY = 24 * 60 * 60 * 1000;

const daysAgo = (days) => new Date(Date.now() - days * DAY);

/**
 * Fail when one seller's balance update runs. The sweep is a batch job over
 * every seller with a matured hold, so the failure has to be targeted by id
 * rather than by call order.
 */
const poisonUserUpdateOnce = (sellerId) => {
  const realUpdateOne = User.updateOne;
  let fired = false;
  jest.spyOn(User, 'updateOne').mockImplementation(function updateOne(filter, ...rest) {
    if (!fired && filter && String(filter._id) === String(sellerId)) {
      fired = true;
      return Promise.reject(new Error('db unavailable'));
    }
    return realUpdateOne.call(User, filter, ...rest);
  });
};

const makeWorld = async (label) => {
  const seller = await User.create({
    name: `Hold Seller ${label}`,
    email: `holdseller_${label}_${TEST_RUN_ID}@test.com`,
    password: 'password123',
    emailVerified: true,
    authProvider: 'email',
    country: 'US',
    currency: 'USD',
    role: 'user',
    // Below NEW_SELLER_THRESHOLD and a brand new account: the hold applies.
    stats: { totalSales: 0, totalPurchases: 0, strikes: 0 },
    balance: { available: 0, pending: EARNINGS, totalEarned: 0, totalPaidOut: 0, currency: 'USD' },
  });
  const buyer = await User.create({
    name: `Hold Buyer ${label}`,
    email: `holdbuyer_${label}_${TEST_RUN_ID}@test.com`,
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
    title: `Hold Item ${label} ${TEST_RUN_ID}`,
    description: 'Fixture listing for new-seller hold release tests',
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

/** A confirmed sale whose confirm + delivery windows have both expired. */
const createConfirmedTxn = (world) =>
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
  });

/** Completion with the hold in force: order finalized, money still escrowed. */
const expectFundsHeld = async (sellerId, txnId) => {
  const seller = await User.findById(sellerId);
  expect(seller.balance.available).toBe(0);
  expect(seller.balance.pending).toBeCloseTo(EARNINGS, 2);
  expect(seller.balance.reserve).toBe(0);
  expect(seller.balance.reserveReleaseDate || []).toHaveLength(0);
  // No release marker: the money has demonstrably not been released.
  expect(seller.balance.settledTransactions || []).not.toContain(String(txnId));
};

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

afterEach(() => {
  jest.restoreAllMocks();
});

describe('New-seller funds held at completion must be released later', () => {
  test('NRH.1 completing under the new-seller hold records when the money becomes releasable', async () => {
    const world = await makeWorld('record');
    const txn = await createConfirmedTxn(world);

    await autoProcessOrders();

    const completed = await Transaction.findById(txn._id);
    expect(completed.status).toBe(orderStates.COMPLETED);

    // Without this record the withheld money is unreachable: nothing else in
    // the system knows the release was deferred rather than done.
    expect(completed.settlementHold).toBeTruthy();
    expect(completed.settlementHold.reason).toBe('new_seller');
    const releaseAfter = new Date(completed.settlementHold.releaseAfter).getTime();
    const accountAge = new Date(world.seller.createdAt).getTime() + timeWindows.NEW_SELLER_HOLD;
    expect(Math.abs(releaseAfter - accountAge)).toBeLessThan(60 * 1000);

    // The payout ledger must not claim a held order was paid: the dashboard
    // derives the seller's available balance from completed payouts.
    const heldPayouts = await Payout.find({ transaction: txn._id });
    expect(heldPayouts).toHaveLength(1);
    expect(heldPayouts[0].status).toBe('pending');

    await expectFundsHeld(world.seller._id, txn._id);
  });

  test('NRH.2 the sweep pays held funds out exactly once, after the hold expires', async () => {
    const world = await makeWorld('sweep');
    const txn = await createConfirmedTxn(world);
    await autoProcessOrders();

    // Time passes: the account is now older than the hold window.
    await Transaction.updateOne(
      { _id: txn._id },
      { $set: { 'settlementHold.releaseAfter': daysAgo(1) } },
    );

    const first = await releaseHeldSettlements();
    expect(first.released).toBe(1);

    const paid = await User.findById(world.seller._id);
    expect(paid.balance.available).toBeCloseTo(AVAILABLE, 2);
    expect(paid.balance.pending).toBe(0);
    expect(paid.balance.reserve).toBeCloseTo(RESERVE, 2);
    expect(paid.balance.reserveReleaseDate).toHaveLength(1);

    const after = await Transaction.findById(txn._id);
    // Marked done, so a later sweep does not even look at it again...
    expect(after.settlementHold.releasedAt).toBeTruthy();
    expect(after.status).toBe(orderStates.COMPLETED);

    const payouts = await Payout.find({ transaction: txn._id });
    expect(payouts).toHaveLength(1);
    expect(payouts[0].status).toBe('completed');

    // ...and running the job again is a no-op (the seller is not paid twice).
    const second = await releaseHeldSettlements();
    expect(second.released).toBe(0);
    const stillPaid = await User.findById(world.seller._id);
    expect(stillPaid.balance.available).toBeCloseTo(AVAILABLE, 2);
    expect(stillPaid.balance.reserveReleaseDate).toHaveLength(1);
  });

  test('NRH.3 the sweep leaves a hold that has not matured alone', async () => {
    const world = await makeWorld('active');
    const txn = await createConfirmedTxn(world);
    await autoProcessOrders();

    const result = await releaseHeldSettlements();
    expect(result.released).toBe(0);

    const after = await Transaction.findById(txn._id);
    expect(after.settlementHold.releasedAt).toBeFalsy();
    await expectFundsHeld(world.seller._id, txn._id);
  });

  test('NRH.4 one failing seller does not block the other held sellers', async () => {
    const poisoned = await makeWorld('poisoned');
    const healthy = await makeWorld('healthy');
    const poisonedTxn = await createConfirmedTxn(poisoned);
    const healthyTxn = await createConfirmedTxn(healthy);
    await autoProcessOrders();
    await Transaction.updateMany(
      { _id: { $in: [poisonedTxn._id, healthyTxn._id] } },
      { $set: { 'settlementHold.releaseAfter': daysAgo(1) } },
    );

    // The poisoned seller's balance update is the failing row; each hold is a
    // separate payout, so it must not take the healthy sellers down with it.
    poisonUserUpdateOnce(poisoned.seller._id);

    const result = await releaseHeldSettlements();
    expect(result.released).toBe(1);
    expect(result.failed).toBe(1);

    const good = await User.findById(healthy.seller._id);
    expect(good.balance.available).toBeCloseTo(AVAILABLE, 2);

    // The failing one keeps its hold queued so the next run retries it.
    const bad = await User.findById(poisoned.seller._id);
    expect(bad.balance.available).toBe(0);
    const badTxn = await Transaction.findById(poisonedTxn._id);
    expect(badTxn.settlementHold.releasedAt).toBeFalsy();
  });
});
