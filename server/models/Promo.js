const mongoose = require('mongoose');

const promoSchema = new mongoose.Schema({
  code: {
    type: String,
    required: true,
    uppercase: true,
    trim: true,
  },
  seller: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  discountType: {
    type: String,
    enum: ['percentage', 'fixed'],
    required: true,
  },
  discountValue: {
    type: Number,
    required: true,
    min: 0.01,
  },
  // Optional: minimum purchase amount to apply promo
  minPurchaseAmount: {
    type: Number,
    default: 0,
  },
  // Optional: maximum discount amount (for percentage discounts)
  maxDiscountAmount: {
    type: Number,
    default: 0,
  },
  expiresAt: {
    type: Date,
  },
  usageLimit: {
    type: Number,
    default: 0, // 0 = unlimited
  },
  usageCount: {
    type: Number,
    default: 0,
  },
  // If true, applies to entire platform (admin only)
  isPlatformWide: {
    type: Boolean,
    default: false,
  },
  // Optional: applicable categories (empty = all)
  applicableCategories: [{
    type: String,
    trim: true,
  }],
  isActive: {
    type: Boolean,
    default: true,
  },
  description: {
    type: String,
    default: '',
  },
}, { timestamps: true });

promoSchema.index({ code: 1, seller: 1 }, { unique: true });
promoSchema.index({ seller: 1 });
promoSchema.index({ isPlatformWide: 1, isActive: 1 });

module.exports = mongoose.model('Promo', promoSchema);