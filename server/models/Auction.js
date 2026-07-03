const mongoose = require('mongoose');

const auctionSchema = new mongoose.Schema({
  listing: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Listing',
    required: true,
    unique: true,
  },
  seller: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  startTime: {
    type: Date,
    required: true,
  },
  endTime: {
    type: Date,
    required: true,
  },
  reservePrice: {
    type: Number,
    default: 0,
  },
  currentBid: {
    type: Number,
    default: 0,
  },
  status: {
    type: String,
    enum: ['scheduled', 'active', 'closed', 'cancelled'],
    default: 'scheduled',
  },
  bids: [{
    bidder: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    timestamp: {
      type: Date,
      default: Date.now,
    },
  }],
  winner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  winningBid: {
    type: Number,
    default: 0,
  },
}, { timestamps: true });

// Indexes
auctionSchema.index({ seller: 1, createdAt: -1 });
auctionSchema.index({ status: 1 });
auctionSchema.index({ endTime: 1 });

module.exports = mongoose.model('Auction', auctionSchema);