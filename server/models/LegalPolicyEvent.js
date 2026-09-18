const mongoose = require('mongoose');

const legalPolicyEventSchema = new mongoose.Schema({
  pack: { type: mongoose.Schema.Types.ObjectId, ref: 'JurisdictionPolicyPack', required: true, index: true },
  country: { type: String, required: true, uppercase: true, minlength: 2, maxlength: 2 },
  version: { type: String, required: true },
  action: { type: String, required: true, enum: ['created', 'translation_updated', 'signed_off', 'submitted', 'rejected', 'approved', 'published', 'superseded', 'rollback_created'] },
  actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  reason: { type: String, default: '', maxlength: 2000 },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true });

legalPolicyEventSchema.index({ country: 1, createdAt: -1 });
legalPolicyEventSchema.index({ pack: 1, createdAt: 1 });

module.exports = mongoose.model('LegalPolicyEvent', legalPolicyEventSchema);
