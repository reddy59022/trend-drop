/* TDD Round 20 — SYSTEMATIC SURFACE SWEEP (file-level audit).
 *
 * Goal: no endpoint anywhere under /api may answer 500 to hostile-but-
 * well-formed input (ghost ObjectIds, invalid enums, missing fields,
 * wrong-type scalars). A 400/401/403/404/409/422 is a correct rejection;
 * a 500 means an unhandled crash — a bug.
 *
 * Earlier rounds fixed individual routes their own tests touched. This
 * suite walks the ENTIRE route surface instead of a hand-picked subset:
 *
 *   R20.1 sweep        — every probe must be < 500
 *   R20.2 hostile body — wrong types / invalid enums / missing fields
 */
const mongoose = require('mongoose');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../server');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Promo = require('../models/Promo');
const CrossBorder = require('../models/CrossBorder');

const SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';
const RUN = `r20_${Date.now()}`;
const GHOST = () => new mongoose.Types.ObjectId().toString();
const U = [];
const L = [];

let me;
let myToken;
let stranger;
let strangerToken;
let listing;

const US = { fullName: 'R20', street1: '1 St', city: 'C', state: 'S', postalCode: '0', country: 'US' };

const mkUser = async (label) => {
  const u = await User.create({
    name: `R20 ${label}`, email: `${RUN}_${label}@test.com`, password: 'password123',
    emailVerified: true, authProvider: 'email', country: 'US', currency: 'USD',
    shippingAddress: { ...US },
    balance: { available: 0, pending: 0, totalEarned: 0, totalPaidOut: 0, currency: 'USD' },
  });
  U.push(u._id);
  return u;
};

beforeAll(async () => {
  if (mongoose.connection.readyState !== 1) await mongoose.connect(process.env.MONGO_URI);
  me = await mkUser('me');
  stranger = await mkUser('stranger');
  myToken = jwt.sign({ id: me._id }, SECRET, { expiresIn: '30d' });
  strangerToken = jwt.sign({ id: stranger._id }, SECRET, { expiresIn: '30d' });
  listing = await Listing.create({
    seller: me._id, title: 'R20 Item', description: 'd', price: 50,
    category: 'Men', condition: 'New with tags', quantity: 5,
    available: true, sold: false, status: 'active', shipsFrom: 'US',
    currency: 'USD', weight: 0.5,
  });
  L.push(listing._id);
});

afterAll(async () => {
  await CrossBorder.deleteMany({ seller: { $in: U } });
  await Promo.deleteMany({ seller: { $in: U } });
  await Listing.deleteMany({ _id: { $in: L } });
  await User.deleteMany({ _id: { $in: U } });
});

const call = (method, url, { body, token } = {}) => {
  const r = request(app)[method](url);
  if (token) r.set('Authorization', `Bearer ${token}`);
  if (body !== undefined && body !== null) r.send(body);
  return r;
};

// Placeholders: GHOST -> fresh ghost ObjectId, GHOST2 -> another one,
// LISTING -> the seeded real listing id, GHOSTCATEGORY/GHOSTCODE -> ghost text.
const resolve = (url) => String(url)
  .replace(/LISTING/g, listing ? listing._id.toString() : '')
  .replace(/GHOST2/g, GHOST())
  .replace(/GHOSTCATEGORY/g, GHOST())
  .replace(/GHOSTCODE/g, GHOST())
  .replace(/GHOST/g, GHOST());

