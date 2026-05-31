const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  listing: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Listing',
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
  // Pricing
  itemPrice: {
    type: Number,
    required: true,
  },
  currency: {
    type: String,
    default: 'USD',
  },
  // Full payment breakdown - transparent for both buyer and seller
  paymentBreakdown: {
    // What the buyer pays
    subtotal: { type: Number, required: true },
    shippingCost: { type: Number, default: 0 },
    buyerProtectionFee: { type: Number, default: 0 },
    buyerProtectionPercent: { type: Number, default: 5 },
    tax: { type: Number, default: 0 },
    totalPaid: { type: Number, required: true },

    // What the seller receives
    platformFee: { type: Number, default: 0 },
    platformFeePercent: { type: Number, default: 10 },
    shippingPayout: { type: Number, default: 0 },
    sellerEarnings: { type: Number, required: true },
    // Boost fees - BUG 9: Added missing fields that transactions.js sets
    boostFee: { type: Number, default: 0 },
    boostTier: { type: String, default: '' },
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
  // Payout tracking
  payout: {
    status: { type: String, enum: ['pending', 'processing', 'completed', 'failed', 'refunded'], default: 'pending' },
    method: { type: String, default: '' },
    processedAt: { type: Date },
    transactionId: { type: String, default: '' },
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
    requestedAt: Date,
    deadline: Date,
    acceptedAt: Date,
    returnShipDeadline: Date,
    receivedAt: Date,
    reason: String,
    condition: String,
    buyerPackingProof: [String],
    sellerInspectionProof: [String],
    inspectionNotes: String,
    trackingNumber: String,
  },
  // Dispute info
  dispute: {
    reason: String,
    filedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    filedAt: Date,
    resolvedAt: Date,
    resolution: String,
    evidence: [String],
    responseDeadline: Date,
  },
  // Cancellation info
  cancellation: {
    cancelledBy: String,
    reason: String,
    cancelledAt: Date,
    refundAmount: Number,
  },
}, { timestamps: true });

// Indexes
transactionSchema.index({ buyer: 1, createdAt: -1 });
transactionSchema.index({ seller: 1, createdAt: -1 });
transactionSchema.index({ status: 1 });
transactionSchema.index({ 'shipping.trackingNumber': 1 });
transactionSchema.index({ 'autoTracking.nextCheck': 1, status: 1 });

module.exports = mongoose.model('Transaction', transactionSchema);