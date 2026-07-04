const mongoose = require('mongoose');

const SellerBadgeSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
  },
  tier: {
    type: String,
    enum: ['bronze', 'silver', 'gold', 'platinum'],
    default: 'bronze',
  },
  salesCount: {
    type: Number,
    default: 0,
  },
  avgRating: {
    type: Number,
    default: 0,
  },
  responseRate: {
    type: Number,
    default: 0,
  },
  returnRate: {
    type: Number,
    default: 0,
  },
  isVerified: {
    type: Boolean,
    default: false,
  },
  verifiedAt: Date,
  benefits: {
    reducedFees: { type: Boolean, default: false },
    prioritySupport: { type: Boolean, default: false },
    featuredListings: { type: Boolean, default: false },
  },
}, {
  timestamps: true,
});

// Tier thresholds
SellerBadgeSchema.statics.TIERS = {
  bronze: { minSales: 0, minRating: 4.0, maxReturnRate: 0.15 },
  silver: { minSales: 10, minRating: 4.5, maxReturnRate: 0.10 },
  gold: { minSales: 50, minRating: 4.7, maxReturnRate: 0.05 },
  platinum: { minSales: 200, minRating: 4.8, maxReturnRate: 0.02 },
};

module.exports = mongoose.model('SellerBadge', SellerBadgeSchema);