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
    try {
      await refundShippingLabel(label.shipmentId);
    } catch (refundError) {
      // Best-effort compensation; the original failure must still propagate.
      console.error('Label refund rollback failed:', refundError.message);
    }
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
        declaredValue: plan.itemSubtotal,
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
  normalizeBuyerAddress,
  sellerParcelAddress,
  purchaseBatchLabels,
  purchaseSingleLabel,
  refundPurchasedLabels,
};
