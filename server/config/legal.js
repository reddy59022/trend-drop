// Legal policy registry. This is a product-enforcement layer, not legal advice.
// Replace every ENTITY_* placeholder and obtain local counsel approval before
// enabling a country in production.
const ENTITY = {
  name: process.env.LEGAL_ENTITY_NAME || '[LEGAL ENTITY NAME — COUNSEL MUST COMPLETE]',
  address: process.env.LEGAL_ENTITY_ADDRESS || '[REGISTERED BUSINESS ADDRESS]',
  jurisdiction: process.env.LEGAL_ENTITY_JURISDICTION || '[GOVERNING JURISDICTION]',
  contact: process.env.LEGAL_CONTACT_EMAIL || 'legal@example.invalid',
};

const CURRENT_VERSIONS = {
  terms: process.env.LEGAL_TERMS_VERSION || '2026-09-18.1',
  privacy: process.env.LEGAL_PRIVACY_VERSION || '2026-09-18.1',
  cookies: process.env.LEGAL_COOKIES_VERSION || '2026-09-18.1',
  buyer: process.env.LEGAL_BUYER_VERSION || '2026-09-18.1',
  seller: process.env.LEGAL_SELLER_VERSION || '2026-09-18.1',
  prohibited: process.env.LEGAL_PROHIBITED_VERSION || '2026-09-18.1',
};

const DOCUMENTS = {
  terms: {
    title: 'Terms of Service',
    summary: 'Rules for using the marketplace, accounts, transactions, content, disputes, and platform services.',
    sections: [
      ['Acceptance and eligibility', `You enter an agreement with ${ENTITY.name} when you use the service or create an account. You must be at least 18 to sell or create an account unless local law requires a different lawful arrangement. You must provide accurate information and keep credentials secure.`],
      ['Marketplace role', `${ENTITY.name} operates a marketplace and is not the owner, manufacturer, importer, carrier, insurer, or professional adviser for items offered by users unless expressly stated. Sellers remain responsible for lawful listings, fulfillment, taxes, authenticity, and consumer rights.`],
      ['Transactions and fees', 'Prices, taxes, shipping, currency conversion, payment-provider charges, platform fees, reserves, and payout timing are shown before confirmation when applicable. A transaction is not complete until the platform confirms it. We may correct manifest pricing or calculation errors and will notify affected parties where required by law.'],
      ['Prohibited conduct', 'No fraud, impersonation, manipulation, harassment, counterfeit or stolen goods, illegal goods, unsafe products, circumvention of fees or controls, scraping, malware, money laundering, sanctions evasion, or abuse of returns, referrals, reviews, disputes, or payment systems.'],
      ['Content and enforcement', 'You grant the platform the permissions needed to host, display, moderate, and promote your content to operate the service. We may remove content, restrict features, suspend accounts, hold funds, cancel transactions, or cooperate with authorities when reasonably necessary for safety, law, fraud prevention, or platform integrity.'],
      ['Disputes and mandatory rights', 'Contact support first. Nothing here removes non-waivable consumer, privacy, payment, or other rights. Where lawful, unresolved disputes may be handled under the governing-law and dispute process displayed for your country; otherwise the courts or authority required by local law apply.'],
      ['Liability and service changes', 'The service is provided subject to applicable law. We do not exclude liability that cannot lawfully be excluded. We may change, suspend, or discontinue features and will provide notice where required.'],
      ['Contact and notices', `Legal notices: ${ENTITY.contact}. Entity details: ${ENTITY.name}, ${ENTITY.address}.`],
    ],
  },
  privacy: {
    title: 'Privacy Notice',
    summary: 'How account, identity, transaction, device, location, fraud, and support data is used and protected.',
    sections: [
      ['Controller and contact', `${ENTITY.name} is the responsible entity for the applicable service and can be contacted at ${ENTITY.contact}. Local country supplements may identify a representative or additional controller.`],
      ['Data we process', 'Account and verification data; seller, buyer, listing, order, payment-token, shipping, communications, support, device, security, approximate location, preferences, and consent records. We do not store full payment-card numbers when the payment provider handles them.'],
      ['Purposes and sharing', 'We use data to provide the marketplace, process payments and payouts, prevent fraud, secure accounts, ship orders, provide support, measure performance, comply with law, and communicate service messages. We share only as needed with processors, payment, identity, hosting, analytics, logistics, safety, and legal partners under appropriate controls.'],
      ['International transfers and retention', 'The service is global. Data may be processed in countries other than yours using safeguards required by applicable law. We retain information only as long as needed for the stated purpose, disputes, fraud prevention, tax, accounting, safety, and legal obligations.'],
      ['Your choices', 'Depending on your country, you may request access, correction, deletion, portability, restriction, objection, withdrawal of optional consent, or complaint review. Some records must be retained and some features may stop working after deletion. Contact support or the legal contact above.'],
      ['Security and children', 'We use administrative, technical, and organizational safeguards but cannot promise absolute security. The service is not directed to children; do not create an account for someone who is not eligible under the applicable country policy.'],
    ],
  },
  cookies: {
    title: 'Cookie and Tracking Notice',
    summary: 'Essential storage, security, preference, measurement, and optional marketing technologies.',
    sections: [
      ['Essential technologies', 'Authentication, security, fraud prevention, accessibility, language, currency, cart, and consent storage may be necessary for the service.'],
      ['Optional technologies', 'Where required, analytics, personalization, advertising, and marketing technologies are enabled only after the applicable choice is recorded. You can change optional choices through the privacy settings control.'],
      ['Browser controls', 'Blocking essential storage can prevent login, checkout, or other functions. Provider names, durations, and country-specific choices should be completed in the deployed cookie inventory before launch.'],
    ],
  },
  buyer: {
    title: 'Buyer Rules and Returns',
    summary: 'Buyer checkout, inspection, delivery, returns, disputes, and prohibited abuse rules.',
    sections: [
      ['Before purchase', 'Review listing condition, measurements, authenticity statements, seller policy, delivery estimate, taxes, duties, insurance, and total price. Do not rely on assumptions not shown in the listing or checkout.'],
      ['After purchase', 'Provide accurate delivery information, cooperate with carriers, inspect promptly, and report non-delivery, damage, counterfeit concerns, or material misdescription through the platform within the displayed deadline.'],
      ['Returns and refunds', 'Returns and refunds follow the order, seller, platform, payment-provider, and mandatory local rules shown at checkout. Do not use, alter, substitute, or falsely report an item. Refund timing depends on provider settlement and required inspection.'],
      ['No abuse', 'Chargeback abuse, false claims, serial returns, review manipulation, account sharing, and payment circumvention may result in cancellation, withheld benefits, account action, and lawful recovery.'],
    ],
  },
  seller: {
    title: 'Seller Rules and Payouts',
    summary: 'Seller verification, listing accuracy, fulfillment, authenticity, fees, reserves, taxes, and payouts.',
    sections: [
      ['Seller responsibility', 'You must own or lawfully control the item, have authority to sell it, describe it accurately, disclose defects and provenance where relevant, and comply with product, consumer, tax, export, sanctions, and marketplace laws.'],
      ['Fulfillment', 'Ship the exact item securely and within the displayed timeframe, use valid tracking when required, and respond to buyer and platform requests. Do not sell the same inventory elsewhere after it is committed here.'],
      ['Fees and funds', 'Platform fees, payment fees, taxes, reserves, refunds, chargebacks, disputes, cancellations, and payout timing are calculated under the current checkout or seller schedule. Funds may remain pending or reserved until risk and return windows end.'],
      ['Verification and records', 'We may request identity, business, tax, bank, authenticity, or source-of-funds information. You authorize lawful verification and must keep it current.'],
      ['Seller indemnity', 'To the extent permitted by law, you are responsible for losses, claims, penalties, taxes, refunds, chargebacks, and costs caused by your listings, conduct, or breach.'],
    ],
  },
  prohibited: {
    title: 'Prohibited Items and Conduct',
    summary: 'A non-exhaustive safety list enforced together with applicable law and country restrictions.',
    sections: [
      ['Never list', 'Counterfeits, stolen goods, weapons, controlled substances, hazardous materials, recalled or unsafe products, live animals, human remains, sexual exploitation material, stolen data, forged documents, financial instruments, and goods whose sale or export is unlawful.'],
      ['No manipulation', 'No fake accounts, shill bidding, review or referral manipulation, fee avoidance, malware, scraping that harms the service, unauthorized automation, harassment, discrimination, doxxing, or evasion of an enforcement action.'],
      ['Report and cooperate', 'Report suspicious listings or behavior promptly. We may preserve evidence, remove content, suspend access, freeze or return funds, and report suspected crime or safety risks where lawful or required.'],
    ],
  },
};

