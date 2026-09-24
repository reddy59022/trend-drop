/**
 * Settlement reconciliation for completed orders.
 *
 * THE PROBLEM THIS SOLVES (one-time data repair, general safety net):
 * the new-seller hold was originally only a *decision* to skip the release. A
 * held order was finalized as `completed`, its money stayed in
 * `balance.pending`, and — depending on which completion path ran — the payout
 * ledger row was written as `completed`/`paidAt` as if the seller had been paid.
 * Nothing on the transaction says the payout was withheld (`settlementHold` did
 * not exist yet), so those rows are indistinguishable from genuinely paid sales.
 * The order is already `completed`, so no completion path will ever come back
 * for it: `releaseHeldSettlements` only looks at rows with a hold record.
 *
 * WHAT MAKES A REPAIR DEFENSIBLE: the risk is one-sided in the wrong way. Paying
 * a row twice is a straight platform loss, so a verdict of "withheld" has to be
 * *proved* from positive evidence, and the amount that may leave the platform in
 * any run is capped by the funds the platform is actually holding.
 *
 * Evidence, in order of strength:
 *   1. `balance.settledTransactions` — written by the exactly-once release. Proof.
 *   2. `balance.reserveReleaseDate[].transactionId` — every release pushes a
 *      rolling-reserve entry. Proof (but rotate-out by `releaseReserves`, so it
 *      disappears once the reserve matures).
 *   3. `settlementHold.releasedAt` — a hold that was swept. Proof.
 *   4. `escrow.status === 'released'` — escrow paid the seller out. Proof.
 *   5. A seller notification for this transaction whose copy only a release
 *      branch writes. Weaker (it is text), durable, and the last trace left once
 *      the reserve entry has aged out.
 *   6. A seller notification whose copy only a *withholding* branch writes — the
 *      fingerprint of the legacy hold.
 *   7. `settlementHold.releaseAfter` — the recorded (modern) deferral.
 *   8. Account age: a hold can only apply while the seller is younger than
 *      NEW_SELLER_HOLD, and the order was placed no earlier than the account was
 *      created, so `txn.createdAt - seller.createdAt >= NEW_SELLER_HOLD` rules the
 *      hold out. Used only to *refuse* a repair, never to justify one.
 *
 * The payout row is deliberately NOT evidence: the legacy completion wrote
 * `completed`/`paidAt` whether or not it released the funds, so trusting it is
 * exactly the bug being repaired.
 *
 * Any run that is not covered by a hard proof is reported, never paid: an
 * operator can act on `unknown` / `conflict` / `insufficient_pending` rows, and
 * nothing here is irreversible because the payout itself goes through
 * `releaseSellerSettlement`, which is exactly-once per transaction.
 */
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const Payout = require('../models/Payout');
const { releaseSellerSettlement } = require('./settlement');
const { round2 } = require('./balances');
const { orderStates, timeWindows } = require('../config/orderLifecycle');

const verdicts = {
  ALREADY_PAID: 'already_paid',
  /** Recorded on a row this reconciler actually paid. */
  RELEASED: 'released',
  UNPAID: 'unpaid',
  HELD_PENDING: 'held_pending',
  UNKNOWN: 'unknown',
  CONFLICT: 'conflict',
  OUT_OF_SCOPE: 'out_of_scope',
  SELLER_MISSING: 'seller_missing',
};

/** Verdicts that are terminal: an audited row is not scanned again. */
const TERMINAL_VERDICTS = [verdicts.ALREADY_PAID, verdicts.RELEASED];

/** Copy written only by a withholding branch. */
const HOLD_NOTICE_RE = /new seller hold|payment held/i;
/** Copy written only by a release branch. */
const RELEASE_NOTICE_RE = /released/i;

const LEGACY_HOLD_REASON = 'legacy_hold_recovered';

const noticeFor = (seller, transactionId, pattern) =>
  (seller?.notifications || []).find(
    (n) => n?.transaction
      && String(n.transaction) === String(transactionId)
      && typeof n.message === 'string'
      && pattern.test(n.message),
  );

