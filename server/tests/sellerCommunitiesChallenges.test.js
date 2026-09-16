const mongoose = require('mongoose');
const request = require('supertest');
const app = require('../server');
const User = require('../models/User');
const SellerCommunity = require('../models/SellerCommunity');
const jwt = require('jsonwebtoken');

/**
 * TDD Round 26 — Seller-community challenges input contract.
 *
 * BUG (documented as a "tolerated production quirk" in SESSION_LOG §D and
 * papered over by the prod E2E spec 17 with `expect([200, 500]).toContain`):
 * the challenge subdocument schema declares `rewards: String`, but the real
 * E2E client posts `rewards: []` (an array) to
 * POST /api/seller-communities/:id/challenges — Mongoose CastError -> 500.
 * A missing/blank `title` and a malformed `endDate` also surface as 500s
 * instead of 4xx client errors.
 *
 * Contract asserted here:
 *   - array rewards are accepted and normalized to a comma-joined string
 *   - empty array rewards are accepted ('')
 *   - string rewards keep working unchanged
 *   - non-string scalar rewards (number) are coerced to a string
 *   - missing / blank title => 400 (never 500)
 *   - malformed endDate => 400 (never 500)
 *   - non-moderator members still get 403 (RBAC unchanged)
 */

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';

let moderator;
let moderatorToken;
let member;
let memberToken;
let community;

const mkUser = (name, email) => User.create({
  name, email, password: 'password123',
  country: 'US', currency: 'USD', emailVerified: true, authProvider: 'email',
  shippingAddress: { fullName: name, street1: '1 St', city: 'C', state: 'CA', postalCode: '90210', country: 'US' },
});

beforeAll(async () => {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/trenddrop_test');
  }

  const run = `ch26_${Date.now()}`;
  moderator = await mkUser('Challenge Mod', `${run}_mod@test.com`);
  member = await mkUser('Challenge Member', `${run}_member@test.com`);

  moderatorToken = jwt.sign({ id: moderator._id }, JWT_SECRET, { expiresIn: '30d' });
  memberToken = jwt.sign({ id: member._id }, JWT_SECRET, { expiresIn: '30d' });

  community = await SellerCommunity.create({
    name: 'Challenge Contract Community',
    description: 'verifies the challenges endpoint input contract',
    members: [moderator._id, member._id],
    moderators: [moderator._id],
  });
});

afterAll(async () => {
  if (moderator) await User.findByIdAndDelete(moderator._id);
  if (member) await User.findByIdAndDelete(member._id);
  await SellerCommunity.deleteMany({});
  await mongoose.connection.close();
});

const postChallenge = (token, body) =>
  request(app)
    .post(`/api/seller-communities/${community._id}/challenges`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);

// This jest major doesn't support expect()'s second (message) argument, so
// status assertions carry context via a helper that throws on mismatch.
const expectStatus = (res, status, label = 'request') => {
  if (res.status !== status) {
    throw new Error(`${label}: expected HTTP ${status}, got ${res.status} — body=${JSON.stringify(res.body)}`);
  }
  expect(res.status).toBe(status);
};

const lastChallenge = (res) => {
  const list = res.body.challenges || [];
  return list[list.length - 1];
};

describe('TDD R26 — POST /api/seller-communities/:id/challenges input contract', () => {
  test('accepts array-shaped rewards (the real E2E client payload) and persists them', async () => {
    const res = await postChallenge(moderatorToken, {
      title: 'Array Rewards Challenge',
      description: 'rewards posted as an array must not 500',
      endDate: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
      rewards: ['First sale: $10 credit', '5 listings sold'],
    });

    expectStatus(res, 200);
    const challenge = lastChallenge(res);
    expect(challenge.title).toBe('Array Rewards Challenge');
    // Normalized to the schema's string shape, keeping every entry readable.
    expect(challenge.rewards).toBe('First sale: $10 credit, 5 listings sold');
  });

  test('accepts an EMPTY rewards array (the exact e2e spec 17 payload)', async () => {
    const res = await postChallenge(moderatorToken, {
      title: 'E2E Challenge',
      description: 'test',
      endDate: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
      rewards: [],
    });

    expectStatus(res, 200);
    expect(lastChallenge(res).rewards).toBe('');
  });

  test('still accepts string rewards unchanged', async () => {
    const res = await postChallenge(moderatorToken, {
      title: 'String Rewards Challenge',
      rewards: '$50 shop credit',
    });

    expectStatus(res, 200);
    expect(lastChallenge(res).rewards).toBe('$50 shop credit');
  });

  test('coerces non-string scalar rewards (number) instead of crashing', async () => {
    const res = await postChallenge(moderatorToken, {
      title: 'Numeric Rewards Challenge',
      rewards: 25,
    });

    expectStatus(res, 200);
    expect(lastChallenge(res).rewards).toBe('25');
  });

  test('missing title is a client error (400), never a 500', async () => {
    const res = await postChallenge(moderatorToken, {
      description: 'no title supplied',
      endDate: new Date().toISOString(),
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/title/i);
  });

  test('blank title is a client error (400), never a 500', async () => {
    const res = await postChallenge(moderatorToken, { title: '   ' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/title/i);
  });

  test('non-string title is a client error (400), never a 500', async () => {
    const res = await postChallenge(moderatorToken, { title: 42 });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/title/i);
  });

  test('malformed endDate is a client error (400), never a 500', async () => {
    const res = await postChallenge(moderatorToken, {
      title: 'Bad Date Challenge',
      endDate: 'not-a-real-date',
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/date/i);
  });

  test('RBAC unchanged: a non-moderator member still cannot create challenges (403)', async () => {
    const res = await postChallenge(memberToken, {
      title: 'Member Challenge Attempt',
      rewards: [],
    });

    expect(res.status).toBe(403);
  });
});
