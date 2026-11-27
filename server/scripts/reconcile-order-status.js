#!/usr/bin/env node
/**
 * Operator entry point: reconcile consolidated Orders with their transactions.
 *
 * Inventory-first — dry run by default. It finds:
 *   - orders whose items are ALL refunded/cancelled/chargeback-lost but the
 *     order is still active;
 *   - orders whose items are ALL completed but the order never completed;
 *   - reversed items or fully reversed shipments still sitting on an order.
 *
 * Fixes go through the same idempotent `syncOrderFromTransaction` used by the
 * live routes, so a repeated run (or a crash mid-fix) cannot double-count the
 * refund audit.
 *
 *   node scripts/reconcile-order-status.js             # dry run, writes nothing
 *   node scripts/reconcile-order-status.js --apply
 *   node scripts/reconcile-order-status.js --apply --limit=5000
 */
if (process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test') {
  require('dotenv').config();
}

const mongoose = require('mongoose');
const connectDB = require('../config/db');
const Order = require('../models/Order');
const Transaction = require('../models/Transaction');
const { syncOrderFromTransaction } = require('../routes/orderLifecycle');
const { classifyOrder, isReversedStatus, refundAmountFor } = require('../utils/orderStatusReconcile');

const readLimit = (args) => {
  const inline = args.find((a) => a.startsWith('--limit='));
  const value = inline ? inline.split('=')[1] : args[args.indexOf('--limit') + 1];
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5000;
};

const describe = (plan) => {
  const target = plan.expected ? `expected=${plan.expected}` : 'expected=preserve';
  return `${plan.orderId} status=${plan.status} ${target} staleItems=${plan.staleItems.length} staleShipments=${plan.staleShipments.length} missingTxns=${plan.missingTransactions.length}`;
};

const main = async () => {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const limit = readLimit(args);

  await connectDB();
  const { host, name } = mongoose.connection;
  console.log(`target database: ${name} @ ${host}`);
  console.log('');

  const orders = await Order.find({})
    .select('status items shipments cancellation payment')
    .sort({ createdAt: 1 })
    .limit(limit)
    .lean();

  const txnIds = [];
  for (const order of orders) {
    for (const item of order.items || []) if (item.transaction) txnIds.push(item.transaction);
    for (const shipment of order.shipments || []) for (const id of shipment.items || []) txnIds.push(id);
  }
  const transactions = await Transaction.find({ _id: { $in: txnIds } })
    .select('status cancellation paymentBreakdown itemPrice currency seller')
    .lean();
  const txnsById = new Map(transactions.map((txn) => [String(txn._id), txn]));

  const plans = orders
    .map((order) => classifyOrder(order, txnsById))
    .filter((plan) => plan.needsFix);

  console.log(`ORDER STATUS RECONCILIATION (${apply ? 'APPLY' : 'DRY RUN'})`);
  console.log(`scanned orders: ${orders.length}${orders.length >= limit ? ` (hit --limit=${limit})` : ''}`);
  console.log(`mismatched orders: ${plans.length}`);
  console.log('');

  for (const plan of plans) console.log(`  ${describe(plan)}`);

  if (!apply) {
    console.log('');
    console.log('DRY RUN — nothing was written. Re-run with --apply to reconcile.');
    await mongoose.disconnect();
    return;
  }

  let fixed = 0;
  let failed = 0;
  for (const plan of plans) {
    try {
      const order = await Order.findById(plan.orderId);
      if (!order) continue;

      if (plan.missingTransactions.length > 0) {
        console.log(`  SKIP ${plan.orderId}: missing transactions ${plan.missingTransactions.join(',')}`);
        failed++;
        continue;
      }

      const itemTxns = [];
      for (const item of order.items || []) {
        const txn = txnsById.get(String(item.transaction));
        if (txn) itemTxns.push(txn);
      }

      if (plan.expected === 'completed') {
        if (itemTxns.length === 0) {
          console.log(`  SKIP ${plan.orderId}: completed order has no transactions to sync`);
          failed++;
          continue;
        }
        await syncOrderFromTransaction(itemTxns[0], 'completed');
      } else {
        const reversedTxns = itemTxns.filter((txn) => isReversedStatus(txn.status));
        for (const txn of reversedTxns) {
          await syncOrderFromTransaction(txn, 'refunded', refundAmountFor(txn));
        }
        // Items already removed (e.g. a crash after the item deletion) — finish
        // the terminal state without touching the refund audit.
        if (reversedTxns.length === 0 && plan.expected === 'refunded') {
          order.items = [];
          for (const shipment of order.shipments || []) {
            shipment.items = [];
            shipment.status = 'cancelled';
          }
          order.status = 'refunded';
          if (order.payment) order.payment.status = 'refunded';
          await order.save();
        } else if (reversedTxns.length === 0 && plan.staleShipments.length > 0) {
          for (const shipment of order.shipments || []) {
            if (plan.staleShipments.includes(String(shipment._id))) shipment.status = 'cancelled';
          }
          await order.save();
        }
      }

      const after = await Order.findById(plan.orderId);
      const stillStale = plan.expected && after.status !== plan.expected;
      if (stillStale) {
        console.log(`  FAILED ${plan.orderId}: status is ${after.status}, expected ${plan.expected}`);
        failed++;
      } else {
        console.log(`  FIXED  ${plan.orderId} -> ${after.status}`);
        fixed++;
      }
    } catch (error) {
      console.log(`  FAILED ${plan.orderId}: ${error.message}`);
      failed++;
    }
  }

  console.log('');
  console.log(`APPLY — fixed=${fixed} failed=${failed}`);
  await mongoose.disconnect();
  if (failed > 0) process.exitCode = 1;
};

main().catch(async (error) => {
  console.error('Order status reconciliation failed:', error.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
