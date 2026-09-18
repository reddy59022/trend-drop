const express = require('express');
const crypto = require('crypto');
const mongoose = require('mongoose');
const router = express.Router();
const { auth } = require('../middleware/auth');
const { legalCounselAuth } = require('../middleware/legalCounsel');
const JurisdictionPolicyPack = require('../models/JurisdictionPolicyPack');
const LegalPolicyEvent = require('../models/LegalPolicyEvent');
const { getCountryPolicy, getPublicDocuments, ENTITY } = require('../config/legal');
const { POLICY_PACK_TARGET_CODES } = require('../config/marketplace');
const { getRequiredLanguages, requiresThreePersonApproval } = require('../config/jurisdictions');

router.use(auth, legalCounselAuth);

const normalizeCountry = (value) => typeof value === 'string' && /^[A-Za-z]{2}$/.test(value.trim()) ? value.trim().toUpperCase() : null;
const normalizeLanguage = (value) => typeof value === 'string' && /^[A-Za-z]{2,10}(?:-[A-Za-z]{2,8})?$/.test(value.trim()) ? value.trim().toLowerCase() : null;
const checksum = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const requiredTypes = ['terms', 'privacy', 'cookies', 'buyer', 'seller', 'prohibited'];
const validatePack = (body) => {
  const country = normalizeCountry(body.country);
  if (!country) return 'country must be a two-letter ISO code';
  if (typeof body.version !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(body.version)) return 'version is invalid';
  if (typeof body.changeSummary !== 'string' || !body.changeSummary.trim()) return 'changeSummary is required';
  if (typeof body.mandatoryRightsSummary !== 'string' || !body.mandatoryRightsSummary.trim()) return 'mandatoryRightsSummary is required';
  if (!Array.isArray(body.documents)) return 'documents must be an array';
  const types = body.documents.map((doc) => doc && doc.type);
  if (requiredTypes.some((type) => !types.includes(type))) return `documents must include: ${requiredTypes.join(', ')}`;
  if (new Set(types).size !== types.length) return 'document types must be unique';
  if (body.documents.some((doc) => !doc || typeof doc.type !== 'string' || typeof doc.content !== 'object' || doc.content === null)) return 'each document requires structured content';
  return null;
};
const addEvent = (pack, action, actor, reason = '', metadata = {}) => LegalPolicyEvent.create({ pack: pack._id, country: pack.country, version: pack.version, action, actor: actor._id, reason, metadata });

router.get('/readiness', async (req, res) => {
  const entityReady = [ENTITY.name, ENTITY.address, ENTITY.jurisdiction, ENTITY.contact].every((value) => value && !value.includes('[') && !value.endsWith('.invalid'));
  const results = [];
  for (const country of POLICY_PACK_TARGET_CODES) {
    const requiredLanguages = getRequiredLanguages(country);
    const pack = await JurisdictionPolicyPack.findOne({ country, status: { $in: ['draft', 'submitted', 'approved', 'published', 'superseded', 'rolled_back'] } }).sort({ createdAt: -1 }).lean();
    const documentTypes = new Set((pack?.documents || []).map((doc) => doc.type));
    const missingDocuments = requiredTypes.filter((type) => !documentTypes.has(type));
    const missingTranslations = [];
    const translationAuthors = new Set();
    (pack?.documents || []).forEach((doc) => requiredLanguages.forEach((language) => {
      const translation = (doc.translations || []).find((item) => item.language === language);
      if (!translation || !translation.updatedBy) missingTranslations.push(`${doc.type}:${language}`);
      if (translation?.updatedBy) translationAuthors.add(String(translation.updatedBy));
    }));
    const signoffReviewers = new Set((pack?.signoffs || []).map((signoff) => String(signoff.reviewer)));
    const missingSignoffs = requiredLanguages.filter((language) => !(pack?.signoffs || []).some((signoff) => signoff.language === language));
    const reviewerIsAuthor = (pack?.signoffs || []).some((signoff) => (pack?.documents || []).some((doc) => (doc.translations || []).some((translation) => translation.language === signoff.language && String(translation.updatedBy) === String(signoff.reviewer))));
    const approverIsAuthorOrReviewer = Boolean(pack?.approvedBy && (translationAuthors.has(String(pack.approvedBy)) || signoffReviewers.has(String(pack.approvedBy))));
    results.push({ country, requiredLanguages, pack: pack ? { id: pack._id, version: pack.version, status: pack.status } : null, missingDocuments, missingTranslations, missingSignoffs, reviewerIsAuthor, approverIsAuthorOrReviewer, entityReady, readyForActivation: entityReady && Boolean(pack && pack.status === 'published') && missingDocuments.length === 0 && missingTranslations.length === 0 && missingSignoffs.length === 0 && !reviewerIsAuthor && !approverIsAuthorOrReviewer });
  }
  res.json({ entityReady, countries: results, allReady: results.every((result) => result.readyForActivation), activationAllowed: false, activationMessage: 'Human legal approval is required; this endpoint never publishes or activates a pack.' });
});

