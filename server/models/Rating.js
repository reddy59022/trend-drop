const mongoose = require('mongoose');

const ratingSchema = new mongoose.Schema({
  listing: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Listing',
    required: true,
  },
  reviewer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  seller: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  rating: {
    type: Number,
    required: true,
    min: 1,
    max: 5,
  },
  review: {
    type: String,
    maxlength: 1000,
    default: '',
  },
}, { timestamps: true });

ratingSchema.index({ seller: 1, createdAt: -1 });
ratingSchema.index({ listing: 1 });
ratingSchema.index({ reviewer: 1, listing: 1 }, { unique: true });

module.exports = mongoose.model('Rating', ratingSchema);