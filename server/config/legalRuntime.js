const mongoose = require('mongoose');
const JurisdictionPolicyPack = require('../models/JurisdictionPolicyPack');
const { isCountrySupported } = require('./marketplace');

const isCountryPolicyPublished = async (country) => {
  const code = String(country || '').toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return false;
  if (process.env.NODE_ENV === 'test') return isCountrySupported(code);
  // Explicit legacy bypass still respects the code-level launch market list.
  if (process.env.LEGAL_ENFORCEMENT === 'false') return isCountrySupported(code);
  // A production instance with no database cannot safely claim a country is
  // legally enabled. Fail closed instead of serving an unreviewed market.
  if (mongoose.connection.readyState !== 1) return false;
  return Boolean(await JurisdictionPolicyPack.exists({ country: code, status: 'published' }));
};

module.exports = { isCountryPolicyPublished };
