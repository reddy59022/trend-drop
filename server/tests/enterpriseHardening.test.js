/**
 * Enterprise hardening regressions (red-first suite).
 *
 * Each test documents a defect that existed in production code:
 *  EH.1  login/me never returned `role`, so role-gated client routes
 *        (admin panel, legal admin) could never open.
 *  EH.2  PUT /auth/profile returned the raw Mongoose user document,
 *        including the bcrypt password hash and email-verification token.
 *  EH.3  PUT /auth/avatar had the same raw-document leak.
 *  EH.4  PUT /auth/profile let any user grant themselves `isVerified`
 *        (the public "Verified Seller" badge).
 *  EH.5  The public profile listingsCount included drafts/paused listings.
 *  EH.6  Comments could be posted on a draft (unpublished) listing.
 *  EH.7  A soft-deleted listing stayed publicly retrievable by id.
 */
const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const app = require('../server');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Comment = require('../models/Comment');
const Party = require('../models/Party');
const Collection = require('../models/Collection');
const LiveEvent = require('../models/LiveEvent');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';
const tokenFor = (id) => jwt.sign({ id }, JWT_SECRET, { expiresIn: '30d' });

let seller;
let buyer;
let sellerToken;
let buyerToken;
let activeListing;
let draftListing;
let deletedListing;

const listingFixture = (overrides = {}) => ({
  title: 'Enterprise Fixture',
  description: 'Fixture listing for hardening tests',
  price: 50,
  category: 'Women',
  condition: 'Good',
  images: ['https://example.com/fixture.jpg'],
  seller: seller._id,
  quantity: 1,
  status: 'active',
  available: true,
  sold: false,
  ...overrides,
});

beforeAll(async () => {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/trenddrop_test');
  }
  const base = `hardening_${Date.now()}_`;
  seller = await User.create({
    name: 'Hardening Seller',
    email: `${base}seller@test.com`,
    password: 'password123',
    country: 'US',
    currency: 'USD',
    emailVerified: true,
    authProvider: 'email',
  });
  buyer = await User.create({
    name: 'Hardening Buyer',
    email: `${base}buyer@test.com`,
    password: 'password123',
    country: 'US',
    currency: 'USD',
    emailVerified: true,
    authProvider: 'email',
  });
  sellerToken = tokenFor(seller._id);
  buyerToken = tokenFor(buyer._id);

  activeListing = await Listing.create(listingFixture({ title: 'Active Fixture' }));
  draftListing = await Listing.create(listingFixture({
    title: 'Draft Fixture', status: 'draft', available: false,
  }));
  deletedListing = await Listing.create(listingFixture({
    title: 'Deleted Fixture', status: 'deleted', available: false,
  }));
});

afterAll(async () => {
  await Comment.deleteMany({});
  await Listing.deleteMany({ seller: seller._id });
  await User.deleteMany({ _id: { $in: [seller._id, buyer._id] } });
  // Do NOT disconnect — jest.setup.js owns DB cleanup between files.
});

