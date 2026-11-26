/**
 * TDD round: referral rewards require a completed referral, and generating a
 * code after expiry must replace the stale code.
 */
const mongoose = require('mongoose');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../server');
const User = require('../models/User');
const Referral = require('../models/Referral');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';
const tokenFor = (user) => jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '30d' });
const created = { users: [], referrals: [] };

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

const makeReferral = async (referrer, overrides = {}) => {
  const referral = await Referral.create({
    referrer,
    code: `REF${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
    status: 'active',
    uses: 0,
    ...overrides,
  });
  created.referrals.push(referral._id);
  return referral;
};

beforeAll(async () => {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/trenddrop_test');
  }
});

afterAll(async () => {
  await Referral.deleteMany({ _id: { $in: created.referrals } });
  await User.deleteMany({ _id: { $in: created.users } });
  await mongoose.connection.close();
});

describe('RH.1 referral rewards require a completed referral', () => {
  test('claiming with no referred users is rejected and credits nothing', async () => {
    const user = await makeUser('ref_claim_none');
    await makeReferral(user._id, { uses: 0, referredUsers: [] });

    const before = await User.findById(user._id);
    const res = await request(app)
      .post('/api/referrals/claim')
      .set('Authorization', `Bearer ${tokenFor(user)}`);

    expect(res.status).toBe(400);
    const after = await User.findById(user._id);
    expect(after.balance.available).toBe(before.balance.available);
  });

  test('claiming with a completed referral still pays exactly that referral', async () => {
    const user = await makeUser('ref_claim_one');
    const friend = await makeUser('ref_claim_friend');
    await makeReferral(user._id, {
      uses: 1,
      referredUsers: [{ user: friend._id, rewardGiven: false }],
      rewardAmount: 10,
    });

    const res = await request(app)
      .post('/api/referrals/claim')
      .set('Authorization', `Bearer ${tokenFor(user)}`);
    expect(res.status).toBe(200);
    expect(res.body.newBalance).toBe(10);
  });
});

describe('RH.2 expired codes are not regenerated as-is', () => {
  test('generate replaces an expired active code with a fresh one', async () => {
    const user = await makeUser('ref_expired');
    const expired = await makeReferral(user._id, {
      expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    });

    const res = await request(app)
      .post('/api/referrals/generate')
      .set('Authorization', `Bearer ${tokenFor(user)}`);
    expect(res.status).toBe(201);
    expect(res.body.referral.code).not.toBe(expired.code);
    created.referrals.push(res.body.referral._id);

    const old = await Referral.findById(expired._id);
    expect(old.status).toBe('expired');
  });
});