// ---------------------------------------------------------------------------
// R20.1 probe tables — ghost ids in path params and body fields.
// `null` body means "send no body at all".
// ---------------------------------------------------------------------------
const SWEEP1 = [
  // --- profiles / social -------------------------------------------------
  ['get', '/api/users/GHOST', null],
  ['get', '/api/users/GHOST/listings', null],
  ['get', '/api/users/GHOST/closet', null],
  ['get', '/api/users/GHOST/followers', null],
  ['get', '/api/users/GHOST/following', null],
  ['post', '/api/users/GHOST/follow', null],
  ['get', '/api/users/GHOST/notifications', null],
  ['put', '/api/users/GHOST/notifications/read', null],

  // --- listings ----------------------------------------------------------
  ['get', '/api/listings/GHOST', null],
  ['get', '/api/listings/user/GHOST', null],
  ['put', '/api/listings/GHOST', { title: 'x' }],
  ['delete', '/api/listings/GHOST', null],
  ['post', '/api/listings/GHOST/like', null],
  ['post', '/api/listings/GHOST/comment', { text: 'hi' }],
  ['delete', '/api/listings/GHOST/comments/GHOST2', null],
  ['post', '/api/listings/GHOST/share', {}],
  ['patch', '/api/listings/GHOST/sold', {}],
  ['post', '/api/listings/GHOST/relist', {}],
  ['post', '/api/listings/GHOST/boost', { tier: 'standard' }],
  ['post', '/api/listings/GHOST/deactivate-boost', {}],

  // --- offers ------------------------------------------------------------
  ['get', '/api/offers/GHOST', null],
  ['get', '/api/offers/listing/GHOST/buyer', null],
  ['get', '/api/offers/bulk/GHOST', null],
  ['patch', '/api/offers/GHOST/accept', null],
  ['patch', '/api/offers/GHOST/decline', null],
  ['patch', '/api/offers/GHOST/counter', { amount: 10 }],
  ['patch', '/api/offers/GHOST/buyer-counter', { amount: 10 }],
  ['patch', '/api/offers/GHOST/accept-counter', null],
  ['patch', '/api/offers/GHOST/seller-accept', null],
  ['patch', '/api/offers/GHOST/seller-accept-buyer-counter', null],
  ['patch', '/api/offers/GHOST/complete', null],
  ['post', '/api/offers/to-likers', { listingId: GHOST() }],
  ['post', '/api/offers/to-likers/GHOST/claim', null],
  ['put', '/api/offers/bundle/GHOST', { price: 10 }],
  ['delete', '/api/offers/bundle/GHOST', null],
  ['post', '/api/offers/bundle/apply', { bundleId: GHOST() }],
];

describe('R20.1a profiles + listings + offers never 500', () => {
  test.each(SWEEP1.map((c) => [c[0], c[1], c[2]]))(
    '%s %s -> status < 500',
    async (method, url, body) => {
      const res = await call(method, resolve(url), { body, token: myToken });
      expect(res.status).toBeLessThan(500);
    }
  );
});
const SWEEP2 = [
  // --- transactions / orders --------------------------------------------
  ['get', '/api/transactions/GHOST', null],
  ['post', '/api/transactions/offer/GHOST', {}],
  ['get', '/api/orders/GHOST', null],
  ['get', '/api/orders/GHOST/status', null],
  ['get', '/api/orders/GHOST/lifecycle', null],
  ['post', '/api/orders/GHOST/ship', { trackingNumber: '1Z' }],
  ['post', '/api/orders/GHOST/cancel', {}],
  ['post', '/api/orders/GHOST/confirm-received', {}],
  ['post', '/api/orders/GHOST/auto-complete', {}],
  ['post', '/api/orders/GHOST/request-return', { reason: 'x' }],
  ['post', '/api/orders/GHOST/accept-return', {}],
  ['post', '/api/orders/GHOST/return-shipped', {}],
  ['post', '/api/orders/GHOST/reject-return', {}],
  ['post', '/api/orders/GHOST/confirm-return-received', {}],
  ['post', '/api/orders/GHOST/process-return', {}],
  ['post', '/api/orders/GHOST/dispute', { reason: 'x' }],
  ['post', '/api/orders/GHOST/resolve-dispute', { resolution: 'buyer' }],

  // --- payment-adjacent --------------------------------------------------
  ['post', '/api/payments/breakdown', { listingId: GHOST() }],
  ['post', '/api/payments/cancel-payment', { paymentIntentId: 'pi_garbage' }],
  ['post', '/api/shipping/label/GHOST', {}],
  ['post', '/api/shipping/void/GHOST', {}],
  ['get', '/api/shipping/label/GHOST', null],
  ['get', '/api/shipping/track/GHOST', null],
  ['get', '/api/shipping/tracking/GHOST', null],
  ['post', '/api/shipping/auto-track', { transactionId: GHOST() }],
  ['post', '/api/shipping/tracking-event', { transactionId: GHOST(), status: 'in_transit' }],
  ['post', '/api/payouts/process/GHOST', {}],
  ['post', '/api/shipping-insurance/GHOST/claim', { reason: 'x' }],
  ['post', '/api/shipping-insurance/GHOST/refund', {}],

  // --- wallet / loyalty / referrals -------------------------------------
  ['get', '/api/loyalty/history', null],
  ['post', '/api/loyalty/redeem', { rewardId: GHOST() }],
  ['get', '/api/referrals/GHOSTCODE', null],

  // --- cart / wishlist / recently-viewed --------------------------------
  ['delete', '/api/cart/items/GHOST', null],
  ['post', '/api/wishlist', { listingId: GHOST() }],
  ['delete', '/api/wishlist/GHOST', null],
  ['get', '/api/wishlist/check/GHOST', null],
  ['delete', '/api/recently-viewed/GHOST', null],
  ['post', '/api/recently-viewed/GHOST', null],

  // --- messaging / ratings / comments -----------------------------------
  ['get', '/api/messages/conversation/GHOST', null],
  ['get', '/api/messages/conversation/GHOST/GHOST2', null],
  ['put', '/api/messages/read/GHOST', null],
  ['post', '/api/messages/GHOST', { text: 'hi' }],
  ['get', '/api/ratings/seller/GHOST', null],
  ['get', '/api/ratings/listing/GHOST', null],
  ['delete', '/api/ratings/GHOST', null],
  ['get', '/api/comments/GHOST', null],
  ['put', '/api/comments/GHOST/like', null],
  ['delete', '/api/comments/GHOST', null],
];