describe('Enterprise auth payloads', () => {
  test('EH.1 login and /auth/me expose the authoritative role', async () => {
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: buyer.email, password: 'password123' });

    expect(login.status).toBe(200);
    expect(login.body.user.role).toBe('user');

    const me = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${buyerToken}`);

    expect(me.status).toBe(200);
    expect(me.body.role).toBe('user');
  });

  test('EH.2 profile update never returns password or verification secrets', async () => {
    const res = await request(app)
      .put('/api/auth/profile')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ bio: 'No secrets here' });

    expect(res.status).toBe(200);
    expect(res.body.bio).toBe('No secrets here');
    expect(res.body.password).toBeUndefined();
    expect(res.body.verificationToken).toBeUndefined();
    expect(res.body.verificationTokenExpires).toBeUndefined();
  });

  test('EH.3 avatar update never returns the password hash', async () => {
    const res = await request(app)
      .put('/api/auth/avatar')
      .set('Authorization', `Bearer ${buyerToken}`)
      .attach('avatar', Buffer.from([0x89, 0x50, 0x4e, 0x47]), {
        filename: 'avatar.png',
        contentType: 'image/png',
      });

    expect(res.status).toBe(200);
    expect(res.body.password).toBeUndefined();
  });

  test('EH.4 a user cannot self-grant the verified badge', async () => {
    const res = await request(app)
      .put('/api/auth/profile')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ isVerified: true });

    expect(res.status).toBe(400);
    const stored = await User.findById(buyer._id);
    expect(stored.isVerified).toBe(false);
  });
});

describe('Catalog and privacy invariants', () => {
  test('EH.5 public profile listingsCount matches the public closet', async () => {
    const res = await request(app).get(`/api/users/${seller._id}`);

    expect(res.status).toBe(200);
    // Only the active listing is publicly visible; draft/deleted are not.
    expect(res.body.listingsCount).toBe(1);
  });

  test('EH.6 comments cannot be posted on a draft listing', async () => {
    const res = await request(app)
      .post(`/api/comments/${draftListing._id}`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ text: 'Commenting on an unpublished draft' });

    expect([400, 404]).toContain(res.status);
    expect(await Comment.countDocuments({ listingId: draftListing._id })).toBe(0);
  });

  test('EH.7 soft-deleted listings are not publicly retrievable', async () => {
    const res = await request(app).get(`/api/listings/${deletedListing._id}`);
    expect(res.status).toBe(404);

    const ownerRes = await request(app)
      .get(`/api/listings/${deletedListing._id}`)
      .set('Authorization', `Bearer ${sellerToken}`);
    expect(ownerRes.status).toBe(404);
  });

  test('active listings remain public (control)', async () => {
    const res = await request(app).get(`/api/listings/${activeListing._id}`);
    expect(res.status).toBe(200);
    expect(res.body.listing.title).toBe('Active Fixture');
  });

  test('EH.8 live-event viewCount counts unique viewers (no off-by-one)', async () => {
    const created = await request(app)
      .post('/api/live-events')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({
        title: 'Viewer Count Event',
        listingIds: [String(activeListing._id)],
        startTime: new Date(Date.now() + 60_000),
        endTime: new Date(Date.now() + 3_600_000),
      });
    expect(created.status).toBe(201);

    const eventId = created.body._id;
    await LiveEvent.updateOne({ _id: eventId }, { $set: { status: 'live', viewers: [], viewCount: 0 } });

    const first = await request(app)
      .post(`/api/live-events/${eventId}/join`)
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(first.status).toBe(200);
    expect(first.body.viewers).toBe(1);
    expect(first.body.viewCount).toBe(1);

    const second = await request(app)
      .post(`/api/live-events/${eventId}/join`)
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(second.status).toBe(200);
    expect(second.body.viewers).toBe(1);
    expect(second.body.viewCount).toBe(1);
  });

  test('EH.9 joining a party twice keeps participantCount at one', async () => {
    const party = await Party.create({
      hostId: seller._id,
      hostName: 'Hardening Seller',
      title: 'Idempotent Join Party',
      category: 'Women',
      startTime: new Date(Date.now() + 60_000),
      endTime: new Date(Date.now() + 3_600_000),
    });

    const first = await request(app)
      .post(`/api/parties/${party._id}/join`)
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(first.status).toBe(200);
    expect(first.body.participantCount).toBe(1);

    const second = await request(app)
      .post(`/api/parties/${party._id}/join`)
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(second.status).toBe(200);
    expect(second.body.participantCount).toBe(1);
  });

  test('EH.10 a deactivated collection is hidden from the public', async () => {
    const collection = await Collection.create({
      seller: seller._id,
      name: 'Hidden Collection',
      isActive: false,
    });

    const publicRes = await request(app).get(`/api/collections/${collection._id}`);
    expect(publicRes.status).toBe(404);

    const ownerRes = await request(app)
      .get(`/api/collections/${collection._id}`)
      .set('Authorization', `Bearer ${sellerToken}`);
    expect(ownerRes.status).toBe(200);
  });

  test('EH.11 a private party is hidden from non-hosts', async () => {
    const party = await Party.create({
      hostId: seller._id,
      hostName: 'Hardening Seller',
      title: 'Private Party',
      category: 'Women',
      startTime: new Date(Date.now() + 60_000),
      endTime: new Date(Date.now() + 3_600_000),
      isPublic: false,
    });

    const publicRes = await request(app).get(`/api/parties/${party._id}`);
    expect(publicRes.status).toBe(404);

    const hostRes = await request(app)
      .get(`/api/parties/${party._id}`)
      .set('Authorization', `Bearer ${sellerToken}`);
    expect(hostRes.status).toBe(200);
  });
});
