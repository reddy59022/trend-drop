#!/usr/bin/env node
/**
 * QA/E2E catalog cleanup: remove test inventory from the listing catalog.
 *
 * The production catalog accumulated test listings (PROD-E2E …, QA Test
 * Item …, transaction-artifact titles). They are the single biggest reason
 * the marketplace does not look credible. This script is the operator entry
 * point and follows the reconcile-settlements.js contract:
 *
 *   node scripts/clean-qa-listings.js                    # dry run, writes nothing
 *   node scripts/clean-qa-listings.js --apply            # delete the clean junk
 *   node scripts/clean-qa-listings.js --limit=2000
 *
 * Safety contract:
 *  - Detection is tight (utils/qaListingCleanup.js): only unmistakable test
 *    artifacts match. A real seller's listing is never deleted.
 *  - A junk listing WITH commerce history (transactions / orders / offers) is
 *    never deleted silently — it is reported for manual review instead.
 *  - Dry run is the default; --apply is required to write.
 */
if (process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test') {
  require('dotenv').config();
}

const mongoose = require('mongoose');
const connectDB = require('../config/db');
const { isQaJunkTitle, planQaCleanup } = require('../utils/qaListingCleanup');

const readLimit = (args) => {
  const inline = args.find((a) => a.startsWith('--limit='));
  const value = inline ? inline.split('=')[1] : args[args.indexOf('--limit') + 1];
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5000;
};

const main = async () => {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const limit = readLimit(args);

  await connectDB();

  // Say WHERE this is about to run: a cleanup must never be applied to an
  // unknown database by accident.
  const { host, name } = mongoose.connection;
  console.log(`target database: ${name} @ ${host}`);
  console.log('');

  const Listing = require('../models/Listing');
  const Transaction = require('../models/Transaction');
  const Order = require('../models/Order');
  const Offer = require('../models/Offer');

  const candidates = await Listing.find({}).select('title seller createdAt').limit(limit).lean();
  const junk = candidates.filter((l) => isQaJunkTitle(l.title));

  // Commerce history per junk listing — anything that has it needs review.
  const junkIds = junk.map((l) => l._id);
  const [txns, orders, offers] = await Promise.all([
    Transaction.find({ listing: { $in: junkIds } }).select('listing').lean(),
    Order.find({ 'items.listing': { $in: junkIds } }).select('items.listing').lean(),
    Offer.find({ listing: { $in: junkIds } }).select('listing').lean(),
  ]);

  const touched = new Set();
  for (const t of txns) touched.add(String(t.listing));
  for (const o of orders) for (const item of o.items || []) touched.add(String(item.listing));
  for (const o of offers) touched.add(String(o.listing));

  const { deletable, needsReview } = planQaCleanup(junk, (l) => touched.has(String(l._id)));

  console.log(`QA/E2E CATALOG CLEANUP (${apply ? 'APPLY' : 'DRY RUN'})`);
  console.log(`scanned listings: ${candidates.length}${candidates.length >= limit ? ` (hit --limit=${limit}; rerun with a higher limit)` : ''}`);
  console.log(`junk identified: ${junk.length}`);
  console.log(`  deletable (no commerce history): ${deletable.length}`);
  console.log(`  needs review (has transactions/orders/offers): ${needsReview.length}`);
  console.log('');

  for (const l of needsReview) {
    console.log(`  REVIEW  ${String(l._id)}  "${l.title}"`);
  }
  if (needsReview.length) console.log('');

  if (!apply) {
    for (const l of deletable.slice(0, 50)) {
      console.log(`  would delete  ${String(l._id)}  "${l.title}"`);
    }
    if (deletable.length > 50) console.log(`  … and ${deletable.length - 50} more`);
    console.log('');
    console.log('DRY RUN — nothing was written. Re-run with --apply to delete.');
  } else {
    let deleted = 0;
    for (const l of deletable) {
      await Listing.deleteOne({ _id: l._id });
      deleted++;
    }
    console.log(`APPLY — deleted ${deleted} junk listings.`);
    if (needsReview.length) {
      console.log(`${needsReview.length} listings with commerce history were NOT touched — review them manually.`);
    }
  }

  await mongoose.connection.close();
};

main().catch((err) => {
  console.error('clean-qa-listings failed:', err.message);
  process.exit(1);
});
