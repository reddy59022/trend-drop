const mongoose = require('mongoose');

// Shop Boost (Feature 3): a seller-level toggle that treats every active
// listing as BASIC (standard) boosted with the HIGHEST feed priority.
const shopBoostSchema = new mongoose.Schema({
  seller: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
  },
  active: { type: Boolean, default: false },
  // Shop boosts are always the basic/standard tier (10% per-sale fee).
  tier: { type: String, enum: ['standard', 'premium', 'elite'], default: 'standard' },
  startDate: { type: Date },
  endDate: { type: Date },
  durationDays: { type: Number, default: 30 },
  feePercent: { type: Number, default: 10 },
}, { timestamps: true });

module.exports = mongoose.model('ShopBoost', shopBoostSchema);