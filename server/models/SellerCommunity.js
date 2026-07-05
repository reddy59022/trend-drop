const mongoose = require('mongoose');

const sellerCommunitySchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: { type: String },
  members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  moderators: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  isPrivate: { type: Boolean, default: false },
  inviteCode: { type: String, unique: true },
  challenges: [{
    title: { type: String, required: true },
    description: String,
    startDate: { type: Date, default: Date.now },
    endDate: Date,
    rewards: String,
    participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
  }],
  achievements: [{
    member: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    badge: String,
    awardedAt: { type: Date, default: Date.now }
  }],
  campaigns: [{
    title: String,
    discount: Number,
    startDate: Date,
    endDate: Date,
    participantListings: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Listing' }]
  }]
}, {
  timestamps: true,
});

module.exports = mongoose.model('SellerCommunity', sellerCommunitySchema);