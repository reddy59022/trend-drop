#!/usr/bin/env node
/**
 * Operator entry point: remove the commerce rows left by the QA webhook/chargeback
 * runs (orders, transactions, returns, payouts) and reverse the seller credit for
 * any matched sale that was never refunded.
 *
 * Inventory-first — a dry run by default, scoped only to listings titled
 * "QA webhook flow …" / "QA chargeback flow …". Listings themselves are NOT
 * touched here (they were already retired to draft); only their commerce history
 * is removed. An order containing any non-QA item is reported and blocks the run.
 *
 *   node scripts/clean-qa-commerce.js             # dry run, writes nothing
 *   node scripts/clean-qa-commerce.js --apply     # reverse credits, then delete
 *
 * Re-running after a partial failure is safe: credit reversals carry a per
 * transaction idempotency key, and deleted rows simply stop being selected.
 */
if (process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test') {
  require('dotenv').config();
}

const mongoose = require('mongoose');
const connectDB = require('../config/db');
const Listing = require('../models/Listing');
const Transaction = require('../models/Transaction');
const Order = require('../models/Order');
const Return = require('../models/Return');
const Payout = require('../models/Payout');
const { QA_TITLE_PATTERN, planQaCommerce } = require('../utils/qaCommerceCleanup');
const { applyBalanceAdjustment } = require('../utils/balanceAdjustment');

const ids = (rows) => rows.map((row) => row._id);

const main = async () => {
  const apply = process.argv.slice(2).includes('--apply');

  await connectDB();
  const { host, name } = mongoose.connection;
  console.log(`target database: ${name} @ ${host}`);
  console.log('');

  const listings = await Listing.find({ title: QA_TITLE_PATTERN })
    .select('title status seller')
    .lean();
  const listingIds = ids(listings);

  const transactions = await Transaction.find({ listing: { $in: listingIds } })
    .select('listing seller status payout paymentBreakdown')
    .lean();
  const transactionIds = ids(transactions);

  const [orders, returns, payouts] = await Promise.all([
    Order.find({
      $or: [
        { 'items.transaction': { $in: transactionIds } },
        { 'items.listing': { $in: listingIds } },
      ],
    }).select('status items seller').lean(),
    Return.find({ transaction: { $in: transactionIds } }).select('status transaction').lean(),
    Payout.find({ transaction: { $in: transactionIds } }).select('status transaction payoutAmount').lean(),
  ]);

  const plan = planQaCommerce({ listings, transactions, orders, returns, payouts });

  console.log(`QA COMMERCE CLEANUP (${apply ? 'APPLY' : 'DRY RUN'})`);
  console.log(`listings matched:  ${plan.qaListings.length}`);
  console.log(`transactions:      ${plan.qaTransactions.length}`);
  console.log(`orders:            ${plan.qaOrders.length}`);
  console.log(`returns:           ${plan.qaReturns.length}`);
  console.log(`payouts:           ${plan.qaPayouts.length}`);
  console.log('');

  if (plan.blockedOrders.length) {
    console.log(`BLOCKED (${plan.blockedOrders.length}) — orders mixing QA and non-QA items are never deleted:`);
    for (const order of plan.blockedOrders) {
      console.log(`  order ${String(order._id)} items=${(order.items || []).length}`);
    }
    console.log('');
    console.log('Refusing to run while a mixed order is in scope. Resolve it manually first.');
    await mongoose.disconnect();
    process.exit(2);
  }

  if (plan.qaTransactions.length === 0) {
    console.log('Nothing to clean up.');
    await mongoose.disconnect();
    return;
  }

  for (const txn of plan.qaTransactions) {
    console.log(`  txn   ${String(txn._id)}  ${txn.status}`);
  }
  for (const order of plan.qaOrders) {
    console.log(`  order ${String(order._id)}  ${order.status}`);
  }

  if (plan.creditReversals.length) {
    console.log('');
    console.log('Seller credit to reverse (sale still held, records about to be deleted):');
    for (const row of plan.creditReversals) {
      console.log(`  ${row.transactionId} seller=${row.sellerId} amount=${row.amount}`);
    }
  }

  if (!apply) {
    console.log('');
    console.log('DRY RUN — nothing was written. Re-run with --apply to reverse credits and delete.');
    await mongoose.disconnect();
    return;
  }

  for (const row of plan.creditReversals) {
    const result = await applyBalanceAdjustment({
      userId: row.sellerId,
      amount: -row.amount,
      key: `qa-commerce-cleanup:${row.transactionId}`,
      reason: `Reverse seller credit for deleted QA order ${row.transactionId}`,
      apply: true,
    });
    const state = result.applied ? 'reversed' : result.alreadyApplied ? 'already reversed' : 'not applied';
    console.log(`  credit ${row.transactionId}: ${state}`);
  }

  const deleted = {
    orders: (await Order.deleteMany({ _id: { $in: ids(plan.qaOrders) } })).deletedCount,
    returns: (await Return.deleteMany({ _id: { $in: ids(plan.qaReturns) } })).deletedCount,
    payouts: (await Payout.deleteMany({ _id: { $in: ids(plan.qaPayouts) } })).deletedCount,
    transactions: (await Transaction.deleteMany({ _id: { $in: ids(plan.qaTransactions) } })).deletedCount,
  };

  console.log('');
  console.log('APPLY — deleted:');
  console.log(`  orders=${deleted.orders} returns=${deleted.returns} payouts=${deleted.payouts} transactions=${deleted.transactions}`);
  console.log('Listings were left untouched (retire them separately if needed).');

  await mongoose.disconnect();
};

main().catch(async (error) => {
  console.error('QA commerce cleanup failed:', error.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
