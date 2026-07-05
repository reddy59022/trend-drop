const mongoose = require('mongoose');

const shippingIntegrationSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  carrier: { type: String, enum: ['UPS', 'FedEx', 'DHL', 'USPS'], required: true },
  apiKey: { type: String, required: true },
  accountNumber: { type: String },
  isActive: { type: Boolean, default: true },
  rates: {
    baseRate: { type: Number, default: 0 },
    weightMultiplier: { type: Number, default: 0 }
  }
}, {
  timestamps: true,
});

module.exports = mongoose.model('ShippingIntegration', shippingIntegrationSchema);