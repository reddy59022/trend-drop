const mongoose = require('mongoose');

const translationSchema = new mongoose.Schema({
  language: { type: String, required: true, lowercase: true, maxlength: 10 },
  content: { type: mongoose.Schema.Types.Mixed, required: true },
  checksum: { type: String, required: true },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  updatedAt: { type: Date, default: null },
}, { _id: false });

const policyDocumentSchema = new mongoose.Schema({
  type: { type: String, required: true, enum: ['terms', 'privacy', 'cookies', 'buyer', 'seller', 'prohibited'] },
  version: { type: String, required: true },
  content: { type: mongoose.Schema.Types.Mixed, required: true },
  checksum: { type: String, required: true },
  translations: { type: [translationSchema], default: [] },
}, { _id: false });

const signoffSchema = new mongoose.Schema({
  language: { type: String, required: true, lowercase: true, maxlength: 10 },
  reviewer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  reviewerRole: { type: String, required: true },
  attestation: { type: String, required: true, minlength: 30, maxlength: 4000 },
  signedAt: { type: Date, default: Date.now, required: true },
}, { _id: false });

const jurisdictionPolicyPackSchema = new mongoose.Schema({
  country: { type: String, required: true, uppercase: true, minlength: 2, maxlength: 2, index: true },
  version: { type: String, required: true },
  status: { type: String, required: true, enum: ['draft', 'submitted', 'rejected', 'approved', 'publishing', 'published', 'superseded', 'rolled_back'], default: 'draft', index: true },
  language: { type: String, required: true, default: 'en', maxlength: 10 },
  requiredLanguages: { type: [String], required: true, default: ['en'] },
  signoffs: { type: [signoffSchema], default: [] },
  changeSummary: { type: String, required: true, maxlength: 2000 },
  documents: { type: [policyDocumentSchema], required: true, validate: (docs) => docs.length > 0 },
  governingLaw: { type: String, default: null, maxlength: 500 },
  disputeResolution: { type: String, default: null, maxlength: 2000 },
  mandatoryRightsSummary: { type: String, required: true, maxlength: 5000 },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  submittedAt: { type: Date, default: null },
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  approvedAt: { type: Date, default: null },
  publishedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  publishedAt: { type: Date, default: null },
  rejectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  rejectionReason: { type: String, default: null, maxlength: 2000 },
  supersedes: { type: mongoose.Schema.Types.ObjectId, ref: 'JurisdictionPolicyPack', default: null },
  rollbackOf: { type: mongoose.Schema.Types.ObjectId, ref: 'JurisdictionPolicyPack', default: null },
}, { timestamps: true });

jurisdictionPolicyPackSchema.index({ country: 1, version: 1 }, { unique: true });
jurisdictionPolicyPackSchema.index({ country: 1, status: 1, publishedAt: -1 });

module.exports = mongoose.model('JurisdictionPolicyPack', jurisdictionPolicyPackSchema);
