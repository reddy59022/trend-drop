const mongoose = require('mongoose');

const loyaltySchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  points: { type: Number, default: 0 },
  tier: { type: String, enum: ['Silver', 'Gold', 'Platinum'], default: 'Silver' },
  pointsHistory: [{
    amount: { type: Number, required: true },
    reason: { type: String, required: true }, // purchase, referral, anniversary, etc.
    listing: { type: mongoose.Schema.Types.ObjectId, ref: 'Listing' },
    createdAt: { type: Date, default: Date.now }
  }],
  anniversaryRewards: [{
    year: { type: Number },
    reward: { type: String },
    claimed: { type: Boolean, default: false }
  }]
}, {
  timestamps: true,
});

module.exports = mongoose.model('LoyaltyProgram', loyaltySchema);