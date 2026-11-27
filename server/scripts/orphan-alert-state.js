#!/usr/bin/env node
/**
 * Inspect or reset the durable orphan-notification alert state.
 *
 * Read-only by default. --reset requires --confirm and only removes the
 * deduplication/reminder document; it never modifies users, transactions, or
 * notifications.
 *
 *   npm run notifications:state
 *   npm run notifications:state:reset
 */
if (process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test') {
  require('dotenv').config();
}

const mongoose = require('mongoose');
const connectDB = require('../config/db');
const NotificationAuditState = require('../models/NotificationAuditState');
const { getStateKey, getOrphanAlertState } = require('../utils/orphanNotificationAlerts');

const main = async () => {
  const args = process.argv.slice(2);
  const reset = args.includes('--reset');
  if (reset && !args.includes('--confirm')) {
    throw new Error('Refusing to reset alert state without --confirm.');
  }

  await connectDB();
  const key = getStateKey();
  if (reset) {
    const result = await NotificationAuditState.deleteOne({ key });
    console.log(JSON.stringify({
      reset: true,
      key,
      deleted: result.deletedCount,
      note: 'Only alert deduplication state was removed; application data was not touched.',
    }, null, 2));
  } else {
    const state = await getOrphanAlertState();
    console.log(JSON.stringify({
      readOnly: true,
      key,
      state: state || null,
      note: state ? 'Inspect this document when an alert is unexpectedly suppressed.' : 'No alert state exists yet.',
    }, null, 2));
  }
  await mongoose.disconnect();
};

main().catch(async (error) => {
  console.error('Orphan alert state command failed:', error.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
