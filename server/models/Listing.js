const mongoose = require('mongoose');

const listingSchema = new mongoose.Schema({
  seller: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 150,
  },
  description: {
    type: String,
    required: true,
    maxlength: 2000,
  },
  price: {
    type: Number,
    required: true,
    min: 0,
  },
  originalPrice: {
    type: Number,
    min: 0,
  },
  images: [{
    type: String,
  }],
  category: {
    type: String,
    required: true,
    enum: ['Women', 'Men', 'Kids', 'Electronics', 'Home', 'Beauty', 'Accessories'],
  },
  brand: {
    type: String,
    trim: true,
  },
  size: {
    type: String,
  },
  condition: {
    type: String,
    required: true,
    enum: ['New with tags', 'New without tags', 'Good', 'Fair', 'Poor'],
  },
  color: {
    type: String,
  },
  likes: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  }],
  comments: [{
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    text: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
  }],
  shares: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  }],
  sold: {
    type: Boolean,
    default: false,
  },
  available: {
    type: Boolean,
    default: true,
  },
}, { timestamps: true });

// Performance: Compound indexes for filtered & sorted queries
listingSchema.index({ title: 'text', brand: 'text' });
listingSchema.index({ available: 1, sold: 1, createdAt: -1 });
listingSchema.index({ available: 1, sold: 1, category: 1, price: 1 });
listingSchema.index({ seller: 1, sold: 1, createdAt: -1 });
listingSchema.index({ category: 1, available: 1, sold: 1, price: 1 });
listingSchema.index({ 'likes.length': -1 });
listingSchema.index({ _id: 1, createdAt: -1 });

module.exports = mongoose.model('Listing', listingSchema);