router.get('/policy-targets', async (req, res) => {
  const packs = await JurisdictionPolicyPack.find({ country: { $in: POLICY_PACK_TARGET_CODES } }).select('country version status').sort({ country: 1, createdAt: -1 }).lean();
  const latest = new Map();
  packs.forEach((pack) => { if (!latest.has(pack.country)) latest.set(pack.country, pack); });
  res.json({ targets: POLICY_PACK_TARGET_CODES.map((country) => ({ country, current: latest.get(country) || null, policy: getCountryPolicy(country) })) });
});

// Create reviewable baseline drafts for the exact initial rollout boundary.
// These are deliberately drafts: they contain platform baseline text and may
// not be published until counsel replaces/reviews every country-specific rule.
router.post('/policy-packs/bootstrap-targets', async (req, res) => {
  const version = typeof req.body?.version === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(req.body.version) ? req.body.version : 'baseline-2026.1';
  const baseline = getPublicDocuments();
  const created = [];
  const skipped = [];
  for (const country of POLICY_PACK_TARGET_CODES) {
    if (await JurisdictionPolicyPack.exists({ country, version })) { skipped.push(country); continue; }
    const pack = await JurisdictionPolicyPack.create({
      country, version, status: 'draft', language: getRequiredLanguages(country)[0], requiredLanguages: getRequiredLanguages(country),
      changeSummary: `Initial baseline draft for ${country}; mandatory local review required.`,
      mandatoryRightsSummary: 'COUNSEL REVIEW REQUIRED: replace with verified mandatory local rights before publication.',
      governingLaw: null, disputeResolution: null,
      documents: baseline.map((doc) => ({ type: doc.type, version, content: { title: doc.title, summary: doc.summary, sections: doc.sections, counselReviewRequired: true }, checksum: checksum({ title: doc.title, summary: doc.summary, sections: doc.sections }), translations: getRequiredLanguages(country).map((language) => ({ language, content: { title: doc.title, summary: doc.summary, sections: doc.sections, counselReviewRequired: true, translationReviewRequired: true }, checksum: checksum({ language, title: doc.title, summary: doc.summary, sections: doc.sections }), updatedBy: req.user._id, updatedAt: new Date() })) })),
      createdBy: req.user._id,
    });
    await addEvent(pack, 'created', req.user, 'Bootstrap baseline draft; not approved for publication');
    created.push(pack);
  }
  res.status(201).json({ created, skipped, targetCountries: POLICY_PACK_TARGET_CODES });
});

