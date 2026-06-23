const mongoose = require('mongoose');

const savedSearchSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  name: {
    type: String,
    default: '',
    maxlength: 100,
  },
  // Search query parameters (stored as JSON)
  query: {
    type: String,
    default: '',
  },
  filters: {
    category: { type: String, default: '' },
    brand: { type: String, default: '' },
    size: { type: String, default: '' },
    condition: { type: String, default: '' },
    minPrice: { type: Number, default: null },
    maxPrice: { type: Number, default: null },
    sort: { type: String, default: '' },
  },
  // Notification frequency
  notifyFrequency: {
    type: String,
    enum: ['instant', 'daily', 'weekly', 'never'],
    default: 'daily',
  },
  // Last time we checked for new results
  lastChecked: {
    type: Date,
    default: Date.now,
  },
  // Email notification enabled
  emailNotify: {
    type: Boolean,
    default: false,
  },
  // Push notification enabled
  pushNotify: {
    type: Boolean,
    default: true,
  },
}, { timestamps: true });

savedSearchSchema.index({ user: 1, createdAt: -1 });
savedSearchSchema.index({ notifyFrequency: 1, lastChecked: 1 });

module.exports = mongoose.model('SavedSearch', savedSearchSchema);