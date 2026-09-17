const mongoose = require('mongoose');

const EVENT_TYPES = ['listing.created', 'listing.updated', 'order.created', 'order.updated', 'order.completed'];

const enterpriseWebhookSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
  url: { type: String, required: true, trim: true },
  events: [{ type: String, enum: EVENT_TYPES }],
  active: { type: Boolean, default: true },
}, { timestamps: true });

module.exports = mongoose.model('EnterpriseWebhook', enterpriseWebhookSchema);
module.exports.EVENT_TYPES = EVENT_TYPES;
