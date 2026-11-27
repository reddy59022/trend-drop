#!/usr/bin/env node
/**
 * Operator entry point: restore the $11.35 that the pre-fix return flow debited
 * twice from the QA seller's ledger (return clawback + `charge.refunded` unwind).
 *
 * Both `clawbackSellerEarnings` and `reverseEscrowHold` decrement `pending` and
 * `totalEarned`, so the repair credits both. The adjustment is audited and
 * idempotent (unique key on the user's internal `balanceAdjustments` trail), so a
 * retry cannot credit twice.
 *
 *   node scripts/restore-qa-balance.js               # dry run, writes nothing
 *   node scripts/restore-qa-balance.js --apply       # apply once
 *   node scripts/restore-qa-balance.js --email=… --amount=11.35 --key=…
 */
if (process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test') {
  require('dotenv').config();
}

const mongoose = require('mongoose');
const connectDB = require('../config/db');
const User = require('../models/User');
const { applyBalanceAdjustment } = require('../utils/balanceAdjustment');

const readArg = (args, name, fallback) => {
  const inline = args.find((arg) => arg.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const index = args.indexOf(`--${name}`);
  if (index !== -1 && args[index + 1] && !args[index + 1].startsWith('--')) return args[index + 1];
  return fallback;
};

const main = async () => {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const email = readArg(args, 'email', 'reddy59021@gmail.com');
  const amount = Number(readArg(args, 'amount', '11.35'));
  const key = readArg(args, 'key', 'qa-double-unwind-2026-11-27');
  const reason = readArg(
    args,
    'reason',
    'Restore 11.35 double-debited by the pre-fix return/refund QA flow',
  );

  await connectDB();
  const { host, name } = mongoose.connection;
  console.log(`target database: ${name} @ ${host}`);
  console.log('');

  const user = await User.findOne({ email }).select('email name balance').lean();
  if (!user) throw new Error(`No user with email ${email}`);
  console.log(`seller:      ${user.email} (${String(user._id)})`);
  console.log(`before:      pending=${Number(user.balance?.pending || 0).toFixed(2)} totalEarned=${Number(user.balance?.totalEarned || 0).toFixed(2)}`);
  console.log(`adjustment:  +${amount.toFixed(2)} (pending and totalEarned)`);
  console.log(`audit key:   ${key}`);

  const result = await applyBalanceAdjustment({
    userId: user._id,
    amount,
    key,
    reason,
    apply,
  });

  console.log('');
  if (result.alreadyApplied) {
    console.log('This adjustment was already applied — nothing was written.');
  } else if (result.dryRun) {
    console.log(`planned:     pending=${result.planned.pending.toFixed(2)} totalEarned=${result.planned.totalEarned.toFixed(2)}`);
    console.log('DRY RUN — nothing was written. Re-run with --apply to credit the seller.');
  } else {
    console.log(`after:       pending=${result.after.pending.toFixed(2)} totalEarned=${result.after.totalEarned.toFixed(2)}`);
    console.log('APPLY — balance restored.');
  }

  await mongoose.disconnect();
};

main().catch(async (error) => {
  console.error('QA balance restore failed:', error.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
