/**
 * Postage funding rules.
 *
 * TrendDrop buys every label with its own EasyPost account, so a label is a
 * platform cost. The buyer's shipping charge is the first funding source. If
 * the carrier rate is higher than that charge (free shipping, a free-shipping
 * threshold, or an under-estimated rate), the seller whose item is shipping
 * funds the uncovered postage out of the sale earnings for that item.
 *
 * A checkout is refused when buyer postage + seller earnings cannot cover the
 * label. That is deliberate: the platform must never buy postage it cannot
 * recover, and the buyer must never be charged for an order that cannot be
 * fulfilled profitably.
 */
class PostageFundingError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'PostageFundingError';
    this.code = 'SHIPPING_BUDGET_INSUFFICIENT';
    this.status = 422;
    this.retryable = false;
    Object.assign(this, details);
  }
}

const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;

const allocatePostage = ({ labelCost, buyerShipping, sellerEarnings } = {}) => {
  const cost = Math.max(0, round2(labelCost));
  const charged = Math.max(0, round2(buyerShipping));
  const availableEarnings = Math.max(0, round2(sellerEarnings));
  const uncovered = Math.max(0, round2(cost - charged));
  const sellerSubsidy = round2(Math.min(uncovered, availableEarnings));
  return {
    labelCost: cost,
    buyerShipping: charged,
    sellerSubsidy,
    sellerEarningsAfterPostage: round2(availableEarnings - sellerSubsidy),
    // What the platform keeps after paying the carrier, before Stripe fees.
    platformPostageMargin: round2(charged + sellerSubsidy - cost),
    shortfall: round2(uncovered - sellerSubsidy),
  };
};

const postageFundingFailure = (error = {}) => ({
  status: error.status || 502,
  code: error.code || 'SHIPPING_BUDGET_INSUFFICIENT',
  message: 'Shipping for this order could not be funded. Your payment was not captured.',
  retryable: false,
});

const requirePostageFunded = (input = {}) => {
  const funding = allocatePostage(input);
  if (funding.shortfall > 0) {
    throw new PostageFundingError(
      'The carrier rate for this shipment cannot be funded by the order. No payment was captured.',
      funding,
    );
  }
  return funding;
};

module.exports = {
  PostageFundingError,
  allocatePostage,
  requirePostageFunded,
  postageFundingFailure,
  round2,
};
