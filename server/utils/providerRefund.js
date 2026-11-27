/**
 * Provider (Stripe) refund reconciliation for returns.
 *
 * Both return settlement paths — the hourly carrier-delivery cron and the
 * seller's "confirm received" route — issue a Stripe refund. Recording that a
 * return was "provider refunded" without looking at Stripe's answer closed
 * orders whose refund Stripe rejected: inventory was restocked, the seller's
 * earnings were clawed back, and the buyer never got their money.
 *
 * Stripe refund statuses:
 *   succeeded → the refund is complete;
 *   pending   → accepted by Stripe and in flight (async payment methods); the
 *               same idempotency key returns the same refund, so retrying
 *               cannot advance it and it is safe to settle locally;
 *   failed / canceled → NOT refunded. The caller must leave the return
 *               retryable and keep the ledger untouched.
 */

const SETTLED_PROVIDER_REFUND_STATUSES = ['succeeded', 'pending'];

function applyProviderRefundResult(returnRequest, refund, paymentIntentId) {
  if (!refund || !refund.id) {
    throw new Error(`Refund for ${paymentIntentId} returned no provider reference`);
  }
  const status = String(refund.status || '').toLowerCase();
  if (!SETTLED_PROVIDER_REFUND_STATUSES.includes(status)) {
    throw new Error(`Refund ${refund.id} was not accepted by the provider (status: ${status || 'unknown'})`);
  }
  returnRequest.providerRefunded = true;
  returnRequest.providerRefundId = refund.id;
  returnRequest.providerRefundStatus = status;
  const refundedCents = Number(refund.amount);
  returnRequest.providerRefundAmount = Number.isFinite(refundedCents) ? refundedCents : null;
  returnRequest.providerRefundedAt = new Date();
  return returnRequest;
}

/** Settlement that needed no refund call (no captured money, nothing owed). */
function recordProviderSettlement(returnRequest, status, at = new Date()) {
  returnRequest.providerRefunded = true;
  returnRequest.providerRefundStatus = status;
  returnRequest.providerRefundedAt = at;
  return returnRequest;
}

module.exports = {
  SETTLED_PROVIDER_REFUND_STATUSES,
  applyProviderRefundResult,
  recordProviderSettlement,
};
