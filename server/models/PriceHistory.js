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
}, { timestamps: true });

priceHistorySchema.index({ listing: 1, createdAt: -1 });

module.exports = mongoose.model('PriceHistory', priceHistorySchema);