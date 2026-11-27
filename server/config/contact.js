// Public contact address for users, legal notices, and email replies.
// This is intentionally one canonical address: stale dashboard values for the
// legacy LEGAL_CONTACT_EMAIL variable must not route users to an old inbox.
const CONTACT_EMAIL = process.env.CONTACT_EMAIL || 'connect.trenddrop@gmail.com';

module.exports = { CONTACT_EMAIL };
