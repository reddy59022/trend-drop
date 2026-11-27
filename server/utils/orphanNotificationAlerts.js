const crypto = require('crypto');
const NotificationAuditState = require('../models/NotificationAuditState');

const STATE_KEY = 'orphan-notifications';
const MAX_STORED_IDS = 100;
// Suppress an unchanged finding for a week, then send one reminder. The
// weekly cadence keeps a known-but-unfixed integrity issue visible without
// filling the on-call inbox with the same daily page.
const REMINDER_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
const CLAIM_LEASE_MS = 5 * 60 * 1000;
const FAILURE_REMINDER_AFTER_MS = 6 * 60 * 60 * 1000;

// Production and staging share the same collection shape. Deployments that use
// the same MongoDB cluster must set ORPHAN_ALERT_STATE_KEY to a distinct value
// per environment; otherwise a staging alert can suppress a production one.
const getStateKey = () => process.env.ORPHAN_ALERT_STATE_KEY || STATE_KEY;

const normalizeMissingTransactionIds = (ids = []) => {
  const values = Array.isArray(ids) ? ids : [ids];
  return [...new Set(values.map((id) => String(id || '')).filter(Boolean))].sort();
};

/**
 * Stable identity for the missing transaction references, independent of
 * notification count, user order, or the order in which Mongo returned them.
 */
const fingerprintMissingTransactionIds = (ids = []) => {
  const normalized = normalizeMissingTransactionIds(ids);
  if (normalized.length === 0) return null;
  return crypto.createHash('sha256').update(normalized.join('\n')).digest('hex');
};

const fingerprintAuditFailure = (error) => {
  const name = error?.name || 'Error';
  const message = String(error?.message || error || 'unknown audit failure').slice(0, 500);
  return crypto.createHash('sha256').update(`${name}\n${message}`).digest('hex');
};

const getOrphanAlertState = () => NotificationAuditState.findOne({ key: getStateKey() }).lean();

const ensureState = async () => {
  try {
    await NotificationAuditState.updateOne(
      { key: getStateKey() },
      { $setOnInsert: { key: getStateKey() } },
      { upsert: true },
    );
  } catch (error) {
    // Two cron instances can race to create the singleton state document.
    // The unique index resolves that race; any other error must still surface.
    if (error?.code !== 11000) throw error;
  }
};

const updateState = (update) => NotificationAuditState.findOneAndUpdate(
  { key: getStateKey() },
  { $set: update },
  { upsert: true, new: true, setDefaultsOnInsert: true },
);

const recordAuditRun = async ({ orphanCount = 0, missingTransactionIds = [] } = {}) => updateState({
  orphanCount,
  missingTransactionIds: normalizeMissingTransactionIds(missingTransactionIds).slice(0, MAX_STORED_IDS),
  lastRunAt: new Date(),
  // A successful audit means the failure streak is over.
  failureFingerprint: null,
  failureCount: 0,
  lastFailureAt: null,
  lastFailureAlertedAt: null,
  lastFailureMessage: null,
});

const recordOrphanAlert = async ({
  fingerprint,
  orphanCount,
  missingTransactionIds = [],
  recipientKey = null,
  claimToken = null,
}) => {
  const filter = { key: getStateKey() };
  if (claimToken) filter.claimToken = claimToken;
  const update = {
    $set: {
      fingerprint,
      orphanCount,
      missingTransactionIds: normalizeMissingTransactionIds(missingTransactionIds).slice(0, MAX_STORED_IDS),
      recipientKey,
      lastAlertedAt: new Date(),
      lastRunAt: new Date(),
      claimToken: null,
      claimUntil: null,
      pendingFingerprint: null,
      pendingOrphanCount: 0,
      pendingMissingTransactionIds: [],
      failureFingerprint: null,
      failureCount: 0,
      lastFailureAt: null,
      lastFailureAlertedAt: null,
      lastFailureMessage: null,
    },
  };
  return NotificationAuditState.findOneAndUpdate(filter, update, { new: true });
};

const recordOrphanRecovery = ({ claimToken = null } = {}) => {
  const filter = { key: getStateKey() };
  if (claimToken) filter.claimToken = claimToken;
  return NotificationAuditState.findOneAndUpdate(
    filter,
    {
      $set: {
        fingerprint: null,
        orphanCount: 0,
        missingTransactionIds: [],
        recipientKey: null,
        lastRecoveredAt: new Date(),
        lastRunAt: new Date(),
        claimToken: null,
        claimUntil: null,
        pendingFingerprint: null,
        pendingOrphanCount: 0,
        pendingMissingTransactionIds: [],
        failureFingerprint: null,
        failureCount: 0,
        lastFailureAt: null,
        lastFailureAlertedAt: null,
        lastFailureMessage: null,
      },
    },
    { new: true },
  );
};

const isDuplicateOrphanAlert = (
  state,
  fingerprint,
  { orphanCount = 0, recipientKey = null, now = new Date() } = {},
) => {
  if (!state?.lastAlertedAt || !state?.fingerprint || fingerprint !== state.fingerprint) {
    return false;
  }
  // A different recipient configuration must receive the current finding.
  if (recipientKey && state.recipientKey !== recipientKey) return false;
  // More dangling notifications for the same missing transaction ids is a
  // material change; silence would hide continued corruption.
  if (Number(orphanCount) > Number(state.orphanCount || 0)) return false;
  const age = now.getTime() - new Date(state.lastAlertedAt).getTime();
  return Number.isFinite(age) && age < REMINDER_AFTER_MS;
};

