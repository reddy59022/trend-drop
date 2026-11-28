/**
 * Outbound tracking reconciliation.
 *
 * The carrier webhook is the fast path, but it is best-effort: a missed,
 * rejected or undelivered webhook would otherwise leave an order stuck in
 * `shipped`/`in_transit` forever. This service re-reads every active label's
 * tracker from EasyPost and applies the same forward-only transition rules as
 * the webhook.
 *
 * Accuracy rules:
 *   - only `shipped`, `in_transit`, `out_for_delivery` are eligible: delivered
 *     and post-delivery states are never touched;
 *   - the mapped carrier status must be a real tracker status (pre_transit and
 *     unknown are ignored so a poll can never regress an order);
 *   - the event timestamp/location/description come from the carrier scan that
 *     matches the new status, not from "now";
 *   - `applyOutboundTrackingEvent` owns the state machine: forward-only,
 *     terminal-state safe, duplicate-scan safe;
 *   - one failing tracker never aborts the batch.
 */
const Transaction = require('../models/Transaction');
const { simulateTrackingUpdate } = require('../config/shipping');
const { getTracker, mapTrackerStatus, isMockMode } = require('./easypostService');
const { applyOutboundTrackingEvent } = require('./shipmentTracking');

const ELIGIBLE_STATUSES = ['shipped', 'in_transit', 'out_for_delivery'];
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_LIMIT = 5000;
const DEFAULT_CONCURRENCY = 8;

/** Latest carrier scan that belongs to the mapped status (falls back to last). */
const carrierScanFor = (tracker, mappedStatus) => {
  const details = Array.isArray(tracker?.tracking_details) ? tracker.tracking_details : [];
  for (let i = details.length - 1; i >= 0; i -= 1) {
    const detail = details[i];
    if (!detail) continue;
    if (!mappedStatus || mapTrackerStatus(detail.status) === mappedStatus) return detail;
  }
  return details[details.length - 1] || null;
};

const scanFields = (detail) => ({
  timestamp: detail?.datetime ? new Date(detail.datetime) : undefined,
  description: detail?.message || '',
  location: [detail?.tracking_location?.city, detail?.tracking_location?.state]
    .filter(Boolean).join(', ') || null,
});

async function reconcileOne(transaction, now) {
  const trackerId = transaction.shipping?.trackerId;
  if (!trackerId) return { outcome: 'skipped', reason: 'no_tracker' };

  let nextStatus = null;
  let fields = {};
  if (isMockMode()) {
    // Development/demo only: production requires a carrier-confirmed tracker.
    const labelDate = transaction.shipping?.labelCreatedDate || transaction.createdAt;
    const daysSince = Math.floor((now.getTime() - new Date(labelDate).getTime()) / DAY_MS);
    const current = transaction.status === 'shipped' ? 'picked_up' : transaction.status;
    nextStatus = simulateTrackingUpdate(current, daysSince);
    fields = { timestamp: now, description: 'Auto-updated', location: 'Auto-updated' };
  } else {
    const tracker = await getTracker(trackerId);
    nextStatus = mapTrackerStatus(tracker?.status);
    if (!nextStatus) return { outcome: 'unchanged', reason: 'no_mapped_status' };
    fields = scanFields(carrierScanFor(tracker, nextStatus));
  }

  if (!nextStatus) return { outcome: 'unchanged', reason: 'no_next_status' };

  const result = await applyOutboundTrackingEvent(transaction, {
    status: nextStatus,
    trackingNumber: transaction.shipping?.trackingNumber,
    timestamp: fields.timestamp,
    description: fields.description,
    location: fields.location,
  });

  return { outcome: result.advanced ? 'updated' : 'unchanged', status: result.lifecycleStatus };
}

async function recordPoll(transactionId, now) {
  // Telemetry only. The transition service owns shipment state and saves it
  // separately, so a telemetry failure cannot undo a carrier-confirmed update.
  await Transaction.updateOne(
    { _id: transactionId },
    {
      $set: { 'autoTracking.lastChecked': now, 'autoTracking.nextCheck': new Date(now.getTime() + DAY_MS) },
      $inc: { 'autoTracking.attempts': 1 },
    },
  );
}

/**
 * Reconcile every active outbound shipment. Safe to run repeatedly and from
 * overlapping instances: transitions are idempotent and forward-only.
 */
async function syncOutboundTracking({ now = new Date(), limit = DEFAULT_LIMIT, concurrency = DEFAULT_CONCURRENCY } = {}) {
  const transactions = await Transaction.find({
    status: { $in: ELIGIBLE_STATUSES },
    'shipping.trackerId': { $exists: true, $nin: ['', null] },
  })
    // Never-checked / longest-unchecked first, so a large backlog drains in
    // order instead of starving the same tail every run.
    .sort({ 'autoTracking.lastChecked': 1, createdAt: 1 })
    .limit(limit);

  const summary = {
    scanned: transactions.length,
    updated: 0,
    unchanged: 0,
    skipped: 0,
    failed: 0,
  };
  const errors = [];

  let cursor = 0;
  const worker = async () => {
    while (cursor < transactions.length) {
      const index = cursor;
      cursor += 1;
      const transaction = transactions[index];
      try {
        const result = await reconcileOne(transaction, now);
        summary[result.outcome] += 1;
      } catch (error) {
        summary.failed += 1;
        if (errors.length < 10) {
          errors.push({ transactionId: String(transaction._id), code: error.code || null, message: error.message });
        }
        console.error(
          `[TRACKING SYNC] ${transaction._id} (${transaction.shipping?.trackerId || 'no tracker'}) failed:`,
          error.code || error.message,
        );
      }
      try {
        await recordPoll(transaction._id, now);
      } catch (telemetryError) {
        console.error(`[TRACKING SYNC] telemetry failed for ${transaction._id}:`, telemetryError.message);
      }
    }
  };

  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, transactions.length || 1)) }, worker);
  await Promise.all(workers);

  if (errors.length) summary.errors = errors;
  return summary;
}

module.exports = { syncOutboundTracking, ELIGIBLE_STATUSES };
