const mongoose = require('mongoose');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Transaction = require('../models/Transaction');
const Order = require('../models/Order');
const Return = require('../models/Return');
const Payout = require('../models/Payout');
const { main } = require('../scripts/clean-qa-commerce');

const oid = () => new mongoose.Types.ObjectId();

describe('QA commerce cleanup script', () => {
  beforeAll(async () => {
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
    }
  });

  afterEach(async () => {
    await Promise.all([
      User.deleteMany({}),
      Listing.deleteMany({}),
      Transaction.deleteMany({}),
      Order.deleteMany({}),
      Return.deleteMany({}),
      Payout.deleteMany({}),
    ]);
  });

  const captureOutput = async (apply) => {
    const lines = [];
    const logSpy = jest.spyOn(console, 'log').mockImplementation((...args) => {
      lines.push(args.join(' '));
    });
    try {
      await main({ apply, disconnect: false });
    } finally {
      logSpy.mockRestore();
    }
    return lines.join('\n');
  };

  const seed = async () => {
    const seller = await User.create({
      name: 'QA script seller',
      email: `qa-script-${Date.now()}@test.local`,
      password: 'password123',
      country: 'US',
      currency: 'USD',
      emailVerified: true,
      authProvider: 'email',
    });
    const qaListing = await Listing.create({
      seller: seller._id,
      title: 'QA webhook flow script test 1795785937036',
      description: 'QA script listing',
      price: 20,
      category: 'Men',
      condition: 'Good',
      available: true,
      quantity: 1,
      shipsFrom: 'US',
    });
    const realListing = await Listing.create({
      seller: seller._id,
      title: 'Real script test item',
      description: 'Real listing',
      price: 25,
      category: 'Men',
      condition: 'Good',
      available: true,
      quantity: 1,
      shipsFrom: 'US',
    });

    const qaTransaction = oid();
    const realTransaction = oid();
    await Transaction.collection.insertMany([
      {
        _id: qaTransaction,
        listing: qaListing._id,
        seller: seller._id,
        status: 'refunded',
        paymentBreakdown: { sellerEarnings: 11.35 },
      },
      {
        _id: realTransaction,
        listing: realListing._id,
        seller: seller._id,
        status: 'completed',
        paymentBreakdown: { sellerEarnings: 5 },
      },
    ]);

    await User.updateOne(
      { _id: seller._id },
      {
        $set: {
          notifications: [
            { _id: oid(), type: 'dispute', transaction: qaTransaction, message: 'QA dispute' },
            { _id: oid(), type: 'purchase', transaction: qaTransaction, message: 'QA purchase' },
            { _id: oid(), type: 'refund', transaction: qaTransaction, message: 'QA refund' },
            { _id: oid(), type: 'sale', transaction: qaTransaction, message: 'QA sale' },
            { _id: oid(), type: 'sale', transaction: realTransaction, message: 'real sale' },
            { _id: oid(), type: 'sale', message: 'no transaction' },
          ],
        },
      },
    );

    return { seller, qaTransaction, realTransaction };
  };

  test('dry run prints per-type counts and writes nothing; apply removes only QA-linked notifications', async () => {
    const { seller, qaTransaction, realTransaction } = await seed();

    const dryRunOutput = await captureOutput(false);
    expect(dryRunOutput).toContain('QA COMMERCE CLEANUP (DRY RUN)');
    expect(dryRunOutput).toContain('notifications:     4 (dispute=1 purchase=1 refund=1 sale=1)');
    expect(dryRunOutput).toContain('DRY RUN — nothing was written.');
    expect(await Transaction.collection.findOne({ _id: qaTransaction })).not.toBeNull();
    expect((await User.findById(seller._id)).notifications).toHaveLength(6);

    const applyOutput = await captureOutput(true);
    expect(applyOutput).toContain('APPLY — deleted:');
    expect(applyOutput).toContain('notifications=4 (dispute=1 purchase=1 refund=1 sale=1)');

    expect(await Transaction.collection.findOne({ _id: qaTransaction })).toBeNull();
    expect(await Transaction.collection.findOne({ _id: realTransaction })).not.toBeNull();

    const after = await User.findById(seller._id).lean();
    expect(after.notifications.map((notification) => notification.message).sort()).toEqual([
      'no transaction',
      'real sale',
    ]);
    expect(after.notifications.some((notification) =>
      String(notification.transaction) === String(qaTransaction))).toBe(false);
  });
});
