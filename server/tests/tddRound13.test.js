/* TDD Round 13 RED tests — recently-viewed orphan rows (GA-2b bug class).
 * POST /api/recently-viewed/:listingId accepts a valid-but-nonexistent id and
 * persists a view row pointing at nothing; the later GET then returns nulls.
 * Rule: the listing must exist -> 404, nothing persisted.
 */
const mongoose = require('mongoose');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../server');
const User = require('../models/User');
const RecentlyViewed = require('../models/RecentlyViewed');

const SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';
const RUN = `r13_${Date.now()}`;
let user;
let token;

beforeAll(async () => {
  if (mongoose.connection.readyState !== 1) await mongoose.connect(process.env.MONGO_URI);
  user = await User.create({
    name: 'R13 Viewer', email: `r13_${RUN}@test.com`, password: 'password123',
    emailVerified: true, authProvider: 'email', country: 'US', currency: 'USD',
    shippingAddress: { fullName: 'R13', street1: '1 St', city: 'C', state: 'S', postalCode: '0', country: 'US' },
    balance: { available: 0, pending: 0, totalEarned: 0, totalPaidOut: 0, currency: 'USD' },
  });
  token = jwt.sign({ id: user._id }, SECRET, { expiresIn: '30d' });
});

afterAll(async () => {
  await RecentlyViewed.deleteMany({ userId: user._id });
  await User.deleteMany({ _id: user._id });
});

describe('R13 ghost listing ids must not create orphan view rows', () => {
  test('POST valid-but-nonexistent listingId -> 404, nothing persisted', async () => {
    const ghost = new mongoose.Types.ObjectId().toString();
    const res = await request(app).post(`/api/recently-viewed/${ghost}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
    expect(await RecentlyViewed.countDocuments({ userId: user._id })).toBe(0);
  });
});