const needsRecoveryNotice = (state) => Boolean(state?.lastAlertedAt && state?.fingerprint);

/**
 * Atomically claim the right to deliver one alert. A matching recent finding is
 * suppressed; a matching finding older than the reminder window, a changed
 * finding, a changed recipient, or a larger orphan count is claimable. The
 * lease makes overlapping cron processes safe and recoverable.
 */
const claimOrphanAlert = async ({
  fingerprint,
  orphanCount = 0,
  missingTransactionIds = [],
  recipientKey = null,
  now = new Date(),
}) => {
  if (!fingerprint) return { claimed: false, reason: 'no-fingerprint' };
  await ensureState();

  const token = crypto.randomBytes(16).toString('hex');
  const claimUntil = new Date(now.getTime() + CLAIM_LEASE_MS);
  const reminderCutoff = new Date(now.getTime() - REMINDER_AFTER_MS);
  const claimed = await NotificationAuditState.findOneAndUpdate(
    {
      key: getStateKey(),
      $and: [
        {
          $or: [
            { fingerprint: { $ne: fingerprint } },
            { lastAlertedAt: null },
            { recipientKey: { $ne: recipientKey } },
            { orphanCount: { $lt: Number(orphanCount) } },
            { lastAlertedAt: { $lte: reminderCutoff } },
          ],
        },
        {
          $or: [
            { claimToken: null },
            { claimToken: { $exists: false } },
            { claimUntil: null },
            { claimUntil: { $exists: false } },
            { claimUntil: { $lte: now } },
          ],
        },
      ],
    },
    {
      $set: {
        claimToken: token,
        claimUntil,
        pendingFingerprint: fingerprint,
        pendingOrphanCount: orphanCount,
        pendingMissingTransactionIds: normalizeMissingTransactionIds(missingTransactionIds)
          .slice(0, MAX_STORED_IDS),
      },
    },
    { new: true },
  ).lean();

  return claimed
    ? { claimed: true, token, state: claimed }
    : { claimed: false, reason: 'suppressed-or-claimed' };
};

const claimOrphanRecovery = async ({ now = new Date() } = {}) => {
  await ensureState();
  const token = crypto.randomBytes(16).toString('hex');
  const claimUntil = new Date(now.getTime() + CLAIM_LEASE_MS);
  const claimed = await NotificationAuditState.findOneAndUpdate(
    {
      key: getStateKey(),
      fingerprint: { $ne: null },
      lastAlertedAt: { $ne: null },
      $or: [
        { claimToken: null },
        { claimToken: { $exists: false } },
        { claimUntil: null },
        { claimUntil: { $exists: false } },
        { claimUntil: { $lte: now } },
      ],
    },
    {
      $set: {
        claimToken: token,
        claimUntil,
        pendingFingerprint: null,
        pendingOrphanCount: 0,
        pendingMissingTransactionIds: [],
      },
    },
    { new: true },
  ).lean();
  return claimed ? { claimed: true, token } : { claimed: false };
};

const releaseOrphanAlertClaim = async ({
  claimToken,
  fingerprint = null,
  orphanCount = 0,
  missingTransactionIds = [],
} = {}) => {
  if (!claimToken) return null;
  return NotificationAuditState.findOneAndUpdate(
    { key: getStateKey(), claimToken },
    {
      $set: {
        claimToken: null,
        claimUntil: null,
        pendingFingerprint: null,
        pendingOrphanCount: 0,
        pendingMissingTransactionIds: [],
        lastRunAt: new Date(),
        ...(fingerprint ? {
          orphanCount,
          missingTransactionIds: normalizeMissingTransactionIds(missingTransactionIds)
            .slice(0, MAX_STORED_IDS),
        } : {}),
      },
    },
    { new: true },
  );
};

const isDuplicateAuditFailure = (
  state,
  failureFingerprint,
  { now = new Date() } = {},
) => {
  if (!state?.lastFailureAlertedAt || state?.failureFingerprint !== failureFingerprint) {
    return false;
  }
  const age = now.getTime() - new Date(state.lastFailureAlertedAt).getTime();
  return Number.isFinite(age) && age < FAILURE_REMINDER_AFTER_MS;
};

const recordAuditFailure = async ({ failureFingerprint, error }) => {
  const update = {
    $set: {
      failureFingerprint,
      lastFailureAt: new Date(),
      lastFailureAlertedAt: new Date(),
      lastFailureMessage: String(error?.message || error || 'unknown audit failure').slice(0, 500),
    },
    $inc: { failureCount: 1 },
  };
  return NotificationAuditState.findOneAndUpdate(
    { key: getStateKey() },
    update,
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
};

module.exports = {
  STATE_KEY,
  REMINDER_AFTER_MS,
  CLAIM_LEASE_MS,
  FAILURE_REMINDER_AFTER_MS,
  getStateKey,
  fingerprintMissingTransactionIds,
  fingerprintAuditFailure,
  normalizeMissingTransactionIds,
  getOrphanAlertState,
  recordAuditRun,
  recordOrphanAlert,
  recordOrphanRecovery,
  isDuplicateOrphanAlert,
  needsRecoveryNotice,
  claimOrphanAlert,
  claimOrphanRecovery,
  releaseOrphanAlertClaim,
  isDuplicateAuditFailure,
  recordAuditFailure,
};
