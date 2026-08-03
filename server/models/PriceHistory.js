const mongoose = require('mongoose');

const priceHistorySchema = new mongoose.Schema({
  listing: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Listing',
    required: true,
  },
  price: {
    type: Number,
    required: true,
  },
  // Historical price tracking support
  oldPrice: {
    type: Number,
    default: null,
  },
  newPrice: {
    type: Number,
    default: null,
  },
  changedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  reason: {
    type: String,
    enum: ['price_change', 'price_drop', 'relist', 'bulk_edit', 'offer_accept', 'manual'],
    default: 'price_change',
  },
  // How many likers were notified of this change
  notifiedLikers: {
    type: Number,
    default: 0,
  },
}, { timestamps: true });

priceHistorySchema.index({ listing: 1, createdAt: -1 });

module.exports = mongoose.model('PriceHistory', priceHistorySchema);