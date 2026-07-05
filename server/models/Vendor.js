const mongoose = require('mongoose');

const vendorSchema = new mongoose.Schema({
  listing: { type: mongoose.Schema.Types.ObjectId, ref: 'Listing', required: true },
  sellers: [{
    seller: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    commission: { type: Number, default: 0 }, // percentage
    isPrimary: { type: Boolean, default: false }
  }],
  sharedInventory: { type: Number, default: 0 },
  performance: {
    rating: { type: Number, default: 5 },
    totalSales: { type: Number, default: 0 },
    onTimeShipments: { type: Number, default: 0 }
  }
}, {
  timestamps: true,
});

module.exports = mongoose.model('Vendor', vendorSchema);