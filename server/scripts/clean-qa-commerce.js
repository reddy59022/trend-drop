#!/usr/bin/env node
/**
 * Operator entry point: remove the commerce rows left by the QA webhook/chargeback
 * runs (orders, transactions, returns, payouts), every notification that
 * references a matched transaction, and reverse the seller credit for any
 * matched sale that was never refunded.
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
const User = require('../models/User');
const { QA_TITLE_PATTERN, buildNotificationRemovalFilter, planQaCommerce } = require('../utils/qaCommerceCleanup');
const { applyBalanceAdjustment } = require('../utils/balanceAdjustment');

const ids = (rows) => rows.map((row) => row._id);

const formatTypeCounts = (byType = {}) => Object.entries(byType)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([type, count]) => `${type}=${count}`)
  .join(' ');

const countType = (notifications) => notifications.reduce((counts, notification) => {
  const type = String(notification?.type || 'unknown');
  counts[type] = (counts[type] || 0) + 1;
  return counts;
}, {});

const main = async ({
  apply = process.argv.slice(2).includes('--apply'),
  disconnect = true,
} = {}) => {
  const close = async () => {
    if (disconnect) await mongoose.disconnect();
  };

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

  const [orders, returns, payouts, users] = await Promise.all([
    Order.find({
      $or: [
        { 'items.transaction': { $in: transactionIds } },
        { 'items.listing': { $in: listingIds } },
      ],
    }).select('status items seller').lean(),
    Return.find({ transaction: { $in: transactionIds } }).select('status transaction').lean(),
    Payout.find({ transaction: { $in: transactionIds } }).select('status transaction payoutAmount').lean(),
    User.find({
      'notifications.transaction': { $in: transactionIds },
    }).select('notifications').lean(),
  ]);

  const plan = planQaCommerce({ listings, transactions, orders, returns, payouts, users });

  console.log(`QA COMMERCE CLEANUP (${apply ? 'APPLY' : 'DRY RUN'})`);
  console.log(`listings matched:  ${plan.qaListings.length}`);
  console.log(`transactions:      ${plan.qaTransactions.length}`);
  console.log(`orders:            ${plan.qaOrders.length}`);
  console.log(`returns:           ${plan.qaReturns.length}`);
  console.log(`payouts:           ${plan.qaPayouts.length}`);
  const notificationBreakdown = formatTypeCounts(plan.notificationCounts.byType);
  console.log(`notifications:     ${plan.notificationCounts.total}${notificationBreakdown ? ` (${notificationBreakdown})` : ''}`);
  console.log('');

  if (plan.blockedOrders.length) {
    console.log(`BLOCKED (${plan.blockedOrders.length}) — orders mixing QA and non-QA items are never deleted:`);
    for (const order of plan.blockedOrders) {
      console.log(`  order ${String(order._id)} items=${(order.items || []).length}`);
    }
    console.log('');
    console.log('Refusing to run while a mixed order is in scope. Resolve it manually first.');
    await close();
    process.exit(2);
  }

  if (plan.qaTransactions.length === 0) {
    console.log('Nothing to clean up.');
    await close();
    return;
  }

  for (const txn of plan.qaTransactions) {
    console.log(`  txn   ${String(txn._id)}  ${txn.status}`);
  }
  for (const order of plan.qaOrders) {
    console.log(`  order ${String(order._id)}  ${order.status}`);
  }
  for (const row of plan.notificationRemovals) {
    const breakdown = formatTypeCounts(row.byType);
    console.log(`  notifications user=${row.userId} total=${row.total}${breakdown ? ` (${breakdown})` : ''}`);
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
    await close();
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

  // Remove notifications BEFORE the transactions. If the process dies after
  // this step, the remaining QA commerce rows are still identifiable by their
  // listings; the reverse order would leave dangling references.
  const qaTransactionIds = new Set(plan.qaTransactions.map((txn) => String(txn._id)));
  let notificationsRemoved = 0;
  const notificationsRemovedByType = {};
  for (const row of plan.notificationRemovals) {
    if (row.notificationIds.length === 0) continue;
    await User.updateOne(
      { _id: row.userId },
      {
        $pull: {
          notifications: buildNotificationRemovalFilter(
            row.notificationIds,
            ids(plan.qaTransactions),
          ),
        },
      },
    );
    // Count from the resulting document so partial matches are reported
    // accurately rather than claiming the whole planned batch was removed.
    const after = await User.findById(row.userId).select('notifications').lean();
    const remaining = (after?.notifications || []).filter((notification) =>
      notification.transaction
      && qaTransactionIds.has(String(notification.transaction)));
    const remainingByType = countType(remaining);
    for (const [type, count] of Object.entries(row.byType)) {
      const removed = Math.max(0, count - (remainingByType[type] || 0));
      if (removed) notificationsRemovedByType[type] = (notificationsRemovedByType[type] || 0) + removed;
    }
    notificationsRemoved += Math.max(0, row.total - remaining.length);
  }

  const deleted = {
    notifications: notificationsRemoved,
    orders: (await Order.deleteMany({ _id: { $in: ids(plan.qaOrders) } })).deletedCount,
    returns: (await Return.deleteMany({ _id: { $in: ids(plan.qaReturns) } })).deletedCount,
    payouts: (await Payout.deleteMany({ _id: { $in: ids(plan.qaPayouts) } })).deletedCount,
    transactions: (await Transaction.deleteMany({ _id: { $in: ids(plan.qaTransactions) } })).deletedCount,
  };

  const removedBreakdown = formatTypeCounts(notificationsRemovedByType);
  console.log('');
  console.log('APPLY — deleted:');
  console.log(`  notifications=${deleted.notifications}${removedBreakdown ? ` (${removedBreakdown})` : ''} orders=${deleted.orders} returns=${deleted.returns} payouts=${deleted.payouts} transactions=${deleted.transactions}`);
  console.log('Listings were left untouched (retire them separately if needed).');

  await close();
};

if (require.main === module) {
  main().catch(async (error) => {
    console.error('QA commerce cleanup failed:', error.message);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
}

module.exports = { main };
