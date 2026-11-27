const crypto = require('crypto');
const NotificationAuditState = require('../models/NotificationAuditState');

const STATE_KEY = 'orphan-notifications';
const MAX_STORED_IDS = 100;

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

const getOrphanAlertState = () => NotificationAuditState.findOne({ key: STATE_KEY }).lean();

const updateState = (update) => NotificationAuditState.findOneAndUpdate(
  { key: STATE_KEY },
  { $set: update },
  { upsert: true, new: true, setDefaultsOnInsert: true },
);

const recordAuditRun = async ({ orphanCount = 0, missingTransactionIds = [] } = {}) => updateState({
  orphanCount,
  missingTransactionIds: normalizeMissingTransactionIds(missingTransactionIds).slice(0, MAX_STORED_IDS),
  lastRunAt: new Date(),
});

const recordOrphanAlert = async ({ fingerprint, orphanCount, missingTransactionIds = [] }) => updateState({
  fingerprint,
  orphanCount,
  missingTransactionIds: normalizeMissingTransactionIds(missingTransactionIds).slice(0, MAX_STORED_IDS),
  lastAlertedAt: new Date(),
  lastRunAt: new Date(),
});

const recordOrphanRecovery = () => NotificationAuditState.findOneAndUpdate(
  { key: STATE_KEY },
  {
    $set: {
      fingerprint: null,
      orphanCount: 0,
      missingTransactionIds: [],
      lastRecoveredAt: new Date(),
      lastRunAt: new Date(),
    },
  },
  { new: true },
);

const isDuplicateOrphanAlert = (state, fingerprint) => Boolean(
  state?.lastAlertedAt && state?.fingerprint && fingerprint === state.fingerprint,
);

const needsRecoveryNotice = (state) => Boolean(state?.lastAlertedAt && state?.fingerprint);

module.exports = {
  STATE_KEY,
  fingerprintMissingTransactionIds,
  normalizeMissingTransactionIds,
  getOrphanAlertState,
  recordAuditRun,
  recordOrphanAlert,
  recordOrphanRecovery,
  isDuplicateOrphanAlert,
  needsRecoveryNotice,
};