describe('R20.1b orders + payments + wallet + social never 500', () => {
  test.each(SWEEP2.map((c) => [c[0], c[1], c[2]]))(
    '%s %s -> status < 500',
    async (method, url, body) => {
      const res = await call(method, resolve(url), { body, token: myToken });
      expect(res.status).toBeLessThan(500);
    }
  );
});
const SWEEP3 = [
  // --- collections / storefront -----------------------------------------
  ['get', '/api/collections/GHOST', null],
  ['put', '/api/collections/GHOST', { name: 'x' }],
  ['delete', '/api/collections/GHOST', null],
  ['post', '/api/collections/GHOST/listings', { listingIds: [GHOST()] }],
  ['delete', '/api/collections/GHOST/listings/GHOST2', null],
  ['get', '/api/collections/seller/GHOST', null],

  // --- promos ------------------------------------------------------------
  ['put', '/api/promos/GHOST', { discountValue: 10 }],
  ['delete', '/api/promos/GHOST', null],
  ['post', '/api/promos/GHOST/use', null],

  // --- auctions ----------------------------------------------------------
  ['get', '/api/auctions/GHOST', null],
  ['delete', '/api/auctions/GHOST', null],
  ['post', '/api/auctions/GHOST/bids', { amount: 10 }],
  ['post', '/api/auctions/GHOST/close', {}],
  ['post', '/api/auctions/GHOST/stream/start', {}],
  ['post', '/api/auctions/GHOST/stream/stop', {}],
  ['get', '/api/auctions/GHOST/stream', null],

  // --- saved searches / search ------------------------------------------
  ['get', '/api/saved-searches/GHOST/results', null],
  ['put', '/api/saved-searches/GHOST', { name: 'x' }],
  ['delete', '/api/saved-searches/GHOST', null],

  // --- parties / live events / video ------------------------------------
  ['get', '/api/parties/GHOST', null],
  ['put', '/api/parties/GHOST', { title: 'x' }],
  ['delete', '/api/parties/GHOST', null],
  ['post', '/api/parties/GHOST/join', {}],
  ['post', '/api/parties/GHOST/share', {}],
  ['get', '/api/live-events/GHOST', null],
  ['post', '/api/live-events/GHOST/join', {}],
  ['post', '/api/live-events/GHOST/leave', {}],
  ['post', '/api/live-events/GHOST/purchase', { listingId: GHOST() }],
  ['get', '/api/live-events/stats/GHOST', null],
  ['get', '/api/video-shopping/GHOST', null],
  ['put', '/api/video-shopping/GHOST', { title: 'x' }],
  ['delete', '/api/video-shopping/GHOST', null],
  ['post', '/api/video-shopping/GHOST/like', null],
  ['post', '/api/video-shopping/GHOST/share', null],
  ['get', '/api/video-shopping/analytics/GHOST', null],

  // --- showrooms / try-on ------------------------------------------------
  ['get', '/api/ar-showrooms/GHOST', null],
  ['put', '/api/ar-showrooms/GHOST', { name: 'x' }],
  ['delete', '/api/ar-showrooms/GHOST', null],
  ['post', '/api/ar-showrooms/GHOST/items', { listingId: GHOST() }],
  ['post', '/api/ar-showrooms/GHOST/like', null],
  ['get', '/api/ar-showrooms/seller/GHOST', null],
  ['put', '/api/virtual-try-on/GHOST', { fit: 'true' }],
  ['delete', '/api/virtual-try-on/GHOST', null],
  ['get', '/api/virtual-try-on/GHOST', null],

  // --- communities / social commerce ------------------------------------
  ['get', '/api/seller-communities/GHOST', null],
  ['post', '/api/seller-communities/GHOST/join', {}],
  ['post', '/api/seller-communities/GHOST/challenges', { title: 'x' }],
  ['post', '/api/seller-communities/GHOST/achievements', { name: 'x' }],
  ['get', '/api/seller-communities/GHOST/leaderboard', null],
  ['post', '/api/social-commerce/GHOST/sync', {}],
  ['put', '/api/social-commerce/GHOST/settings', { autoSync: true }],
  ['get', '/api/social-commerce/GHOST/stats', null],
  ['delete', '/api/social-commerce/GHOST', null],

  // --- inventory / badges / boost ---------------------------------------
  ['get', '/api/inventory/GHOST', null],
  ['put', '/api/inventory/GHOST/auto-reorder', { enabled: true }],
  ['get', '/api/seller-badges/GHOST', null],
  ['get', '/api/shop-boost/status/GHOST', null],

  // --- size guides / price history / forecasts --------------------------
  ['get', '/api/size-guides/GHOSTCATEGORY', null],
  ['get', '/api/size-guides/suggestions/GHOSTCATEGORY/M', null],
  ['get', '/api/pricehistory/GHOST', null],
  ['get', '/api/trend-forecast/GHOSTCATEGORY', null],
  ['get', '/api/trend-forecast/GHOSTCATEGORY/trending', null],
];

