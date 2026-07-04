const mongoose = require('mongoose');

const mobilePreferencesSchema = new mongoose.Schema({
  userId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true, 
    unique: true 
  },
  pushNotifications: {
    enabled: { type: Boolean, default: true },
    priceDrop: { type: Boolean, default: true },
    messages: { type: Boolean, default: true },
    offers: { type: Boolean, default: true },
    orderUpdates: { type: Boolean, default: true },
  },
  location: {
    country: { type: String, default: 'US' },
    region: { type: String, default: '' },
    useForShipping: { type: Boolean, default: true },
  },
  quickActions: {
    cameraSell: { type: Boolean, default: true },
    quickMessage: { type: Boolean, default: true },
    barcodeScan: { type: Boolean, default: false },
  },
  biometric: {
    enabled: { type: Boolean, default: false },
    type: { type: String, enum: ['touch', 'face', 'none'], default: 'none' },
  },
  // Device information for analytics
  deviceInfo: {
    platform: { type: String, enum: ['iOS', 'Android', 'Web'] },
    version: { type: String },
    appVersion: { type: String },
  },
}, {
  timestamps: true,
});

module.exports = mongoose.model('MobilePreferences', mobilePreferencesSchema);