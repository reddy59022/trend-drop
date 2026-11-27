#!/usr/bin/env node
/**
 * Safe operational-alert verification.
 *
 * Default is a dry run: it validates the configured recipient list and prints
 * the recipient key without sending anything or touching MongoDB. Pass --send
 * to deliver one clearly-labelled test alert through the production transport.
 *
 *   npm run notifications:test-alert
 *   npm run notifications:test-alert:send
 *
 * This command never mutates application data and never triggers the orphan
 * audit; it only exercises the alert transport.
 */
if (process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test') {
  require('dotenv').config();
}

const {
  sendOperationalAlert,
  getOperationalAlertRecipientKey,
} = require('../config/email');

const main = async () => {
  const send = process.argv.slice(2).includes('--send');
  const recipientKey = getOperationalAlertRecipientKey();
  const subject = '[TrendDrop][TEST] Operational alert transport verification';
  const text = [
    'This is a safe transport verification from notifications:test-alert.',
    'No application data was read or written by this command.',
    `Recipient configuration key: ${recipientKey}`,
    `Sent at: ${new Date().toISOString()}`,
  ].join('\n');

  console.log('ORPHAN NOTIFICATION ALERT TRANSPORT CHECK');
  console.log(`mode: ${send ? 'SEND' : 'DRY RUN'}`);
  console.log(`recipient key: ${recipientKey}`);
  if (!send) {
    console.log('No email sent. Re-run with --send to deliver one test alert.');
    return;
  }

  const result = await sendOperationalAlert({ subject, text });
  if (result?.skipped) {
    console.error('Alert transport is not configured; nothing was sent.');
    process.exitCode = 1;
    return;
  }
  console.log(`test alert delivered: messageId=${result?.messageId || 'unknown'}`);
};

main().catch((error) => {
  console.error('Operational alert transport check failed:', error.message);
  process.exitCode = 1;
});
