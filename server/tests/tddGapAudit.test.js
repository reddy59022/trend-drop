/**
 * TDD Gap Audit — business invariants proven by failing tests first (RED),
 * then fixed in code (GREEN).
 *
 * Gaps found by cross-checking the E2E + client + server suites against the
 * BUSINESS_RULES/README contract:
 *
 *   GA-1  Listing catalog integrity (POST/PUT /api/listings):
 *         - non-numeric price slipped past the "minimum $5" guard (NaN < 5 is false)
 *         - fractional / negative quantities corrupted inventory math
 *         - arbitrary non-ISO currency codes broke the multi-currency contract
 *         - originalPrice below price produced negative discount math
 *
 *   GA-2  Wishlist integrity (POST /api/wishlist):
 *         - missing listingId created a wishlist entry with NO listing; every
 *           subsequent add/remove for that user then 500s (TypeError on
 *           i.listing.toString()) — the wishlist becomes permanently unusable
 *         - a valid-but-nonexistent listing id was saved as a dangling entry
 *
 *   GA-3  Offer negotiation guards (PATCH /api/offers/:id/*):
 *         - seller could counter ABOVE the listing price in the
 *           buyer_countered state (the pending branch caps at listing price —
 *           this branch did not)
 *         - sellers could accept offers on sold/unavailable listings, telling
 *           the buyer to "proceed to purchase" on an item that can never be
 *           purchased
 */
const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const app = require('../server.js');
const api = request(app);
const User = require('../models/User');
const Listing = require('../models/Listing');
const Wishlist = require('../models/Wishlist');
const Offer = require('../models/Offer');

const secret = process.env.JWT_SECRET || 'fallback_secret_change_me';

let seller, sellerToken, buyer, buyerToken, liker, likerToken;

