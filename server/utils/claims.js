/**
 * Atomic claims for money-moving jobs.
 *
 * A `*Processing` flag on a transaction is set with a single
 * `findOneAndUpdate` before any balance change, which is what stops two
 * workers (a duplicate click, an overlapping cron run) from settling the same
 * money twice.
 *
 * The flag alone is not enough. If the worker dies between claiming and
 * finishing — a deploy restart, an OOM kill, a dropped request — or if the
 * catch block's rollback write fails, the flag stays set forever and NOTHING
 * clears it. The record is then permanently unreleasable: for completion the
 * seller is never paid, the manual endpoint answers "already being processed"
 * for the rest of time, and no cron run will ever look at that order again.
 *
 * A claim therefore also has to be reclaimable once it is provably abandoned:
 *   - it carries a timestamp older than CLAIM_STALE_MS, or
 *   - it carries no timestamp at all (it predates claim timestamps).
 *
 * Reclaiming is safe for order completion because the release itself is
 * exactly-once (`releaseSellerEarnings`' `settlementKey`): a slow-but-alive
 * worker and a reclaiming worker can move the money at most once, so the worst
 * case is duplicated bookkeeping, not a duplicate payout.
 */
const Transaction = require('../models/Transaction');

/**
 * How long a claim may stay set before another worker treats it as abandoned.
 * Long enough that a live worker's own writes never race it, short enough that
 * a stranded order recovers on the next cron tick (the completion job runs
 * hourly).
 */
const CLAIM_STALE_MS = 15 * 60 * 1000;

/**
 * Claim a transaction, or return null when someone else holds a live claim.
 *
 * @param {object}   params
 * @param {objectId} params._id            transaction to claim
 * @param {string}   params.flag           claim flag, e.g. 'completionProcessing'
 * @param {string}   params.claimedAt      timestamp field for that flag,
 *                                         e.g. 'completionClaimedAt'
 * @param {object}   [params.extraFilter]  extra conditions the claim must satisfy
 * @param {object}   [params.extraSet]     extra fields written with the claim,
 *                                         so the claim and the state move
 *                                         together in one atomic update
 * @param {number}   [params.staleMs]      override the abandonment window
 * @param {number}   [params.now]          injectable clock (tests)
 * @returns {Promise<object|null>} the claimed transaction, or null
 */
const claimTransaction = async ({
  _id,
  flag,
  claimedAt,
  extraFilter = {},
  extraSet = {},
  staleMs = CLAIM_STALE_MS,
  now = Date.now(),
}) => {
  // Fail closed on a field that is not in the schema. Mongoose strips unknown
  // paths out of an update filter, so a typo silently deletes that `$or`
  // branch and turns the guard into "always claimable" — two workers would
  // then settle the same money. A loud throw here is strictly better than
  // silently double-paying.
  for (const path of [flag, claimedAt, ...Object.keys(extraSet)]) {
    if (!Transaction.schema.paths[path]) {
      throw new Error(`claimTransaction: '${path}' is not a Transaction schema path`);
    }
  }

  const staleBefore = new Date(now - staleMs);
  return Transaction.findOneAndUpdate(
    {
      _id,
      ...extraFilter,
      $or: [
        { [flag]: { $ne: true } },
        // "Not claimed recently" also matches a missing or null timestamp, so
        // claims taken before timestamps existed are treated as abandoned
        // rather than stuck forever.
        { [claimedAt]: { $not: { $gte: staleBefore } } },
      ],
    },
    { $set: { [flag]: true, [claimedAt]: new Date(now), ...extraSet } },
    { new: true },
  );
};

module.exports = { claimTransaction, CLAIM_STALE_MS };
