const mongoose = require('mongoose');

const trendForecastSchema = new mongoose.Schema({
  category: { type: String, required: true }, // Women, Men, Kids, etc.
  predictedDemand: { type: Number, default: 0 }, // Predicted percentage change
  confidence: { type: Number, default: 0 }, // Confidence score 0-100
  timeframe: { type: String, enum: ['daily', 'weekly', 'monthly', 'seasonal'], default: 'weekly' },
  trendingItems: [{
    listing: { type: mongoose.Schema.Types.ObjectId, ref: 'Listing' },
    trendScore: { type: Number, default: 0 },
  }],
  lastUpdated: { type: Date, default: Date.now },
  isActive: { type: Boolean, default: true },
}, {
  timestamps: true,
});

module.exports = mongoose.model('TrendForecast', trendForecastSchema);