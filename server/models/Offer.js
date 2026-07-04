const mongoose = require('mongoose');

const offerSchema = new mongoose.Schema({
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
  // Original buyer offer amount
  amount: {
    type: Number,
    required: true,
    min: 0,
  },
  status: {
    type: String,
    enum: ['pending', 'accepted', 'declined', 'countered', 'buyer_countered', 'completed', 'expired'],
    default: 'pending',
  },
  expiresAt: {
    type: Date,
    default: function() { return new Date(Date.now() + 24 * 60 * 60 * 1000); },
  },
  // Latest counter-offer amount (for backward compatibility)
  counterAmount: {
    type: Number,
  },
  // CRITICAL: Full counter-offer history chain
  // Tracks every counter-offer with who made it and when
  counterHistory: [{
    amount: { type: Number, required: true },
    counteredBy: { type: String, enum: ['buyer', 'seller'], required: true },
    message: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now },
  }],
  // Who made the last counter-offer (determines who can act next)
  lastCounterBy: {
    type: String,
    enum: ['buyer', 'seller', null],
    default: null,
  },
  // CRITICAL: The final accepted price (set when seller accepts)
  // This is the price the buyer can purchase at
  acceptedPrice: {
    type: Number,
  },
  // When the offer was accepted
  acceptedAt: {
    type: Date,
  },
  // 24-hour window for accepted offers to purchase
  acceptedUntil: {
    type: Date,
  },
  // Who accepted the offer (buyer accepted seller's counter, or seller accepted buyer's offer/counter)
  acceptedBy: {
    type: String,
    enum: ['buyer', 'seller', null],
    default: null,
  },
  // Link to the transaction created from this offer (set when purchased)
  transaction: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Transaction',
  },
  // Store the currency of the offer to ensure multi-currency safety
  currency: {
    type: String,
    default: 'USD',
  },
  // Optional message from buyer with initial offer
  buyerMessage: {
    type: String,
    default: '',
  },
  // Bulk offer / Offers to Likers (Section 28b)
  bulkOffer: {
    isBulk: { type: Boolean, default: false },
    discountType: { type: String, enum: ['percentage', 'fixed', null], default: null },
    discountValue: { type: Number },
    claimedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  },
  // Offer Sharing fields (v45.0)
  sharedWithLikers: { type: Boolean, default: false },
  sharedFromOffer: { type: mongoose.Schema.Types.ObjectId, ref: 'Offer' },
  isBundle: { type: Boolean, default: false },
  bundleItems: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Listing' }],
  likesCount: { type: Number, default: 0 },
}, { timestamps: true });

// Index for efficient queries
offerSchema.index({ listing: 1, buyer: 1, status: 1 });
offerSchema.index({ seller: 1, status: 1 });
offerSchema.index({ buyer: 1, status: 1 });
offerSchema.index({ expiresAt: 1 });

// Virtual: Get the current active price (what buyer would pay if accepted)
offerSchema.virtual('currentPrice').get(function() {
  if (this.status === 'accepted' && this.acceptedPrice) {
    return this.acceptedPrice;
  }
  // If countered, the counterAmount is the current proposed price
  if (this.counterAmount) {
    return this.counterAmount;
  }
  // Otherwise, the original offer amount
  return this.amount;
});

// Virtual: Get the number of counter-offers
offerSchema.virtual('counterCount').get(function() {
  return this.counterHistory ? this.counterHistory.length : 0;
});

module.exports = mongoose.model('Offer', offerSchema);