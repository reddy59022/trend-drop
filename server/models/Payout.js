const mongoose = require('mongoose');

const payoutSchema = new mongoose.Schema({
  seller: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  transaction: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Transaction',
    required: true,
  },
  listing: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Listing',
    required: true,
  },
  // Breakdown of the payout
  salePrice: {
    type: Number,
    required: true,
  },
  commissionRate: {
    type: Number,
    default: 0.05, // 5% - much lower than Poshmark's 20%
  },
  commissionAmount: {
    type: Number,
    required: true,
  },
  payoutAmount: {
    type: Number,
    required: true,
  },
  // Payout status
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed'],
    default: 'pending',
  },
  // Payment method info (placeholder for Stripe Connect, PayPal, etc.)
  paymentMethod: {
    type: String,
    default: 'balance',
  },
  paidAt: {
    type: Date,
  },
  // Seller balance tracking
  availableBalance: {
    type: Number,
    default: 0,
  },
}, { timestamps: true });

payoutSchema.index({ seller: 1, status: 1 });
payoutSchema.index({ seller: 1, createdAt: -1 });

module.exports = mongoose.model('Payout', payoutSchema);