const mongoose = require('mongoose');

const TrendSchema = new mongoose.Schema({
  postId: {
    type: String,
    required: true,
    unique: true,
  },
  text: {
    type: String,
    required: true,
  },
  author: {
    type: String,
    required: true,
  },
  hashtags: [String],
  likes: {
    type: Number,
    default: 0,
  },
  reposts: {
    type: Number,
    default: 0,
  },
  replies: {
    type: Number,
    default: 0,
  },
  views: {
    type: Number,
    default: 0,
  },
  timestamp: {
    type: Date,
    required: true,
  },
  fetchedAt: {
    type: Date,
    default: Date.now,
  },
  isViral: {
    type: Boolean,
    default: false,
  },
});

// Index for faster queries
TrendSchema.index({ postId: 1 });
TrendSchema.index({ timestamp: -1 });
TrendSchema.index({ isViral: 1 });

module.exports = mongoose.model('Trend', TrendSchema);