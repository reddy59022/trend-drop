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
}, { timestamps: true });

module.exports = mongoose.model('NotificationAuditState', notificationAuditStateSchema);
