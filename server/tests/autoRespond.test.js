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
let liker2, liker2Token, liker3, liker3Token;
const testUserIds = [];
const testListingIds = [];

const mk = (name, email) => User.create({
  name, email: mkEmail(email), password: 'password123', emailVerified: true,
  country: 'US', currency: 'USD',
});

beforeAll(async () => {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/trenddrop_test');
  }
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

  test('AR.16 PATCH /api/listings/bulk/auto-respond with percentOff=5 enables auto-respond with minPrice = 95% of list price', async () => {
    const res = await request(app)
      .patch('/api/listings/bulk/auto-respond')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ enabled: true, percentOff: 5 });
    expect(res.status).toBe(200);
    expect(res.body.percentOff).toBe(5);
    expect(res.body.updated).toBeGreaterThanOrEqual(2);
    expect(res.body.message).toContain('5% off');

    const refreshed = await Listing.find({ _id: { $in: [arListing._id, plainListing._id] } });
    for (const l of refreshed) {
      expect(l.autoRespond.enabled).toBe(true);
      const expectedMin = Math.round(Number(l.price) * 0.95 * 100) / 100;
      expect(l.autoRespond.minPrice).toBe(expectedMin);
      expect(l.autoRespond.currency).toBe('USD');
    }
  });

  test('AR.17 PATCH /api/listings/bulk/auto-respond with percentOff=0 sets minPrice = list price', async () => {
    const res = await request(app)
      .patch('/api/listings/bulk/auto-respond')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ enabled: true, percentOff: 0 });
    expect(res.status).toBe(200);
    expect(res.body.percentOff).toBe(0);

    const refreshed = await Listing.find({ _id: { $in: [arListing._id, plainListing._id] } });
    for (const l of refreshed) {
      expect(l.autoRespond.enabled).toBe(true);
      expect(l.autoRespond.minPrice).toBe(Number(l.price));
    }
  });

  test('AR.18 PATCH /api/listings/bulk/auto-respond rejects percentOff outside 0..100', async () => {
    const neg = await request(app)
      .patch('/api/listings/bulk/auto-respond')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ enabled: true, percentOff: -5 });
    expect(neg.status).toBe(400);

    const over = await request(app)
      .patch('/api/listings/bulk/auto-respond')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ enabled: true, percentOff: 150 });
    expect(over.status).toBe(400);

    const nan = await request(app)
      .patch('/api/listings/bulk/auto-respond')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ enabled: true, percentOff: 'abc' });
    expect(nan.status).toBe(400);
  });

  test('AR.19 PATCH /api/listings/bulk/auto-respond without percentOff keeps legacy minPrice = list price', async () => {
    const res = await request(app)
      .patch('/api/listings/bulk/auto-respond')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ enabled: true });
    expect(res.status).toBe(200);
    expect(res.body.percentOff).toBeNull();

    const refreshed = await Listing.find({ _id: { $in: [arListing._id, plainListing._id] } });
    for (const l of refreshed) {
      expect(l.autoRespond.enabled).toBe(true);
      expect(l.autoRespond.minPrice).toBe(Number(l.price));
    }
  });

  test('AR.20 PATCH /api/listings/bulk/auto-respond with percentOff=25 applies correctly to fractional prices', async () => {
    // Create a listing with a fractional price to verify rounding to cents.
    const frac = await Listing.create({
      seller: seller._id, title: 'Fractional Item', description: 'd', price: 99.99,
      category: 'Accessories', condition: 'Good', currency: 'USD',
      available: true, quantity: 3, shipsFrom: 'US',
    });
    testListingIds.push(frac._id);

    const res = await request(app)
      .patch('/api/listings/bulk/auto-respond')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ enabled: true, percentOff: 25 });
    expect(res.status).toBe(200);

    const refreshed = await Listing.findById(frac._id);
    expect(refreshed.autoRespond.enabled).toBe(true);
    // 99.99 * 0.75 = 74.9925 → rounds to 74.99
    expect(refreshed.autoRespond.minPrice).toBe(74.99);
  });

  test('AR.21 bulk auto-respond still succeeds for seeded/legacy listings that violate non-autoRespond schema fields (weight < 0.1)', async () => {
    // Production regression: server/seed.js creates listings through a
    // simplified schema with weight below the real model's min (0.1).
    // A per-listing save() runs FULL-document validation and throws on those
    // docs, 500ing the whole bulk update. Insert one the same way the seed
    // does (raw collection insert, bypassing Mongoose validation).
    const raw = await Listing.collection.insertOne({
      seller: seller._id,
      title: 'Legacy Seed Item (weight 0.05)',
      description: 'Seeded via the simplified seed schema',
      price: 30,
      category: 'Beauty',
      condition: 'Good',
      shipsFrom: 'US',
      sold: false,
      available: true,
      quantity: 1,
      weight: 0.05, // violates real schema min: 0.1
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const legacyId = raw.insertedId;
    testListingIds.push(legacyId);

    // Sanity: a full-document save() on this doc must fail — this is exactly
    // what 500'd production before the pipeline-update fix.
    const doc = await Listing.findById(legacyId);
    let saveThrew = false;
    try {
      doc.autoRespond = { enabled: true, minPrice: 10 };
      await doc.save();
    } catch { saveThrew = true; }
    expect(saveThrew).toBe(true);

    // The bulk update must still succeed (pipeline update skips full-doc validation).
    const res = await request(app)
      .patch('/api/listings/bulk/auto-respond')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ enabled: true, percentOff: 5 });
    expect(res.status).toBe(200);

    const refreshed = await Listing.findById(legacyId);
    expect(refreshed.autoRespond.enabled).toBe(true);
    expect(refreshed.autoRespond.minPrice).toBe(28.5); // 30 × 0.95
    expect(refreshed.autoRespond.currency).toBe('USD');
  });

  test('AR.22 bulk update enables auto-offer to likers by default → a fresh liker instantly receives an accepted offer at minPrice', async () => {
    // Production regression: bulk-enable must turn ON autoOfferToLikers
    // (likers get instant offers), otherwise liking does nothing for buyers.
    const res = await request(app)
      .patch('/api/listings/bulk/auto-respond')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ enabled: true, percentOff: 5 });
    expect(res.status).toBe(200);
    expect(res.body.autoOfferToLikers).toBe(true);

    const afterBulk = await Listing.findById(arListing._id);
    expect(afterBulk.autoRespond.enabled).toBe(true);
    expect(afterBulk.autoRespond.autoOfferToLikers).toBe(true);
    expect(afterBulk.autoRespond.minPrice).toBe(95); // 100 × 0.95

    // A fresh liker likes the listing → auto-offer arrives instantly.
    liker2 = await mk('ARLiker2', 'liker2');
    testUserIds.push(liker2._id);
    liker2Token = jwt.sign({ id: liker2._id }, JWT_SECRET, { expiresIn: '30d' });

    const likeRes = await request(app)
      .post(`/api/listings/${arListing._id}/like`)
      .set('Authorization', `Bearer ${liker2Token}`);
    expect(likeRes.status).toBe(200);
    expect(likeRes.body.liked).toBe(true);

    const offer = await Offer.findOne({ listing: arListing._id, buyer: liker2._id });
    expect(offer).toBeDefined();
    expect(offer.status).toBe('accepted');
    expect(offer.amount).toBe(95);
    expect(offer.acceptedPrice).toBe(95);
    expect(offer.currency).toBe('USD');
    expect(offer.autoResponded).toBe(true);

    const liker2Doc = await User.findById(liker2._id);
    expect(liker2Doc.notifications.some((n) => n.type === 'offer')).toBe(true);
  });

  test('AR.22b explicit autoOfferToLikers=false → likers do NOT get offers', async () => {
    const off = await request(app)
      .patch('/api/listings/bulk/auto-respond')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ enabled: true, percentOff: 10, autoOfferToLikers: false });
    expect(off.status).toBe(200);
    expect(off.body.autoOfferToLikers).toBe(false);

    const afterOff = await Listing.findById(arListing._id);
    expect(afterOff.autoRespond.autoOfferToLikers).toBe(false);
    expect(afterOff.autoRespond.minPrice).toBe(90); // 100 × 0.90

    liker3 = await mk('ARLiker3', 'liker3');
    testUserIds.push(liker3._id);
    liker3Token = jwt.sign({ id: liker3._id }, JWT_SECRET, { expiresIn: '30d' });

    const like3 = await request(app)
      .post(`/api/listings/${arListing._id}/like`)
      .set('Authorization', `Bearer ${liker3Token}`);
    expect(like3.status).toBe(200);
    expect(like3.body.liked).toBe(true);
    const noOffer = await Offer.findOne({ listing: arListing._id, buyer: liker3._id });
    expect(noOffer).toBeNull();
  });

  test('AR.23 liking (and unliking) a seeded/legacy listing with schema-invalid fields succeeds — atomic ops, no full-document save', async () => {
    // Same legacy-doc class as AR.21, but for the LIKE flow: the endpoint
    // used to run listing.save()/user.save() (full-document validation),
    // which throws on schema-invalid legacy docs and 500s the like.
    const raw = await Listing.collection.insertOne({
      seller: seller._id,
      title: 'Legacy Like Item (weight 0.05)',
      description: 'Seeded via the simplified seed schema',
      price: 40,
      category: 'Beauty',
      condition: 'Good',
      shipsFrom: 'US',
      sold: false,
      available: true,
      quantity: 1,
      weight: 0.05, // violates real schema min: 0.1
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const legacyId = raw.insertedId;
    testListingIds.push(legacyId);

    // Sanity: full-document save() on this doc throws (what 500'd likes before).
    const doc = await Listing.findById(legacyId);
    let saveThrew = false;
    try {
      doc.likesCount = 1;
      await doc.save();
    } catch { saveThrew = true; }
    expect(saveThrew).toBe(true);

    // Like must succeed anyway.
    const likeRes = await request(app)
      .post(`/api/listings/${legacyId}/like`)
      .set('Authorization', `Bearer ${liker2Token}`);
    expect(likeRes.status).toBe(200);
    expect(likeRes.body.liked).toBe(true);
    expect(likeRes.body.likes.some((l) => l.toString() === liker2._id.toString())).toBe(true);

    const afterLike = await Listing.findById(legacyId);
    expect(afterLike.likesCount).toBe(1);
    expect(afterLike.likes.some((l) => l.toString() === liker2._id.toString())).toBe(true);

    // Wishlist got the item (no auto-respond on this listing → no offer).
    const Wishlist = require('../models/Wishlist');
    const wl = await Wishlist.findOne({ user: liker2._id });
    expect(wl).toBeDefined();
    expect(wl.items.some((i) => i.listing.toString() === legacyId.toString())).toBe(true);
    const noOffer = await Offer.findOne({ listing: legacyId, buyer: liker2._id });
    expect(noOffer).toBeNull();

    // Seller received the like notification.
    const sellerDoc = await User.findById(seller._id);
    expect(sellerDoc.notifications.some((n) => n.type === 'like' && n.listing && n.listing.toString() === legacyId.toString())).toBe(true);

    // Unlike.
    const unlikeRes = await request(app)
      .post(`/api/listings/${legacyId}/like`)
      .set('Authorization', `Bearer ${liker2Token}`);
    expect(unlikeRes.status).toBe(200);
    expect(unlikeRes.body.liked).toBe(false);
    const afterUnlike = await Listing.findById(legacyId);
    expect(afterUnlike.likesCount).toBe(0);
    expect(afterUnlike.likes.length).toBe(0);
  });
});
