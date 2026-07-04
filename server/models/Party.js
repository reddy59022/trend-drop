const mongoose = require('mongoose');

const PartySchema = new mongoose.Schema({
  hostId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  hostName: {
    type: String,
    required: true,
  },
  hostAvatar: String,
  title: {
    type: String,
    required: true,
    maxlength: 100,
  },
  description: {
    type: String,
    maxlength: 500,
  },
  coverImage: String,
  category: {
    type: String,
    enum: ['Women', 'Men', 'Kids', 'Electronics', 'Home', 'Beauty', 'Accessories'],
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
  status: {
    type: String,
    enum: ['scheduled', 'active', 'ended', 'cancelled'],
    default: 'scheduled',
  },
  discountPercent: {
    type: Number,
    default: 10,
    min: 5,
    max: 30,
  },
  listingIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Listing',
  }],
  participantCount: {
    type: Number,
    default: 0,
  },
  shareCount: {
    type: Number,
    default: 0,
  },
  isPublic: {
    type: Boolean,
    default: true,
  },
}, {
  timestamps: true,
});

// Index for efficient queries
PartySchema.index({ status: 1, startTime: 1 });
PartySchema.index({ category: 1 });

module.exports = mongoose.model('Party', PartySchema);