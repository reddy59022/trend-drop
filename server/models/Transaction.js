const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  // Fraud detection flag
  fraudFlag: {
    flagged: { type: Boolean, default: false },
    reason: { type: String, default: '' },
    notes: { type: String, default: '' },
    flaggedAt: { type: Date, default: null },
    flaggedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  listing: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Listing',
    required: true,
  },
  // Optional link for auction-created transactions. Without this field
  // Mongoose strict mode silently discarded the auction id during close,
  // making winner orders impossible to reconcile back to their auction.
  auction: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Auction',
    default: null,
  },
  buyer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  seller: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  // Pricing
  quantity: {
    type: Number,
    default: 1,
    min: 1,
  },
  itemPrice: {
    type: Number,
    required: true,
  },
  currency: {
    type: String,
    default: 'USD',
  },
  // Promo code that priced this order (audit + single-use enforcement).
  // Without it the platform could not tell whether a promo had already been
  // consumed by an order, which is what let one checkout burn two uses.
  promoId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Promo',
    default: null,
  },
  // Full payment breakdown - transparent for both buyer and seller
  paymentBreakdown: {
    // What the buyer pays
    subtotal: { type: Number, required: true },
    // Original item subtotal before seller-funded promo/bundle discounts.
    // `subtotal` is the amount actually charged for the item line; keeping
    // both values lets orders, refunds, payouts, and dashboards reconcile.
    originalSubtotal: { type: Number, default: 0 },
    discountAmount: { type: Number, default: 0, min: 0 },
    shippingCost: { type: Number, default: 0 },
    buyerProtectionFee: { type: Number, default: 0 },
    buyerProtectionPercent: { type: Number, default: 5 },
    tax: { type: Number, default: 0 },
    totalPaid: { type: Number, required: true },

    // What the seller receives
    platformFee: { type: Number, default: 0 },
    platformFeePercent: { type: Number, default: 8 },
    shippingPayout: { type: Number, default: 0 },
    sellerEarnings: { type: Number, required: true },
    // Boost fees - BUG 9: Added missing fields that transactions.js sets
    boostFee: { type: Number, default: 0 },
    boostTier: { type: String, default: '' },
    // Stripe idempotency: which payment intent funded this transaction.
    // Required for confirm-batch dedupe (same PI retried after 3DS/app
    // background must return already-processed instead of double-charging).
    paymentIntentId: { type: String, default: '' },
  },
  status: {
    type: String,
    enum: [
      'pending', 'paid', 'processing',
      'shipped', 'in_transit', 'out_for_delivery', 'delivered',
      'completed',
      'cancelled', 'cancelled_by_buyer', 'cancelled_by_seller', 'auto_cancelled',
      'refunded', 'disputed', 'dispute_resolved',
      'returned', 'buyer_confirmed',
      'return_requested', 'return_accepted', 'return_rejected',
      'return_in_transit', 'return_delivered',
      'chargeback_open', 'chargeback_won', 'chargeback_lost',
    ],
    default: 'pending',
  },
  // Shipping details
  shipping: {
    carrier: { type: String, default: '' },
    trackingNumber: { type: String, default: '' },
    trackingUrl: { type: String, default: '' },
    labelCreated: { type: Boolean, default: false },
    labelCreatedDate: { type: Date },
    estimatedDelivery: { type: Date },
    actualDelivery: { type: Date },
    weight: { type: Number, default: 0.5 },
    service: { type: String, default: '' },
    // Label lifecycle is separate from order lifecycle. A mock/real label can
    // be voided without cancelling the sale or restoring inventory.
    voided: { type: Boolean, default: false },
    voidedAt: { type: Date },
    voidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    // Full tracking history
    trackingHistory: [{
      status: String,
      label: String,
      description: String,
      timestamp: { type: Date, default: Date.now },
      location: String,
    }],
  },
  shippingAddress: {
    fullName: String,
    street1: String,
    street2: String,
    city: String,
    state: String,
    postalCode: String,
    country: String,
    phone: String,
  },
  sellerAddress: {
    street1: String,
    street2: String,
    city: String,
    state: String,
    postalCode: String,
    country: String,
  },
  // Stripe payment intent ID for webhook reconciliation
  stripePaymentIntentId: {
    type: String,
    default: '',
  },
  // Payout tracking
  payout: {
    status: { type: String, enum: ['pending', 'processing', 'completed', 'failed', 'refunded'], default: 'pending' },
    method: { type: String, default: '' },
    processedAt: { type: Date },
    transactionId: { type: String, default: '' },
  },
  // Offer negotiation linking
  offer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Offer',
    default: null,
  },
  negotiatedPrice: {
    type: Number,
    default: null,
  },
  isNegotiated: {
    type: Boolean,
    default: false,
  },
  // Auto-tracking
  autoTracking: {
    enabled: { type: Boolean, default: true },
    lastChecked: { type: Date },
    nextCheck: { type: Date },
    attempts: { type: Number, default: 0 },
  },
  // Buyer confirmation
  buyerConfirmed: {
    received: { type: Boolean, default: false },
    confirmedAt: { type: Date },
  },
  // Return details
  returnDetails: {
    returnId: { type: mongoose.Schema.Types.ObjectId, ref: 'Return', default: null },
    requestedAt: Date,
    deadline: Date,
    acceptedAt: Date,
    approvedAt: Date,
    returnShipDeadline: Date,
    shippedAt: Date,
    buyerShippedAt: Date,
    deliveredAt: Date,
    receivedAt: Date,
    reason: String,
    description: String,
    condition: String,
    buyerPackingProof: [String],
    sellerInspectionProof: [String],
    inspectionNotes: String,
    trackingNumber: String,
    autoRefunded: { type: Boolean, default: false },
    autoRefundedAt: Date,
    refundAmount: Number,
    autoRefundReason: String,
    // Seller-side audit trail. These were written by the cron and the
    // reject-return route long before they were declared here — strict mode
    // silently discarded them, so the "was this automatic?" evidence did not
    // actually exist on the document.
    rejectionReason: String,
    autoRejected: { type: Boolean, default: false },
    autoRejectedAt: Date,
    // 5b: the buyer never shipped an accepted return, so the return expired and
    // the sale stands.
    autoExpired: { type: Boolean, default: false },
    autoExpiredAt: Date,
  },
  // Dispute info (internal platform dispute)
  dispute: {
    reason: String,
    filedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    filedAt: Date,
    resolvedAt: Date,
    resolution: String,
    evidence: [String],
    responseDeadline: Date,
  },
  // Stripe chargeback / dispute tracking (from Stripe webhooks)
  disputeInfo: {
    stripeDisputeId: { type: String, default: '' },
    reason: { type: String, default: '' },
    status: { type: String, default: '' },
    openedAt: { type: Date, default: null },
    evidenceDueBy: { type: Date, default: null },
    closedAt: { type: Date, default: null },
  },
  // Atomic provider-refund claim. This prevents concurrent admin/support
  // refund requests from issuing duplicate refunds or reversing inventory
  // twice. Failed provider attempts clear the flag so the request is retryable.
  refundProcessing: {
    type: Boolean,
    default: false,
  },
  // Exactly-once claim for auto-completion. This prevents concurrent cron/manual
  // completion attempts from releasing the same seller earnings twice.
  completionProcessing: {
    type: Boolean,
    default: false,
  },
  // When the completion claim was taken. Without it a claim abandoned by a
  // dead worker (deploy restart, OOM kill) is indistinguishable from a live
  // one and the order is stuck forever — see utils/claims.js, which reclaims
  // claims older than its abandonment window.
  completionClaimedAt: {
    type: Date,
    default: null,
  },
  // Exactly-once claim for return settlement/refund processing.
  returnProcessing: {
    type: Boolean,
    default: false,
  },
  // Timestamps for the refund/return claims, used to tell a live claim from one
  // abandoned by a dead worker. See utils/claims.js.
  refundClaimedAt: {
    type: Date,
    default: null,
  },
  returnClaimedAt: {
    type: Date,
    default: null,
  },
  // Deferred seller payout for a COMPLETED order (currently the new-seller
  // hold: <14-day-old account, <5 sales). Withholding the release at
  // completion time is only half a feature — without a record of *when* the
  // hold matures the money stays in `balance.pending` forever, because the
  // order is already `completed` and its seller cannot re-run completion
  // (`completed → completed` is not a transition). This record turns the hold
  // into a scheduled event: `releaseHeldSettlements` pays it out once
  // `releaseAfter` has passed and stamps `releasedAt`.
  settlementHold: {
    reason: { type: String, default: '' },
    releaseAfter: { type: Date, default: null },
    releasedAt: { type: Date, default: null },
  },
  // What the settlement reconciliation concluded about this order's payout, and
  // on what evidence. Historically a completed order could say `completed` while
  // the seller's money never left `balance.pending`; a money-keeping decision
  // that has to be reconstructed from traces (reserve entries, notifications,
  // the resulting balance) deserves a written trail on the document.
  settlementAudit: {
    verdict: { type: String, default: '' },
    evidence: [{ type: String }],
    blockers: [{ type: String }],
    earnings: { type: Number, default: 0 },
    reconciledAt: { type: Date, default: null },
  },
  // Cancellation info
  cancellation: {
    cancelledBy: String,
    reason: String,
    cancelledAt: Date,
    refundAmount: Number,
  },
  // Escrow info for high-value transactions (>$500)
  escrow: {
    status: { type: String, enum: ['inactive', 'active', 'released', 'disputed', 'resolved'], default: 'inactive' },
    amount: { type: Number, default: 0 },
    initiatedAt: { type: Date, default: null },
    releasedAt: { type: Date, default: null },
    resolvedAt: { type: Date, default: null },
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    releaseConditions: {
      buyerConfirmed: { type: Boolean, default: false },
      sellerConfirmed: { type: Boolean, default: false },
      inspectionPeriodDays: { type: Number, default: 7 },
    },
    dispute: {
      reason: String,
      evidence: [String],
      disputedAt: { type: Date, default: null },
      disputedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    },
    resolution: { type: String, default: '' },
  },
}, { timestamps: true });

