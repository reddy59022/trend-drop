// Coverage gate: test-confirm branches that require a TRUTHY stripe export.
// The critical coverage gate requires 100% of routes/payments.js, and the
// `stripe && …` guards are only reachable with a live SDK client. This file
// replaces config/payments with a stub whose `stripe` is a controlled mock,
// then drives the guardrail and fallback paths of POST /test-confirm.
jest.mock('../config/payments', () => {
  const actual = jest.requireActual('../config/payments');
  const stripeMock = {
    paymentIntents: {
      retrieve: jest.fn(),
      confirm: jest.fn(),
      capture: jest.fn(),
      cancel: jest.fn(),
    },
  };
  return { ...actual, stripe: stripeMock, __stripeMock: stripeMock };
});

process.env.STRIPE_SECRET_KEY = 'sk_test_cov_mock';

const mongoose = require('mongoose');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { getJwtSecret } = require('../config/security');
const app = require('../server');
const config = require('../config/payments');
const User = require('../models/User');

beforeAll(async () => {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/trend-drop-test');
  }
});

let buyer;
const authHeader = () => ({ Authorization: `Bearer ${buyer.token}` });

beforeEach(async () => {
  global.__mockPaymentIntents = {};
  // config/payments was required with sk_test at load; keep env aligned
  process.env.STRIPE_SECRET_KEY = 'sk_test_cov_mock';
  if (buyer) return;
  const created = await User.create({
    name: 'Cov Stripe User', email: `covstripe-${Date.now()}@t.test`, password: 'password123',
    country: 'US', currency: 'USD', emailVerified: true, authProvider: 'email',
  });
  buyer = { user: created, token: jwt.sign({ id: created._id }, getJwtSecret(), { expiresIn: '30d' }) };
});

afterEach(() => {
  config.__stripeMock.paymentIntents.retrieve.mockReset();
  config.__stripeMock.paymentIntents.confirm.mockReset();
});

describe('live-stripe guardrails on /api/payments/test-confirm', () => {
  test('sk_live secret keys make test-confirm unavailable (403)', async () => {
    const envSave = process.env.STRIPE_SECRET_KEY;
    process.env.STRIPE_SECRET_KEY = 'sk_live_cov_probe';
    const res = await request(app)
      .post('/api/payments/test-confirm')
      .set(authHeader())
      .send({ paymentIntentId: 'pi_livetest_1' });
    process.env.STRIPE_SECRET_KEY = envSave;
    expect(res.status).toBe(403);
    expect(res.body.message).toBe('Test confirmation is only available in Stripe TEST mode');
  });

  test('stripe unreachable falls back to a mock intent and still works', async () => {
    config.__stripeMock.paymentIntents.retrieve.mockRejectedValueOnce(new Error('network down'));
    const res = await request(app)
      .post('/api/payments/test-confirm')
      .set(authHeader())
      .send({ paymentIntentId: 'pi_stripe_down', amount: 100 });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('requires_capture');
  });

  test('owner mismatch against a real stripe intent', async () => {
    config.__stripeMock.paymentIntents.retrieve.mockResolvedValueOnce({
      id: 'pi_owner_probe', status: 'requires_payment_method', amount: 25000,
      currency: 'usd', metadata: { buyerId: new mongoose.Types.ObjectId().toString() },
    });
    const res = await request(app)
      .post('/api/payments/test-confirm')
      .set(authHeader())
      .send({ paymentIntentId: 'pi_owner_probe' });
    expect(res.status).toBe(403);
    expect(res.body.message).toBe('Not authorized for this payment intent');
  });

  test('stripe retrievable intent in a non-confirmable state gets confirmed', async () => {
    config.__stripeMock.paymentIntents.retrieve.mockResolvedValueOnce({
      id: 'pi_live_state', status: 'requires_payment_method', amount: 25000,
      currency: 'usd', metadata: { buyerId: buyer.user._id.toString() },
    });
    config.__stripeMock.paymentIntents.confirm
      .mockResolvedValueOnce({ id: 'pi_live_state', status: 'succeeded', amount: 25000, currency: 'usd' });
    const res = await request(app)
      .post('/api/payments/test-confirm')
      .set(authHeader())
      .send({ paymentIntentId: 'pi_live_state' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('succeeded');
    expect(config.__stripeMock.paymentIntents.confirm).toHaveBeenCalled();
  });

  test('stripe confirm failure falls back to the mock-approval shape', async () => {
    config.__stripeMock.paymentIntents.retrieve.mockResolvedValueOnce({
      id: 'pi_confirm_fail', status: 'requires_payment_method', amount: 25000,
      currency: 'usd', metadata: { buyerId: buyer.user._id.toString() },
    });
    config.__stripeMock.paymentIntents.confirm.mockRejectedValueOnce(new Error('confirm failed'));
    const res = await request(app)
      .post('/api/payments/test-confirm')
      .set(authHeader())
      .send({ paymentIntentId: 'pi_confirm_fail' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('succeeded');
  });

  test('already-confirmable stripe intent is returned without confirmation', async () => {
    config.__stripeMock.paymentIntents.retrieve.mockResolvedValueOnce({
      id: 'pi_already', status: 'requires_capture', amount: 25000,
      currency: 'usd', metadata: { buyerId: buyer.user._id.toString() },
    });
    const res = await request(app)
      .post('/api/payments/test-confirm')
      .set(authHeader())
      .send({ paymentIntentId: 'pi_already' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('requires_capture');
    expect(config.__stripeMock.paymentIntents.confirm).not.toHaveBeenCalled();
  });
});
