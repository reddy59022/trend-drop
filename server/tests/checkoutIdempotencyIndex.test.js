/**
 * CHECKOUT IDEMPOTENCY (DB-level) — the route-level `existingTxn` guards are
 * read-then-write and lose to true parallel races (double-click / retry
 * storms): two confirms of the same payment intent could both pass the check
 * and double-credit the seller. The (paymentIntentId, listing) partial unique
 * index turns that race into a clean E11000 the routes answer idempotently.
 *
 * Pins three invariants:
 *   1. duplicate (paymentIntentId, listing) is rejected by the DB
 *   2. one intent MAY span several listings (batch checkout) — the index is
 *      compound, not single-field, for exactly this reason
 *   3. legacy rows with an empty paymentIntentId keep coexisting (partial index)
 */
const mongoose = require('mongoose');
const Transaction = require('../models/Transaction');

jest.setTimeout(30000);

const RUN = Date.now();
let sellerId;
let buyerId;

beforeAll(async () => {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/trend-drop-test';
  if (mongoose.connection.readyState === 0) await mongoose.connect(uri);
  sellerId = new mongoose.Types.ObjectId();
  buyerId = new mongoose.Types.ObjectId();
  await Transaction.syncIndexes(); // force-build the unique index under test
});

afterAll(async () => {
  await Transaction.deleteMany({ 'paymentBreakdown.paymentIntentId': { $regex: `idxtest_${RUN}` } });
});

const makeTxn = (paymentIntentId, listingId) => Transaction.create({
  listing: listingId,
  buyer: buyerId,
  seller: sellerId,
  itemPrice: 10,
  currency: 'USD',
  status: 'paid',
  paymentBreakdown: {
    paymentIntentId,
    subtotal: 10,
    shippingCost: 0,
    buyerProtectionFee: 0,
    tax: 0,
    totalPaid: 10,
    platformFee: 0,
    shippingPayout: 0,
    sellerEarnings: 10,
    boostFee: 0,
  },
});

describe('checkout idempotency: unique (paymentIntentId, listing)', () => {
  test('a duplicate (paymentIntentId, listing) pair is rejected with E11000', async () => {
    const pi = `idxtest_${RUN}_dup`;
    const listing = new mongoose.Types.ObjectId();
    await makeTxn(pi, listing);
    await expect(makeTxn(pi, listing)).rejects.toMatchObject({ code: 11000 });
  });

  test('one payment intent MAY cover several listings (batch checkout stays legal)', async () => {
    const pi = `idxtest_${RUN}_batch`;
    await makeTxn(pi, new mongoose.Types.ObjectId());
    await expect(makeTxn(pi, new mongoose.Types.ObjectId())).resolves.toBeTruthy();
  });

  test('legacy rows with an empty paymentIntentId do not collide', async () => {
    const listing = new mongoose.Types.ObjectId();
    await makeTxn('', listing);
    await expect(makeTxn('', listing)).resolves.toBeTruthy();
  });
});
