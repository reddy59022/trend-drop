/**
 * TDD round: promo creation/update must validate hostile input and must not
 * allow a fixed-amount promo to become a >100% percentage promo.
 */
const mongoose = require('mongoose');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../server');
const User = require('../models/User');
const Promo = require('../models/Promo');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';
const tokenFor = (user) => jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '30d' });
const created = { users: [], promos: [] };

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

const basePromo = (overrides = {}) => ({
  code: `PROMO${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
  discountType: 'fixed',
  discountValue: 10,
  ...overrides,
});

beforeAll(async () => {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/trenddrop_test');
  }
});

afterAll(async () => {
  await Promo.deleteMany({ _id: { $in: created.promos } });
  await User.deleteMany({ _id: { $in: created.users } });
  await mongoose.connection.close();
});

describe('PH.1 promo creation validates input', () => {
  let seller;

  beforeAll(async () => {
    seller = await makeUser('promo_create');
  });

  const post = (body) => request(app)
    .post('/api/promos')
    .set('Authorization', `Bearer ${tokenFor(seller)}`)
    .send(body);

  test.each([
    ['a non-string code', { code: 12345 }],
    ['a blank code', { code: '   ' }],
    ['an invalid expiry date', { expiresAt: 'not-a-date' }],
    ['non-array categories', { applicableCategories: 'Women' }],
    ['a non-string description', { description: { text: 'hi' } }],
  ])('rejects %s with 400', async (_label, overrides) => {
    const res = await post(basePromo(overrides));
    expect(res.status).toBe(400);
  });

  test('still accepts a valid promo', async () => {
    const res = await post(basePromo({ discountType: 'percentage', discountValue: 15 }));
    expect(res.status).toBe(201);
    created.promos.push(res.body._id);
  });
});

describe('PH.2 promo updates preserve pricing invariants', () => {
  test('a fixed promo cannot be switched to a >100% percentage', async () => {
    const seller = await makeUser('promo_update');
    const promo = await Promo.create({
      code: `BIG${Date.now()}`,
      seller: seller._id,
      discountType: 'fixed',
      discountValue: 150,
    });
    created.promos.push(promo._id);

    const res = await request(app)
      .put(`/api/promos/${promo._id}`)
      .set('Authorization', `Bearer ${tokenFor(seller)}`)
      .send({ discountType: 'percentage' });
    expect(res.status).toBe(400);

    const stored = await Promo.findById(promo._id);
    expect(stored.discountType).toBe('fixed');
    expect(stored.discountValue).toBe(150);
  });

  test('invalid expiry and non-boolean isActive are rejected', async () => {
    const seller = await makeUser('promo_update2');
    const promo = await Promo.create({
      code: `UPD${Date.now()}`,
      seller: seller._id,
      discountType: 'fixed',
      discountValue: 10,
    });
    created.promos.push(promo._id);
    const token = tokenFor(seller);

    const badDate = await request(app)
      .put(`/api/promos/${promo._id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ expiresAt: 'soon-ish' });
    expect(badDate.status).toBe(400);

    const badFlag = await request(app)
      .put(`/api/promos/${promo._id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ isActive: 'yes' });
    expect(badFlag.status).toBe(400);
  });
});
