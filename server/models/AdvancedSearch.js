const mongoose = require('mongoose');

const advancedSearchSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  query: { type: String, required: true },
  filters: {
    category: { type: String },
    brand: { type: String },
    size: { type: String },
    condition: { type: String },
    color: { type: String },
    minPrice: { type: Number },
    maxPrice: { type: Number },
    location: { type: String },
  },
  resultsCount: { type: Number, default: 0 },
  saved: { type: Boolean, default: false },
  name: { type: String }, // For saved searches
}, {
  timestamps: true,
});

module.exports = mongoose.model('AdvancedSearch', advancedSearchSchema);