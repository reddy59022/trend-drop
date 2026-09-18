const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { auth } = require('../middleware/auth');
const User = require('../models/User');
const LegalAcceptance = require('../models/LegalAcceptance');
const JurisdictionPolicyPack = require('../models/JurisdictionPolicyPack');
const { getDocument, getPublicDocuments, getCountryPolicy, CURRENT_VERSIONS, requiredConsentTypes } = require('../config/legal');
const { getRequiredLanguages } = require('../config/jurisdictions');

router.get('/documents', async (req, res) => {
  const country = String(req.query.country || '').toUpperCase() || null;
  const language = String(req.query.language || '').toLowerCase() || getRequiredLanguages(country)[0];
  const pack = country ? await JurisdictionPolicyPack.findOne({ country, status: 'published' }).lean() : null;
  const baseline = getCountryPolicy(country);
  const countryPolicy = pack ? { status: 'approved', governingLaw: pack.governingLaw, arbitration: pack.disputeResolution, version: pack.version, language, requiredLanguages: pack.requiredLanguages, mandatoryRightsSummary: pack.mandatoryRightsSummary } : baseline;
  res.json({ documents: pack ? pack.documents.map((doc) => { const translation = doc.translations?.find((item) => item.language === language); return { type: doc.type, version: doc.version, title: doc.type, language, localized: Boolean(translation), content: translation?.content || doc.content }; }) : getPublicDocuments(), versions: pack ? Object.fromEntries(pack.documents.map((doc) => [doc.type, doc.version])) : CURRENT_VERSIONS, country, language, countryPolicy });
});

router.get('/documents/:type', async (req, res) => {
  const country = String(req.query.country || '').toUpperCase() || null;
  const language = String(req.query.language || '').toLowerCase() || getRequiredLanguages(country)[0];
  const pack = country ? await JurisdictionPolicyPack.findOne({ country, status: 'published' }).lean() : null;
  const override = pack?.documents?.find((doc) => doc.type === req.params.type);
  if (override) {
    const translation = override.translations?.find((item) => item.language === language);
    return res.json({ document: { type: override.type, version: override.version, title: override.type, language, localized: Boolean(translation), content: translation?.content || override.content, entity: require('../config/legal').ENTITY }, countryPolicy: { status: 'approved', version: pack.version, language, requiredLanguages: pack.requiredLanguages, governingLaw: pack.governingLaw, arbitration: pack.disputeResolution } });
  }
  const document = getDocument(req.params.type);
  if (!document) return res.status(404).json({ message: 'Legal document not found' });
  res.json({ document, countryPolicy: getCountryPolicy(country) });
});

router.get('/consent-status', auth, async (req, res) => {
  const user = await User.findById(req.user._id).select('country legalConsent ageConfirmed');
  if (!user) return res.status(404).json({ message: 'User not found' });
  const consent = user.legalConsent || {};
  const current = {
    terms: consent.termsVersion === CURRENT_VERSIONS.terms,
    privacy: consent.privacyVersion === CURRENT_VERSIONS.privacy,
  };
  res.json({ current, requiredConsentTypes, needsReconsent: !current.terms || !current.privacy || user.ageConfirmed !== true, versions: CURRENT_VERSIONS, countryPolicy: getCountryPolicy(user.country) });
});

router.post('/accept', auth, async (req, res) => {
  const { termsVersion, privacyVersion, buyerVersion, sellerVersion, ageConfirmed } = req.body || {};
  if (termsVersion !== CURRENT_VERSIONS.terms || privacyVersion !== CURRENT_VERSIONS.privacy || ageConfirmed !== true) {
    return res.status(400).json({ message: 'Current Terms and Privacy versions plus age confirmation are required.', code: 'LEGAL_CONSENT_REQUIRED', versions: CURRENT_VERSIONS });
  }
  const user = await User.findById(req.user._id);
  if (!user) return res.status(404).json({ message: 'User not found' });
  const acceptedAt = new Date();
  user.legalConsent = { termsVersion, privacyVersion, buyerVersion: buyerVersion || null, sellerVersion: sellerVersion || null, acceptedAt, country: user.country };
  user.ageConfirmed = true;
  await user.save();
  await LegalAcceptance.create({
    user: user._id,
    country: user.country || 'US',
    documents: [
      { type: 'terms', version: termsVersion },
      { type: 'privacy', version: privacyVersion },
      ...(buyerVersion ? [{ type: 'buyer', version: buyerVersion }] : []),
      ...(sellerVersion ? [{ type: 'seller', version: sellerVersion }] : []),
    ],
    purpose: 'reconsent',
    acceptedAt,
    ipHash: crypto.createHash('sha256').update(String(req.ip || '')).digest('hex'),
    userAgent: String(req.get('user-agent') || '').slice(0, 500),
  });
  res.json({ accepted: true, versions: CURRENT_VERSIONS, acceptedAt });
});

module.exports = router;
