const mongoose = require('mongoose');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Transaction = require('../models/Transaction');
const { autoCancelUnshippedOrders } = require('../config/cron');
const { timeWindows } = require('../config/orderLifecycle');

const ids = [];
let seller;
let buyer;

async function makeTransaction({ ageMs, paymentStatus = 'succeeded', withLabel = true } = {}) {
  const listing = await Listing.create({
    seller: seller._id,
    title: `No shipment ${Date.now()}`,
    description: 'test',
    price: 100,
    category: 'Men',
    condition: 'Good',
    quantity: 0,
    quantitySold: 1,
    available: false,
    sold: true,
    shipsFrom: 'US',
    currency: 'USD',
  });
  ids.push(listing._id);
  const pi = `pi_no_ship_${Date.now()}_${Math.random()}`;
  global.__mockPaymentIntents[pi] = {
    id: pi,
    status: paymentStatus,
    amount: 11000,
    metadata: { buyerId: String(buyer._id), itemIds: String(listing._id) },
  };
  const txn = await Transaction.create({
    listing: listing._id,
    buyer: buyer._id,
    seller: seller._id,
    itemPrice: 100,
    currency: 'USD',
    quantity: 1,
    paymentBreakdown: {
      subtotal: 100,
      originalSubtotal: 100,
      discountAmount: 0,
      shippingCost: 5,
      buyerProtectionFee: 5,
      totalPaid: 110,
      platformFee: 8,
      platformFeePercent: 8,
      sellerEarnings: 92,
      paymentIntentId: pi,
    },
    payout: { status: 'pending', transactionId: pi },
    shipping: withLabel ? {
      labelCreated: true,
      labelCreatedDate: new Date(Date.now() - ageMs),
      trackingNumber: 'MOCK123',
    } : {},
    status: 'paid',
    createdAt: new Date(Date.now() - ageMs),
    updatedAt: new Date(Date.now() - ageMs),
  });
  return txn;
}

beforeAll(async () => {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/trenddrop_test');
  }
  global.__mockPaymentIntents = {};
  global.__mockRefunds = {};
  seller = await User.create({
    name: 'Deadline Seller', email: `deadline-seller-${Date.now()}@test.com`, password: 'password123',
    emailVerified: true, authProvider: 'email', country: 'US', currency: 'USD',
    balance: { available: 0, pending: 92, totalEarned: 92, totalPaidOut: 0, currency: 'USD' },
    stats: { totalSales: 0, totalPurchases: 0, strikes: 0 },
  });
  buyer = await User.create({
    name: 'Deadline Buyer', email: `deadline-buyer-${Date.now()}@test.com`, password: 'password123',
    emailVerified: true, authProvider: 'email', country: 'US', currency: 'USD',
  });
});

afterAll(async () => {
  await Transaction.deleteMany({ $or: [{ seller: seller._id }, { buyer: buyer._id }] });
  await Listing.deleteMany({ _id: { $in: ids } });
  await User.deleteMany({ _id: { $in: [seller._id, buyer._id] } });
  await mongoose.connection.close();
});

describe('seller shipment deadline / automatic buyer protection', () => {
  test('NS.1 cancels after seven calendar days, voids label, refunds all buyer charges, and restores inventory', async () => {
    const txn = await makeTransaction({ ageMs: timeWindows.SELLER_SHIPMENT_DEADLINE + 60 * 1000 });

    expect(await autoCancelUnshippedOrders()).toBe(1);
    const fresh = await Transaction.findById(txn._id);
    const listing = await Listing.findById(txn.listing);
    const updatedSeller = await User.findById(seller._id);

    expect(fresh.status).toBe('auto_cancelled');
    expect(fresh.shipping.voided).toBe(true);
    expect(fresh.shipping.labelCreated).toBe(false);
    expect(fresh.cancellation.cancelledBy).toBe('system');
    expect(fresh.cancellation.refundAmount).toBe(110);
    expect(global.__mockRefunds[fresh.payout.transactionId].amount).toBe(11000);
    expect(listing.quantity).toBe(1);
    expect(listing.quantitySold).toBe(0);
    expect(updatedSeller.balance.pending).toBe(0);
    expect(updatedSeller.balance.totalEarned).toBe(0);
  });

  test('NS.2 does not cancel before the deadline', async () => {
    const txn = await makeTransaction({ ageMs: timeWindows.SELLER_SHIPMENT_DEADLINE - 60 * 1000 });
    expect(await autoCancelUnshippedOrders()).toBe(0);
    const fresh = await Transaction.findById(txn._id);
    expect(fresh.status).toBe('paid');
    expect(global.__mockRefunds[fresh.payout.transactionId]).toBeUndefined();
  });

  test('NS.3 provider failure leaves the order paid and does not touch inventory or balances', async () => {
    const txn = await makeTransaction({ ageMs: timeWindows.SELLER_SHIPMENT_DEADLINE + 60 * 1000 });
    delete global.__mockPaymentIntents[txn.payout.transactionId];
    const beforeListing = await Listing.findById(txn.listing);
    const beforeSeller = await User.findById(seller._id);

    expect(await autoCancelUnshippedOrders()).toBe(0);
    expect((await Transaction.findById(txn._id)).status).toBe('paid');
    expect((await Listing.findById(txn.listing)).quantity).toBe(beforeListing.quantity);
    expect((await User.findById(seller._id)).balance.pending).toBe(beforeSeller.balance.pending);
  });
});
