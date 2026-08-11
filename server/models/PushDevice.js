const mongoose = require('mongoose');

// PushDevice — registered device tokens for push notifications (TD-2.3).
// One document per device token so a user can receive pushes on every
// device they have signed in (multi-device support).
const pushDeviceSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  token: {
    type: String,
    required: true,
    unique: true,
  },
  platform: {
    type: String,
    enum: ['iOS', 'Android', 'Web'],
    required: true,
  },
  deviceId: {
    type: String,
    default: '',
  },
  appVersion: {
    type: String,
    default: '',
  },
  lastSeenAt: {
    type: Date,
    default: Date.now,
  },
}, {
  timestamps: true,
});

// Fast lookups: all devices for a user, plus per-platform queries.
pushDeviceSchema.index({ userId: 1, platform: 1 });

module.exports = mongoose.model('PushDevice', pushDeviceSchema);