// Until counsel approves a country pack, the platform can expose the baseline
// documents but must not claim that local legal review is complete.
const { POLICY_PACK_TARGET_CODES } = require('./marketplace');
const COUNTRY_POLICIES = Object.fromEntries(POLICY_PACK_TARGET_CODES.map((country) => [country, {
  status: 'baseline_pending_counsel', governingLaw: null, arbitration: 'pending_counsel',
}]));

const getCountryPolicy = (country) => COUNTRY_POLICIES[String(country || '').toUpperCase()] || { status: 'review_required', governingLaw: null, arbitration: 'pending_counsel' };
const getDocument = (type) => {
  const doc = DOCUMENTS[type];
  if (!doc) return null;
  return { type, version: CURRENT_VERSIONS[type], title: doc.title, summary: doc.summary, sections: doc.sections, entity: ENTITY };
};
const getPublicDocuments = () => Object.keys(DOCUMENTS).map(getDocument);
const requiredConsentTypes = ['terms', 'privacy'];

const assertProductionLegalConfig = () => {
  if (process.env.NODE_ENV !== 'production') return;
  const incomplete = [ENTITY.name, ENTITY.address, ENTITY.jurisdiction, ENTITY.contact]
    .some((value) => !value || value.includes('[') || value.endsWith('.invalid'));
  if (incomplete) {
    throw new Error('LEGAL_CONFIG_INCOMPLETE: complete legal entity environment variables before production startup');
  }
  // Country approval is database-backed. The request-time runtime gate fails
  // closed until a published pack exists, so startup does not need a stale
  // code-level allowlist and counsel can operate without deployments.
};

module.exports = { ENTITY, CURRENT_VERSIONS, DOCUMENTS, COUNTRY_POLICIES, getCountryPolicy, getDocument, getPublicDocuments, requiredConsentTypes, assertProductionLegalConfig };
