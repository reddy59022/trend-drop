/**
 * Platform postage purchasing.
 *
 * Keeps the money routes thin: they authorize/capture/refund, while this
 * module turns order plans into EasyPost labels. If any label in a batch
 * fails, every label already bought is refunded before the error is rethrown
 * so the caller can release or refund the buyer's payment.
 */
const { createShippingLabel, refundShippingLabel } = require('./easypostService');
const { refundLabelOrQueue } = require('./labelRefunds');

const normalizeBuyerAddress = (address, fallbackName) => ({
  ...(address || {}),
  fullName: address?.fullName || fallbackName,
});

const sellerParcelAddress = (seller, fallbackCountry) => (
  seller?.shippingAddress
    ? {
      fullName: seller.shippingAddress.fullName || seller.name,
      street1: seller.shippingAddress.street1 || seller.shippingAddress.street,
      street2: seller.shippingAddress.street2,
      city: seller.shippingAddress.city,
      state: seller.shippingAddress.state,
      postalCode: seller.shippingAddress.postalCode || seller.shippingAddress.zip,
      country: seller.shippingAddress.country || fallbackCountry,
    }
    : { fullName: seller?.name, country: fallbackCountry }
);

const refundPurchasedLabels = async (labels = [], reason = 'purchase_failed') => {
  // Refunds are attempted twice, then durably queued for the retry cron — an
  // unrecovered postage purchase is a direct platform loss and must never be
  // left to a log line alone (no Transaction row exists yet to carry the flag).
  for (const label of labels) {
    await refundLabelOrQueue(label.shipmentId, { reason });
  }
};

const purchaseBatchLabels = async ({ plans, buyerAddress, buyerName, paymentIntentId }) => {
  const purchased = [];
  const toAddress = normalizeBuyerAddress(buyerAddress, buyerName);
  for (const plan of plans) {
    try {
      const label = await createShippingLabel({
        fromAddress: plan.sellerAddress,
        toAddress,
        weightKg: plan.combinedWeight,
        reference: `batch:${paymentIntentId}:${plan.listing._id}`,
        // Insure what the buyer actually paid, not the pre-discount subtotal.
        declaredValue: Math.max(0, (plan.itemSubtotal || 0) - (plan.discountAmount || 0)),
      });
      plan.label = label;
      purchased.push(label);
    } catch (labelError) {
      labelError.purchasedLabels = purchased;
      await refundPurchasedLabels(purchased, 'batch_label_failed');
      throw labelError;
    }
  }
  // INVARIANT: an order may never be created from a label the carrier did not
  // actually issue. A provider response missing the shipment id or tracking
  // number is unusable, so refund every purchased label before failing.
  for (const plan of plans) {
    const label = plan.label;
    if (!label?.shipmentId || !label?.trackingNumber) {
      await refundPurchasedLabels(purchased, 'incomplete_label');
      const error = new Error('EasyPost did not return a usable shipping label; no order was created.');
      error.code = 'SHIPPING_LABEL_INCOMPLETE';
      error.status = 502;
      error.retryable = false;
      throw error;
    }
  }
  return purchased;
};

const refundLabelWithRetry = async (shipmentId, attempts = 2, meta = {}) => (
  refundLabelOrQueue(shipmentId, { ...meta, attempts })
);

/**
 * Compensate every label a failed batch/label purchase left behind, including
 * the unusable shipment that threw before it could be added to `purchased`.
 */
const compensateFailedLabels = async (labelError) => {
  for (const label of labelError?.purchasedLabels || []) {
    await refundLabelWithRetry(label.shipmentId, 2, { reason: 'purchase_failed' });
  }
  if (labelError?.shipmentId && !labelError.labelRefunded) {
    await refundLabelWithRetry(labelError.shipmentId, 2, { reason: 'purchase_failed' });
  }
};

/**
 * Refund a label attached to a transaction that has just been closed (for
 * example a sold-out race) and persist the outcome/pending flag on the row.
 */
