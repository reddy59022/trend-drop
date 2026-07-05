const mongoose = require('mongoose');

const arShowroomSchema = new mongoose.Schema({
  seller: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String, required: true, maxlength: 100 },
  description: { type: String, maxlength: 500 },
  roomType: { type: String, enum: ['bedroom', 'living_room', 'closet', 'storefront', 'custom'], default: 'custom' },
  dimensions: {
    width: { type: Number, default: 10 }, // meters
    length: { type: Number, default: 10 },
    height: { type: Number, default: 3 },
  },
  floorPlanImage: { type: String },
  items: [{
    listing: { type: mongoose.Schema.Types.ObjectId, ref: 'Listing' },
    position: {
      x: { type: Number, default: 0 },
      y: { type: Number, default: 0 },
      z: { type: Number, default: 0 },
      rotation: { type: Number, default: 0 },
    },
    scale: {
      x: { type: Number, default: 1 },
      y: { type: Number, default: 1 },
      z: { type: Number, default: 1 },
    },
  }],
  thumbnail: { type: String },
  isPublic: { type: Boolean, default: true },
  viewCount: { type: Number, default: 0 },
  likeCount: { type: Number, default: 0 },
  tags: [{ type: String }],
}, {
  timestamps: true,
});

module.exports = mongoose.model('ARShowroom', arShowroomSchema);