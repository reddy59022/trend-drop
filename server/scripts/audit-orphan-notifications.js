#!/usr/bin/env node
/**
 * READ-ONLY audit: find notifications whose referenced transaction is missing.
 *
 * Notifications live inside User documents; deleting a transaction does not
 * cascade to them. This report is intentionally read-only — it has no --apply
 * mode. Use it after cleanup jobs or as a scheduled integrity check.
 *
 *   node scripts/audit-orphan-notifications.js
 *   node scripts/audit-orphan-notifications.js --json
 */
if (process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test') {
  require('dotenv').config();
}

const mongoose = require('mongoose');
const connectDB = require('../config/db');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const {
  collectOrphanNotifications,
  summarizeOrphanNotifications,
} = require('../utils/notificationAudit');

const main = async () => {
  const json = process.argv.slice(2).includes('--json');

  await connectDB();
  const { host, name } = mongoose.connection;

  // Do not add `$ne: null` here: on an array of subdocuments MongoDB treats a
  // subdocument missing `transaction` as a null match, which excludes the
  // whole user even though other notifications do reference transactions.
  const users = await User.find({
    'notifications.transaction': { $exists: true },
  })
    .select('_id notifications')
    .lean();

  const referencedIds = new Set();
  let notificationCount = 0;
  for (const user of users) {
    for (const notification of user.notifications || []) {
      notificationCount += 1;
      if (notification.transaction) referencedIds.add(String(notification.transaction));
    }
  }

  const existing = referencedIds.size > 0
    ? await Transaction.find({ _id: { $in: [...referencedIds] } }).select('_id').lean()
    : [];
  const existingIds = existing.map((transaction) => transaction._id);

  const rows = collectOrphanNotifications(users, existingIds);
  const summary = summarizeOrphanNotifications(rows);
  const report = {
    readOnly: true,
    database: name,
    host,
    usersScanned: users.length,
    notificationsScanned: notificationCount,
    referencedTransactions: referencedIds.size,
    existingTransactions: existingIds.length,
    ...summary,
  };

  if (json) {
    console.log(JSON.stringify(report, null, 2));
    await mongoose.disconnect();
    return;
  }

  console.log(`ORPHAN NOTIFICATION AUDIT (READ ONLY)`);
  console.log(`database: ${name} @ ${host}`);
  console.log(`users scanned: ${report.usersScanned}`);
  console.log(`notifications scanned: ${report.notificationsScanned}`);
  console.log(`referenced transactions: ${report.referencedTransactions} (${report.existingTransactions} exist)`);
  console.log(`orphaned notifications: ${report.total}`);
  console.log(`affected users: ${report.affectedUsers}`);
  console.log(`missing transactions: ${report.missingTransactionIds.length}`);
  for (const [type, count] of Object.entries(report.byType).sort()) {
    console.log(`  type ${type}: ${count}`);
  }
  if (report.total > 0) {
    console.log('');
    for (const row of report.notifications) {
      console.log(`  user=${row.userId} notification=${row.notificationId || 'n/a'} type=${row.type} missingTxn=${row.transactionId}`);
    }
  }

  await mongoose.disconnect();
};

main().catch(async (error) => {
  console.error('Orphan notification audit failed:', error.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