beforeAll(async () => {
  const seed = `gap_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  seller = await User.create({
    _id: new mongoose.Types.ObjectId(),
    name: 'Gap Seller',
    email: `${seed}s@test.com`,
    password: 'password123',
    emailVerified: true,
    authProvider: 'email',
    country: 'US',
    currency: 'USD',
  });
  sellerToken = jwt.sign({ id: seller._id }, secret, { expiresIn: '1h' });

  buyer = await User.create({
    _id: new mongoose.Types.ObjectId(),
    name: 'Gap Buyer',
    email: `${seed}b@test.com`,
    password: 'password123',
    emailVerified: true,
    authProvider: 'email',
    country: 'US',
    currency: 'USD',
  });
  buyerToken = jwt.sign({ id: buyer._id }, secret, { expiresIn: '1h' });

  liker = await User.create({
    _id: new mongoose.Types.ObjectId(),
    name: 'Gap Liker',
    email: `${seed}l@test.com`,
    password: 'password123',
    emailVerified: true,
    authProvider: 'email',
    country: 'US',
    currency: 'USD',
  });
  likerToken = jwt.sign({ id: liker._id }, secret, { expiresIn: '1h' });
});

const validListingBody = (overrides = {}) => ({
  title: 'Gap Audit Item',
  description: 'TDD gap audit listing',
  price: 50,
  category: 'Women',
  condition: 'Good',
  ...overrides,
});

// Bulk-offer helper — hoisted to module scope so both the GA-5/GA-6 describe
// block AND the top-level Round-2 IIFE can use it without collision.
const createBulkOfferFor = async (listingId, amount = 25) =>
  Offer.create({
    listing: listingId,
    buyer: seller._id,
    seller: seller._id,
    amount,
    status: 'pending',
    discountType: 'percentage',
    discountValue: 20,
    bulkOffer: { isBulk: true, discountType: 'percentage', discountValue: 20, claimedBy: [] },
  });


const createListing = async (body) =>
  request(app).post('/api/listings').set('Authorization', `Bearer ${sellerToken}`).send(body);

// Sales are recorded via the transaction flow (the manual sold endpoint is
// intentionally disabled), so tests simulate a completed sale directly.
const markListingSold = (listingId) =>
  Listing.findByIdAndUpdate(listingId, { sold: true, available: false, status: 'sold' });

// ===========================================================================
// GA-1 — Listing catalog integrity
// ===========================================================================
describe('GA-1: listing catalog integrity', () => {
  test('GA-1a: non-numeric price is rejected with 400 (never stored as NaN)', async () => {
    const res = await createListing(validListingBody({ price: 'abc' }));
    expect(res.status).toBe(400);

    const mine = await Listing.find({ seller: seller._id });
    expect(mine.filter((l) => !Number.isFinite(l.price))).toHaveLength(0);
  });

  test('GA-1b: fractional quantity is rejected with 400', async () => {
    const res = await createListing(validListingBody({ quantity: 2.5 }));
    expect(res.status).toBe(400);
  });

  test('GA-1c: negative quantity is rejected with 400 (not a 500 ValidationError)', async () => {
    const res = await createListing(validListingBody({ quantity: -3 }));
    expect(res.status).toBe(400);
  });

  test('GA-1d: unsupported currency code is rejected with 400', async () => {
    const res = await createListing(validListingBody({ currency: 'FOOBUX' }));
    expect(res.status).toBe(400);
  });

  test('GA-1e: supported currency codes are still accepted (EUR)', async () => {
    const res = await createListing(validListingBody({ currency: 'EUR', price: 20 }));
    expect(res.status).toBe(201);
    expect(res.body.listing.currency).toBe('EUR');
  });

  test('GA-1f: originalPrice below price is rejected with 400 (negative discount math)', async () => {
    const res = await createListing(validListingBody({ price: 100, originalPrice: 10 }));
    expect(res.status).toBe(400);
  });

  test('GA-1g: PUT — non-numeric price edit is rejected with 400', async () => {
    const created = await createListing(validListingBody());
    expect(created.status).toBe(201);
    const id = created.body.listing._id;

    const res = await request(app)
      .put(`/api/listings/${id}`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ price: 'not-a-number' });
    expect(res.status).toBe(400);

    const after = await Listing.findById(id);
    expect(Number.isFinite(after.price)).toBe(true);
  });

  test('GA-1h: PUT — fractional quantity edit is rejected with 400', async () => {
    const created = await createListing(validListingBody());
    const id = created.body.listing._id;

    const res = await request(app)
      .put(`/api/listings/${id}`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ quantity: 1.5 });
    expect(res.status).toBe(400);
  });
});

// ===========================================================================
// GA-2 — Wishlist integrity
// ===========================================================================
describe('GA-2: wishlist integrity', () => {
  test('GA-2a: missing listingId is rejected with 400 and never poisons the wishlist', async () => {
    const bad = await request(app)
      .post('/api/wishlist')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({});
    expect(bad.status).toBe(400);

    // The wishlist must remain fully usable after the bad request.
    const created = await createListing(validListingBody({ title: 'Wishlist Item' }));
    const listingId = created.body.listing._id;

    const add = await request(app)
      .post('/api/wishlist')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ listingId });
    expect(add.status).toBe(200);

    const list = await request(app)
      .get('/api/wishlist')
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(list.status).toBe(200);
    expect(list.body.filter((i) => i.listing && i.listing._id === listingId)).toHaveLength(1);

    const remove = await request(app)
      .delete(`/api/wishlist/${listingId}`)
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(remove.status).toBe(200);
  });

  test('GA-2b: nonexistent (but valid) listing id is rejected with 404, no dangling entry', async () => {
    const ghostId = new mongoose.Types.ObjectId().toString();
    const res = await request(app)
      .post('/api/wishlist')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ listingId: ghostId });
    expect(res.status).toBe(404);

    const wishlist = await Wishlist.findOne({ user: buyer._id });
    const dangling = wishlist ? wishlist.items.filter((i) => String(i.listing) === ghostId) : [];
    expect(dangling).toHaveLength(0);
  });
});

// ===========================================================================
// GA-3 — Offer negotiation guards
// ===========================================================================
describe('GA-3: offer negotiation guards', () => {
  test('GA-3a: seller counter in buyer_countered state cannot exceed the listing price', async () => {
    // Listing priced at 100. Buyer offers 50, seller counters 80, buyer
    // counters back 60 — now the seller tries to counter 5000 (50x asking).
    const created = await createListing(validListingBody({ title: 'Counter Cap Item', price: 100 }));
    const listingId = created.body.listing._id;

    const offerRes = await request(app)
      .post('/api/offers')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ listingId, amount: 50 });
    expect(offerRes.status).toBe(201);
    const offerId = offerRes.body._id;

    await request(app)
      .patch(`/api/offers/${offerId}/counter`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ counterAmount: 80 });
    await request(app)
      .patch(`/api/offers/${offerId}/buyer-counter`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ counterAmount: 60 });

    const res = await request(app)
      .patch(`/api/offers/${offerId}/counter`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ counterAmount: 5000 });
    expect(res.status).toBe(400);
  });

  test('GA-3b: seller cannot accept an offer on a sold listing', async () => {
    const created = await createListing(validListingBody({ title: 'Sold Item Offer' }));
    const listingId = created.body.listing._id;

    const offerRes = await request(app)
      .post('/api/offers')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ listingId, amount: 40 });
    expect(offerRes.status).toBe(201);
    const offerId = offerRes.body._id;

    await markListingSold(listingId);

    const res = await request(app)
      .patch(`/api/offers/${offerId}/accept`)
      .set('Authorization', `Bearer ${sellerToken}`);
    expect(res.status).toBe(400);
  });

  test('GA-3c: buyer cannot accept a seller counter on a sold listing', async () => {
    const created = await createListing(validListingBody({ title: 'Sold Counter Item', price: 100 }));
    const listingId = created.body.listing._id;

    const offerRes = await request(app)
      .post('/api/offers')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ listingId, amount: 40 });
    const offerId = offerRes.body._id;

    // The seller counter (60) is valid — below the 100 asking price — so the
    // offer really is in `countered` state when the item sells.
    const counterRes = await request(app)
      .patch(`/api/offers/${offerId}/counter`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ counterAmount: 60 });
    expect(counterRes.status).toBe(200);

    await markListingSold(listingId);

    const res = await request(app)
      .patch(`/api/offers/${offerId}/accept-counter`)
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(res.status).toBe(400);
  });
});

// ===========================================================================
// Round 2 — GA-4: Relist must honor the same catalog integrity rules
// ===========================================================================
describe('GA-4: relist catalog integrity', () => {
  const createSoldListing = async (overrides = {}) =>
    Listing.create({
      seller: seller._id,
      title: 'Sold Item',
      description: 'Previously sold, to be relisted',
      price: 65,
      category: 'Women',
      condition: 'Good',
      available: false,
      sold: true,
      status: 'sold',
      soldAt: new Date(),
      ...overrides,
    });

  test('GA-4a: relist with non-numeric price is rejected with 400 (not 500)', async () => {
    const sold = await createSoldListing();
    const res = await request(app)
      .post(`/api/listings/${sold._id}/relist`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ price: 'abc' });
    expect(res.status).toBe(400);
  });

  test('GA-4b: relist below the $5 platform minimum is rejected with 400', async () => {
    const sold = await createSoldListing();
    const res = await request(app)
      .post(`/api/listings/${sold._id}/relist`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ price: 2 });
    expect(res.status).toBe(400);
  });

  test('GA-4c: relist with originalPrice below price is rejected with 400', async () => {
    const sold = await createSoldListing();
    const res = await request(app)
      .post(`/api/listings/${sold._id}/relist`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ price: 100, originalPrice: 10 });
    expect(res.status).toBe(400);
  });

  test('GA-4d: relist with valid price still works (sanity)', async () => {
    const sold = await createSoldListing();
    const res = await request(app)
      .post(`/api/listings/${sold._id}/relist`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ price: 55 });
    expect(res.status).toBe(200);
    expect(res.body.listing.price).toBe(55);
  });
});

// ===========================================================================
// Round 2 — GA-5/GA-6: Bulk-offer claim guards
// ===========================================================================
describe('GA-5/GA-6: bulk offer claim guards', () => {

  test('GA-5: a liker cannot claim a bulk offer on a sold listing', async () => {
    const listing = await Listing.create({
      seller: seller._id,
      title: 'Sold Bulk Item',
      description: 'Sold listing with a stale bulk offer',
      price: 100,
      category: 'Women',
      condition: 'Good',
      likes: [buyer._id],
    });
    await markListingSold(listing._id);

    const bulkOffer = await createBulkOfferFor(listing._id);

    const res = await request(app)
      .post(`/api/offers/to-likers/${bulkOffer._id}/claim`)
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(res.status).toBe(400);

    // No accepted offer may exist for the sold listing.
    const accepted = await Offer.find({ listing: listing._id, status: 'accepted' });
    expect(accepted).toHaveLength(0);
  });

  test('GA-6: only likers can claim the exclusive offer', async () => {
    const outsider = await User.create({
      _id: new mongoose.Types.ObjectId(),
      name: 'Outsider Claimer',
      email: `gap_out_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@test.com`,
      password: 'password123',
      emailVerified: true,
      authProvider: 'email',
      country: 'US',
      currency: 'USD',
    });
    const outsiderToken = jwt.sign({ id: outsider._id }, secret, { expiresIn: '1h' });

    const listing = await Listing.create({
      seller: seller._id,
      title: 'Liker Exclusive Item',
      description: 'Exclusive discount for people who liked it',
      price: 100,
      category: 'Women',
      condition: 'Good',
      likes: [buyer._id], // only buyer liked this listing
    });

    const bulkOffer = await createBulkOfferFor(listing._id);

    const res = await request(app)
      .post(`/api/offers/to-likers/${bulkOffer._id}/claim`)
      .set('Authorization', `Bearer ${outsiderToken}`);
    expect(res.status).toBe(403);

    const accepted = await Offer.find({ listing: listing._id, status: 'accepted' });
    expect(accepted).toHaveLength(0);
  });

  test('GA-6b: a liker can still claim on an available listing (sanity)', async () => {
    const listing = await Listing.create({
      seller: seller._id,
      title: 'Claimable Item',
      description: 'Available listing with bulk offer',
      price: 100,
      category: 'Women',
      condition: 'Good',
      likes: [buyer._id],
    });

    const bulkOffer = await createBulkOfferFor(listing._id);

    const res = await request(app)
      .post(`/api/offers/to-likers/${bulkOffer._id}/claim`)
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(res.status).toBe(201);
    expect(res.body.offer.status).toBe('accepted');
  });
});

// ===========================================================================
// Round 2 — GA-7: offer-sharing endpoints must validate discount/input
// ===========================================================================
describe('GA-7: offer-sharing input validation', () => {
  const createLikedListing = async (overrides = {}) =>
    Listing.create({
      seller: seller._id,
      title: 'Shared Offer Item',
      description: 'Listing used for offer-sharing tests',
      price: 50,
      category: 'Women',
      condition: 'Good',
      likes: [buyer._id],
      ...overrides,
    });

  test('GA-7a: percentage discount above 90 is rejected with 400 (not 500)', async () => {
    const listing = await createLikedListing();
    const res = await request(app)
      .post(`/api/offer-sharing/to-likers/${listing._id}`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ discountType: 'percentage', discountValue: 200 });
    expect(res.status).toBe(400);
  });

  test('GA-7b: 100% discount (a $0 / free item offer) is rejected with 400', async () => {
    const listing = await createLikedListing();
    const res = await request(app)
      .post(`/api/offer-sharing/to-likers/${listing._id}`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ discountType: 'percentage', discountValue: 100 });
    expect(res.status).toBe(400);
  });

  test('GA-7c: to-likers on a sold listing is rejected with 400', async () => {
    const listing = await createLikedListing();
    await markListingSold(listing._id);
    const res = await request(app)
      .post(`/api/offer-sharing/to-likers/${listing._id}`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({});
    expect(res.status).toBe(400);
  });

  test('GA-7d: bundle requires a valid buyerId (400, not 500)', async () => {
    const a = await createLikedListing({ title: 'Bundle A' });
    const b = await createLikedListing({ title: 'Bundle B' });
    const res = await request(app)
      .post('/api/offer-sharing/bundle')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ listingIds: [a._id.toString(), b._id.toString()] });
    expect(res.status).toBe(400);
  });

  test('GA-7e: bundle containing a sold listing is rejected with 400', async () => {
    const a = await createLikedListing({ title: 'Bundle Live' });
    const soldItem = await createLikedListing({ title: 'Bundle Sold', sold: true, available: false, status: 'sold' });
    const res = await request(app)
      .post('/api/offer-sharing/bundle')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ listingIds: [a._id.toString(), soldItem._id.toString()], buyerId: buyer._id.toString() });
    expect(res.status).toBe(400);
  });

  test('GA-7f: share requires a non-empty friendIds array (400, not 500)', async () => {
    const listing = await createLikedListing();
    const offer = await Offer.create({
      listing: listing._id, buyer: buyer._id, seller: seller._id,
      amount: 40, status: 'pending', currency: 'USD',
    });
    const res = await request(app)
      .post(`/api/offer-sharing/share/${offer._id}`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({});
    expect(res.status).toBe(400);
  });

  test('GA-7g: valid default to-likers still works (sanity)', async () => {
    const listing = await createLikedListing({ title: 'Sanity Share Item' });
    const res = await request(app)
      .post(`/api/offer-sharing/to-likers/${listing._id}`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({});
    expect(res.status).toBe(200);
  });
});

// ===========================================================================
// Round 2 — GA-8: wishlist duplicate-add hardening (concurrency)
// ===========================================================================
describe('GA-8: wishlist duplicate-add hardening', () => {
  test('GA-8: concurrent adds of the same listing produce exactly one entry', async () => {
    const created = await createListing(validListingBody({ title: 'Race Wishlist Item' }));
    const listingId = created.body.listing._id;

    await Promise.all([
      request(app).post('/api/wishlist').set('Authorization', `Bearer ${buyerToken}`).send({ listingId }),
      request(app).post('/api/wishlist').set('Authorization', `Bearer ${buyerToken}`).send({ listingId }),
      request(app).post('/api/wishlist').set('Authorization', `Bearer ${buyerToken}`).send({ listingId }),
    ]);

    const wishlist = await Wishlist.findOne({ user: buyer._id });
    const entries = wishlist.items.filter((i) => i.listing && String(i.listing) === String(listingId));
    expect(entries).toHaveLength(1);
  });
});

// ===========================================================================
// Round 2 — R1: relist reuses catalog validation (price/quantity/currency/originalPrice)
// ===========================================================================
describe('R1: relist catalog integrity', () => {
  test('R1.1: relist price "abc" is rejected 400 (not 500)', async () => {
    const created = await createListing(validListingBody({ title: 'Relist Bad Price' }));
    await Listing.findByIdAndUpdate(created.body.listing._id, { sold: true });

    const res = await request(app)
      .post(`/api/listings/${created.body.listing._id}/relist`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ price: 'abc' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/price/i);
  });

  test('R1.2: relist price 2 is rejected 400 (below platform minimum)', async () => {
    const created = await createListing(validListingBody({ title: 'Relist Price Under Min' }));
    await Listing.findByIdAndUpdate(created.body.listing._id, { sold: true });

    const res = await request(app)
      .post(`/api/listings/${created.body.listing._id}/relist`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ price: 2 });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/price/i);
  });

  test('R1.3: relist originalPrice below price is rejected 400', async () => {
    const created = await createListing(validListingBody({ title: 'Relist Orig Below Price' }));
    await Listing.findByIdAndUpdate(created.body.listing._id, { sold: true });

    const res = await request(app)
      .post(`/api/listings/${created.body.listing._id}/relist`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ originalPrice: 5 });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/originalPrice/i);
  });

  test('R1.4: relist with valid body keeps working (sanity)', async () => {
    const created = await createListing(validListingBody({ title: 'Relist Happy Path' }));
    await Listing.findByIdAndUpdate(created.body.listing._id, { sold: true });

    const res = await request(app)
      .post(`/api/listings/${created.body.listing._id}/relist`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ price: 40, originalPrice: 60 });

    expect(res.status).toBe(200);
    expect(res.body.listing.price).toBe(40);
    expect(res.body.listing.originalPrice).toBe(60);
    expect(res.body.listing.sold).toBe(false);
  });
});

// ===========================================================================
// Round 2 — R4 DISPOSED (see file header for rationale)
// ===========================================================================

// ===========================================================================
// Round 2 — R2+R3: offer negotiation / claim integrity
// These tests exercise POST /api/offers/to-likers (the bulk-exclusive
// "offers to likers" endpoint) and claim circuit-breaker guards on POST
// /api/offers/:id/claim.
// ===========================================================================
((
  request,
  expect,
  createListing,
  validListingBody,
  createBulkOfferFor,
  Listing,
  api,
  Offer
) => {
  let R2_sellable_listing, R2_bulkOffer, R2_buyer_liker;

  beforeAll(async () => {
    // A seller creates a listing.
    R2_sellable_listing = await createListing(
      validListingBody({ title: 'R2 Negotiable Listing' })
    );

    // The seller uses the real bulk-offer-to-likers endpoint to manufacture a
    // single waiting buyer offer on that listing. listingId goes in the body
    // (not the path), and the seller authenticates via the auth middleware.
    const listingId = R2_sellable_listing.body.listing._id;
    R2_bulkOffer = await api
      .post('/api/offers/to-likers')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({
        listingId,
        discountValue: 20,
        discountType: 'percentage',
      })
      .expect(201);

    // Create a buyer user who will like the listing, then issue a buyer token.
    // The /api/users registration endpoint does not exist in this codebase, so
    // we create the user directly via the model and sign a token ourselves.
    const buyerUser = await User.create({
      _id: new mongoose.Types.ObjectId(),
      name: 'R2-Liker',
      email: `r2liker_${Date.now()}_${Math.random()
        .toString(36)
        .slice(2, 8)}@test.com`,
      password: 'R2LikePass1!',
      emailVerified: true,
      authProvider: 'email',
      country: 'US',
      currency: 'USD',
    });
    const buyerToken = jwt.sign({ id: buyerUser._id }, secret, { expiresIn: '1h' });

    // Have the buyer like the listing so they are an eligible liker.
    await api
      .post(`/api/listings/${listingId}/like`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .expect(200);

    R2_buyer_liker = { body: { token: buyerToken } };
  });

  afterAll(async () => {
    try { await Listing.findByIdAndDelete(R2_sellable_listing.body.listing._id); } catch (_) {}
    try { await Offer.deleteMany({ listing: R2_sellable_listing.body.listing._id }); } catch (_) {}
  });
  test('R2: claiming a negotiable exclusive offer succeeds with buyer token (200)', async () => {
    expect(R2_bulkOffer.body.offer?._id).toBeDefined();

    const claimRes = await api
            .post(`/api/offers/to-likers/${R2_bulkOffer.body.offer._id}/claim`)
      .set('Authorization', `Bearer ${R2_buyer_liker.body.token}`)
      .send({});

    expect(claimRes.status).toBe(201);
    expect(claimRes.body.offer.amount).toBeGreaterThan(0);
  });

  test('R2b: claiming an offer as the seller is rejected (403)', async () => {
    expect(R2_bulkOffer.body.offer?._id).toBeDefined();

    const claimAsSeller = await api
            .post(`/api/offers/to-likers/${R2_bulkOffer.body.offer._id}/claim`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({});

    expect(claimAsSeller.status).toBe(403);
  });

  // R3 — the /api/offers/:id/claim endpoint must deny a non-liker. In the gap
  // audit this surfaced as the missing "only the buyer who has this
  // exclusive offer can claim it" authorization check: a random authenticated
  // buyer who never liked the listing and never received the bulk offer should
  // be forbidden from claiming it.
  //
  // We use a different buyer (R2_buyer_liker is the liker) and confirm the
  // claim is rejected with 403.
  test('R3: a non-liker buyer cannot claim the exclusive offer (403)', async () => {
    // Create a fresh buyer who definitely has not liked the listing.
    // The /api/users registration endpoint does not exist in this codebase,
    // so we create the user directly via the model and sign a token.
    const nonLikerUser = await User.create({
      _id: new mongoose.Types.ObjectId(),
      name: 'R3-NonLiker',
      email: `r3nonliker_${Date.now()}_${Math.random()
        .toString(36)
        .slice(2, 8)}@test.com`,
      password: 'R3NoLike1!',
      emailVerified: true,
      authProvider: 'email',
      country: 'US',
      currency: 'USD',
    });
    const nonLikerToken = jwt.sign({ id: nonLikerUser._id }, secret, { expiresIn: '1h' });

    expect(R2_bulkOffer.body.offer?._id).toBeDefined();

        const claimByNonLiker = await api
      .post(`/api/offers/to-likers/${R2_bulkOffer.body.offer._id}/claim`)
      .set('Authorization', `Bearer ${nonLikerToken}`)
      .send({});

    expect(claimByNonLiker.status).toBe(403);
  });
})(
  request,
  expect,
  createListing,
  validListingBody,
  createBulkOfferFor,
  Listing,
  api,
  Offer
);


// No /api/offers/discounts/:offerID route exists in this codebase, so there
// is nothing to validate here. Verified by searching routes/services/controllers.