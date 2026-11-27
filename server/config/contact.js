// Public contact address for users, legal notices, and email replies.
// `CONTACT_EMAIL` is the preferred override; the legal-specific variable remains
// supported for deployments that already set it.
const CONTACT_EMAIL = process.env.CONTACT_EMAIL
  || process.env.LEGAL_CONTACT_EMAIL
  || 'connect.trenddrop@gmail.com';

module.exports = { CONTACT_EMAIL };
