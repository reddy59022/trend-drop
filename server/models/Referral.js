const mongoose = require('mongoose');

const referralSchema = new mongoose.Schema({
  // The user who shared the referral code
  referrer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  // The user who used the referral code (if any)
  referred: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  // Unique referral code
  code: {
    type: String,
    required: true,
    unique: true,
    uppercase: true,
  },
  // How many times this code has been used
  uses: {
    type: Number,
    default: 0,
  },
  // Maximum uses allowed (null = unlimited)
  maxUses: {
    type: Number,
    default: null,
  },
  // Reward amount for referrer (USD equivalent)
  rewardAmount: {
    type: Number,
    default: 10,
  },
  // Reward currency
  currency: {
    type: String,
    default: 'USD',
  },
  // Whether reward has been claimed
  rewardClaimed: {
    type: Boolean,
    default: false,
  },
  // Status of the referral
  status: {
    type: String,
    enum: ['active', 'used', 'expired', 'inactive'],
    default: 'active',
  },
  // When the referral expires (null = never expires)
  expiresAt: {
    type: Date,
    default: null,
  },
  // Creation date
  createdAt: {
    type: Date,
    default: Date.now,
  },
  // History of referred users
  referredUsers: [{
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    createdAt: { type: Date, default: Date.now },
    rewardGiven: { type: Boolean, default: false },
  }],
}, { timestamps: true });

// Indexes
referralSchema.index({ referrer: 1 });
referralSchema.index({ code: 1 });
referralSchema.index({ referred: 1 });

// Generate unique referral code
referralSchema.statics.generateCode = async function(userId) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code;
  let exists = true;

  while (exists) {
    code = Array.from({ length: 8 }, () => chars.charAt(Math.floor(Math.random() * chars.length))).join('');
    const existing = await this.findOne({ code });
    exists = !!existing;
  }

  return code;
};

module.exports = mongoose.model('Referral', referralSchema);