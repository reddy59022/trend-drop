/* TDD Round 11 RED tests — report filing integrity (GA-2b bug class).
 * R11.1 ghost (valid-but-nonexistent) listingId must 404, not create an
 *       orphan report. R11.2 unknown reason must 400, not 500.
 */
const mongoose = require('mongoose');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../server');
const User = require('../models/User');
const Report = require('../models/Report');

const SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';
const RUN = `r11_${Date.now()}`;
let user;
let token;

beforeAll(async () => {
  if (mongoose.connection.readyState !== 1) await mongoose.connect(process.env.MONGO_URI);
  user = await User.create({
    name: 'R11 Reporter', email: `r11_${RUN}@test.com`, password: 'password123',
    emailVerified: true, authProvider: 'email', country: 'US', currency: 'USD',
    shippingAddress: { fullName: 'R11', street1: '1 St', city: 'C', state: 'S', postalCode: '0', country: 'US' },
    balance: { available: 0, pending: 0, totalEarned: 0, totalPaidOut: 0, currency: 'USD' },
  });
  token = jwt.sign({ id: user._id }, SECRET, { expiresIn: '30d' });
});

afterAll(async () => {
  await Report.deleteMany({ reporter: user._id });
  await User.deleteMany({ _id: user._id });
});

describe('R11.1 ghost listing ids must not create orphan reports', () => {
  test('valid-but-nonexistent listingId -> 404, nothing persisted', async () => {
    const ghost = new mongoose.Types.ObjectId().toString();
    const res = await request(app).post('/api/reports')
      .set('Authorization', `Bearer ${token}`)
      .send({ listingId: ghost, reason: 'Spam', description: 'r11' });
    expect(res.status).toBe(404);
    expect(await Report.countDocuments({ listing: ghost })).toBe(0);
  });
});

describe('R11.2 unknown reason values must be 400 (not 500)', () => {
  test('reason "FakeReason" -> 400', async () => {
    const res = await request(app).post('/api/reports')
      .set('Authorization', `Bearer ${token}`)
      .send({ listingId: new mongoose.Types.ObjectId().toString(), reason: 'FakeReason', description: 'x' });
    expect(res.status).toBe(400);
  });
});
