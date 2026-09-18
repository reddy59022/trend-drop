// Official/local language review requirements for the initial rollout.
// Counsel may expand a country’s list where consumer law requires additional
// languages. Codes use BCP-47-style language tags where practical.
const OFFICIAL_LANGUAGES = {
  US: ['en'], AU: ['en'], CA: ['en', 'fr'], IN: ['en', 'hi'], JP: ['ja'],
  AD: ['ca', 'es', 'fr'], AL: ['sq'], AT: ['de'], BA: ['bs', 'hr', 'sr'],
  BE: ['nl', 'fr', 'de'], BG: ['bg'], BY: ['be', 'ru'], CH: ['de', 'fr', 'it', 'rm'],
  CY: ['el', 'tr'], CZ: ['cs'], DE: ['de'], DK: ['da'], EE: ['et'], ES: ['es'],
  FI: ['fi', 'sv'], FR: ['fr'], GB: ['en'], GR: ['el'], HR: ['hr'], HU: ['hu'],
  IE: ['en', 'ga'], IS: ['is'], IT: ['it'], LI: ['de'], LT: ['lt'], LU: ['lb', 'fr', 'de'],
  LV: ['lv'], MC: ['fr'], MD: ['ro'], ME: ['sr'], MK: ['mk'], MT: ['mt', 'en'],
  NL: ['nl'], NO: ['nb', 'nn'], PL: ['pl'], PT: ['pt'], RO: ['ro'], RS: ['sr'],
  RU: ['ru'], SE: ['sv'], SI: ['sl'], SK: ['sk'], SM: ['it'], TR: ['tr'],
  UA: ['uk'], VA: ['it', 'la'], XK: ['sq', 'sr'],
};

// The initial rollout is treated as high-risk until counsel explicitly lowers
// the control for a jurisdiction. This keeps author, reviewer, and approver
// independent across every launch country.
const STRICT_THREE_PERSON_COUNTRIES = new Set(Object.keys(OFFICIAL_LANGUAGES));
const getRequiredLanguages = (country) => OFFICIAL_LANGUAGES[String(country || '').toUpperCase()] || ['en'];
const requiresThreePersonApproval = (country) => STRICT_THREE_PERSON_COUNTRIES.has(String(country || '').toUpperCase());

module.exports = { OFFICIAL_LANGUAGES, STRICT_THREE_PERSON_COUNTRIES, getRequiredLanguages, requiresThreePersonApproval };
