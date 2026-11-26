/**
 * TDD round: live-event and profile boundary defects.
 * Written before the fixes; every assertion here failed on the prior code.
 */
const mongoose = require('mongoose');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../server');
const User = require('../models/User');
const Listing = require('../models/Listing');
const LiveEvent = require('../models/LiveEvent');
const Transaction = require('../models/Transaction');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';
const tokenFor = (user) => jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '30d' });

const created = { users: [], listings: [], events: [], transactions: [] };

const makeUser = async (label, role = 'user') => {
  const user = await User.create({
    name: `${label} User`,
    email: `${label}_${Date.now()}_${Math.random().toString(36).slice(2)}@test.com`,
    password: 'password123',
    country: 'US',
    currency: 'USD',
    emailVerified: true,
    authProvider: 'email',
    role,
    shippingAddress: { fullName: label, street1: '1 Main St', city: 'City', state: 'CA', postalCode: '90210', country: 'US' },
  });
  created.users.push(user._id);
  return user;
};

const makeListing = async (seller) => {
  const listing = await Listing.create({
    title: 'Live hardening item',
    description: 'Fixture',
    price: 100,
    category: 'Women',
    condition: 'Good',
    images: ['https://example.com/item.jpg'],
    seller,
    quantity: 1,
    status: 'active',
    available: true,
  });
  created.listings.push(listing._id);
  return listing;
};

const makeEvent = async (host, listing, overrides = {}) => {
  const event = await LiveEvent.create({
    host,
    title: 'Hardening event',
    listings: [listing._id],
    startTime: new Date(Date.now() - 3600000),
    endTime: new Date(Date.now() + 3600000),
    status: 'live',
    maxViewers: 10,
    ...overrides,
  });
  created.events.push(event._id);
  return event;
};

const createBody = (listing, overrides = {}) => ({
  title: 'Scheduled event',
  description: 'Fixture event',
  listingIds: [listing._id],
  startTime: new Date(Date.now() + 3600000).toISOString(),
  endTime: new Date(Date.now() + 7200000).toISOString(),
  discount: 10,
  maxViewers: 50,
  ...overrides,
});

beforeAll(async () => {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/trenddrop_test');
  }
});

afterAll(async () => {
  await Transaction.deleteMany({ _id: { $in: created.transactions } });
  await LiveEvent.deleteMany({ _id: { $in: created.events } });
  await Listing.deleteMany({ _id: { $in: created.listings } });
  await User.deleteMany({ _id: { $in: created.users } });
  await mongoose.connection.close();
});

describe('LH.1 live-event revenue statistics are private', () => {
  test('anonymous callers are rejected', async () => {
    const host = await makeUser('stats_host');
    const listing = await makeListing(host._id);
    await makeEvent(host._id, listing);

    const res = await request(app).get(`/api/live-events/stats/${host._id}`);
    expect(res.status).toBe(401);
  });

  test('unrelated sellers cannot read another host revenue', async () => {
    const host = await makeUser('stats_host2');
    const other = await makeUser('stats_other');
    const listing = await makeListing(host._id);
    await makeEvent(host._id, listing);

    const res = await request(app)
      .get(`/api/live-events/stats/${host._id}`)
      .set('Authorization', `Bearer ${tokenFor(other)}`);
    expect(res.status).toBe(403);
  });

  test('the host and an admin can read the statistics', async () => {
    const host = await makeUser('stats_host3');
    const admin = await makeUser('stats_admin', 'admin');
    const listing = await makeListing(host._id);
    await makeEvent(host._id, listing);

    const asHost = await request(app)
      .get(`/api/live-events/stats/${host._id}`)
      .set('Authorization', `Bearer ${tokenFor(host)}`);
    expect(asHost.status).toBe(200);
    expect(asHost.body.totalEvents).toBe(1);

    const asAdmin = await request(app)
      .get(`/api/live-events/stats/${host._id}`)
      .set('Authorization', `Bearer ${tokenFor(admin)}`);
    expect(asAdmin.status).toBe(200);
  });
});

describe('LH.2 live-event creation validates pricing and scheduling', () => {
  let host;
  let listing;

  beforeAll(async () => {
    host = await makeUser('create_host');
    listing = await makeListing(host._id);
  });

  const post = (body) => request(app)
    .post('/api/live-events')
    .set('Authorization', `Bearer ${tokenFor(host)}`)
    .send(body);

  test.each([150, -5, '50', Number.NaN])('rejects an invalid discount (%p)', async (discount) => {
    const res = await post(createBody(listing, { discount }));
    expect(res.status).toBe(400);
  });

  test('rejects an end time before the start time', async () => {
    const res = await post(createBody(listing, {
      startTime: new Date(Date.now() + 7200000).toISOString(),
      endTime: new Date(Date.now() + 3600000).toISOString(),
    }));
    expect(res.status).toBe(400);
  });

  test('rejects unparseable dates instead of throwing a cast error', async () => {
    const res = await post(createBody(listing, { startTime: 'not-a-date' }));
    expect(res.status).toBe(400);
  });

  test('rejects a blank or whitespace-only title', async () => {
    const res = await post(createBody(listing, { title: '   ' }));
    expect(res.status).toBe(400);
  });

  test('rejects titles longer than the schema limit', async () => {
    const res = await post(createBody(listing, { title: 'x'.repeat(101) }));
    expect(res.status).toBe(400);
  });

  test.each([0, -1, 1.5, 'ten'])('rejects an invalid maxViewers (%p)', async (maxViewers) => {
    const res = await post(createBody(listing, { maxViewers }));
    expect(res.status).toBe(400);
  });
});