router.get('/policy-packs', async (req, res) => {
  const country = req.query.country ? normalizeCountry(req.query.country) : null;
  const status = typeof req.query.status === 'string' ? req.query.status : null;
  const query = {};
  if (country) query.country = country;
  if (status) query.status = status;
  const packs = await JurisdictionPolicyPack.find(query).sort({ country: 1, createdAt: -1 }).populate('createdBy approvedBy publishedBy signoffs.reviewer documents.translations.updatedBy', 'name email role');
  res.json({ packs });
});

router.get('/policy-packs/:id/events', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid policy pack ID' });
  const events = await LegalPolicyEvent.find({ pack: req.params.id }).sort({ createdAt: 1 }).populate('actor', 'name email role');
  res.json({ events });
});

router.post('/policy-packs', async (req, res) => {
  const error = validatePack(req.body || {});
  if (error) return res.status(400).json({ message: error });
  try {
    const country = normalizeCountry(req.body.country);
    const pack = await JurisdictionPolicyPack.create({
      country,
      version: req.body.version,
      language: normalizeLanguage(req.body.language) || getRequiredLanguages(country)[0],
      requiredLanguages: getRequiredLanguages(country),
      changeSummary: req.body.changeSummary.trim(),
      mandatoryRightsSummary: req.body.mandatoryRightsSummary.trim(),
      governingLaw: req.body.governingLaw || null,
      disputeResolution: req.body.disputeResolution || null,
      documents: req.body.documents.map((doc) => ({ type: doc.type, version: doc.version || req.body.version, content: doc.content, checksum: checksum(doc.content), translations: Array.isArray(doc.translations) ? doc.translations.filter((translation) => normalizeLanguage(translation.language)).map((translation) => ({ language: normalizeLanguage(translation.language), content: translation.content, checksum: checksum(translation.content), updatedBy: req.user._id, updatedAt: new Date() })) : [] })),
      createdBy: req.user._id,
    });
    await addEvent(pack, 'created', req.user);
    res.status(201).json({ pack });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ message: 'That country and version already exists' });
    console.error('Create legal policy pack error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

router.put('/policy-packs/:id/translations', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid policy pack ID' });
  if (!Array.isArray(req.body?.documents)) return res.status(400).json({ message: 'documents must be an array' });
  const pack = await JurisdictionPolicyPack.findOne({ _id: req.params.id, status: { $in: ['draft', 'rejected'] } });
  if (!pack) return res.status(409).json({ message: 'Only draft or rejected packs can be edited' });
  const byType = new Map(req.body.documents.map((doc) => [doc.type, doc]));
  const missing = pack.documents.map((doc) => doc.type).filter((type) => !byType.has(type));
  if (missing.length) return res.status(400).json({ message: `Missing translations for documents: ${missing.join(', ')}` });
  for (const doc of pack.documents) {
    const input = byType.get(doc.type);
    if (!Array.isArray(input.translations)) return res.status(400).json({ message: `Translations are required for ${doc.type}` });
    const translations = input.translations.map((translation) => ({ language: normalizeLanguage(translation.language), content: translation.content, checksum: checksum(translation.content), updatedBy: req.user._id, updatedAt: new Date() }));
    if (translations.some((translation) => !translation.language || !translation.content || typeof translation.content !== 'object')) return res.status(400).json({ message: `Invalid translation for ${doc.type}` });
    doc.translations = translations;
  }
  pack.markModified('documents');
  await pack.save();
  await addEvent(pack, 'translation_updated', req.user, 'Localized translations updated');
  res.json({ pack });
});

router.post('/policy-packs/:id/signoffs', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid policy pack ID' });
  const language = normalizeLanguage(req.body?.language);
  const pack = await JurisdictionPolicyPack.findOne({ _id: req.params.id, status: 'submitted' });
  if (!pack) return res.status(409).json({ message: 'Only submitted packs can receive counsel sign-offs' });
  if (!language || !pack.requiredLanguages.includes(language)) return res.status(400).json({ message: 'Language is not required for this jurisdiction' });
  const translationsForLanguage = pack.documents.flatMap((doc) => (doc.translations || []).filter((translation) => translation.language === language));
  if (translationsForLanguage.length !== pack.documents.length || translationsForLanguage.some((translation) => !translation.updatedBy)) return res.status(409).json({ message: 'Every document must have an authored translation before language sign-off', code: 'TRANSLATION_AUTHOR_REQUIRED' });
  if (translationsForLanguage.some((translation) => String(translation.updatedBy) === String(req.user._id))) return res.status(409).json({ message: 'The translation author cannot sign off the same language', code: 'INDEPENDENT_REVIEW_REQUIRED' });
  if (typeof req.body.attestation !== 'string' || req.body.attestation.trim().length < 30) return res.status(400).json({ message: 'A detailed counsel attestation of at least 30 characters is required' });
  pack.signoffs = (pack.signoffs || []).filter((signoff) => signoff.language !== language);
  pack.signoffs.push({ language, reviewer: req.user._id, reviewerRole: req.user.role, attestation: req.body.attestation.trim(), signedAt: new Date() });
  await pack.save();
  await addEvent(pack, 'signed_off', req.user, `Counsel sign-off recorded for ${language}`);
  res.json({ pack });
});

