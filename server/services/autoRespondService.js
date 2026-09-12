/**
 * Feature 4 - Auto-respond / enterprise auto-offer shared helpers.
 *
 * Sellers set a LEAST price (minPrice, expressed in the listing currency).
 * When enabled:
 *   - buyer offers >= minPrice are AUTO-ACCEPTED
 *   - buyer offers <  minPrice are AUTO-COUNTERED to minPrice
 *   - (optional) likers automatically RECEIVE an accepted offer at minPrice
 */

const toBool = (v) => {
  if (typeof v === 'boolean') return v;
  if (v === 'true') return true;
  if (v === 'false') return false;
  return undefined;
};

function parseAutoRespondBody(body) {
  body = body || {};
  const keys = ['autoRespondEnabled','autoRespondMinPrice','autoRespondCurrency','autoRespondAutoOfferToLikers','autoRespondMessage'];
  const provided = keys.some((k) => body[k] !== undefined && body[k] !== '' && body[k] !== null);
  return {
    enabled: toBool(body.autoRespondEnabled),
    minPrice: (body.autoRespondMinPrice !== undefined && body.autoRespondMinPrice !== '') ? Number(body.autoRespondMinPrice) : undefined,
    currency: body.autoRespondCurrency || undefined,
    autoOfferToLikers: toBool(body.autoRespondAutoOfferToLikers),
    message: (typeof body.autoRespondMessage === 'string') ? body.autoRespondMessage : undefined,
    provided,
  };
}

function buildAutoRespondForCreate(parsed, opts) {
  opts = opts || {};
  const price = opts.price;
  const currency = opts.currency || 'USD';
  const enabled = parsed.enabled === true;
  if (!enabled) {
    return { autoRespond: { enabled: false, minPrice: 0, currency: currency, autoOfferToLikers: false, message: '' } };
  }
  if (parsed.minPrice === undefined || isNaN(parsed.minPrice) || parsed.minPrice <= 0) {
    return { error: 'autoRespond minPrice (least price) is required when auto-respond is enabled' };
  }
  const arCurrency = parsed.currency || currency;
  if (arCurrency !== currency) {
    return { error: 'autoRespond currency must match the listing currency' };
  }
  if (parsed.minPrice > Number(price)) {
    return { error: 'autoRespond least price cannot exceed the listing price' };
  }
  return { autoRespond: { enabled: true, minPrice: parsed.minPrice, currency: arCurrency, autoOfferToLikers: parsed.autoOfferToLikers === true, message: parsed.message || '' } };
}

function buildAutoRespondForUpdate(parsed, existing, opts) {
  opts = opts || {};
  const current = (existing && typeof existing.toObject === 'function') ? existing.toObject() : (existing || {});
  if (!parsed.provided) return { autoRespond: undefined };
  if (parsed.enabled === false) {
    return { autoRespond: { enabled: false, minPrice: current.minPrice || 0, currency: current.currency || opts.listingCurrency || 'USD', autoOfferToLikers: current.autoOfferToLikers || false, message: current.message || '' } };
  }
  const willBeEnabled = parsed.enabled === true ? true : !!current.enabled;
  if (!willBeEnabled) {
    return { autoRespond: { enabled: false, minPrice: (parsed.minPrice !== undefined ? parsed.minPrice : (current.minPrice || 0)), currency: parsed.currency || current.currency || opts.listingCurrency || 'USD', autoOfferToLikers: (parsed.autoOfferToLikers !== undefined ? parsed.autoOfferToLikers : !!current.autoOfferToLikers), message: (parsed.message !== undefined ? parsed.message : (current.message || '')) } };
  }
  const minPrice = parsed.minPrice !== undefined ? parsed.minPrice : current.minPrice;
  if (minPrice === undefined || minPrice === null || minPrice === '' || isNaN(Number(minPrice)) || Number(minPrice) <= 0) {
    return { error: 'autoRespond minPrice (least price) is required when auto-respond is enabled' };
  }
  const arCurrency = parsed.currency || current.currency || opts.listingCurrency || 'USD';
  if (arCurrency !== (opts.listingCurrency || 'USD')) {
    return { error: 'autoRespond currency must match the listing currency' };
  }
  if (Number(minPrice) > Number(opts.effectivePrice)) {
    return { error: 'autoRespond least price cannot exceed the listing price' };
  }
  return { autoRespond: { enabled: true, minPrice: Number(minPrice), currency: arCurrency, autoOfferToLikers: (parsed.autoOfferToLikers !== undefined ? parsed.autoOfferToLikers : !!current.autoOfferToLikers), message: (parsed.message !== undefined ? parsed.message : (current.message || '')) } };
}

async function applyAutoRespondToOffer(offer, listing) {
  const ar = listing && listing.autoRespond;
  if (!ar || ar.enabled !== true || !ar.minPrice || Number(ar.minPrice) <= 0) return 'none';
  const least = Number(ar.minPrice);
  if (Number(offer.amount) >= least) {
    offer.status = 'accepted';
    offer.acceptedPrice = Number(offer.amount);
    offer.acceptedAt = new Date();
    offer.acceptedBy = 'seller';
    offer.acceptedUntil = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await offer.save();
    return 'accepted';
  }
  offer.status = 'countered';
  offer.counterAmount = least;
  offer.lastCounterBy = 'seller';
  offer.expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  if (!Array.isArray(offer.counterHistory)) offer.counterHistory = [];
  offer.counterHistory.push({ amount: least, counteredBy: 'seller', message: (ar.message && String(ar.message)) || "Auto-counter at the seller least price" });
  await offer.save();
  return 'countered';
}

module.exports = { toBool, parseAutoRespondBody, buildAutoRespondForCreate, buildAutoRespondForUpdate, applyAutoRespondToOffer };
