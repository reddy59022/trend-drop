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
  currency: {
    type: String,
    default: 'USD',
    uppercase: true,
    trim: true,
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
    currency: {
      type: String,
      default: 'USD',
      uppercase: true,
      trim: true,
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
  winningCurrency: {
    type: String,
    default: 'USD',
    uppercase: true,
    trim: true,
  },
  // Live video streaming info (client-side WebRTC, zero server load)
  streamInfo: {
    streamId: { type: String, default: null },
    sellerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    startedAt: { type: Date, default: null },
    endedAt: { type: Date, default: null },
    isLive: { type: Boolean, default: false },
    viewerCount: { type: Number, default: 0 },
  },
}, { timestamps: true });

// Indexes
auctionSchema.index({ seller: 1, createdAt: -1 });
auctionSchema.index({ status: 1 });
auctionSchema.index({ endTime: 1 });

module.exports = mongoose.model('Auction', auctionSchema);