/**
 * Durable queue for platform postage refunds.
 *
 * A label can be purchased before any Transaction row exists (batch label 2
 * fails, funding gate aborts, capture fails). If the immediate EasyPost refund
 * also fails there is nowhere on the ledger to record it, so the platform
 * would silently absorb the postage. This collection is that record: every
 * unresolved refund is retried by cron until it is refunded or the carrier
 * definitively rejects it.
 */
const mongoose = require('mongoose');

const labelRefundSchema = new mongoose.Schema(
  {
    shipmentId: { type: String, required: true, unique: true, index: true },
    transaction: { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction', default: null },
    reason: { type: String, default: '' },
    status: {
      type: String,
      enum: ['pending', 'refunded', 'rejected'],
      default: 'pending',
      index: true,
    },
    attempts: { type: Number, default: 0 },
    lastError: { type: String, default: '' },
    lastAttemptAt: { type: Date, default: null },
    refundedAt: { type: Date, default: null },
    nextAttemptAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true },
);

labelRefundSchema.index({ status: 1, nextAttemptAt: 1 });

module.exports = mongoose.model('LabelRefund', labelRefundSchema);
