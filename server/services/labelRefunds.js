/**
 * Postage refund durability.
 *
 * `refundLabelOrQueue` makes two immediate attempts (transient provider/network
 * blips) and, when both fail, persists the shipment id in `LabelRefund`. Cron
 * drains that queue with exponential backoff until EasyPost refunds the label
 * or definitively rejects it (e.g. the label was already scanned).
 *
 * This closes the orphan-postage hole: labels bought before a Transaction row
 * exists have no ledger row to carry `labelRefundPending`, so an in-memory
 * retry that failed used to lose the platform's money silently.
 */
const LabelRefund = require('../models/LabelRefund');
const Transaction = require('../models/Transaction');
const { refundShippingLabel } = require('./easypostService');

const errorText = (error) => String(error?.code || error?.message || error || '').slice(0, 500);

const enqueueLabelRefund = async ({
  shipmentId,
  transactionId = null,
  reason = '',
  error = null,
} = {}) => {
  if (!shipmentId) return null;
  try {
    return await LabelRefund.findOneAndUpdate(
      { shipmentId },
      {
        $setOnInsert: {
          shipmentId,
          transaction: transactionId || null,
          reason,
          status: 'pending',
          nextAttemptAt: new Date(),
        },
        $set: { lastError: errorText(error) },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  } catch (queueError) {
    // Concurrent compensation for the same shipment hits the unique index.
    // The other writer already queued it, so return that row instead of
    // masking the original refund failure with an E11000.
    if (queueError?.code === 11000) return LabelRefund.findOne({ shipmentId });
    throw queueError;
  }
};

/**
 * Refund a purchased label now, or durably queue it for the retry cron.
 * Returns true only when the provider accepted/confirmed the refund.
 */
const refundLabelOrQueue = async (shipmentId, {
  transactionId = null,
  reason = '',
  attempts = 2,
} = {}) => {
  if (!shipmentId) return false;
  let lastError = null;
  for (let attempt = 0; attempt < Math.max(1, attempts); attempt += 1) {
    try {
      const result = await refundShippingLabel(shipmentId);
      if (result?.refunded !== false) {
        await LabelRefund.updateOne(
          { shipmentId },
          { $set: { status: 'refunded', refundedAt: new Date(), lastError: '' } },
        );
        return true;
      }
      lastError = new Error(result?.status || 'refund rejected');
    } catch (error) {
      lastError = error;
    }
  }
  await enqueueLabelRefund({ shipmentId, transactionId, reason, error: lastError });
  return false;
};

/**
 * Drain queued refunds. A provider error leaves the task pending with backoff;
 * a definitive rejection stops retrying because the carrier has consumed the
 * label. Returns counters for the cron log.
 */
const retryQueuedLabelRefunds = async (limit = 50) => {
  const tasks = await LabelRefund.find({
    status: 'pending',
    nextAttemptAt: { $lte: new Date() },
  }).sort({ nextAttemptAt: 1 }).limit(limit);

  const summary = { checked: tasks.length, recovered: 0, failed: 0, rejected: 0 };
  for (const task of tasks) {
    task.attempts += 1;
    task.lastAttemptAt = new Date();
    try {
      const result = await refundShippingLabel(task.shipmentId);
      if (result?.refunded !== false) {
        task.status = 'refunded';
        task.refundedAt = new Date();
        task.lastError = '';
        summary.recovered += 1;
      } else {
        task.status = 'rejected';
        task.lastError = String(result?.status || 'refund rejected');
        summary.rejected += 1;
      }
    } catch (error) {
      summary.failed += 1;
      task.lastError = errorText(error);
      const backoffHours = Math.min(24, 2 ** Math.min(task.attempts, 4));
      task.nextAttemptAt = new Date(Date.now() + backoffHours * 60 * 60 * 1000);
    }
    await task.save();

    if (task.transaction) {
      // Keep the ledger row's operator-visible flags in sync when the label
      // belongs to a transaction. Best effort: the queue row is authoritative.
      try {
        await Transaction.updateOne(
          { _id: task.transaction },
          {
            $set: {
              'shipping.labelRefunded': task.status === 'refunded',
              'shipping.labelRefundPending': task.status === 'pending',
              'shipping.labelRefundStatus': task.status === 'rejected'
                ? `rejected:${task.lastError}`
                : task.status,
            },
          },
        );
      } catch (syncError) {
        console.error('Label refund ledger sync failed:', syncError.message);
      }
    }
  }
  return summary;
};

module.exports = {
  enqueueLabelRefund,
  refundLabelOrQueue,
  retryQueuedLabelRefunds,
};
