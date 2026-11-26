/**
 * TDD round: party lifecycle/privacy and comment thread integrity.
 * Written before fixes; the failing assertions document the defects.
 */
const mongoose = require('mongoose');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../server');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Party = require('../models/Party');
const Comment = require('../models/Comment');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';
const tokenFor = (user) => jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '30d' });
const created = { users: [], listings: [], parties: [], comments: [] };

const makeUser = async (label) => {
  const user = await User.create({
    name: `${label} User`,
    email: `${label}_${Date.now()}_${Math.random().toString(36).slice(2)}@test.com`,
    password: 'password123',
    country: 'US',
    currency: 'USD',
    emailVerified: true,
    authProvider: 'email',
    shippingAddress: { fullName: label, street1: '1 Main St', city: 'City', state: 'CA', postalCode: '90210', country: 'US' },
  });
  created.users.push(user._id);
  return user;
};

const makeListing = async (seller) => {
  const listing = await Listing.create({
    title: 'Party fixture item',
    description: 'Fixture',
    price: 25,
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

const partyBody = (overrides = {}) => ({
  title: 'Weekend party',
  description: 'Fixture party',
  category: 'Women',
  startTime: new Date(Date.now() + 3600000).toISOString(),
  endTime: new Date(Date.now() + 7200000).toISOString(),
  discountPercent: 10,
  ...overrides,
});

const makeParty = async (host, overrides = {}) => {
  const party = await Party.create({
    hostId: host._id,
    hostName: host.name,
    title: 'Fixture party',
    category: 'Women',
    startTime: new Date(Date.now() + 3600000),
    endTime: new Date(Date.now() + 7200000),
    discountPercent: 10,
    status: 'scheduled',
    ...overrides,
  });
  created.parties.push(party._id);
  return party;
};

beforeAll(async () => {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/trenddrop_test');
  }
});

afterAll(async () => {
  await Comment.deleteMany({ _id: { $in: created.comments } });
  await Party.deleteMany({ _id: { $in: created.parties } });
  await Listing.deleteMany({ _id: { $in: created.listings } });
  await User.deleteMany({ _id: { $in: created.users } });
  await mongoose.connection.close();
});

describe('PC.1 party privacy is honoured', () => {
  test('a party created with isPublic:false is hidden from other users', async () => {
    const host = await makeUser('pp_host');
    const other = await makeUser('pp_other');

    const createdRes = await request(app)
      .post('/api/parties')
      .set('Authorization', `Bearer ${tokenFor(host)}`)
      .send(partyBody({ isPublic: false }));
    expect(createdRes.status).toBe(201);
    created.parties.push(createdRes.body.party._id);
    expect(createdRes.body.party.isPublic).toBe(false);

    const asOther = await request(app).get(`/api/parties/${createdRes.body.party._id}`);
    expect(asOther.status).toBe(404);

    const asHost = await request(app)
      .get(`/api/parties/${createdRes.body.party._id}`)
      .set('Authorization', `Bearer ${tokenFor(host)}`);
    expect(asHost.status).toBe(200);
  });

  test('non-hosts cannot join a private party by id', async () => {
    const host = await makeUser('pp_host2');
    const other = await makeUser('pp_other2');
    const party = await makeParty(host, { isPublic: false });

    const res = await request(app)
      .post(`/api/parties/${party._id}/join`)
      .set('Authorization', `Bearer ${tokenFor(other)}`);
    expect(res.status).toBe(404);
  });
});

describe('PC.2 party lifecycle blocks stale joins', () => {
  test.each(['ended', 'cancelled'])('%s parties cannot be joined', async (status) => {
    const host = await makeUser(`pc_${status}_host`);
    const joiner = await makeUser(`pc_${status}_joiner`);
    const party = await makeParty(host, { status });

    const res = await request(app)
      .post(`/api/parties/${party._id}/join`)
      .set('Authorization', `Bearer ${tokenFor(joiner)}`);
    expect(res.status).toBe(400);

    const stored = await Party.findById(party._id);
    expect(stored.participantCount).toBe(0);
  });
});

describe('PC.3 party schedules and discounts are validated', () => {
  let host;

  beforeAll(async () => {
    host = await makeUser('pc_create_host');
  });

  const post = (body) => request(app)
    .post('/api/parties')
    .set('Authorization', `Bearer ${tokenFor(host)}`)
    .send(body);

  test('creation rejects an end time before the start time', async () => {
    const res = await post(partyBody({
      startTime: new Date(Date.now() + 7200000).toISOString(),
      endTime: new Date(Date.now() + 3600000).toISOString(),
    }));
    expect(res.status).toBe(400);
  });

  test('creation rejects unparseable dates', async () => {
    const res = await post(partyBody({ startTime: 'not-a-date' }));
    expect(res.status).toBe(400);
  });

  test('creation rejects a discount outside the schema range', async () => {
    const res = await post(partyBody({ discountPercent: 80 }));
    expect(res.status).toBe(400);
  });

  test('updates cannot reverse the schedule', async () => {
    const party = await makeParty(host);
    const res = await request(app)
      .put(`/api/parties/${party._id}`)
      .set('Authorization', `Bearer ${tokenFor(host)}`)
      .send({
        startTime: new Date(Date.now() + 7200000).toISOString(),
        endTime: new Date(Date.now() + 3600000).toISOString(),
      });
    expect(res.status).toBe(400);

    const stored = await Party.findById(party._id);
    expect(new Date(stored.endTime).getTime()).toBeGreaterThan(new Date(stored.startTime).getTime());
  });
});

describe('PC.4 party attendee identities stay private', () => {
  test('public details expose the count but not participant ids', async () => {
    const host = await makeUser('pc_priv_host');
    const guest = await makeUser('pc_priv_guest');
    const party = await makeParty(host);
    await Party.updateOne({ _id: party._id }, { $push: { participants: guest._id }, $set: { participantCount: 1 } });

    const publicRes = await request(app).get(`/api/parties/${party._id}`);
    expect(publicRes.status).toBe(200);
    expect(publicRes.body.participantCount).toBe(1);
    expect(publicRes.body.participants).toBeUndefined();

    const hostRes = await request(app)
      .get(`/api/parties/${party._id}`)
      .set('Authorization', `Bearer ${tokenFor(host)}`);
    expect(hostRes.status).toBe(200);
    expect(hostRes.body.participants.map((p) => String(p._id || p))).toContain(String(guest._id));
  });
});

describe('PC.5 comment threads stay one level deep', () => {
  test('replying to a reply is rejected instead of creating an invisible comment', async () => {
    const seller = await makeUser('pc_comment_seller');
    const buyer = await makeUser('pc_comment_buyer');
    const listing = await makeListing(seller._id);

    const root = await request(app)
      .post(`/api/comments/${listing._id}`)
      .set('Authorization', `Bearer ${tokenFor(buyer)}`)
      .send({ text: 'Root comment' });
    expect(root.status).toBe(201);
    created.comments.push(root.body._id);

    const reply = await request(app)
      .post(`/api/comments/${listing._id}`)
      .set('Authorization', `Bearer ${tokenFor(seller)}`)
      .send({ text: 'First reply', parentId: root.body._id });
    expect(reply.status).toBe(201);
    created.comments.push(reply.body._id);

    const nested = await request(app)
      .post(`/api/comments/${listing._id}`)
      .set('Authorization', `Bearer ${tokenFor(buyer)}`)
      .send({ text: 'Reply to a reply', parentId: reply.body._id });
    expect(nested.status).toBe(400);

    const orphan = await Comment.findById(nested.body._id || new mongoose.Types.ObjectId());
    expect(orphan).toBeNull();
  });
});
