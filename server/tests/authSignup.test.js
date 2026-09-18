const request = require('supertest');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const app = require('../server');
const User = require('../models/User');
const PendingUser = require('../models/PendingUser');

const RUN = `signup_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const emailFor = (name) => `${name}_${RUN}@example.com`;
const password = 'StrongPass123!';

const register = (body = {}) => {
  const req = request(app).post('/api/auth/register');
  Object.entries(body).forEach(([key, value]) => {
    if (value !== undefined) req.field(key, value);
  });
  return req;
};

const validBody = (overrides = {}) => ({
  name: 'Global Test User',
  email: emailFor('user'),
  password,
  country: 'US',
  termsVersion: '2026-09-18.1',
  privacyVersion: '2026-09-18.1',
  termsAccepted: 'true',
  privacyAccepted: 'true',
  ageConfirmed: 'true',
  ...overrides,
});

const createPending = async (overrides = {}) => PendingUser.create({
  name: 'Pending User',
  email: emailFor(`pending_${Date.now()}`),
  password,
  country: 'US',
  verificationToken: `token_${Date.now()}_${Math.random().toString(36).slice(2)}`,
  verificationTokenExpires: new Date(Date.now() + 60 * 60 * 1000),
  expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  ...overrides,
});

beforeAll(async () => {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/trenddrop_test');
  }
});

afterAll(async () => {
  await PendingUser.deleteMany({ email: new RegExp(`_${RUN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}@example\\.com$`) });
  await User.deleteMany({ email: new RegExp(`_${RUN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}@example\\.com$`) });
});

describe('Global signup and verification contract', () => {
  test('SG.01 rejects missing name', async () => {
    const { name, ...body } = validBody();
    expect((await register(body)).status).toBe(400);
  });

  test('SG.02 rejects missing email', async () => {
    const { email, ...body } = validBody();
    expect((await register(body)).status).toBe(400);
  });

  test('SG.03 rejects missing password', async () => {
    const { password: omitted, ...body } = validBody();
    expect((await register(body)).status).toBe(400);
  });

  test('SG.04 rejects non-string credentials instead of returning 500', async () => {
    const res = await request(app).post('/api/auth/register').send({
      name: 123, email: emailFor('number'), password: true,
    });
    expect(res.status).toBe(400);
  });

  test('SG.05 rejects passwords shorter than eight characters', async () => {
    expect((await register(validBody({ email: emailFor('short'), password: '1234567' }))).status).toBe(400);
  });

  test('SG.06 rejects malformed email addresses', async () => {
    const invalidEmails = ['plain-address', 'missing@domain', '@example.com', 'a b@example.com'];
    for (const email of invalidEmails) {
      expect((await register(validBody({ email }))).status).toBe(400);
    }
  });

  test('SG.07 rejects blank or overlong names', async () => {
    expect((await register(validBody({ email: emailFor('blankname'), name: '   ' }))).status).toBe(400);
    expect((await register(validBody({ email: emailFor('longname'), name: 'x'.repeat(51) }))).status).toBe(400);
  });

  test('SG.08 accepts the United States', async () => {
    const res = await register(validBody({ email: emailFor('us'), country: 'US' }));
    expect(res.status).toBe(201);
    expect(res.body.userId).toBeDefined();
  });

  test('SG.07 accepts the United Kingdom', async () => {
    expect((await register(validBody({ email: emailFor('gb'), country: 'GB' }))).status).toBe(201);
  });

  test('SG.08 accepts Germany', async () => {
    expect((await register(validBody({ email: emailFor('de'), country: 'DE' }))).status).toBe(201);
  });

  test('SG.09 accepts France', async () => {
    expect((await register(validBody({ email: emailFor('fr'), country: 'FR' }))).status).toBe(201);
  });

  test('SG.10 accepts Spain', async () => {
    expect((await register(validBody({ email: emailFor('es'), country: 'ES' }))).status).toBe(201);
  });

  test('SG.11 accepts lowercase country codes after normalization', async () => {
    const res = await register(validBody({ email: emailFor('lowercountry'), country: 'gb' }));
    expect(res.status).toBe(201);
    const pending = await PendingUser.findById(res.body.userId);
    expect(pending.country).toBe('GB');
  });

  test('SG.12 accepts India within the initial policy-pack rollout boundary', async () => {
    expect((await register(validBody({ email: emailFor('in'), country: 'IN' }))).status).toBe(201);
  });

  test('SG.13 accepts Australia within the initial policy-pack rollout boundary', async () => {
    expect((await register(validBody({ email: emailFor('au'), country: 'AU' }))).status).toBe(201);
  });

  test('SG.14 defaults an omitted country to US', async () => {
    const res = await register(validBody({ email: emailFor('defaultcountry'), country: undefined }));
    expect(res.status).toBe(201);
    const pending = await PendingUser.findById(res.body.userId);
    expect(pending.country).toBe('US');
  });

  test('SG.15 normalizes email case before persistence', async () => {
    const email = emailFor('CaseUser').toUpperCase();
    const res = await register(validBody({ email }));
    expect(res.status).toBe(201);
    const pending = await PendingUser.findById(res.body.userId);
    expect(pending.email).toBe(email.toLowerCase());
  });

  test('SG.16 never stores a pending password in plaintext', async () => {
    const email = emailFor('hashed');
    const res = await register(validBody({ email }));
    const pending = await PendingUser.findById(res.body.userId).select('+password');
    expect(pending.password).not.toBe(password);
    expect(await bcrypt.compare(password, pending.password)).toBe(true);
  });

  test('SG.17 rejects an existing verified account', async () => {
    const email = emailFor('existing');
    await User.create({ name: 'Existing', email, password, emailVerified: true, country: 'US' });
    const res = await register(validBody({ email }));
    expect(res.status).toBe(400);
  });

  test('SG.18 refreshes an existing pending registration instead of duplicating it', async () => {
    const email = emailFor('pendingduplicate');
    const first = await register(validBody({ email }));
    const before = await PendingUser.countDocuments({ email });
    const second = await register(validBody({ email, name: 'Updated Name' }));
    expect(second.status).toBe(200);
    expect(await PendingUser.countDocuments({ email })).toBe(before);
    expect(second.body.emailSent).toBe(true);
  });

  test('SG.19 verifies a pending user via POST and issues a JWT', async () => {
    const pending = await createPending();
    const res = await request(app).post('/api/auth/verify-email').send({ token: pending.verificationToken });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    const user = await User.findOne({ email: pending.email });
    expect(user.emailVerified).toBe(true);
    expect(user.country).toBe('US');
    expect(await PendingUser.exists({ _id: pending._id })).toBeFalsy();
  });

  test('SG.20 propagates the selected global country through verification', async () => {
    const pending = await createPending({ country: 'GB' });
    const res = await request(app).post('/api/auth/verify-email').send({ token: pending.verificationToken });
    expect(res.status).toBe(200);
    const user = await User.findOne({ email: pending.email });
    expect(user.country).toBe('GB');
  });

  test('SG.21 verifies a pending user via GET email-link flow', async () => {
    const pending = await createPending();
    const res = await request(app).get('/api/auth/verify-email').query({ token: pending.verificationToken });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
  });

  test('SG.22 rejects an expired verification token', async () => {
    const pending = await createPending({
      verificationTokenExpires: new Date(Date.now() - 1000),
      expiresAt: new Date(Date.now() - 1000),
    });
    expect((await request(app).post('/api/auth/verify-email').send({ token: pending.verificationToken })).status).toBe(400);
  });

  test('SG.23 rejects malformed verification token payloads', async () => {
    expect((await request(app).post('/api/auth/verify-email').send({ token: { value: 'x' } })).status).toBe(400);
    expect((await request(app).get('/api/auth/verify-email').query({ token: ['x'] })).status).toBe(400);
  });

  test('SG.24 rejects verification without a token', async () => {
    expect((await request(app).post('/api/auth/verify-email').send({})).status).toBe(400);
  });

  test('SG.25 resends a pending verification email', async () => {
    const pending = await createPending();
    const res = await request(app).post('/api/auth/resend-verification').send({ email: pending.email });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/resent/i);
  });

  test('SG.26 blocks login before email verification', async () => {
    const user = await User.create({ name: 'Unverified', email: emailFor('unverified'), password, emailVerified: false, country: 'US' });
    const res = await request(app).post('/api/auth/login').send({ email: user.email, password });
    expect(res.status).toBe(403);
    expect(res.body.needsVerification).toBe(true);
  });

  test('SG.27 allows login after email verification', async () => {
    const user = await User.create({ name: 'Verified', email: emailFor('verified'), password, emailVerified: true, country: 'US' });
    const res = await request(app).post('/api/auth/login').send({ email: user.email, password });
    expect(res.status).toBe(200);
    expect(jwt.decode(res.body.token).id).toBe(user._id.toString());
  });

  test('SG.28 concurrent verification accepts exactly one request', async () => {
    const pending = await createPending();
    const [first, second] = await Promise.all([
      request(app).post('/api/auth/verify-email').send({ token: pending.verificationToken }),
      request(app).post('/api/auth/verify-email').send({ token: pending.verificationToken }),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 400]);
    expect(await User.countDocuments({ email: pending.email })).toBe(1);
  });
});
