/**
 * Atomic balance mutation helpers.
 *
 * WHY THIS EXISTS (revenue-integrity): the legacy money paths mutated
 * `user.balance.*` via read-modify-write (`seller.balance.available = x; await
 * seller.save()`). Under concurrency (two orders completing for the same
 * seller, a refund racing a payout, a retry double-crediting escrow) those
 * writes either (a) lose updates — silently destroying money, or (b) blow up
 * with Mongoose VersionError 500s *after* the money moved. Both are revenue
 * bugs: the seller is under- or over-paid and the platform eats the loss.
 *
 * Every helper here performs the balance change in ONE atomic
 * `updateOne` (either `$inc` or an aggregation pipeline so min/max clamps are
 * evaluated on the server against the current document). Balance math can
 * therefore never lose an update, no matter how many run concurrently.
 *
 * Conventions preserved from the legacy code:
 *   - pending/available/totalEarned clamps at 0 where the legacy code did
 *     (Math.max(0, ...)), EXCEPT the chargeback debit which intentionally
 *     allows a negative pending balance ("seller owes platform").
 *   - all amounts are 2-decimal rounded before being applied.
 */
const User = require('../models/User');

const round2 = (v) => {
  const n = typeof v === 'number' && isFinite(v) ? v : 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
};

/**
 * Release seller earnings: pending -= earnings (floor 0),
 * available += availableAmount, totalEarned += earnings.
 * Optional reserve tracking mirrors the legacy balance.reserve fields.
 *
 * `settlementKey` (normally the transaction id) makes the release
 * EXACTLY-ONCE. Completing an order is retryable — a failure in any step after
 * the release (buyer stats, the final status write, the payout record) clears
 * the claim so the next cron run / manual retry pays the seller. That retry
 * used to run this pipeline a second time and credit the seller twice, i.e.
 * the platform paid one sale twice and queued a second rolling-reserve payout.
 *
 * The key is written in the SAME single-document update as the balance change:
 * the `$ne` filter makes a second attempt match nothing, and because the marker
 * and the money move together there is no window in which the funds are out but
 * the marker is missing (which is what made the old claim-based guard
 * insufficient). Callers detect the no-op with settlementAlreadyApplied() and
 * then only skip the money, never the state transition.
 */
const releaseSellerEarnings = async (sellerId, { earnings, availableAmount, reserveAmount = 0, reserveRelease = null, settlementKey = null }) => {
  const earn = round2(earnings);
  const avail = round2(Math.max(0, availableAmount || 0));
  const reserve = round2(Math.max(0, reserveAmount || 0));
  const filter = { _id: sellerId };
  if (settlementKey) {
    // Stored (and queried) as a string: pipeline updates are applied verbatim,
    // so an ObjectId cast on one side only would silently never match.
    const key = String(settlementKey);
    filter['balance.settledTransactions'] = { $ne: key };
  }
  const stages = [
    {
      $set: {
        'balance.pending': { $max: [0, { $subtract: [{ $ifNull: ['$balance.pending', 0] }, earn] }] },
        'balance.available': { $add: [{ $ifNull: ['$balance.available', 0] }, avail] },
        'balance.totalEarned': { $add: [{ $ifNull: ['$balance.totalEarned', 0] }, earn] },
        'balance.reserve': { $add: [{ $ifNull: ['$balance.reserve', 0] }, reserve] },
      },
    },
  ];
  // NOTE: an update *pipeline* may only contain operators Mongoose can cast
  // ($set / $unset / $addFields / $replaceRoot). `$push` is a classic update
  // operator, NOT a pipeline stage — using it here throws
  // "Invalid update pipeline operator" (a 500 that would abort the release
  // after the pending balance had already been decremented). Append via
  // $set + $concatArrays instead, which is pipeline-legal and still atomic.
  if (reserveRelease) {
    stages.push({
      $set: {
        'balance.reserveReleaseDate': {
          $concatArrays: [
            { $ifNull: ['$balance.reserveReleaseDate', []] },
            [reserveRelease],
          ],
        },
      },
    });
  }
  if (settlementKey) {
    stages.push({
      $set: {
        'balance.settledTransactions': {
          $concatArrays: [
            { $ifNull: ['$balance.settledTransactions', []] },
            [String(settlementKey)],
          ],
        },
      },
    });
  }
  return User.updateOne(filter, stages);
};

