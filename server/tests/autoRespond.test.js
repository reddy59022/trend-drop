/**
 * Auto-respond / enterprise auto-offer (Feature 4).
 *
 * Sellers can set a LEAST PRICE they will accept on a listing. When
 * auto-respond is enabled:
 *   - offers >= least price are AUTO-ACCEPTED
 *   - offers < least price are AUTO-COUNTERED to the least price
 *   - (optional) likers automatically RECEIVE an offer at the least price
 *
 * Available during listing creation AND edit. Currency-aware: the least
 * price is expressed in the listing's currency.
 */
const mongoose = require('mongoose');
const request = require('supertest');
const app = require('../server');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Offer = require('../models/Offer');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';
const mkEmail = (p) => `${p}_auto_${Date.now()}@test.com`;

let seller, buyer, liker, sellerToken, buyerToken, likerToken;
const testUserIds = [];
const testListingIds = [];

beforeAll(async () => {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/trenddrop_test');
  }
  const mk = async (name, email) => User.create({
    name, email: mkEmail(email), password: 'password123', emailVerified: true,
    country: 'US', currency: 'USD',
  });
  seller = await mk('ARSeller', 'seller'); testUserIds.push(seller._id);
  buyer = await mk('ARBuyer', 'buyer'); testUserIds.push(buyer._id);
  liker = await mk('ARLiker', 'liker'); testUserIds.push(liker._id);
  sellerToken = jwt.sign({ id: seller._id }, JWT_SECRET, { expiresIn: '30d' });
  buyerToken = jwt.sign({ id: buyer._id }, JWT_SECRET, { expiresIn: '30d' });
  likerToken = jwt.sign({ id: liker._id }, JWT_SECRET, { expiresIn: '30d' });
});

afterAll(async () => {
  await Offer.deleteMany({ $or: [{ listing: { $in: testListingIds } }, { buyer: { $in: testUserIds } }, { seller: { $in: testUserIds } }] });
  await Listing.deleteMany({ _id: { $in: testListingIds } });
  await User.deleteMany({ _id: { $in: testUserIds } });
});