/**
 * Decide what happened to one completed order's earnings, from the records that
 * are still on the account. Pure: no reads, no writes, no clock of its own.
 *
 * @returns {{transactionId: string, sellerId: string|null, verdict: string,
 *            earnings: number, evidence: string[], blockers: string[]}}
 */
const auditSettlement = ({ txn, seller, now = Date.now() }) => {
  const transactionId = String(txn._id);
  const sellerId = txn.seller ? String(txn.seller) : null;
  const earnings = round2(txn.paymentBreakdown?.sellerEarnings || 0);
  const evidence = [];
  const blockers = [];
  const result = (verdict) => ({
    transactionId,
    sellerId,
    verdict,
    earnings,
    evidence,
    blockers: [...blockers],
  });

  if (!seller) {
    blockers.push('seller_missing');
    return result(verdicts.SELLER_MISSING);
  }
  // Out of scope: nothing about a seller's payable settlement can be concluded.
  if (txn.status !== orderStates.COMPLETED) {
    blockers.push('not_completed');
    return result(verdicts.OUT_OF_SCOPE);
  }
  if (txn.payout?.status === 'refunded') {
    blockers.push('payout_refunded');
    return result(verdicts.OUT_OF_SCOPE);
  }
  if (earnings <= 0) {
    blockers.push('nothing_to_pay');
    return result(verdicts.OUT_OF_SCOPE);
  }
  // Escrow owns these funds until it settles, in either direction.
  if (txn.escrow?.status && txn.escrow.status !== 'inactive' && txn.escrow.status !== 'released') {
    blockers.push(`escrow_${txn.escrow.status}`);
    return result(verdicts.OUT_OF_SCOPE);
  }

  const hold = txn.settlementHold || {};
  const scheduledRelease = hold.releaseAfter ? new Date(hold.releaseAfter).getTime() : null;

  // ── Proof that the earnings already reached the seller's balance.
  const settledKey = (seller.balance?.settledTransactions || [])
    .some((key) => String(key) === transactionId);
  const reserveEntry = (seller.balance?.reserveReleaseDate || [])
    .some((entry) => entry.transactionId && String(entry.transactionId) === transactionId);
  const escrowReleased = txn.escrow?.status === 'released';
  const releaseNotice = noticeFor(seller, transactionId, RELEASE_NOTICE_RE);

  if (settledKey) evidence.push('settlement_key');
  if (hold.releasedAt) evidence.push('hold_released');
  if (reserveEntry) evidence.push('reserve_entry');
  if (escrowReleased) evidence.push('escrow_released');
  if (releaseNotice) evidence.push('release_notice');

  // Balance-level proofs: the money physically moved for this transaction.
  const moneyProof = settledKey || Boolean(hold.releasedAt) || reserveEntry || escrowReleased;

  // ── Traces that the payout was deliberately withheld.
  const holdNotice = noticeFor(seller, transactionId, HOLD_NOTICE_RE);
  // A one-off message can match both vocabularies; that is not evidence.
  const holdNoticeIsProof = Boolean(holdNotice) && !RELEASE_NOTICE_RE.test(holdNotice.message);
  if (holdNoticeIsProof) evidence.push('hold_notice');
  if (scheduledRelease) evidence.push('settlement_hold_record');
  const holdTrace = holdNoticeIsProof || Boolean(scheduledRelease);

  if (moneyProof) return result(verdicts.ALREADY_PAID);

  // Text against text: escalate rather than pick a side.
  if (holdTrace && releaseNotice) {
    blockers.push('conflicting_evidence');
    return result(verdicts.CONFLICT);
  }
  if (releaseNotice) return result(verdicts.ALREADY_PAID);

  // A hold was impossible: the account was already past the window when the
  // order was placed (so it was past it at completion too). Yet there is no
  // trace of a release either — the release may have failed silently. Report it;
  // never pay it.
  const ageAtPurchase = new Date(txn.createdAt).getTime() - new Date(seller.createdAt).getTime();
  if (Number.isFinite(ageAtPurchase) && ageAtPurchase >= timeWindows.NEW_SELLER_HOLD) {
    blockers.push('hold_impossible');
    return result(verdicts.UNKNOWN);
  }

  if (scheduledRelease) {
    return result(scheduledRelease <= now ? verdicts.UNPAID : verdicts.HELD_PENDING);
  }
  if (holdNoticeIsProof) return result(verdicts.UNPAID);
  return result(verdicts.UNKNOWN);
};