describe('R20.1c storefront + events + community never 500', () => {
  test.each(SWEEP3.map((c) => [c[0], c[1], c[2]]))(
    '%s %s -> status < 500',
    async (method, url, body) => {
      const res = await call(method, resolve(url), { body, token: myToken });
      expect(res.status).toBeLessThan(500);
    }
  );
});
// ---------------------------------------------------------------------------
// R20.2 hostile bodies — wrong types, invalid enums, missing fields.
// LISTING is the seeded real listing id; everything else is deliberately bad.
// ---------------------------------------------------------------------------
const HOSTILE = [
  ['post', '/api/listings', { price: 'free' }],
  ['post', '/api/listings', { title: 'x', price: -5 }],
  ['post', '/api/reports', { listingId: 'LISTING', reason: 'NotAReason' }],
  ['post', '/api/reports', { listingId: GHOST(), reason: 'Spam' }],
  ['post', '/api/messages', { recipientId: 'not-an-id', text: 'hi' }],
  ['post', '/api/offers', { listingId: 'not-an-id', amount: 'lots' }],
  ['post', '/api/ratings', { listingId: 'not-an-id', rating: 99 }],
  ['post', '/api/promos', { code: 123, discountType: 'bogus', discountValue: 'x' }],
  ['post', '/api/promos/validate', { code: 42 }],
  ['post', '/api/auctions', { listingId: 'not-an-id', startingPrice: 'free' }],
  ['post', '/api/collections', { name: 42, listings: 'nope' }],
  ['post', '/api/saved-searches', { keywords: { a: 1 } }],
  ['post', '/api/vendors', { listingId: 'not-an-id', sellers: 'nope' }],
  ['post', '/api/vendors', { listingId: 'LISTING', commission: 'lots' }],
  ['put', '/api/vendors/shared-inventory', { listingId: 'not-an-id', quantity: 'lots' }],
  ['post', '/api/subscriptions/subscribe', { plan: 'bogus', price: 'free' }],
  ['post', '/api/shop-boost', { tier: 'bogus', durationDays: 'x' }],
  ['post', '/api/loyalty/earn', { reason: 'bogus', purchaseAmount: 'x' }],
  ['post', '/api/loyalty/redeem', { rewardId: 'not-an-id', points: 'x' }],
  ['post', '/api/returns', { transactionId: 'not-an-id', reason: 'bogus' }],
  ['post', '/api/escrow/initiate', { transactionId: 'not-an-id', amount: 'x' }],
  ['post', '/api/fraud/check', { listingId: 'not-an-id', amount: 'x' }],
  ['post', '/api/shipping/calculate', { weight: 'heavy' }],
  ['post', '/api/shipping-insurance/calculate', { transactionId: 'not-an-id', coverageType: 'bogus' }],
  ['post', '/api/cart/items', { listingId: 'not-an-id', quantity: 'many' }],
  ['post', '/api/advanced-shipping/rates', { weight: 'x', toCountry: 42 }],
  ['post', '/api/mobile/barcode-lookup', { barcode: 42 }],
  ['post', '/api/mobile/push-token', { token: 42 }],
  ['put', '/api/mobile/preferences', { preferences: 'nope' }],
  ['put', '/api/ai-stylist/preferences', { style: 42, sizes: 'nope' }],
  ['post', '/api/ai-stylist/generate', { occasion: 42 }],
  ['post', '/api/analytics/forecast', { months: 'many' }],
  ['post', '/api/trend-forecast/generate', { category: 42 }],
  ['post', '/api/onboarding/complete-step', { step: 'bogus' }],
  ['post', '/api/price-suggestions/suggest', { listingId: 'not-an-id', category: 42 }],
  ['post', '/api/social-commerce/connect', { platform: 'bogus' }],
  ['post', '/api/seller-communities', { name: 42 }],
  ['post', '/api/parties', { title: 42, scheduledAt: 'never' }],
  ['post', '/api/live-events', { title: 42, listingIds: 'nope' }],
  ['post', '/api/ar-showrooms', { listingId: 'not-an-id', position: 'nope' }],
  ['post', '/api/video-shopping/upload', { title: 42, url: 42 }],
  ['post', '/api/virtual-try-on/session', { listingId: 'not-an-id', measurements: 'nope' }],
  ['put', '/api/cross-border', { shippingPartners: 'nope' }],
  ['post', '/api/enterprise/webhook', { url: 42, events: 'nope' }],
  ['post', '/api/enterprise/export', { type: 42, startDate: 'never' }],
  ['post', '/api/offer-sharing/to-likers/LISTING', { discountValue: 'x' }],
  ['post', '/api/referrals/apply', { code: 42 }],
  ['put', '/api/notifications/not-an-id/read', null],
  // --- hostile shapes added with the R20.3 fixes -------------------------
  ['post', '/api/promos/validate', { code: 42, items: [null, 7, { listingId: 'not-an-id', price: 10 }] }],
  ['post', '/api/virtual-try-on/session', { listingId: 'LISTING', sessionType: 'bogus' }],
  ['post', '/api/virtual-try-on/session', { listingId: 'LISTING', measurements: { bust: 'wide' } }],
  ['put', '/api/cross-border', { shippingPartners: [null] }],
  ['put', '/api/cross-border', { shippingPartners: [{ name: 'DHL', rateMultiplier: 'fast' }] }],
  ['put', '/api/cross-border', { country: 42, currency: {}, taxId: [] }],
];

