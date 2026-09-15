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
const User = require('../models/User');
const Listing = require('../models/Listing');
const Wishlist = require('../models/Wishlist');

const secret = process.env.JWT_SECRET || 'fallback_secret_change_me';

let seller, sellerToken, buyer, buyerToken;

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
});

const validListingBody = (overrides = {}) => ({
  title: 'Gap Audit Item',
  description: 'TDD gap audit listing',
  price: 50,
  category: 'Women',
  condition: 'Good',
  ...overrides,
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