/**
 * Inventory the completed orders whose seller settlement cannot be accounted
 * for, and (with `apply`) pay the provably-withheld ones.
 *
 * Safety properties:
 *   - a dry run writes nothing at all;
 *   - the per-run payout budget for a seller is the cash the platform is still
 *     holding for them (`balance.pending`), so the repair can never book out
 *     money that is not there — a row that would exceed it is escalated;
 *   - every payment goes through the exactly-once settlement key, so overlapping
 *     runs, retries and the existing hold sweep cannot pay twice;
 *   - a row is stamped only after the money moved, so a failed payment stays
 *     queued for the next run.
 *
 * @param {object} [options]
 * @param {boolean} [options.apply=false] move money (default: report only)
 * @param {number}  [options.now]
 * @param {number}  [options.limit=500]
 */
const reconcileSettlements = async ({ apply = false, now = Date.now(), limit = 500 } = {}) => {
  const counts = {
    released: 0,
    already_paid: 0,
    unpaid: 0,
    held_pending: 0,
    unknown: 0,
    conflict: 0,
    out_of_scope: 0,
    seller_missing: 0,
    insufficient_pending: 0,
    failed: 0,
  };
  const findings = [];
  const released = [];

  const candidates = await Transaction.find({
    status: orderStates.COMPLETED,
    // Matches both a recorded-but-unswept hold and the legacy rows that have no
    // hold record at all; already-audited rows are out of scope.
    'settlementHold.releasedAt': null,
    'payout.status': { $ne: 'refunded' },
    'settlementAudit.verdict': { $nin: TERMINAL_VERDICTS },
  })
    .sort({ createdAt: 1 })
    .limit(Math.max(1, limit));

  // A refunded ledger row outranks anything the transaction claims about itself.
  const refundedTransactions = new Set(
    (await Payout.find(
      { transaction: { $in: candidates.map((txn) => txn._id) }, status: 'refunded' },
      'transaction',
    )).map((payout) => String(payout.transaction)),
  );

  const sellers = await User.find(
    { _id: { $in: candidates.map((txn) => txn.seller) } },
    '_id createdAt balance.pending balance.settledTransactions balance.reserveReleaseDate notifications.transaction notifications.message',
  );
  const sellerById = new Map(sellers.map((seller) => [String(seller._id), seller]));
  // Funds on hand, per seller: the ceiling on what this run may pay out.
  const budget = new Map(sellers.map((seller) => [String(seller._id), round2(seller.balance?.pending || 0)]));

  for (const txn of candidates) {
    const seller = sellerById.get(String(txn.seller));
    const audit = refundedTransactions.has(String(txn._id))
      ? {
        transactionId: String(txn._id),
        sellerId: txn.seller ? String(txn.seller) : null,
        verdict: verdicts.OUT_OF_SCOPE,
        earnings: round2(txn.paymentBreakdown?.sellerEarnings || 0),
        evidence: [],
        blockers: ['payout_refunded'],
      }
      : auditSettlement({ txn, seller, now });

    let action = 'none';
    // A missing seller account is a ledger we cannot credit: escalate the row
    // instead of guessing, and leave it queued for reconciliation.
    if (audit.verdict === verdicts.SELLER_MISSING) {
      action = 'skipped';
    } else if (audit.verdict === verdicts.UNPAID) {
      const onHand = budget.get(audit.sellerId) || 0;
      if (audit.earnings > onHand) {
        // The cash is not there to pay: releasing anyway would credit the seller
        // with money the platform never received back from its own books.
        audit.blockers.push('insufficient_pending');
        counts.insufficient_pending += 1;
        action = 'skipped';
      } else if (!apply) {
        // A forecast is only useful if it matches the real run, so the budget is
        // consumed here exactly as the paying branch consumes it: a second
        // withheld order on an account that can only cover one is reported as
        // unpayable rather than promised.
        budget.set(audit.sellerId, round2(onHand - audit.earnings));
        action = 'would_release';
      } else {
        const reserveAmount = round2(audit.earnings * timeWindows.SELLER_RESERVE_PERCENT);
        const availableAmount = round2(audit.earnings - reserveAmount);
        try {
          const { paid, reason } = await releaseSellerSettlement(txn, {
            now,
            // Say why: the seller was told the payout was held, so the release
            // has to read as the same conversation continuing.
            message: `Payment of ${availableAmount} ${txn.currency} released from a settlement-hold review; ${reserveAmount} ${txn.currency} held in reserve.`,
          });
          if (reason === 'seller_missing') {
            audit.blockers.push('seller_missing');
            action = 'skipped';
          } else if (paid) {
            budget.set(audit.sellerId, round2(onHand - audit.earnings));
            audit.evidence.push('reconciled_hold');
            // The recorded verdict is the outcome, not the input: the row is
            // paid, terminal, and must never be picked up as pending again.
            audit.verdict = verdicts.RELEASED;
            await stampReconciled(txn, seller, audit, now);
            action = 'released';
            released.push({
              transactionId: audit.transactionId,
              sellerId: audit.sellerId,
              earnings: audit.earnings,
            });
          } else {
            // A concurrent sweep (or an earlier crash) already paid it.
            audit.verdict = verdicts.ALREADY_PAID;
            if (!audit.evidence.includes('settlement_key')) audit.evidence.push('settlement_key');
            await stampReconciled(txn, seller, audit, now);
          }
        } catch (error) {
          // Leave the row unstamped: the next run retries it, and because the
          // release is exactly-once the retry cannot pay twice.
          audit.blockers.push('release_failed');
          counts.failed += 1;
          action = 'skipped';
          console.error(`[RECONCILE] Settlement ${audit.transactionId} failed:`, error.message);
        }
      }
    }

    counts[audit.verdict] = (counts[audit.verdict] || 0) + 1;
    findings.push({ ...audit, action });

    // Record the conclusion on the document (money-keeping decisions deserve a
    // trail: what was concluded, on what evidence, when), but only when the run
    // is allowed to write at all. A paid row already carries its own stamp.
    if (apply && action !== 'released' && audit.verdict !== verdicts.SELLER_MISSING) {
      await Transaction.updateOne(
        { _id: txn._id },
        {
          $set: {
            'settlementAudit.verdict': audit.verdict,
            'settlementAudit.evidence': audit.evidence,
            'settlementAudit.blockers': audit.blockers,
            'settlementAudit.earnings': audit.earnings,
            'settlementAudit.reconciledAt': new Date(now),
          },
        },
      ).catch((error) => {
        counts.failed += 1;
        console.error(`[RECONCILE] Could not record audit for ${audit.transactionId}:`, error.message);
      });
    }
  }

  return { dryRun: !apply, scanned: candidates.length, counts, released, findings };
};

/**
 * Close a reconciled hold the same way the daily sweep closes one: the release
 * timestamp is what stops every other path from coming back for this order.
 */
const stampReconciled = async (txn, seller, audit, now) => {
  const maturedAt = txn.settlementHold?.releaseAfter
    ? new Date(txn.settlementHold.releaseAfter)
    : new Date(new Date(seller.createdAt).getTime() + timeWindows.NEW_SELLER_HOLD);
  await Transaction.updateOne(
    { _id: txn._id },
    {
      $set: {
        'settlementHold.reason': txn.settlementHold?.reason || LEGACY_HOLD_REASON,
        'settlementHold.releaseAfter': maturedAt,
        'settlementHold.releasedAt': new Date(now),
        'settlementAudit.verdict': audit.verdict,
        'settlementAudit.evidence': audit.evidence,
        'settlementAudit.blockers': audit.blockers,
        'settlementAudit.earnings': audit.earnings,
        'settlementAudit.reconciledAt': new Date(now),
      },
    },
  );
};

module.exports = {
  auditSettlement,
  reconcileSettlements,
  verdicts,
  TERMINAL_VERDICTS,
  LEGACY_HOLD_REASON,
};