const refundClosedTransactionLabel = async (transaction) => {
  if (!transaction?.shipping?.shipmentId) return;
  try {
    const labelRefund = await refundShippingLabel(transaction.shipping.shipmentId);
    transaction.shipping = {
      ...transaction.shipping,
      voided: true,
      voidedAt: new Date(),
      labelRefunded: Boolean(labelRefund.refunded),
      labelRefundPending: !labelRefund.refunded,
      labelRefundStatus: labelRefund.status || '',
      labelRefundRequestedAt: new Date(),
    };
  } catch (labelRefundError) {
    transaction.shipping = {
      ...transaction.shipping,
      labelRefundPending: true,
      labelRefundStatus: 'request_failed',
      labelRefundRequestedAt: new Date(),
    };
    console.error('Sold-out label refund failed:', labelRefundError.message);
  }
};

const TERMINAL_STATUSES = new Set([
  'cancelled', 'cancelled_by_buyer', 'cancelled_by_seller', 'auto_cancelled',
  'refunded', 'returned', 'chargeback_lost',
]);

/**
 * Request a carrier refund for a cancelled transaction's unused label and
 * persist the outcome. If EasyPost is unavailable the label stays marked
 * pending; retryPendingLabelRefunds() (cron) must eventually settle it so the
 * platform does not absorb postage it could have recovered.
 */
const refundTransactionLabel = async (transaction, { markVoided = true } = {}) => {
  const shipping = transaction?.shipping;
  if (!shipping?.shipmentId) {
    // Legacy rows recorded a tracking number but no provider shipment id.
    // The order is still closed, so its label must not remain printable.
    if (shipping?.trackingNumber && markVoided) {
      transaction.shipping = {
        ...shipping,
        voided: true,
        voidedAt: shipping.voidedAt || new Date(),
        labelCreated: false,
      };
      return { requested: false, voided: true, reason: 'no_shipment' };
    }
    return { requested: false, reason: 'no_label' };
  }
  if (shipping.labelRefunded) return { requested: false, refunded: true, status: 'already_refunded' };
  try {
    const result = await refundShippingLabel(shipping.shipmentId);
    transaction.shipping = {
      ...shipping,
      ...(markVoided ? { voided: true, voidedAt: shipping.voidedAt || new Date(), voidedBy: shipping.voidedBy || null } : {}),
      labelRefunded: Boolean(result.refunded),
      labelRefundPending: false,
      labelRefundStatus: result.status || 'submitted',
      labelRefundRequestedAt: new Date(),
    };
    return { requested: true, ...result };
  } catch (error) {
    transaction.shipping = {
      ...shipping,
      labelRefundPending: true,
      labelRefundStatus: 'request_failed',
      labelRefundRequestedAt: new Date(),
    };
    console.error('Label refund request failed:', error.code || error.message);
    return { requested: true, refunded: false, status: 'request_failed', error };
  }
};

const purchaseSingleLabel = async ({
  sellerAddress,
  buyerAddress,
  buyerName,
  weightKg,
  reference,
  declaredValue,
}) => {
  const label = await createShippingLabel({
    fromAddress: sellerAddress,
    toAddress: normalizeBuyerAddress(buyerAddress, buyerName),
    weightKg,
    reference,
    declaredValue,
  });
  // Same invariant as the batch path: no Transaction/order from a usable-looking
  // response that has no shipment id or tracking number.
  if (!label?.shipmentId || !label?.trackingNumber) {
    await refundLabelOrQueue(label?.shipmentId, { reason: 'incomplete_single_label' });
    const error = new Error('EasyPost did not return a usable shipping label; no order was created.');
    error.code = 'SHIPPING_LABEL_INCOMPLETE';
    error.status = 502;
    error.retryable = false;
    throw error;
  }
  return label;
};

module.exports = {
  TERMINAL_STATUSES,
  normalizeBuyerAddress,
  sellerParcelAddress,
  purchaseBatchLabels,
  purchaseSingleLabel,
  refundPurchasedLabels,
  refundTransactionLabel,
  refundLabelWithRetry,
  compensateFailedLabels,
  refundClosedTransactionLabel,
};
