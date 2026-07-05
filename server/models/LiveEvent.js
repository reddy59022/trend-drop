const mongoose = require('mongoose');

const liveEventSchema = new mongoose.Schema({
  host: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, required: true, maxlength: 100 },
  description: { type: String, maxlength: 500 },
  listings: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Listing' }],
  startTime: { type: Date, required: true },
  endTime: { type: Date, required: true },
  status: { type: String, enum: ['scheduled', 'live', 'ended', 'cancelled'], default: 'scheduled' },
  viewers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  viewCount: { type: Number, default: 0 },
  discount: { type: Number, default: 0 }, // Percentage discount during live event
  maxViewers: { type: Number, default: 100 },
  thumbnail: { type: String },
  streamUrl: { type: String },
}, {
  timestamps: true,
});

module.exports = mongoose.model('LiveEvent', liveEventSchema);