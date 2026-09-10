const request = require('supertest');

// Webhook security: fail-closed signature verification.
// jest.setup.js pins STRIPE_SECRET_KEY='sk_test_trenddrop_hermetic' and
// STRIPE_WEBHOOK_SECRET='whsec_trenddrop_hermetic', and mocks the Stripe SDK
// (constructEvent throws only for sig 'bad'). NODE_ENV is 'test' here.
const app = require('../server');

const post = (payload, sig) => {
  const req = request(app).post('/api/payments/webhook');
  // Omit the header entirely when sig is undefined — supertest's
  // .set(h, '') still transmits an empty header, which is not "unsigned".
  return (sig === undefined ? req : req.set('stripe-signature', sig))
    .send(payload);
};

describe('Stripe webhook fail-closed verification', () => {
  const ORIGINAL = { ...process.env };

  afterEach(() => {
    process.env.STRIPE_WEBHOOK_SECRET = ORIGINAL.STRIPE_WEBHOOK_SECRET;
    delete process.env.STRIPE_WEBHOOK_DISABLE_VERIFY;
  });

  it('rejects unsigned events with 400 when a signing secret is configured', async () => {
    const res = await post({ type: 'charge.refunded', data: { object: {} } }, '');
    expect(res.status).toBe(400);
    expect(res.text).toMatch(/Stripe-Signature/i);
  });

  it('rejects events with an invalid signature', async () => {
    const res = await post({ type: 'charge.refunded', data: { object: {} } }, 'bad');
    expect(res.status).toBe(400);
    expect(res.text).toMatch(/Webhook Error/i);
  });

  it('returns 500 (retryable) when the signing secret is missing entirely', async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const res = await post({ type: 'charge.refunded', data: { object: {} } });
    expect(res.status).toBe(500);
    expect(res.text).toMatch(/signing secret not configured/i);
  });

  it('accepts a validly-signed event', async () => {
    const res = await post({
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_test_x', metadata: {} } },
    }, 'whsec_trenddrop_hermetic');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });
  });

  it('honors the explicit dev-only unsigned bypass (non-production only)', async () => {
    process.env.STRIPE_WEBHOOK_DISABLE_VERIFY = '1';
    const res = await post({
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_test_y', metadata: {} } },
    }, ''); // no signature header
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });
  });
});
