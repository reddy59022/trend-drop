const mongoose = require('mongoose');

const notificationAuditStateSchema = new mongoose.Schema({
  key: {
    type: String,
    required: true,
    unique: true,
  },
  fingerprint: {
    type: String,
    default: null,
  },
  orphanCount: {
    type: Number,
    default: 0,
  },
  missingTransactionIds: {
    type: [String],
    default: [],
  },
  recipientKey: {
    type: String,
    default: null,
  },
  lastAlertedAt: {
    type: Date,
    default: null,
  },
  lastRecoveredAt: {
    type: Date,
    default: null,
  },
  lastRunAt: {
    type: Date,
    default: null,
  },
  // A claim is a short-lived lease around delivery. It prevents two overlapping
  // cron instances from both sending the same alert while still allowing a
  // crashed worker's attempt to be retried after the lease expires.
  claimToken: {
    type: String,
    default: null,
  },
  claimUntil: {
    type: Date,
    default: null,
  },
  pendingFingerprint: {
    type: String,
    default: null,
  },
  pendingOrphanCount: {
    type: Number,
    default: 0,
  },
  pendingMissingTransactionIds: {
    type: [String],
    default: [],
  },
  failureFingerprint: {
    type: String,
    default: null,
  },
  failureCount: {
    type: Number,
    default: 0,
  },
  lastFailureAt: {
    type: Date,
    default: null,
  },
  lastFailureAlertedAt: {
    type: Date,
    default: null,
  },
  lastFailureMessage: {
    type: String,
    default: null,
  },
}, { timestamps: true });

module.exports = mongoose.model('NotificationAuditState', notificationAuditStateSchema);
