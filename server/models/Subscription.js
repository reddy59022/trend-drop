const mongoose = require('mongoose');

const subscriptionSchema = new mongoose.Schema({
  seller: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  tier: { type: String, enum: ['free', 'basic', 'pro', 'enterprise'], default: 'free' },
  status: { type: String, enum: ['active', 'cancelled', 'expired'], default: 'active' },
  billingCycle: { type: String, enum: ['monthly', 'annual'], default: 'monthly' },
  startDate: { type: Date, default: Date.now },
  endDate: { type: Date },
  renewalDate: { type: Date },
  price: { type: Number, default: 0 },
  features: {
    reducedFees: { type: Boolean, default: false },
    prioritySupport: { type: Boolean, default: false },
    enhancedPromotions: { type: Boolean, default: false },
    analyticsAccess: { type: Boolean, default: false },
    customDomain: { type: Boolean, default: false },
  },
}, {
  timestamps: true,
});

module.exports = mongoose.model('Subscription', subscriptionSchema);