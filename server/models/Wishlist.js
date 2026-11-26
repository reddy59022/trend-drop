const mongoose = require('mongoose');

const wishlistSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
  },
  items: [{
    listing: { type: mongoose.Schema.Types.ObjectId, ref: 'Listing' },
    addedAt: { type: Date, default: Date.now },
  }],
}, { timestamps: true });

// Drives price-drop/restock alert fan-out; without it a popular item's alert
// lookup scans every wishlist in the collection.
wishlistSchema.index({ 'items.listing': 1 });

module.exports = mongoose.model('Wishlist', wishlistSchema);