router.post('/policy-packs/:id/submit', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid policy pack ID' });
  const pack = await JurisdictionPolicyPack.findOneAndUpdate({ _id: req.params.id, status: 'draft' }, { $set: { status: 'submitted', submittedBy: req.user._id, submittedAt: new Date() } }, { new: true });
  if (!pack) return res.status(409).json({ message: 'Only draft policy packs can be submitted' });
  await addEvent(pack, 'submitted', req.user);
  res.json({ pack });
});

router.post('/policy-packs/:id/reject', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid policy pack ID' });
  if (typeof req.body.reason !== 'string' || !req.body.reason.trim()) return res.status(400).json({ message: 'A rejection reason is required' });
  const pack = await JurisdictionPolicyPack.findOneAndUpdate({ _id: req.params.id, status: 'submitted' }, { $set: { status: 'rejected', rejectedBy: req.user._id, rejectionReason: req.body.reason.trim() } }, { new: true });
  if (!pack) return res.status(409).json({ message: 'Only submitted policy packs can be rejected' });
  await addEvent(pack, 'rejected', req.user, req.body.reason.trim());
  res.json({ pack });
});

router.post('/policy-packs/:id/approve', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid policy pack ID' });
  const candidate = await JurisdictionPolicyPack.findOne({ _id: req.params.id, status: 'submitted' });
  if (!candidate) return res.status(409).json({ message: 'Only submitted policy packs can be approved' });
  const signedLanguages = new Set((candidate.signoffs || []).map((signoff) => signoff.language));
  const missingSignoffs = candidate.requiredLanguages.filter((language) => !signedLanguages.has(language));
  const translationAuthors = candidate.documents.flatMap((doc) => (doc.translations || []).map((translation) => translation.updatedBy).filter(Boolean).map(String));
  if (candidate.documents.some((doc) => candidate.requiredLanguages.some((language) => !(doc.translations || []).some((translation) => translation.language === language && translation.updatedBy)))) return res.status(409).json({ message: 'Every required translation must have an author before approval', code: 'TRANSLATION_AUTHOR_REQUIRED' });
  if (translationAuthors.includes(String(req.user._id))) return res.status(409).json({ message: 'The translation author cannot be the approval authority', code: 'INDEPENDENT_APPROVAL_REQUIRED' });
  if (requiresThreePersonApproval(candidate.country)) {
    const signoffReviewers = new Set((candidate.signoffs || []).map((signoff) => String(signoff.reviewer)));
    if (signoffReviewers.has(String(req.user._id))) return res.status(409).json({ message: 'This high-risk jurisdiction requires a third independent approval authority', code: 'THREE_PERSON_APPROVAL_REQUIRED' });
  }
  const missingTranslations = candidate.documents.filter((doc) => candidate.requiredLanguages.some((language) => !(doc.translations || []).some((translation) => translation.language === language))).map((doc) => doc.type);
  if (missingSignoffs.length || missingTranslations.length) return res.status(409).json({ message: 'All required translations and counsel sign-offs are required before approval', missingSignoffs, missingTranslations });
  const pack = await JurisdictionPolicyPack.findOneAndUpdate({ _id: req.params.id, status: 'submitted' }, { $set: { status: 'approved', approvedBy: req.user._id, approvedAt: new Date(), rejectionReason: null } }, { new: true });
  await addEvent(pack, 'approved', req.user);
  res.json({ pack });
});

