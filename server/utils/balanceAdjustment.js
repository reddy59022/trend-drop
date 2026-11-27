/**
 * Audited, idempotent seller balance adjustment.
 *
 * Used by operator scripts to restore a ledger amount that was debited twice.
 * The adjustment is applied in ONE atomic document update that also records an
 * audit entry on the user under `balanceAdjustments` — the update is filtered by
 * `balanceAdjustments.key != key`, so re-running the same adjustment (a retry, a
 * duplicated operator run) is a no-op instead of a second credit.
 *
 * `balanceAdjustments` is intentionally not part of the User schema: Mongoose
 * hydrates only declared paths, so this internal audit trail never leaks through
 * the API and no schema migration is required.
 */
const mongoose = require('mongoose');

const round2 = (value) => Math.round(Number(value || 0) * 100) / 100;
const toObjectId = (value) => new mongoose.Types.ObjectId(String(value));

/**
 * @param {object} params
 * @param {string} params.userId
 * @param {number} params.amount    positive to credit, negative to debit
 * @param {string} params.key       unique idempotency key for this adjustment
 * @param {string} [params.reason]
 * @param {boolean} [params.apply]  false = dry run (default)
 */
async function applyBalanceAdjustment({ userId, amount, key, reason = '', apply = false }) {
  if (!mongoose.isValidObjectId(userId)) throw new Error('A valid userId is required');
  if (typeof key !== 'string' || !key.trim()) throw new Error('An idempotency key is required');
  const amt = round2(amount);
  if (!Number.isFinite(amt) || amt === 0) throw new Error('Amount must be a non-zero number');

  const users = mongoose.connection.db.collection('users');
  const _id = toObjectId(userId);
  const user = await users.findOne(
    { _id },
    { projection: { 'balance.pending': 1, 'balance.totalEarned': 1, email: 1, name: 1 } },
  );
  if (!user) throw new Error(`User ${userId} not found`);

  const before = {
    pending: round2(user.balance?.pending),
    totalEarned: round2(user.balance?.totalEarned),
  };
  const planned = {
    pending: round2(before.pending + amt),
    totalEarned: round2(before.totalEarned + amt),
  };

  const existing = await users.findOne(
    { _id, 'balanceAdjustments.key': key },
    { projection: { _id: 1 } },
  );
  if (existing) {
    return { applied: false, alreadyApplied: true, dryRun: false, before, after: before, planned, key };
  }
  if (!apply) {
    return { applied: false, alreadyApplied: false, dryRun: true, before, after: before, planned, key };
  }

  const result = await users.updateOne(
    { _id, 'balanceAdjustments.key': { $ne: key } },
    {
      $inc: { 'balance.pending': amt, 'balance.totalEarned': amt },
      $push: {
        balanceAdjustments: {
          key,
          amount: amt,
          reason,
          appliedAt: new Date(),
        },
      },
    },
  );
  if (result.modifiedCount === 0) {
    return { applied: false, alreadyApplied: true, dryRun: false, before, after: before, planned, key };
  }

  const updated = await users.findOne(
    { _id },
    { projection: { 'balance.pending': 1, 'balance.totalEarned': 1 } },
  );
  return {
    applied: true,
    alreadyApplied: false,
    dryRun: false,
    before,
    after: {
      pending: round2(updated?.balance?.pending),
      totalEarned: round2(updated?.balance?.totalEarned),
    },
    planned,
    key,
  };
}

module.exports = { applyBalanceAdjustment };
