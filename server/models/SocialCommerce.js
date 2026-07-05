const mongoose = require('mongoose');

const socialCommerceSchema = new mongoose.Schema({
  seller: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  platform: { type: String, enum: ['instagram', 'tiktok', 'pinterest', 'snapchat', 'facebook'], required: true },
  accountId: { type: String, required: true },
  accessToken: { type: String },
  refreshToken: { type: String },
  connectedAt: { type: Date, default: Date.now },
  lastSync: { type: Date },
  isActive: { type: Boolean, default: true },
  settings: {
    autoPostListings: { type: Boolean, default: false },
    autoPostSales: { type: Boolean, default: false },
    syncFrequency: { type: String, enum: ['hourly', 'daily', 'weekly'], default: 'daily' },
  },
  stats: {
    totalPosts: { type: Number, default: 0 },
    totalViews: { type: Number, default: 0 },
    totalClicks: { type: Number, default: 0 },
    totalConversions: { type: Number, default: 0 },
  },
}, {
  timestamps: true,
});

// Ensure one connection per seller per platform
socialCommerceSchema.index({ seller: 1, platform: 1 }, { unique: true });

module.exports = mongoose.model('SocialCommerce', socialCommerceSchema);