const mongoose = require('mongoose');

const bundleRuleSchema = new mongoose.Schema({
  seller: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  name: {
    type: String,
    required: true,
    trim: true,
  },
  minQuantity: {
    type: Number,
    required: true,
    min: 2,
    default: 2,
  },
  discountPercent: {
    type: Number,
    required: true,
    min: 1,
    max: 100,
  },
  applicableCategories: [{
    type: String,
    trim: true,
  }],
  // If empty, applies to all categories
  isActive: {
    type: Boolean,
    default: true,
  },
  // Optional: bundle description shown to buyers
  description: {
    type: String,
    default: '',
  },
  // Max number of times this rule can be applied (0 = unlimited)
  maxApplications: {
    type: Number,
    default: 0,
  },
  usageCount: {
    type: Number,
    default: 0,
  },
  expiresAt: {
    type: Date,
  },
}, { timestamps: true });

bundleRuleSchema.index({ seller: 1, isActive: 1 });
bundleRuleSchema.index({ seller: 1, applicableCategories: 1 });

module.exports = mongoose.model('BundleRule', bundleRuleSchema);