describe('LH.3 live-event joins respect lifecycle and capacity', () => {
  test('ended and cancelled events cannot be joined', async () => {
    const host = await makeUser('join_host');
    const viewer = await makeUser('join_viewer');
    const listing = await makeListing(host._id);

    for (const status of ['ended', 'cancelled']) {
      const event = await makeEvent(host._id, listing, { status });
      const res = await request(app)
        .post(`/api/live-events/${event._id}/join`)
        .set('Authorization', `Bearer ${tokenFor(viewer)}`);
      expect(res.status).toBe(400);
    }
  });

  test('concurrent joins cannot exceed maxViewers', async () => {
    const host = await makeUser('race_host');
    const listing = await makeListing(host._id);
    const buyers = await Promise.all(
      Array.from({ length: 5 }, (_, i) => makeUser(`race_buyer_${i}`)),
    );
    const event = await makeEvent(host._id, listing, { maxViewers: 2 });

    const responses = await Promise.all(buyers.map((buyer) => request(app)
      .post(`/api/live-events/${event._id}/join`)
      .set('Authorization', `Bearer ${tokenFor(buyer)}`)));

    const accepted = responses.filter((r) => r.status === 200);
    expect(accepted.length).toBeLessThanOrEqual(2);

    const stored = await LiveEvent.findById(event._id);
    expect(stored.viewers.length).toBeLessThanOrEqual(2);
    expect(stored.viewCount).toBeLessThanOrEqual(2);
  });
});

describe('LH.4 live-event pricing clamps legacy discounts', () => {
  test('a legacy discount above 100 cannot produce a negative price', async () => {
    const host = await makeUser('legacy_host');
    const buyer = await makeUser('legacy_buyer');
    const listing = await makeListing(host._id);
    const event = await makeEvent(host._id, listing, { discount: 150 });

    const res = await request(app)
      .post(`/api/live-events/${event._id}/purchase`)
      .set('Authorization', `Bearer ${tokenFor(buyer)}`)
      .send({ listingId: listing._id });

    expect(res.status).toBe(200);
    expect(res.body.discountedPrice).toBeGreaterThanOrEqual(0);
    expect(res.body.discountedPrice).toBeLessThanOrEqual(100);
    expect(res.body.discount).toBeLessThanOrEqual(100);
  });
});

describe('LH.5 attendee identities are not public', () => {
  let host;
  let viewer;
  let event;
  let listing;

  beforeAll(async () => {
    host = await makeUser('privacy_host');
    viewer = await makeUser('privacy_viewer');
    listing = await makeListing(host._id);
    event = await makeEvent(host._id, listing);
    await LiveEvent.updateOne({ _id: event._id }, { $push: { viewers: viewer._id }, $set: { viewCount: 1 } });
  });

  test('the public list exposes a count but not viewer identities', async () => {
    const res = await request(app).get('/api/live-events?limit=50');
    expect(res.status).toBe(200);
    const listed = res.body.events.find((e) => String(e._id) === String(event._id));
    expect(listed).toBeTruthy();
    expect(listed.viewerCount).toBe(1);
    expect(listed.viewers).toBeUndefined();
  });

  test('public event details expose a count but not viewer identities', async () => {
    const res = await request(app).get(`/api/live-events/${event._id}`);
    expect(res.status).toBe(200);
    expect(res.body.viewerCount).toBe(1);
    expect(res.body.viewers).toBeUndefined();
  });

  test('the host still sees the attendee list', async () => {
    const res = await request(app)
      .get(`/api/live-events/${event._id}`)
      .set('Authorization', `Bearer ${tokenFor(host)}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.viewers)).toBe(true);
    expect(res.body.viewers.map((v) => String(v._id || v))).toContain(String(viewer._id));
  });
});

describe('LH.6 profile updates cannot bypass marketplace policy', () => {
  test('unsupported countries are rejected', async () => {
    const user = await makeUser('profile_country');
    const res = await request(app)
      .put('/api/auth/profile')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ country: 'ZZ' });
    expect(res.status).toBe(400);
  });

  test('supported countries are accepted and normalized', async () => {
    const user = await makeUser('profile_country_ok');
    const res = await request(app)
      .put('/api/auth/profile')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ country: 'us' });
    expect(res.status).toBe(200);
    expect(res.body.country).toBe('US');
  });

  test('unsupported currencies are rejected', async () => {
    const user = await makeUser('profile_currency');
    const res = await request(app)
      .put('/api/auth/profile')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ currency: 'XXX' });
    expect(res.status).toBe(400);
  });

  test('a whitespace-only display name is rejected', async () => {
    const user = await makeUser('profile_name');
    const res = await request(app)
      .put('/api/auth/profile')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ name: '   ' });
    expect(res.status).toBe(400);
  });
});
