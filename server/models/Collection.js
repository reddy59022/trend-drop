const mongoose = require('mongoose');

const collectionSchema = new mongoose.Schema({
  seller: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100,
  },
  description: {
    type: String,
    maxlength: 500,
    default: '',
  },
  image: {
    type: String,
    default: '',
  },
  listings: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Listing',
  }],
  isActive: {
    type: Boolean,
    default: true,
  },
  sortOrder: {
    type: Number,
    default: 0,
  },
}, { timestamps: true });

collectionSchema.index({ seller: 1, sortOrder: 1 });
collectionSchema.index({ isActive: 1 });

module.exports = mongoose.model('Collection', collectionSchema);