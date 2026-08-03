const mongoose = require('mongoose');

const returnSchema = new mongoose.Schema({
  transaction: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Transaction',
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
  listing: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Listing',
    required: true,
  },
  reason: {
    type: String,
    required: true,
    enum: [
      'Item not as described',
      'Defective',
      'Wrong item received',
      'Changed mind',
      'Item damaged in shipping',
      'Late delivery',
      'Other',
    ],
  },
  description: {
    type: String,
    default: '',
    maxlength: 1000,
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'denied', 'shipped', 'received', 'refunded', 'completed', 'disputed'],
    default: 'pending',
  },
  refundAmount: {
    type: Number,
    default: 0,
  },
  trackingNumber: {
    type: String,
    default: '',
  },
  returnLabel: {
    type: String,
    default: '',
  },
  sellerResponse: {
    type: String,
    default: '',
  },
  denialReason: {
    type: String,
    default: '',
  },
  returnWindow: {
    type: Date,
    default: function () {
      return new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    },
  },
  images: [{
    type: String,
  }],
}, { timestamps: true });

returnSchema.virtual('id').get(function () {
  return this._id.toHexString();
});

returnSchema.index({ buyer: 1, status: 1 });
returnSchema.index({ seller: 1, status: 1 });
returnSchema.index({ transaction: 1 }, { unique: true });

module.exports = mongoose.model('Return', returnSchema);