describe('Feature 4 — Auto-respond / enterprise auto-offer', () => {
  let arListing; // auto-respond enabled listing (price 100, minPrice 60)
  let plainListing; // auto-respond disabled

  beforeAll(async () => {
    arListing = await Listing.create({
      seller: seller._id, title: 'AR Item', description: 'd', price: 100,
      category: 'Women', condition: 'Good', currency: 'USD',
      available: true, quantity: 5, shipsFrom: 'US',
      autoRespond: { enabled: true, minPrice: 60, currency: 'USD', autoOfferToLikers: true },
    });
    testListingIds.push(arListing._id);

    plainListing = await Listing.create({
      seller: seller._id, title: 'Plain Item', description: 'd', price: 100,
      category: 'Men', condition: 'Good', currency: 'USD',
      available: true, quantity: 5, shipsFrom: 'US',
    });
    testListingIds.push(plainListing._id);
  });

  test('AR.1 Create listing with autoRespond enabled + least price succeeds (201) and persists', async () => {
    const res = await request(app)
      .post('/api/listings')
      .set('Authorization', `Bearer ${sellerToken}`)
      .field('title', 'Auto Respond New')
      .field('description', 'auto respond at creation')
      .field('price', '80')
      .field('category', 'Accessories')
      .field('condition', 'Good')
      .field('shipsFrom', 'US')
      .field('autoRespondEnabled', 'true')
      .field('autoRespondMinPrice', '50')
      .field('autoRespondCurrency', 'USD');
    expect(res.status).toBe(201);
    expect(res.body.listing.autoRespond.enabled).toBe(true);
    expect(res.body.listing.autoRespond.minPrice).toBe(50);
    expect(res.body.listing.autoRespond.currency).toBe('USD');
    testListingIds.push(res.body.listing._id);
  });

  test('AR.2 Create listing with autoRespond enabled but missing minPrice is rejected (400)', async () => {
    const res = await request(app)
      .post('/api/listings')
      .set('Authorization', `Bearer ${sellerToken}`)
      .field('title', 'No Min Price')
      .field('description', 'missing min price')
      .field('price', '80')
      .field('category', 'Beauty')
      .field('condition', 'Good')
      .field('autoRespondEnabled', 'true');
    expect(res.status).toBe(400);
    expect(res.body.message.toLowerCase()).toContain('minprice');
  });

  test('AR.3 Create listing with autoRespond currency mismatching the listing currency is rejected (400)', async () => {
    const res = await request(app)
      .post('/api/listings')
      .set('Authorization', `Bearer ${sellerToken}`)
      .field('title', 'Currency Mismatch')
      .field('description', 'wrong currency')
      .field('price', '80')
      .field('currency', 'USD')
      .field('category', 'Home')
      .field('condition', 'Good')
      .field('autoRespondEnabled', 'true')
      .field('autoRespondMinPrice', '50')
      .field('autoRespondCurrency', 'GBP');
    expect(res.status).toBe(400);
    expect(res.body.message.toLowerCase()).toContain('currency');
  });

  test('AR.4 Create listing with minPrice above listing price is rejected (400)', async () => {
    const res = await request(app)
      .post('/api/listings')
      .set('Authorization', `Bearer ${sellerToken}`)
      .field('title', 'Min Above Price')
      .field('description', 'min price too high')
      .field('price', '80')
      .field('category', 'Kids')
      .field('condition', 'Good')
      .field('autoRespondEnabled', 'true')
      .field('autoRespondMinPrice', '90')
      .field('autoRespondCurrency', 'USD');
    expect(res.status).toBe(400);
    expect(res.body.message.toLowerCase()).toContain('price');
  });

  test('AR.5 Edit listing can change the least price while staying enabled', async () => {
    const id = arListing._id;
    const res = await request(app)
      .put(`/api/listings/${id}`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .field('autoRespondEnabled', 'true')
      .field('autoRespondMinPrice', '70')
      .field('autoRespondCurrency', 'USD');
    expect(res.status).toBe(200);
    expect(res.body.listing.autoRespond.enabled).toBe(true);
    expect(res.body.listing.autoRespond.minPrice).toBe(70);
  });

  test('AR.6 Offer at/above least price is AUTO-ACCEPTED (acceptedBy seller, acceptedUntil set, currency preserved)', async () => {
    const res = await request(app)
      .post('/api/offers')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ listingId: arListing._id, amount: 75 });
    expect(res.status).toBe(201);
    const offer = res.body;
    expect(offer.status).toBe('accepted');
    expect(offer.acceptedPrice).toBe(75);
    expect(offer.acceptedBy).toBe('seller');
    expect(offer.acceptedUntil).toBeDefined();
    expect(offer.currency).toBe('USD');
  });

  test('AR.7 Offer below least price is AUTO-COUNTERED to the least price', async () => {
    const res = await request(app)
      .post('/api/offers')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ listingId: arListing._id, amount: 40 });
    expect(res.status).toBe(201);
    const offer = res.body;
    expect(offer.status).toBe('countered');
    expect(offer.counterAmount).toBe(70); // least price updated in AR.5
    expect(offer.lastCounterBy).toBe('seller');
    const last = offer.counterHistory[offer.counterHistory.length - 1];
    expect(last.counteredBy).toBe('seller');
    expect(last.amount).toBe(70);
  });

  test('AR.8 With autoRespond disabled offers stay PENDING (no behavior change)', async () => {
    const res = await request(app)
      .post('/api/offers')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ listingId: plainListing._id, amount: 40 });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('pending');
  });

  test('AR.9 Liking a listing with autoOfferToLikers sends the liker an accepted offer at the least price', async () => {
    // Re-enable auto-respond with auto-offer to likers.
    await request(app)
      .put(`/api/listings/${arListing._id}`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .field('autoRespondEnabled', 'true')
      .field('autoRespondMinPrice', '55')
      .field('autoRespondCurrency', 'USD')
      .field('autoRespondAutoOfferToLikers', 'true');

    const likeRes = await request(app)
      .post(`/api/listings/${arListing._id}/like`)
      .set('Authorization', `Bearer ${likerToken}`);
    expect(likeRes.status).toBe(200);

    const offer = await Offer.findOne({ listing: arListing._id, buyer: liker._id });
    expect(offer).toBeDefined();
    expect(offer.status).toBe('accepted');
    expect(offer.acceptedPrice).toBe(55);
    expect(offer.amount).toBe(55);
    expect(offer.currency).toBe('USD');
    expect(offer.acceptedBy).toBe('seller');
  });

  test('AR.10 GET /api/listings/:id returns the autoRespond configuration', async () => {
    const res = await request(app).get(`/api/listings/${arListing._id}`);
    expect(res.status).toBe(200);
    expect(res.body.listing.autoRespond.enabled).toBe(true);
    expect(res.body.listing.autoRespond.minPrice).toBe(55);
  });

  test('AR.11 Edit listing can turn autoRespond OFF', async () => {
    const off = await request(app)
      .put(`/api/listings/${arListing._id}`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .field('autoRespondEnabled', 'false');
    expect(off.status).toBe(200);
    expect(off.body.listing.autoRespond.enabled).toBe(false);
  });

  test('AR.12 auto-accepted, auto-countered and liker auto-offers carry the autoResponded provenance flag (powers ⚡ badge)', async () => {
    const accepted = await Offer.findOne({ listing: arListing._id, buyer: buyer._id, status: 'accepted' });
    expect(accepted).toBeDefined();
    expect(accepted.autoResponded).toBe(true);

    const countered = await Offer.findOne({ listing: arListing._id, buyer: buyer._id, status: 'countered' });
    expect(countered).toBeDefined();
    expect(countered.autoResponded).toBe(true);

    const likerOffer = await Offer.findOne({ listing: arListing._id, buyer: liker._id });
    expect(likerOffer).toBeDefined();
    expect(likerOffer.autoResponded).toBe(true);

    // Plain (non auto-respond) offers must NOT be flagged.
    const manual = await Offer.findOne({ listing: plainListing._id, buyer: buyer._id });
    expect(manual).toBeDefined();
    expect(manual.autoResponded).toBe(false);
  });

  test('AR.13 PATCH /api/listings/bulk/auto-respond enables auto-respond for ALL seller listings (minPrice = list price)', async () => {
    const res = await request(app)
      .patch('/api/listings/bulk/auto-respond')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ enabled: true });
    expect(res.status).toBe(200);
    expect(res.body.updated).toBeGreaterThanOrEqual(2);

    const refreshed = await Listing.find({ _id: { $in: [arListing._id, plainListing._id] } });
    for (const l of refreshed) {
      expect(l.autoRespond.enabled).toBe(true);
      expect(l.autoRespond.minPrice).toBe(l.price);
      expect(l.autoRespond.currency).toBe('USD');
    }
  });

  test('AR.14 PATCH /api/listings/bulk/auto-respond requires a boolean enabled and rejects invalid bodies', async () => {
    const res = await request(app)
      .patch('/api/listings/bulk/auto-respond')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ enabled: 'yes' });
    expect(res.status).toBe(400);
  });

  test('AR.15 PATCH /api/listings/bulk/auto-respond disabled=false turns auto-respond OFF for all seller listings', async () => {
    const res = await request(app)
      .patch('/api/listings/bulk/auto-respond')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ enabled: false });
    expect(res.status).toBe(200);
    const refreshed = await Listing.find({ _id: { $in: [arListing._id, plainListing._id] } });
    for (const l of refreshed) {
      expect(l.autoRespond.enabled).toBe(false);
    }
  });
});
