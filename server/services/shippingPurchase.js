/**
 * Platform postage purchasing.
 *
 * Keeps the money routes thin: they authorize/capture/refund, while this
 * module turns order plans into EasyPost labels. If any label in a batch
 * fails, every label already bought is refunded before the error is rethrown
 * so the caller can release or refund the buyer's payment.
 */
const { createShippingLabel, refundShippingLabel } = require('./easypostService');

const normalizeBuyerAddress = (address, fallbackName) => ({
  ...(address || {}),
  fullName: address?.fullName || fallbackName,
});

const sellerParcelAddress = (seller, fallbackCountry) => (
  seller?.shippingAddress
    ? {
      fullName: seller.shippingAddress.fullName || seller.name,
      street1: seller.shippingAddress.street1,
      street2: seller.shippingAddress.street2,
      city: seller.shippingAddress.city,
      state: seller.shippingAddress.state,
      postalCode: seller.shippingAddress.postalCode,
      country: seller.shippingAddress.country || fallbackCountry,
    }
    : { fullName: seller?.name, country: fallbackCountry }
);

const refundPurchasedLabels = async (labels = []) => {
  for (const label of labels) {
    let lastError;
    // Two immediate attempts cover a transient provider/network failure. The
    // caller also retries the attached list, because unrecovered postage is a
    // direct platform loss.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const result = await refundShippingLabel(label.shipmentId);
        lastError = result?.refunded === false ? new Error(result.status || 'refund rejected') : null;
        if (!lastError) break;
      } catch (refundError) {
        lastError = refundError;
      }
    }
    if (lastError) console.error('Label refund rollback failed:', lastError.message);
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
      await refundPurchasedLabels(purchased);
      throw labelError;
    }
  }
  return purchased;
};

const refundLabelWithRetry = async (shipmentId, attempts = 2) => {
  if (!shipmentId) return false;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const result = await refundShippingLabel(shipmentId);
      if (result?.refunded !== false) return true;
    } catch (e) {
      console.error('Shipping label refund failed:', e.message);
    }
  }
  return false;
};

/**
 * Compensate every label a failed batch/label purchase left behind, including
 * the unusable shipment that threw before it could be added to `purchased`.
 */
const compensateFailedLabels = async (labelError) => {
  for (const label of labelError?.purchasedLabels || []) {
    await refundLabelWithRetry(label.shipmentId);
  }
  if (labelError?.shipmentId && !labelError.labelRefunded) {
    await refundLabelWithRetry(labelError.shipmentId);
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

const purchaseSingleLabel = ({
  sellerAddress,
  buyerAddress,
  buyerName,
  weightKg,
  reference,
  declaredValue,
}) => createShippingLabel({
  fromAddress: sellerAddress,
  toAddress: normalizeBuyerAddress(buyerAddress, buyerName),
  weightKg,
  reference,
  declaredValue,
});

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
