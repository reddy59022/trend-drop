/**
 * TrendDrop — listing image placeholder migration (idempotent).
 *
 * Legacy listings may carry the old grey avatar-silhouette SVG data URI as a
 * stand-in "product photo". This script rewrites those entries to the branded
 * "photo coming soon" art at /img/placeholders/listing.svg (same art the client
 * falls back to for empty image arrays).
 *
 * Safety:
 *  - Only touches Listing.images entries that ARE the old silhouette data URI
 *    (matched by its decoded markup signature — both grey #e0e0e0/#bdbdbd
 *    shapes). Real photos (Cloudinary https URLs, user uploads) are never
 *    modified. Empty arrays are left alone: the client renders the branded
 *    illustration for them, and keeping the DB honest avoids fake "1 photo".
 *  - Idempotent: re-running changes nothing after the first apply.
 *  - Dry-run by default. Pass --apply to write.
 *
 * Usage:
 *   node scripts/migrate-listing-placeholders.js          # dry run
 *   node scripts/migrate-listing-placeholders.js --apply  # write changes
 *
 * The Mongo connection string comes from server/.env (MONGO_URI) or the
 * environment. The URI is never printed (secret hygiene).
 */

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const APPLY = process.argv.includes('--apply');
const NEW_IMAGE = '/img/placeholders/listing.svg';

// Load MONGO_URI from server/.env without printing it.
const envPath = path.join(__dirname, '..', 'server', '.env');
if (fs.existsSync(envPath)) {
  require('dotenv').config({ path: envPath });
}
const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
  console.error('MONGO_URI is not set (server/.env or environment). Aborting.');
  process.exit(1);
}

// Signature of the legacy grey avatar-silhouette placeholder.
const SILHOUETTE_MARKERS = ['fill="#e0e0e0"', 'fill="#bdbdbd"'];
const isLegacySilhouette = (value) => {
  if (typeof value !== 'string' || !value.startsWith('data:image/svg+xml')) return false;
  try {
    const svg = Buffer.from(value.slice(value.indexOf(',') + 1), 'base64').toString('utf8');
    return SILHOUETTE_MARKERS.every((m) => svg.includes(m));
  } catch (e) {
    return false;
  }
};

async function main() {
  await mongoose.connect(MONGO_URI);
  // Reuse the app's own model so the migration matches production schema.
  const Listing = require(path.join(__dirname, '..', 'server', 'models', 'Listing'));

  const candidates = await Listing.find({
    images: { $elemMatch: { $regex: '^data:image/svg\\+xml' } },
  }).select('images');

  let updated = 0;
  let replacedEntries = 0;

  for (const doc of candidates) {
    const next = [];
    let changed = false;
    for (const img of doc.images || []) {
      if (isLegacySilhouette(img)) {
        changed = true;
        replacedEntries += 1;
        if (!next.includes(NEW_IMAGE)) next.push(NEW_IMAGE);
      } else if (!next.includes(img)) {
        next.push(img);
      }
    }
    if (changed) {
      updated += 1;
      if (APPLY) {
        await Listing.updateOne({ _id: doc._id }, { $set: { images: next } });
      }
    }
  }

  console.log(`Listings scanned (svg data-URI images): ${candidates.length}`);
  console.log(`Listings ${APPLY ? 'updated' : 'needing update'}: ${updated}`);
  console.log(`Silhouette image entries replaced: ${replacedEntries}`);
  if (!APPLY) console.log('Dry run — re-run with --apply to write changes.');

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
