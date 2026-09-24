const mongoose = require('mongoose');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Transaction = require('../models/Transaction');
const Return = require('../models/Return');
const { autoProcessReturnTracking } = require('../config/cron');

const created = [];
let seller;
let buyer;

async function makeReturn({ responsibility = 'seller', ageDays = 7, provider = true } = {}) {
  const listing = await Listing.create({
    seller: seller._id, title: `Return tracking ${Date.now()}`, description: 'test',
    price: 100, category: 'Women', condition: 'Good', quantity: 0, quantitySold: 1,
    available: false, sold: true, status: 'active', shipsFrom: 'US', currency: 'USD',
  });
  created.push(listing._id);
  const paymentIntentId = `pi_return_${Date.now()}_${Math.random()}`;
  if (provider) {
    global.__mockPaymentIntents[paymentIntentId] = {
      id: paymentIntentId, status: 'succeeded', amount: 11000,
      metadata: { buyerId: String(buyer._id), itemIds: String(listing._id) },
    };
  }
  const txn = await Transaction.create({
    listing: listing._id, buyer: buyer._id, seller: seller._id, itemPrice: 100,
    currency: 'USD', quantity: 1,
    paymentBreakdown: {
      subtotal: 100, originalSubtotal: 100, discountAmount: 0, shippingCost: 5,
      buyerProtectionFee: 5, totalPaid: 110, platformFee: 8, platformFeePercent: 8,
      sellerEarnings: 92, paymentIntentId,
    },
    payout: { status: 'pending', transactionId: paymentIntentId },
    status: 'return_in_transit',
    returnDetails: { trackingNumber: `RET${Date.now()}`, buyerShippedAt: new Date(Date.now() - ageDays * 24 * 60 * 60 * 1000) },
  });
  const returnRequest = await Return.create({
    transaction: txn._id, buyer: buyer._id, seller: seller._id, listing: listing._id,
    reason: responsibility === 'buyer' ? 'Changed mind' : 'Defective',
    refundAmount: responsibility === 'buyer' ? 100 : 110,
    returnShippingResponsibility: responsibility,
    status: 'shipped', trackingNumber: txn.returnDetails.trackingNumber,
    returnTrackingNumber: txn.returnDetails.trackingNumber,
  });
  txn.returnDetails.returnId = returnRequest._id;
  await txn.save();
  created.push(txn._id, returnRequest._id);
  return { txn, returnRequest, listing, paymentIntentId };
}

beforeAll(async () => {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/trenddrop_test');
  }
  global.__mockPaymentIntents = {};
  global.__mockRefunds = {};
  seller = await User.create({
    name: 'Return Cron Seller', email: `return-cron-seller-${Date.now()}@test.com`, password: 'password123',
    emailVerified: true, authProvider: 'email', country: 'US', currency: 'USD',
    balance: { available: 0, pending: 92, totalEarned: 92, totalPaidOut: 0, currency: 'USD' },
  });
  buyer = await User.create({
    name: 'Return Cron Buyer', email: `return-cron-buyer-${Date.now()}@test.com`, password: 'password123',
    emailVerified: true, authProvider: 'email', country: 'US', currency: 'USD',
  });
});

afterAll(async () => {
  await Transaction.deleteMany({ _id: { $in: created } });
  await Return.deleteMany({ _id: { $in: created } });
  await Listing.deleteMany({ _id: { $in: created } });
  await User.deleteMany({ _id: { $in: [seller._id, buyer._id] } });
  await mongoose.connection.close();
});