describe('R20.2 no /api endpoint 500s on hostile bodies', () => {
  test.each(HOSTILE.map((c) => [c[0], c[1], c[2]]))(
    '%s %s -> status < 500',
    async (method, url, body) => {
      const realBody = body && typeof body === 'object'
        ? JSON.parse(JSON.stringify(body).replace(/LISTING/g, listing._id.toString()))
        : body;
      const res = await call(method, resolve(url), { body: realBody, token: myToken });
      expect(res.status).toBeLessThan(500);

    }
  );
});

// ---------------------------------------------------------------------------
// R20.3 regression guards — the exact bugs the sweep above exposed. These
// assert the PRECISE status code (not merely "< 500") so a future refactor
// cannot silently turn a rejection back into a crash.
// ---------------------------------------------------------------------------
describe('R20.3 hostile bodies -> 400 (regression guards)', () => {
  let adminToken;

  beforeAll(async () => {
    const admin = await mkUser('admin');
    admin.role = 'admin';
    await admin.save();
    adminToken = jwt.sign({ id: admin._id }, SECRET, { expiresIn: '30d' });
  });

  test('R20.3a promos/validate non-string code -> 400 (was 500: toUpperCase)', async () => {
    const res = await call('post', '/api/promos/validate', { body: { code: 42 }, token: myToken });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/required/i);
  });

  test('R20.3b promos/validate hostile items do not break a valid code', async () => {
    const promo = await Promo.create({
      code: `R20PROMO${Date.now()}`, seller: me._id,
      discountType: 'percentage', discountValue: 10,
    });
    const res = await call('post', '/api/promos/validate', {
      token: myToken,
      body: {
        code: promo.code,
        items: [null, 7, { listingId: 'not-an-id', price: 999 }, { listingId: listing._id, price: 40, quantity: 1 }],
      },
    });
    expect(res.status).toBe(200);
    // Only the real, seller-owned line counts, using the authoritative listing
    // price rather than the client-supplied 40.
    expect(res.body.promo.eligibleTotal).toBe(50);
  });

  test('R20.3c referrals/apply non-string code -> 400 (was 500: toUpperCase)', async () => {
    const res = await call('post', '/api/referrals/apply', { body: { code: 42 } });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/required/i);
  });

  test('R20.3d virtual-try-on/session malformed listingId -> 400', async () => {
    const res = await call('post', '/api/virtual-try-on/session', {
      body: { listingId: 'not-an-id' }, token: myToken,
    });
    expect(res.status).toBe(400);
  });

  test('R20.3e virtual-try-on/session non-object measurements -> 400, nothing persisted', async () => {
    const before = await call('get', `/api/virtual-try-on/${listing._id}`, { token: myToken });
    expect(before.status).toBe(404); // no session for this listing yet

    const res = await call('post', '/api/virtual-try-on/session', {
      body: { listingId: listing._id, measurements: 'nope' }, token: myToken,
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/measurements/i);

    const after = await call('get', `/api/virtual-try-on/${listing._id}`, { token: myToken });
    expect(after.status).toBe(404); // the rejected session left no row behind
  });

  test('R20.3f virtual-try-on/session unknown sessionType -> 400 (model enum)', async () => {
    const res = await call('post', '/api/virtual-try-on/session', {
      body: { listingId: listing._id, sessionType: 'bogus' }, token: myToken,
    });
    expect(res.status).toBe(400);
  });

  test('R20.3g cross-border non-array shippingPartners -> 400 (was CastError 500)', async () => {
    const res = await call('put', '/api/cross-border', {
      body: { shippingPartners: 'nope' }, token: myToken,
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/array/i);
  });

  test('R20.3h cross-border malformed partner entry -> 400', async () => {
    const res = await call('put', '/api/cross-border', {
      body: { shippingPartners: [{ name: 'DHL', rateMultiplier: 'fast' }] }, token: myToken,
    });
    expect(res.status).toBe(400);
  });

  test('R20.3i cross-border well-formed update still succeeds', async () => {
    const res = await call('put', '/api/cross-border', {
      token: myToken,
      body: { country: 'CA', currency: 'CAD', shippingPartners: [{ name: 'DHL', rateMultiplier: 1.2 }] },
    });
    expect(res.status).toBe(200);
    expect(res.body.currency).toBe('CAD');
    expect(res.body.shippingPartners[0].name).toBe('DHL');
  });

  test('R20.3j reports status invalid value -> 400 (findByIdAndUpdate skips validators)', async () => {
    const res = await call('patch', `/api/reports/${GHOST()}/status`, {
      body: { status: 'NotAStatus' }, token: adminToken,
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/status/i);
  });

  test('R20.3k reports status valid value on ghost report -> 404', async () => {
    const res = await call('patch', `/api/reports/${GHOST()}/status`, {
      body: { status: 'resolved' }, token: adminToken,
    });
    expect(res.status).toBe(404);
  });
});
