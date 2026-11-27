/**
 * Return settlement must record what the payment provider actually answered.
 *
 * The cron used to set `providerRefunded = true` immediately after calling
 * Stripe without looking at the result. A refund Stripe rejects (failed /
 * canceled) still released the transaction, restocked the item, and clawed
 * back the seller's earnings — the buyer's money never moved but the order
 * was closed as refunded. These tests pin the corrected contract:
 *   - only an accepted refund ('succeeded' / 'pending') settles the return;
 *   - a rejected refund leaves the return retryable with the ledger intact;
 *   - the provider's refund id/status/amount are persisted for audit.
 */
const mongoose = require('mongoose');

jest.mock('../config/payments', () => {
  const actual = jest.requireActual('../config/payments');
  return { ...actual, issueRefund: jest.fn() };
});

const payments = require('../config/payments');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Transaction = require('../models/Transaction');
const Return = require('../models/Return');
const { autoProcessReturnTracking } = require('../config/cron');

let seller;
let buyer;
const created = [];

async function makeDeliveredReturn({ responsibility = 'seller' } = {}) {
  const listing = await Listing.create({
    seller: seller._id, title: `Provider refund ${Date.now()}`, description: 'test',
    price: 100, category: 'Women', condition: 'Good', quantity: 0, quantitySold: 1,
    available: false, sold: true, status: 'active', shipsFrom: 'US', currency: 'USD',
  });
  created.push(listing._id);
  const paymentIntentId = `pi_provider_${Date.now()}_${Math.random()}`;
  global.__mockPaymentIntents[paymentIntentId] = {
    id: paymentIntentId, status: 'succeeded', amount: 11000,
    metadata: { buyerId: String(buyer._id), itemIds: String(listing._id) },
  };
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
    returnDetails: {
      trackingNumber: `RET${Date.now()}`,
      buyerShippedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
    },
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
    name: 'Refund Provider Seller', email: `refund-provider-seller-${Date.now()}@test.com`,
    password: 'password123', emailVerified: true, authProvider: 'email',
    country: 'US', currency: 'USD',
    balance: { available: 0, pending: 92, totalEarned: 92, totalPaidOut: 0, currency: 'USD' },
  });
  buyer = await User.create({
    name: 'Refund Provider Buyer', email: `refund-provider-buyer-${Date.now()}@test.com`,
    password: 'password123', emailVerified: true, authProvider: 'email',
    country: 'US', currency: 'USD',
  });
});

beforeEach(() => {
  payments.issueRefund.mockReset();
});

afterAll(async () => {
  await Transaction.deleteMany({ _id: { $in: created } });
  await Return.deleteMany({ _id: { $in: created } });
  await Listing.deleteMany({ _id: { $in: created } });
  await User.deleteMany({ _id: { $in: [seller._id, buyer._id] } });
  await mongoose.connection.close();
});

describe('return settlement records the provider refund result', () => {
  test('a rejected refund does not settle the return and stays retryable', async () => {
    const { txn, returnRequest, listing } = await makeDeliveredReturn();
    payments.issueRefund.mockResolvedValueOnce({ id: 're_test_failed', status: 'failed', amount: 11000 });

    const result = await autoProcessReturnTracking();

    expect(result.settled).toBe(0);
    const rejectedReturn = await Return.findById(returnRequest._id);
    expect(rejectedReturn.status).not.toBe('refunded');
    expect(rejectedReturn.providerRefunded).toBe(false);
    expect(rejectedReturn.providerRefundId).toBe('');
    // The ledger must be untouched: no restock, no seller clawback, no payout
    // marked refunded while the buyer still has no money back.
    expect((await Listing.findById(listing._id)).quantity).toBe(0);
    expect((await User.findById(seller._id)).balance.pending).toBe(92);
    const parked = await Transaction.findById(txn._id);
    expect(parked.status).toBe('return_delivered');
    expect(parked.returnProcessing).toBe(false);

    payments.issueRefund.mockResolvedValueOnce({ id: 're_test_succeeded', status: 'succeeded', amount: 11000 });
    const retry = await autoProcessReturnTracking();

    expect(retry.settled).toBe(1);
    const settledReturn = await Return.findById(returnRequest._id);
    expect(settledReturn.status).toBe('refunded');
    expect(settledReturn.providerRefunded).toBe(true);
    expect(settledReturn.providerRefundId).toBe('re_test_succeeded');
    expect(settledReturn.providerRefundStatus).toBe('succeeded');
    expect(settledReturn.providerRefundAmount).toBe(11000);
    expect(settledReturn.providerRefundedAt).toBeTruthy();
    expect((await Transaction.findById(txn._id)).status).toBe('refunded');
    expect((await Listing.findById(listing._id)).quantity).toBe(1);
    expect((await User.findById(seller._id)).balance.pending).toBe(0);
  });

  test('a pending provider refund is recorded as pending, not silently succeeded', async () => {
    const { returnRequest } = await makeDeliveredReturn();
    payments.issueRefund.mockResolvedValueOnce({ id: 're_test_pending', status: 'pending', amount: 11000 });

    const result = await autoProcessReturnTracking();

    expect(result.settled).toBe(1);
    const settledReturn = await Return.findById(returnRequest._id);
    expect(settledReturn.status).toBe('refunded');
    expect(settledReturn.providerRefunded).toBe(true);
    expect(settledReturn.providerRefundStatus).toBe('pending');
    expect(settledReturn.providerRefundId).toBe('re_test_pending');
  });
});
