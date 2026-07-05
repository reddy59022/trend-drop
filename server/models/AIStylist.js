const mongoose = require('mongoose');

const aiStylistSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  preferences: {
    categories: [{ type: String, enum: ['Women', 'Men', 'Kids', 'Electronics', 'Home', 'Beauty', 'Accessories'] }],
    brands: [{ type: String }],
    sizes: {
      women: { type: String },
      men: { type: String },
      kids: { type: String },
    },
    colors: [{ type: String }],
    priceRange: {
      min: { type: Number, default: 0 },
      max: { type: Number, default: 1000 },
    },
  },
  recommendations: [{
    listing: { type: mongoose.Schema.Types.ObjectId, ref: 'Listing' },
    score: { type: Number, default: 0 },
    reason: { type: String, enum: ['preference_match', 'trending', 'similar_purchase', 'color_match', 'brand_match'] },
    generatedAt: { type: Date, default: Date.now },
  }],
  outfits: [{
    name: { type: String, default: 'My Outfit' },
    items: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Listing' }],
    createdAt: { type: Date, default: Date.now },
  }],
  lastUpdated: { type: Date, default: Date.now },
});

module.exports = mongoose.model('AIStylist', aiStylistSchema);