describe('automated return tracking and settlement', () => {
  test('RTC.1 progresses shipped returns and settles on carrier delivery', async () => {
    const { txn, returnRequest, listing, paymentIntentId } = await makeReturn({ ageDays: 7 });
    const result = await autoProcessReturnTracking();
    const freshTxn = await Transaction.findById(txn._id);
    const freshReturn = await Return.findById(returnRequest._id);
    const freshListing = await Listing.findById(listing._id);
    const freshSeller = await User.findById(seller._id);

    expect(result.settled).toBe(1);
    expect(freshReturn.status).toBe('refunded');
    expect(freshReturn.trackingStatus).toBe('delivered');
    expect(freshReturn.trackingHistory.map((event) => event.status)).toEqual([
      'picked_up', 'in_transit', 'in_transit_local', 'out_for_delivery', 'delivered',
    ]);
    expect(freshTxn.status).toBe('refunded');
    expect(global.__mockRefunds[paymentIntentId].amount).toBeUndefined();
    expect(freshListing.quantity).toBe(1);
    expect(freshListing.quantitySold).toBe(0);
    expect(freshSeller.balance.pending).toBe(0);
    expect(freshSeller.balance.totalEarned).toBe(0);
  });

  test('RTC.2 does not refund before carrier delivery', async () => {
    const { txn, returnRequest, paymentIntentId } = await makeReturn({ ageDays: 1 });
    const result = await autoProcessReturnTracking();
    const freshTxn = await Transaction.findById(txn._id);
    const freshReturn = await Return.findById(returnRequest._id);

    expect(result.settled).toBe(0);
    expect(freshTxn.status).toBe('return_in_transit');
    expect(freshReturn.status).toBe('in_transit');
    expect(global.__mockRefunds[paymentIntentId]).toBeUndefined();
  });

  test('RTC.3 buyer-remorse return refunds item price only', async () => {
    const { returnRequest, paymentIntentId } = await makeReturn({ responsibility: 'buyer', ageDays: 7 });
    await autoProcessReturnTracking();
    const freshReturn = await Return.findById(returnRequest._id);
    expect(freshReturn.status).toBe('refunded');
    expect(freshReturn.refundAmount).toBe(100);
    expect(global.__mockRefunds[paymentIntentId].amount).toBe(10000);
  });

  test('RTC.4 duplicate cron runs cannot refund, restock, or claw back twice', async () => {
    const { txn, returnRequest, listing } = await makeReturn({ ageDays: 7 });
    await autoProcessReturnTracking();
    const firstListing = await Listing.findById(listing._id);
    const firstSeller = await User.findById(seller._id);
    const second = await autoProcessReturnTracking();
    const secondListing = await Listing.findById(listing._id);
    const secondSeller = await User.findById(seller._id);

    expect(second.settled).toBe(0);
    expect(secondListing.quantity).toBe(firstListing.quantity);
    expect(secondListing.quantitySold).toBe(firstListing.quantitySold);
    expect(secondSeller.balance.pending).toBe(firstSeller.balance.pending);
    expect((await Transaction.findById(txn._id)).status).toBe('refunded');
    expect((await Return.findById(returnRequest._id)).status).toBe('refunded');
  });

  test('RTC.6 reclaims a return claim abandoned by a dead worker', async () => {
    const { txn, returnRequest, listing } = await makeReturn({ ageDays: 7 });
    // The worker claimed the settlement, then died (deploy restart). The claim
    // -- and the buyer's refund -- stayed stuck forever.
    await Transaction.updateOne(
      { _id: txn._id },
      {
        $set: {
          returnProcessing: true,
          returnClaimedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
        },
      },
    );

    const result = await autoProcessReturnTracking();

    expect(result.settled).toBe(1);
    const freshTxn = await Transaction.findById(txn._id);
    expect(freshTxn.status).toBe('refunded');
    expect(freshTxn.returnProcessing).toBe(false);
    expect((await Return.findById(returnRequest._id)).status).toBe('refunded');
    // The unwind still runs exactly once: inventory back, seller clawed back.
    expect((await Listing.findById(listing._id)).quantity).toBe(1);
    const sellerAfter = await User.findById(seller._id);
    expect(sellerAfter.balance.pending).toBe(0);
  });

  test('RTC.7 a live return claim is not trampled by a concurrent worker', async () => {
    const { txn, returnRequest } = await makeReturn({ ageDays: 7 });
    await Transaction.updateOne(
      { _id: txn._id },
      { $set: { returnProcessing: true, returnClaimedAt: new Date() } },
    );

    const result = await autoProcessReturnTracking();

    expect(result.settled).toBe(0);
    const freshTxn = await Transaction.findById(txn._id);
    expect(freshTxn.status).not.toBe('refunded');
    expect(freshTxn.returnProcessing).toBe(true);
    expect((await Return.findById(returnRequest._id)).status).not.toBe('refunded');
  });

  test('RTC.5 missing provider reference leaves delivery visible but preserves ledger for retry', async () => {
    const { txn, returnRequest, listing } = await makeReturn({ ageDays: 7, provider: false });
    const result = await autoProcessReturnTracking();
    const freshTxn = await Transaction.findById(txn._id);
    const freshReturn = await Return.findById(returnRequest._id);
    const freshListing = await Listing.findById(listing._id);

    expect(result.settled).toBe(0);
    expect(freshTxn.status).toBe('return_delivered');
    expect(freshTxn.returnProcessing).toBe(false);
    expect(freshReturn.status).toBe('delivered');
    expect(freshListing.quantity).toBe(0);
  });
});
