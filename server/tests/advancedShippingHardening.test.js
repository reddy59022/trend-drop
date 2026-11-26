/**
 * TDD round: carrier credentials must not be returned by the API, and a
 * carrier integration must be unique per seller (a second connect updates it).
 */
const mongoose = require('mongoose');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../server');
const User = require('../models/User');
const ShippingIntegration = require('../models/ShippingIntegration');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';
const tokenFor = (user) => jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '30d' });
const created = { users: [] };

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

beforeAll(async () => {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/trenddrop_test');
  }
});

afterAll(async () => {
  await ShippingIntegration.deleteMany({ user: { $in: created.users } });
  await User.deleteMany({ _id: { $in: created.users } });
  await mongoose.connection.close();
});

describe('ASH.1 carrier credentials stay server-side', () => {
  test('connecting and listing integrations never returns the apiKey', async () => {
    const user = await makeUser('ship_key');
    const token = tokenFor(user);

    const createdRes = await request(app)
      .post('/api/advanced-shipping')
      .set('Authorization', `Bearer ${token}`)
      .send({ carrier: 'fedex', apiKey: 'super-secret-carrier-key', accountNumber: 'A123' });
    expect(createdRes.status).toBe(201);
    expect(createdRes.body.apiKey).toBeUndefined();

    const stored = await ShippingIntegration.findOne({ user: user._id });
    expect(stored.apiKey).toBe('super-secret-carrier-key');

    const list = await request(app)
      .get('/api/advanced-shipping')
      .set('Authorization', `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].apiKey).toBeUndefined();
  });
});

describe('ASH.2 one integration per carrier', () => {
  test('reconnecting the same carrier updates instead of duplicating', async () => {
    const user = await makeUser('ship_dup');
    const token = tokenFor(user);

    const first = await request(app)
      .post('/api/advanced-shipping')
      .set('Authorization', `Bearer ${token}`)
      .send({ carrier: 'UPS', apiKey: 'old-key' });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post('/api/advanced-shipping')
      .set('Authorization', `Bearer ${token}`)
      .send({ carrier: 'ups', apiKey: 'new-key' });
    expect(second.status).toBe(201);

    const integrations = await ShippingIntegration.find({ user: user._id, carrier: 'UPS' });
    expect(integrations).toHaveLength(1);
    expect(integrations[0].apiKey).toBe('new-key');
  });
});
