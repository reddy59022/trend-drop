const mongoose = require('mongoose');

const RecentlyViewedSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  listingId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Listing',
    required: true,
  },
  viewedAt: {
    type: Date,
    default: Date.now,
  },
}, {
  timestamps: true,
});

// Index to ensure unique user-listing pairs and efficient queries
RecentlyViewedSchema.index({ userId: 1, listingId: 1 }, { unique: true });
RecentlyViewedSchema.index({ userId: 1, viewedAt: -1 });

module.exports = mongoose.model('RecentlyViewed', RecentlyViewedSchema);