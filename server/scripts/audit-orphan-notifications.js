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
const { auditOrphanNotifications } = require('../utils/notificationAudit');

const main = async () => {
  const json = process.argv.slice(2).includes('--json');

  await connectDB();
  const { host, name } = mongoose.connection;

  const report = {
    readOnly: true,
    database: name,
    host,
    ...(await auditOrphanNotifications()),
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