router.post('/policy-packs/:id/publish', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid policy pack ID' });
  const claimed = await JurisdictionPolicyPack.findOneAndUpdate({ _id: req.params.id, status: 'approved' }, { $set: { status: 'publishing' } }, { new: true });
  if (!claimed) return res.status(409).json({ message: 'Only approved policy packs can be published' });
  try {
    const current = await JurisdictionPolicyPack.findOneAndUpdate({ country: claimed.country, status: 'published' }, { $set: { status: 'superseded' } }, { new: true });
    claimed.status = 'published';
    claimed.publishedBy = req.user._id;
    claimed.publishedAt = new Date();
    claimed.supersedes = current?._id || null;
    await claimed.save();
    if (current) await addEvent(current, 'superseded', req.user, `Superseded by ${claimed.version}`, { replacement: String(claimed._id) });
    await addEvent(claimed, 'published', req.user, '', current ? { supersedes: String(current._id) } : {});
    res.json({ pack: claimed, superseded: current || null });
  } catch (error) {
    await JurisdictionPolicyPack.updateOne({ _id: claimed._id, status: 'publishing' }, { $set: { status: 'approved' } });
    console.error('Publish legal policy pack error:', error);
    res.status(500).json({ message: 'Policy pack was not published' });
  }
});

router.post('/policy-packs/:id/rollback', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid policy pack ID' });
  const source = await JurisdictionPolicyPack.findOne({ _id: req.params.id, status: { $in: ['superseded', 'published'] } });
  if (!source) return res.status(409).json({ message: 'Only a published or superseded version can be rolled back' });
  const version = typeof req.body.version === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(req.body.version) ? req.body.version : `rollback-${Date.now()}`;
  const current = await JurisdictionPolicyPack.findOne({ country: source.country, status: 'published' });
  if (current && String(current._id) === String(source._id)) return res.status(409).json({ message: 'Choose a superseded version to roll back to' });
  try {
    const pack = await JurisdictionPolicyPack.create({
      country: source.country, version, status: 'published', language: source.language,
      changeSummary: `Rollback to ${source.version}. ${String(req.body.reason || '').trim()}`.trim(),
      mandatoryRightsSummary: source.mandatoryRightsSummary, governingLaw: source.governingLaw,
      disputeResolution: source.disputeResolution, documents: source.documents, requiredLanguages: source.requiredLanguages, signoffs: source.signoffs,
      createdBy: req.user._id, approvedBy: req.user._id, approvedAt: new Date(), publishedBy: req.user._id,
      publishedAt: new Date(), supersedes: current?._id || null, rollbackOf: source._id,
    });
    if (current) {
      current.status = 'rolled_back';
      await current.save();
      await addEvent(current, 'superseded', req.user, `Rolled back to ${source.version}`, { rollback: String(pack._id) });
    }
    await addEvent(pack, 'rollback_created', req.user, req.body.reason || '', { source: String(source._id) });
    await addEvent(pack, 'published', req.user, 'Rollback published', { rollbackOf: String(source._id) });
    res.status(201).json({ pack, rolledBack: current || null });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ message: 'That rollback version already exists' });
    console.error('Rollback legal policy pack error:', error);
    res.status(500).json({ message: 'Policy rollback failed' });
  }
});

module.exports = router;
