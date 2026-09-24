#!/usr/bin/env node
/**
 * One-time settlement repair: pay the completed orders whose seller payout was
 * withheld before the hold was ever recorded on the transaction.
 *
 * See utils/settlementAudit.js for the evidence model. This script is the
 * operator entry point: it is inventory-first (dry run by default), it pays only
 * rows whose withholding is proved, and it never pays a row twice because every
 * payment goes through the exactly-once settlement key.
 *
 *   node scripts/reconcile-settlements.js                  # dry run, writes nothing
 *   node scripts/reconcile-settlements.js --apply          # pay the provable rows
 *   node scripts/reconcile-settlements.js --apply --limit 5000
 *
 * Exit code 1 means at least one row failed or could not be recorded; the run is
 * safe to repeat (the rows that did not move stay queued).
 */
if (process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test') {
  require('dotenv').config();
}

const mongoose = require('mongoose');
const connectDB = require('../config/db');
const { reconcileSettlements } = require('../utils/settlementAudit');

const ATTENTION_VERDICTS = ['unknown', 'conflict', 'out_of_scope', 'seller_missing'];

const readLimit = (args) => {
  const inline = args.find((a) => a.startsWith('--limit='));
  const value = inline ? inline.split('=')[1] : args[args.indexOf('--limit') + 1];
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 500;
};

const main = async () => {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const limit = readLimit(args);

  await connectDB();

  // Say WHERE this is about to run: `server/.env` carries whatever MONGO_URI the
  // checkout was configured with, so a local invocation can be pointed at a live
  // cluster. A repair must never be applied to an unknown database by accident.
  const { host, name } = mongoose.connection;
  console.log(`target database: ${name} @ ${host}`);

  const report = await reconcileSettlements({ apply, limit });

  const label = (row) => `${row.transactionId} seller=${row.sellerId} ${row.earnings} [${row.verdict}] action=${row.action}`;

  console.log('');
  console.log(`SETTLEMENT RECONCILIATION (${apply ? 'APPLY' : 'DRY RUN'})`);
  console.log(`scanned: ${report.scanned}`);
  for (const [verdict, count] of Object.entries(report.counts)) {
    if (count > 0) console.log(`  ${verdict}: ${count}`);
  }

  if (report.released.length) {
    console.log('');
    console.log(`PAID (${report.released.length}):`);
    for (const row of report.released) {
      console.log(`  ${row.transactionId} seller=${row.sellerId} earnings=${row.earnings}`);
    }
  }

  const attention = report.findings.filter(
    (row) => ATTENTION_VERDICTS.includes(row.verdict) || row.blockers.length > 0,
  );
  if (attention.length) {
    console.log('');
    console.log(`NEEDS A HUMAN (${attention.length}):`);
    for (const row of attention) {
      console.log(`  ${label(row)} blockers=${row.blockers.join(',') || '-'} evidence=${row.evidence.join(',') || '-'}`);
    }
  }

  if (!apply) {
    console.log('');
    console.log('Dry run: nothing was written. Re-run with --apply to pay the withheld rows.');
  }

  await mongoose.disconnect();
  process.exit(report.counts.failed > 0 ? 1 : 0);
};

main().catch(async (error) => {
  console.error('Settlement reconciliation failed:', error.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
