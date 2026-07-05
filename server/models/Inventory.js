const mongoose = require('mongoose');

const inventorySchema = new mongoose.Schema({
  seller: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  listing: { type: mongoose.Schema.Types.ObjectId, ref: 'Listing', required: true },
  warehouse: { type: String }, // Warehouse code (e.g., 'WH-001')
  quantity: { type: Number, default: 0 },
  reserved: { type: Number, default: 0 },
  location: { type: String }, // warehouse location code
  sku: { type: String },
  barcode: { type: String },
  lastSync: { type: Date, default: Date.now },
  lowStockThreshold: { type: Number, default: 5 },
  autoReorder: {
    enabled: { type: Boolean, default: false },
    quantity: { type: Number, default: 0 },
    supplier: { type: String }
  }
}, {
  timestamps: true,
});

module.exports = mongoose.model('Inventory', inventorySchema);