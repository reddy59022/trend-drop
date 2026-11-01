// Coverage gate: cancel-payment with no usable buyer identity on the request.
// The middleware auth always sets a user with an ObjectId, so the
// `if (!userId) 401` guard in /api/payments/cancel-payment is unreachable via
// normal requests; drive it with a stubbed authentication middleware.
jest.mock('../middleware/auth', () => ({
  auth: (req, res, next) => { req.user = {}; next(); }, // identity-less user
  optionalAuth: (req, res, next) => next(),
}));

const mongoose = require('mongoose');
const request = require('supertest');
const app = require('../server');

beforeAll(async () => {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/trend-drop-test');
  }
});

describe('cancel-payment identity guard', () => {
  test('authenticated request without a usable user id -> 401', async () => {
    const res = await request(app)
      .post('/api/payments/cancel-payment')
      .send({ paymentIntentId: 'pi_cov_identity' });
    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Authenticated user identity required');
  });
});