/**
 * True when releaseSellerEarnings() applied nothing because this settlement
 * key was already recorded for that seller — the earnings are already with
 * them and the caller must skip the payout-side effects (reserve queue,
 * "payment released" notification, sale counters, boost-fee collection) while
 * still finishing the transaction's state transition.
 */
const settlementAlreadyApplied = (result) => !result || result.matchedCount === 0;

/**
 * Credit money to a user's available balance (escrow refunds to buyers,
 * insurance payouts, manual credits). Pure $inc — concurrent credits sum.
 */
const creditAvailable = async (userId, amount) =>
  User.updateOne({ _id: userId }, { $inc: { 'balance.available': round2(amount) } });

/**
 * Claw back seller earnings for a refund/return: take from available first,
 * remainder from pending (both floored at 0), and reduce totalEarned
 * (floored at 0). The available→pending split is computed server-side inside
 * the pipeline, so two concurrent clawbacks can never over-refund.
 */
const clawbackSellerEarnings = async (sellerId, earnings) => {
  const amt = round2(earnings);
  return User.updateOne({ _id: sellerId }, [
    {
      $set: {
        __clawFromAvailable: { $min: [{ $ifNull: ['$balance.available', 0] }, amt] },
        __clawRemaining: { $subtract: [amt, { $min: [{ $ifNull: ['$balance.available', 0] }, amt] }] },
      },
    },
    {
      $set: {
        'balance.available': { $subtract: [{ $ifNull: ['$balance.available', 0] }, '$__clawFromAvailable'] },
        'balance.pending': { $max: [0, { $subtract: [{ $ifNull: ['$balance.pending', 0] }, '$__clawRemaining'] }] },
        'balance.totalEarned': { $max: [0, { $subtract: [{ $ifNull: ['$balance.totalEarned', 0] }, amt] }] },
      },
    },
    { $unset: ['__clawFromAvailable', '__clawRemaining'] },
  ]);
};

/**
 * Reverse an *escrowed* hold: pending -= amount (floor 0) and totalEarned -=
 * amount (floor 0), deliberately WITHOUT touching `available`.
 *
 * WHY NOT clawbackSellerEarnings: that helper drains `available` first, which is
 * correct for reversing money that was already released to the seller. Escrow
 * funds were never released — they are still sitting in `pending`. Using the
 * available-first clawback for an escrow refund would seize money belonging to
 * *other, unrelated* completed orders, i.e. it would under-pay an innocent
 * seller to cover a refunded order. This helper scopes the reversal to the
 * escrow hold only.
 *
 * Revenue case this closes: an escrow refunded to the buyer used to leave the
 * same sum sitting in the seller's `pending` balance. A later payout run (or a
 * manual cash-out) would then pay the seller money the platform had already
 * refunded — a straight platform loss.
 */
const reverseEscrowHold = async (sellerId, amount) => {
  const amt = round2(amount);
  return User.updateOne({ _id: sellerId }, [
    {
      $set: {
        'balance.pending': { $max: [0, { $subtract: [{ $ifNull: ['$balance.pending', 0] }, amt] }] },
        'balance.totalEarned': { $max: [0, { $subtract: [{ $ifNull: ['$balance.totalEarned', 0] }, amt] }] },
      },
    },
  ]);
};

/**
 * Chargeback debit: pending -= amount WITHOUT the floor (a lost dispute can
 * push the seller's pending balance negative — the seller owes the platform).
 */
const debitPendingAllowNegative = async (sellerId, amount) =>
  User.updateOne({ _id: sellerId }, { $inc: { 'balance.pending': -round2(amount) } });

/**
 * Atomic cash-out: decrement available ONLY if the balance still covers the
 * amount. Returns the updated doc, or null when the balance was already
 * spent by a concurrent request (the caller answers 422).
 */
const withdrawAvailable = async (userId, amount, extraInc = {}) => {
  const amt = round2(amount);
  const inc = { 'balance.available': -amt };
  for (const [k, v] of Object.entries(extraInc)) inc[k] = round2(v);
  return User.findOneAndUpdate(
    { _id: userId, 'balance.available': { $gte: amt } },
    { $inc: inc },
    { new: true }
  );
};

module.exports = {
  round2,
  releaseSellerEarnings,
  settlementAlreadyApplied,
  creditAvailable,
  clawbackSellerEarnings,
  reverseEscrowHold,
  debitPendingAllowNegative,
  withdrawAvailable,
};
