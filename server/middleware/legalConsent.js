const { optionalAuth } = require('./auth');
const User = require('../models/User');
const { CURRENT_VERSIONS } = require('../config/legal');

const exempt = (path) => path.startsWith('/auth') || path.startsWith('/legal') || path.startsWith('/marketplace') || path.startsWith('/config') || path === '/health';

const requireCurrentLegal = async (req, res, next) => {
  if (process.env.NODE_ENV === 'test' || process.env.LEGAL_ENFORCEMENT === 'false' || exempt(req.path)) return next();
  return optionalAuth(req, res, async () => {
    if (!req.user) return next();
    const user = await User.findById(req.user._id).select('legalConsent ageConfirmed');
    const consent = user?.legalConsent || {};
    if (!user || consent.termsVersion !== CURRENT_VERSIONS.terms || consent.privacyVersion !== CURRENT_VERSIONS.privacy || user.ageConfirmed !== true) {
      return res.status(428).json({ message: 'Updated legal documents must be accepted before continuing.', code: 'LEGAL_RECONSENT_REQUIRED', versions: CURRENT_VERSIONS });
    }
    return next();
  });
};

module.exports = { requireCurrentLegal };
