const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  participants: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  }],
  listing: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Listing',
    required: true,
  },
  messages: [{
    sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    text: { type: String, required: true },
    read: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
  }],
}, { timestamps: true });

messageSchema.index({ participants: 1, updatedAt: -1 });
messageSchema.index({ 'messages.read': 1 });
messageSchema.index({ listing: 1 });

module.exports = mongoose.model('Message', messageSchema);