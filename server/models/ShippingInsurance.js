const mongoose = require('mongoose');

const insuranceSchema = new mongoose.Schema({
  // The transaction this insurance is for
  transaction: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Transaction',
    required: true,
  },
  // The seller who purchased insurance
  seller: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  // Item value at purchase (not including shipping)
  itemValue: {
    type: Number,
    required: true,
  },
  // Insurance premium (2% of item value)
  premium: {
    type: Number,
    required: true,
  },
  // Currency
  currency: {
    type: String,
    default: 'USD',
  },
  // Coverage type: basic (up to $100), standard (up to $500), premium (up to $2000)
  coverageType: {
    type: String,
    enum: ['basic', 'standard', 'premium'],
    default: 'standard',
  },
  // Coverage limit (calculated at purchase)
  coverageLimit: {
    type: Number,
    default: 500,
  },
  // Insurance status
  status: {
    type: String,
    enum: ['active', 'claimed', 'expired', 'cancelled'],
    default: 'active',
  },
  // When insurance was purchased
  purchasedAt: {
    type: Date,
    default: Date.now,
  },
  // Expiration date (typically 7 days from purchase)
  expiresAt: {
    type: Date,
  },
  // Claim information (mixed type to allow flexible storage)
  claim: mongoose.Schema.Types.Mixed,
  // Refund tracking
  refunded: {
    type: Boolean,
    default: false,
  },
}, { timestamps: true });

// Indexes
insuranceSchema.index({ transaction: 1 });
insuranceSchema.index({ seller: 1 });
insuranceSchema.index({ expiresAt: 1 });

// Calculate premium (2% of item value, min $2)
insuranceSchema.statics.calculatePremium = function(itemValue, coverageType = 'standard') {
  const rates = {
    basic: 0.03, // 3% for basic
    standard: 0.02, // 2% for standard
    premium: 0.015, // 1.5% for premium
  };
  const premium = Math.max(2, Math.round(itemValue * rates[coverageType] * 100) / 100);
  return premium;
};

// Get coverage limit for type
insuranceSchema.statics.getCoverageLimit = function(coverageType) {
  const limits = {
    basic: 100,
    standard: 500,
    premium: 2000,
  };
  return limits[coverageType] || 500;
};

module.exports = mongoose.model('ShippingInsurance', insuranceSchema);