const mongoose = require('mongoose');

const videoSchema = new mongoose.Schema({
  listing: { type: mongoose.Schema.Types.ObjectId, ref: 'Listing', required: true },
  seller: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  videoUrl: { type: String, required: true },
  thumbnailUrl: { type: String },
  duration: { type: Number, default: 0 }, // in seconds
  title: { type: String },
  description: { type: String },
  effects: [{ type: String }], // applied filters/effects
  tags: [{ type: String }],
  isPublic: { type: Boolean, default: true },
  status: { type: String, enum: ['processing', 'active', 'rejected'], default: 'processing' },
  analytics: {
    views: { type: Number, default: 0 },
    completionRate: { type: Number, default: 0 },
    shares: { type: Number, default: 0 },
    likes: { type: Number, default: 0 }
  }
}, {
  timestamps: true,
});

module.exports = mongoose.model('Video', videoSchema);