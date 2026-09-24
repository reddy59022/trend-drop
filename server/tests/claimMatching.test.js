/**
 * claimTransaction matching matrix (regression suite).
 *
 * The stale-claim recovery is what stops a claim abandoned by a dead worker
 * (deploy restart mid-completion) from stranding an order's money forever. It
 * must be *exactly* that narrow: a live claim still has to hold, otherwise two
 * workers can settle the same order.
 *
 * This is asserted directly because the behaviour depends on how the claim
 * filter is cast for an UPDATE, not on the claim rules themselves: an
 * innocuous-looking `{ claimedAt: null }` branch matches ANY timestamp there
 * (Mongoose casts the null for a Date path), which silently turns the guard
 * into "always reclaimable".
 */
const mongoose = require('mongoose');
const Transaction = require('../models/Transaction');
const { claimTransaction, CLAIM_STALE_MS } = require('../utils/claims');

let sellerId;
let buyerId;
let listingId;

const makeTxn = (overrides) =>
  Transaction.create({
    listing: listingId,
    buyer: buyerId,
    seller: sellerId,
    itemPrice: 100,
    currency: 'USD',
    quantity: 1,
    paymentBreakdown: { subtotal: 100, totalPaid: 115, sellerEarnings: 92 },
    status: 'buyer_confirmed',
    payout: { status: 'pending', transactionId: '' },
    ...overrides,
  });

const claim = (id) =>
  claimTransaction({
    _id: id,
    flag: 'completionProcessing',
    claimedAt: 'completionClaimedAt',
    extraFilter: { status: 'buyer_confirmed' },
  });

beforeAll(async () => {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/trend-drop-test';
  if (mongoose.connection.readyState === 0) await mongoose.connect(uri);
  sellerId = new mongoose.Types.ObjectId();
  buyerId = new mongoose.Types.ObjectId();
  listingId = new mongoose.Types.ObjectId();
});

afterAll(async () => {
  await Transaction.deleteMany({});
});

beforeEach(async () => {
  await Transaction.deleteMany({});
});

describe('Stale claim recovery is narrow', () => {
  test('CM.1 an unclaimed order can be claimed', async () => {
    const txn = await makeTxn({});
    expect(await claim(txn._id)).toBeTruthy();
  });

  test('CM.2 a live claim is never reclaimed', async () => {
    const txn = await makeTxn({ completionProcessing: true, completionClaimedAt: new Date() });
    expect(await claim(txn._id)).toBeNull();

    // Still held a moment later, and the timestamp was not overwritten.
    const after = await Transaction.findById(txn._id);
    expect(after.completionProcessing).toBe(true);
  });

  test('CM.3 a claim abandoned by a dead worker is reclaimed', async () => {
    const txn = await makeTxn({
      completionProcessing: true,
      completionClaimedAt: new Date(Date.now() - CLAIM_STALE_MS - 60 * 1000),
    });
    const claimed = await claim(txn._id);
    expect(claimed).toBeTruthy();
    // The claim is refreshed so the next worker sees a live one.
    expect(claimed.completionClaimedAt.getTime()).toBeGreaterThan(Date.now() - 5000);
  });

  test('CM.4 a claim with no timestamp (taken before timestamps existed) is reclaimed', async () => {
    const txn = await makeTxn({ completionProcessing: true });
    // Simulate the pre-migration shape: flag set, timestamp key absent.
    await Transaction.collection.updateOne({ _id: txn._id }, { $unset: { completionClaimedAt: '' } });
    expect(await claim(txn._id)).toBeTruthy();
  });

  test('CM.5 a claim whose timestamp is null is reclaimed, not treated as live', async () => {
    const txn = await makeTxn({ completionProcessing: true, completionClaimedAt: null });
    expect(await claim(txn._id)).toBeTruthy();
  });

  test('CM.6 the claim only applies to a transaction in the expected state', async () => {
    const txn = await makeTxn({ status: 'delivered' });
    expect(await claim(txn._id)).toBeNull();
  });

  test('CM.7 a claim field that is not in the schema fails loudly instead of unlocking everything', async () => {
    const txn = await makeTxn({});
    // Mongoose strips unknown paths out of an update filter, which would delete
    // that branch of the claim and leave an always-matching filter behind.
    await expect(
      claimTransaction({
        _id: txn._id,
        flag: 'completionProcessing',
        claimedAt: 'completionProcessingClaimedAt',
        extraFilter: { status: 'buyer_confirmed' },
      }),
    ).rejects.toThrow(/not a Transaction schema path/);
  });
});
