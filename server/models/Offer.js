const mongoose = require('mongoose');

const offerSchema = new mongoose.Schema({
  listing: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Listing',
    required: true,
  },
  buyer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  seller: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  amount: {
    type: Number,
    required: true,
    min: 0,
  },
  status: {
    type: String,
    enum: ['pending', 'accepted', 'declined', 'countered', 'buyer_countered', 'completed', 'expired'],
    default: 'pending',
  },
  expiresAt: {
    type: Date,
    default: function() { return new Date(Date.now() + 24 * 60 * 60 * 1000); },
  },
  counterAmount: {
    type: Number,
  },
  // Store the currency of the offer to ensure multi‑currency safety. Defaults to the listing's currency on creation.
  currency: {
    type: String,
    default: 'USD',
  },
}, { timestamps: true });

module.exports = mongoose.model('Offer', offerSchema);
