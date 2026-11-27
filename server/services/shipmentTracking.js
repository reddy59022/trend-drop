/**
 * Canonical outbound shipment state transitions.
 *
 * Shared by the carrier webhook and the sandbox-only state driver. Keeping the
 * transition rules here prevents test tooling from inventing states the
 * production lifecycle does not understand.
 */
const { trackingStatuses } = require('../config/shipping');

const STATUS_BY_CODE = new Map(trackingStatuses.map((status) => [status.code, status]));
const ORDERED_STATUSES = trackingStatuses
  .filter((status) => status.sortOrder >= 0)
  .sort((a, b) => a.sortOrder - b.sortOrder);

const canonicalLifecycleState = (status) => {
  if (status === 'picked_up') return 'shipped';
  if (status === 'in_transit_local') return 'in_transit';
  return status;
};

// Once one of these is reached, an outbound carrier event must not move the
// order backwards. `buyer_confirmed`/`completed` are post-delivery states and
// are deliberately included: a late replay of a delivery scan must not undo a
// receipt confirmation.
const TERMINAL_LIFECYCLE_STATES = new Set([
  'delivered', 'buyer_confirmed', 'completed', 'returned', 'refunded',
  'cancelled', 'cancelled_by_buyer', 'cancelled_by_seller', 'auto_cancelled',
  'return_requested', 'return_accepted', 'return_rejected', 'return_in_transit',
  'return_delivered', 'disputed', 'dispute_resolved',
  'chargeback_open', 'chargeback_won', 'chargeback_lost',
]);

const eventTimeFor = (timestamp) => {
  if (!timestamp) return new Date();
  const parsed = new Date(timestamp);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
};

const applyOutboundTrackingEvent = async (transaction, {
  status,
  trackingNumber,
  timestamp,
  location,
  description,
} = {}) => {
  if (!transaction) {
    const error = new Error('Transaction is required');
    error.statusCode = 400;
    throw error;
  }
  const meta = STATUS_BY_CODE.get(status);
  if (!meta) {
    const error = new Error(`Invalid tracking status: ${status}`);
    error.statusCode = 400;
    throw error;
  }

  const eventTime = eventTimeFor(timestamp);
  const currentTracking = transaction.status === 'shipped' ? 'picked_up' : transaction.status;
  const currentIndex = ORDERED_STATUSES.findIndex((item) => item.code === currentTracking);
  const eventIndex = ORDERED_STATUSES.findIndex((item) => item.code === status);
  const terminal = ['returned', 'delivered'].includes(status);
  const alreadyTerminal = TERMINAL_LIFECYCLE_STATES.has(transaction.status);

  const advances = status !== 'exception'
    && status !== 'label_created'
    && !alreadyTerminal
    && (
      terminal
        ? status === 'returned' || transaction.status !== 'delivered'
        : (currentIndex === -1 || eventIndex > currentIndex)
    );
  // Keep the audit trail for real progress, exceptions and the initial label
  // event. A stale out-of-order scan after a terminal state is acknowledged
  // but not appended, so the visible timeline cannot run backwards.
  const recordEvent = advances || status === 'exception' || status === 'label_created';

  transaction.shipping = transaction.shipping || {};
  transaction.shipping.trackingHistory = transaction.shipping.trackingHistory || [];
  const duplicate = recordEvent && transaction.shipping.trackingHistory.some((entry) => (
    entry.status === status
    && new Date(entry.timestamp).getTime() === eventTime.getTime()
  ));
  if (recordEvent && !duplicate) {
    transaction.shipping.trackingHistory.push({
      status,
      label: meta.label,
      description: description || meta.description || '',
      timestamp: eventTime,
      location: location || null,
    });
    transaction.shipping.trackingHistory = transaction.shipping.trackingHistory.slice(-50);
  }

  if (advances) {
    transaction.status = canonicalLifecycleState(status);
    if (status === 'delivered') {
      transaction.shipping.actualDelivery = eventTime;
    }
  }
  const previousTrackingNumber = transaction.shipping.trackingNumber;
  if (trackingNumber) transaction.shipping.trackingNumber = trackingNumber;

  if (recordEvent || (trackingNumber && trackingNumber !== previousTrackingNumber)) {
    await transaction.save();
  }
  return {
    advanced: advances,
    status,
    lifecycleStatus: transaction.status,
    transactionId: String(transaction._id),
  };
};

module.exports = {
  applyOutboundTrackingEvent,
  canonicalLifecycleState,
  ORDERED_STATUSES,
  TERMINAL_LIFECYCLE_STATES,
};
