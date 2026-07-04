const mongoose = require('mongoose');

const virtualTryOnSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  listingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Listing', required: true },
  sessionType: { 
    type: String, 
    enum: ['camera', 'upload', 'ar'], 
    default: 'ar' 
  },
  imageUrl: { type: String }, // User's uploaded photo or generated AR view
  thumbnailUrl: { type: String },
  measurements: {
    bust: { type: Number },
    waist: { type: Number },
    hip: { type: Number },
    inseam: { type: Number },
    height: { type: Number },
  },
  fitAnalysis: {
    recommendedSize: { type: String },
    confidenceScore: { type: Number, min: 0, max: 100 },
    fitNotes: [{ type: String }],
    sizeAdjustments: [{
      dimension: { type: String },
      adjustment: { type: String }, // 'tight', 'loose', 'perfect'
    }],
  },
  viewedAt: { type: Date, default: Date.now },
  durationSeconds: { type: Number, default: 0 },
}, {
  timestamps: true,
});

// Indexes for efficient queries
virtualTryOnSchema.index({ userId: 1, createdAt: -1 });
virtualTryOnSchema.index({ listingId: 1 });
virtualTryOnSchema.index({ userId: 1, listingId: 1 }, { unique: true });

module.exports = mongoose.model('VirtualTryOn', virtualTryOnSchema);