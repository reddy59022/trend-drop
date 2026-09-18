const mongoose = require('mongoose');

const legalAcceptanceSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  country: { type: String, required: true, uppercase: true, minlength: 2, maxlength: 2 },
  documents: [{
    type: { type: String, required: true },
    version: { type: String, required: true },
  }],
  purpose: { type: String, enum: ['account', 'checkout', 'seller_onboarding', 'reconsent'], required: true },
  acceptedAt: { type: Date, default: Date.now, required: true },
  ipHash: { type: String, default: '' },
  userAgent: { type: String, default: '' },
}, { timestamps: true });

legalAcceptanceSchema.index({ user: 1, 'documents.type': 1, 'documents.version': 1 });

module.exports = mongoose.model('LegalAcceptance', legalAcceptanceSchema);
