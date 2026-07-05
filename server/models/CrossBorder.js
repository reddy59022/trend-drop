const mongoose = require('mongoose');

const crossBorderSchema = new mongoose.Schema({
  seller: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  country: { type: String, required: true },
  currency: { type: String, required: true },
  taxRate: { type: Number, default: 0 },
  taxId: { type: String },
  shippingPartners: [{
    name: { type: String },
    enabled: { type: Boolean, default: true },
    rateMultiplier: { type: Number, default: 1 },
  }],
  isActive: { type: Boolean, default: true },
}, {
  timestamps: true,
});

module.exports = mongoose.model('CrossBorder', crossBorderSchema);