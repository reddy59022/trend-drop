const mongoose = require('mongoose');

const returnSchema = new mongoose.Schema({
  transaction: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Transaction',
    required: true,
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
  listing: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Listing',
    required: true,
  },
  reason: {
    type: String,
    required: true,
    enum: [
      'Item not as described',
      'Defective',
      'Wrong item received',
      'Changed mind',
      'Item damaged in shipping',
      'Late delivery',
      'Other',
    ],
  },
  description: {
    type: String,
    default: '',
    maxlength: 1000,
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'shipped', 'in_transit', 'out_for_delivery', 'delivered', 'received', 'denied', 'refunded', 'completed', 'disputed'],
    default: 'pending',
  },
  refundAmount: {
    type: Number,
    default: 0,
  },
  // BUSINESS RULES: "Return shipping cost responsibility varies by reason
  // (buyer/seller)". 'seller' = seller-fault reasons (defective / not as
  // described / wrong item / damaged / late) → buyer is refunded the FULL
  // totalPaid. 'buyer' = buyer-remorse reasons (changed mind) → buyer is
  // refunded the item price only; outbound shipping + protection stay with
  // the buyer, and the buyer pays return shipping.
  returnShippingResponsibility: {
    type: String,
    enum: ['buyer', 'seller'],
    default: 'seller',
  },
  trackingNumber: {
    type: String,
    default: '',
  },
  returnLabel: {
    type: String,
    default: '',
  },
  returnTrackingNumber: {
    type: String,
    default: '',
  },
  // EasyPost tracker for the platform-purchased return label.
  trackerId: {
    type: String,
    default: '',
  },
  trackingStatus: {
    type: String,
    default: 'label_created',
  },
  trackingHistory: [{
    status: String,
    label: String,
    description: String,
    timestamp: { type: Date, default: Date.now },
    location: String,
  }],
  deliveredAt: {
    type: Date,
    default: null,
  },
  inventoryRestored: { type: Boolean, default: false },
  boostReversed: { type: Boolean, default: false },
  payoutMarkedRefunded: { type: Boolean, default: false },
  sellerLedgerClawedBack: { type: Boolean, default: false },
  providerRefunded: { type: Boolean, default: false },
  // A lost chargeback refunds the buyer outside the return flow; any in-progress
  // return for that transaction is closed so it cannot be settled twice.
  closedByChargeback: { type: Boolean, default: false },
  chargebackClosedAt: { type: Date, default: null },
  // The provider's actual answer for this return's refund. `providerRefunded`
  // means the money-moving call was accepted; these fields record WHAT Stripe
  // returned (refund id, status, amount in minor units) so a settled return
  // can be audited against the dashboard instead of trusting a boolean.
  providerRefundId: { type: String, default: '' },
  providerRefundStatus: { type: String, default: '' },
  providerRefundAmount: { type: Number, default: null },
  providerRefundedAt: { type: Date, default: null },
  labelCarrier: {
    type: String,
    default: '',
  },
  labelCost: {
    type: Number,
    default: 0,
  },
  // Postage recovered from a seller-responsibility return (return label +
  // consumed outbound label). Audit trail for the platform's shipping P&L.
  postageChargedToSeller: {
    type: Number,
    default: 0,
  },
  labelGeneratedAt: {
    type: Date,
    default: null,
  },
  sellerResponse: {
    type: String,
    default: '',
  },
  denialReason: {
    type: String,
    default: '',
  },
  returnWindow: {
    type: Date,
    default: function () {
      return new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    },
  },
  images: [{
    type: String,
  }],
}, { timestamps: true });

returnSchema.virtual('id').get(function () {
  return this._id.toHexString();
});

returnSchema.index({ buyer: 1, status: 1 });
returnSchema.index({ seller: 1, status: 1 });
returnSchema.index({ transaction: 1 }, { unique: true });

module.exports = mongoose.model('Return', returnSchema);