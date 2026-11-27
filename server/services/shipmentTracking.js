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
  const alreadyTerminal = ['returned', 'delivered', 'cancelled', 'refunded', 'chargeback_lost']
    .includes(transaction.status);

  const advances = status !== 'exception'
    && status !== 'label_created'
    && !alreadyTerminal
    && (
      terminal
        ? status === 'returned' || transaction.status !== 'delivered'
        : (currentIndex === -1 || eventIndex >= currentIndex)
    );

  transaction.shipping = transaction.shipping || {};
  transaction.shipping.trackingHistory = transaction.shipping.trackingHistory || [];
  const duplicate = transaction.shipping.trackingHistory.some((entry) => (
    entry.status === status
    && new Date(entry.timestamp).getTime() === eventTime.getTime()
  ));
  if (!duplicate) {
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
  if (trackingNumber) transaction.shipping.trackingNumber = trackingNumber;

  await transaction.save();
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
};
