const mongoose = require('mongoose');

const cartSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
  },
  items: [{
    listing: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Listing',
      required: true,
    },
    quantity: {
      type: Number,
      default: 1,
    },
    addedAt: {
      type: Date,
      default: Date.now,
    },
  }],
  status: {
    type: String,
    enum: ['active', 'abandoned', 'purchased', 'expired'],
    default: 'active',
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  expiresAt: {
    type: Date,
    default: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
  },
  reminderSent: {
    type: Boolean,
    default: false,
  },
  reminderSentAt: Date,
}, { timestamps: true });

// Indexes
cartSchema.index({ user: 1 });
cartSchema.index({ status: 1 });
cartSchema.index({ expiresAt: 1 });

module.exports = mongoose.model('Cart', cartSchema);