// Indexes
transactionSchema.index({ buyer: 1, createdAt: -1 });
transactionSchema.index({ seller: 1, createdAt: -1 });
transactionSchema.index({ status: 1 });
transactionSchema.index({ 'shipping.trackingNumber': 1 });
transactionSchema.index({ 'autoTracking.nextCheck': 1, status: 1 });
transactionSchema.index({ 'disputeInfo.stripeDisputeId': 1 });
// Payment reconciliation and checkout replay guards query these fields on
// every webhook/retry. Keep them indexed so idempotency remains fast as the
// ledger grows instead of degrading into collection scans.
transactionSchema.index({ 'stripePaymentIntentId': 1 });
transactionSchema.index({ 'paymentBreakdown.paymentIntentId': 1 });
// Compound indexes for paginated status-filtered queries (enterprise scale)
transactionSchema.index({ buyer: 1, status: 1, createdAt: -1 });
transactionSchema.index({ seller: 1, status: 1, createdAt: -1 });
transactionSchema.index({ buyer: 1, createdAt: -1, _id: -1 });
transactionSchema.index({ seller: 1, createdAt: -1, _id: -1 });
// Both settlement-hold scans (the daily release sweep and the reconciliation
// audit) open with `status: 'completed'` and a settlementHold predicate, and
// both grow with the order history rather than the active queue. Without this
// the hourly/daily money jobs degrade into full collection scans.
transactionSchema.index({ status: 1, 'settlementHold.releaseAfter': 1, 'settlementHold.releasedAt': 1 });

module.exports = mongoose.model('Transaction', transactionSchema);