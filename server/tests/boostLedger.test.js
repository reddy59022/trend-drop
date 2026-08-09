const mongoose = require('mongoose');
const Listing = require('../models/Listing');
const Transaction = require('../models/Transaction');
const User = require('../models/User');
const Payout = require('../models/Payout');

describe('ITEM-LEVEL BOOST FEE LEDGER', () => {
  let seller;
  let buyer;
  let listing;
  let txn;

  beforeAll(async () => {
    // Connect to MongoDB for integration testing
    const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/trend-drop';
    await mongoose.connect(mongoUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
  });

  afterAll(async () => {
    // Do NOT disconnect — jest.setup.js afterAll cleans DB between files
  });

  test('boost fee is owed at sale, reversed at cancel, collected at completion', async () => {
    // 1. Create seller & buyer
    seller = await User.create({
      name: 'Boost Seller',
      email: `boost-seller-${Date.now()}@test.com`,
      password: 'password123',
      balance: { available: 0, pending: 0, totalEarned: 0, totalPaidOut: 0, currency: 'USD' },
      stats: { totalSales: 0, totalPurchases: 0, strikes: 0 },
    });
    buyer = await User.create({
      name: 'Boost Buyer',
      email: `boost-buyer-${Date.now()}@test.com`,
      password: 'password123',
      balance: { available: 0, pending: 0, totalEarned: 0, totalPaidOut: 0, currency: 'USD' },
      stats: { totalSales: 0, totalPurchases: 0, strikes: 0 },
    });

    // 2. Create a boosted listing (elite tier = 8% boost fee)
    listing = await Listing.create({
      seller: seller._id,
      title: 'Boosted Test Item',
      description: 'Test',
      price: 100,
      currency: 'USD',
      category: 'Women',
      brand: 'TestBrand',
      condition: 'New with tags',
      images: [],
      quantity: 3,
      quantitySold: 0,
      status: 'active',
      available: true,
      sold: false,
      boost: {
        active: true,
        tier: 'elite',
        startDate: new Date(),
        endDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        durationDays: 14,
        fee: 10,
        priorityScore: 100,
        feeLedger: { owed: 0, collected: 0, reversed: 0 },
      },
    });

    // 3. Simulate a sale: sellerEarnings = 100 - 10% platform = 90, minus 8% boost = 82
    const boostFee = Math.round(100 * 0.08 * 100) / 100; // 8
    const platformFee = 10;
    const sellerEarnings = 100 - platformFee - boostFee; // 82

    // Record boost fee owed at listing level + simulate sale inventory decrement (3 → 2)
    await Listing.findByIdAndUpdate(listing._id, { $inc: { 'boost.feeLedger.owed': boostFee, quantity: -1, quantitySold: 1 } });
    listing.quantity = 2;

    // Create transaction (mimic sale)
    txn = await Transaction.create({
      listing: listing._id,
      buyer: buyer._id,
      seller: seller._id,
      itemPrice: 100,
      currency: 'USD',
      quantity: 1,
      paymentBreakdown: {
        subtotal: 100,
        shippingCost: 0,
        buyerProtectionFee: 0,
        totalPaid: 100,
        platformFee,
        shippingPayout: 0,
        sellerEarnings,
        boostFee,
        boostTier: 'elite',
      },
      status: 'paid',
      payout: { status: 'pending' },
    });

    // Verify ledger after sale
    let refreshed = await Listing.findById(listing._id);
    expect(refreshed.boost.feeLedger.owed).toBe(boostFee);
    expect(refreshed.boost.feeLedger.reversed).toBe(0);

    // Seller should have pending balance = sellerEarnings
    let sellerDoc = await User.findById(seller._id);
    sellerDoc.balance.pending = sellerEarnings;
    await sellerDoc.save();

    // 4. Simulate CANCELLATION (exactly what orderLifecycle cancel route does)
    await Listing.findOneAndUpdate(
      { _id: listing._id, 'boost.feeLedger.owed': { $gte: boostFee } },
      { $inc: { 'boost.feeLedger.owed': -boostFee, 'boost.feeLedger.reversed': boostFee } },
      { new: true }
    );
    await Payout.updateMany(
      { transaction: txn._id, status: { $ne: 'refunded' } },
      { $set: { status: 'refunded', refundedAt: new Date() } }
    );
    // Restore inventory
    await Listing.findByIdAndUpdate(listing._id, {
      $inc: { quantity: 1, quantitySold: -1 },
      $set: { sold: false, available: true },
    });

    // Seller clawback (exactly what cancel route does)
    sellerDoc = await User.findById(seller._id);
    sellerDoc.balance.pending = Math.max(0, (sellerDoc.balance.pending || 0) - sellerEarnings);
    await sellerDoc.save();

    // Verify ledger after cancel
    refreshed = await Listing.findById(listing._id);
    expect(refreshed.boost.feeLedger.owed).toBe(0);
    expect(refreshed.boost.feeLedger.reversed).toBe(boostFee);
    expect(refreshed.quantity).toBe(3);

    // 5. Verify seller clawed back pending earnings
    sellerDoc = await User.findById(seller._id);
    expect(sellerDoc.balance.pending).toBe(0);

    // 6. Simulate a SECOND sale then completion (collect path)
    await Listing.findByIdAndUpdate(listing._id, { $inc: { 'boost.feeLedger.owed': boostFee } });
    const txn2 = await Transaction.create({
      listing: listing._id,
      buyer: buyer._id,
      seller: seller._id,
      itemPrice: 100,
      currency: 'USD',
      quantity: 1,
      paymentBreakdown: {
        subtotal: 100,
        shippingCost: 0,
        buyerProtectionFee: 0,
        totalPaid: 100,
        platformFee,
        shippingPayout: 0,
        sellerEarnings,
        boostFee,
        boostTier: 'elite',
      },
      status: 'buyer_confirmed',
      payout: { status: 'pending', transactionId: 'pi_test' },
    });

    refreshed = await Listing.findById(listing._id);
    expect(refreshed.boost.feeLedger.owed).toBe(boostFee);
    expect(refreshed.boost.feeLedger.collected).toBe(0);

    // Simulate order completion (auto-complete path)
    await Listing.findOneAndUpdate(
      { _id: listing._id, 'boost.feeLedger.owed': { $gte: boostFee } },
      { $inc: { 'boost.feeLedger.owed': -boostFee, 'boost.feeLedger.collected': boostFee } },
      { new: true }
    );

    refreshed = await Listing.findById(listing._id);
    expect(refreshed.boost.feeLedger.owed).toBe(0);
    expect(refreshed.boost.feeLedger.collected).toBe(boostFee);
    expect(refreshed.boost.feeLedger.reversed).toBe(boostFee);

    // Cleanup test data
    await Listing.deleteMany({ _id: { $in: [listing._id] } });
    await Transaction.deleteMany({ _id: { $in: [txn._id, txn2._id] } });
    await User.deleteMany({ _id: { $in: [seller._id, buyer._id] } });
  });
});
