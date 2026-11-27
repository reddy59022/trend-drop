/**
 * TDD round: a payout request that rounds below one cent must be rejected, not
 * processed as a zero-dollar transfer.
 */
const mongoose = require('mongoose');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../server');
const User = require('../models/User');

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
    balance: { available: 100, pending: 0, totalEarned: 100, totalPaidOut: 0, currency: 'USD' },
    payoutMethod: { type: 'bank' },
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
  await User.deleteMany({ _id: { $in: created.users } });
  await mongoose.connection.close();
});

describe('PAH.1 payout minimum', () => {
  test('a sub-cent amount is rejected and the balance is untouched', async () => {
    const user = await makeUser('payout_subcent');
    const res = await request(app)
      .post('/api/payments/payout')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ amount: 0.001 });

    expect(res.status).toBe(400);
    const after = await User.findById(user._id);
    expect(after.balance.available).toBe(100);
  });

  test('a normal payout still works', async () => {
    const user = await makeUser('payout_normal');
    const res = await request(app)
      .post('/api/payments/payout')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ amount: 5 });
    expect(res.status).toBe(200);
    const after = await User.findById(user._id);
    expect(after.balance.available).toBe(95);
  });

  test('production never simulates a payout without a connected account on live keys', async () => {
    const user = await makeUser('payout_unconfigured');
    const { processSellerPayout } = require('../config/payments');
    const previousEnv = process.env.NODE_ENV;
    const previousStripe = process.env.STRIPE_SECRET_KEY;
    process.env.NODE_ENV = 'production';
    delete process.env.STRIPE_SECRET_KEY;
    try {
      await expect(processSellerPayout(user._id, 5, 'USD', 'bank'))
        .rejects.toThrow(/connected Stripe account/i);
    } finally {
      process.env.NODE_ENV = previousEnv;
      if (previousStripe === undefined) delete process.env.STRIPE_SECRET_KEY;
      else process.env.STRIPE_SECRET_KEY = previousStripe;
    }
  });

  test('production on Stripe TEST keys simulates cash-out without Connect', async () => {
    const user = await makeUser('payout_test_mode');
    const previousEnv = process.env.NODE_ENV;
    const previousStripe = process.env.STRIPE_SECRET_KEY;
    process.env.NODE_ENV = 'production';
    process.env.STRIPE_SECRET_KEY = 'sk_test_payout_probe';
    try {
      const { processSellerPayout } = require('../config/payments');
      const payout = await processSellerPayout(user._id, 10, 'USD', 'bank');
      expect(payout.mock).toBe(true);
      expect(payout.status).toBe('paid');
    } finally {
      process.env.NODE_ENV = previousEnv;
      if (previousStripe === undefined) delete process.env.STRIPE_SECRET_KEY;
      else process.env.STRIPE_SECRET_KEY = previousStripe;
    }
  });
});
