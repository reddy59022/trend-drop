/**
 * TDD round: insurance claims need an admin decision, and the premium must be
 * collected from the payout (previously coverage was free and no route could
 * ever approve a pending claim).
 */
const mongoose = require('mongoose');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../server');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const ShippingInsurance = require('../models/ShippingInsurance');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';
const tokenFor = (user) => jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '30d' });
const created = { users: [], transactions: [], policies: [] };

const makeUser = async (label, role = 'user') => {
  const user = await User.create({
    name: `${label} User`,
    email: `${label}_${Date.now()}_${Math.random().toString(36).slice(2)}@test.com`,
    password: 'password123',
    country: 'US',
    currency: 'USD',
    emailVerified: true,
    authProvider: 'email',
    role,
    balance: { available: 0, pending: 0, totalEarned: 0, totalPaidOut: 0, currency: 'USD' },
    shippingAddress: { fullName: label, street1: '1 Main St', city: 'City', state: 'CA', postalCode: '90210', country: 'US' },
  });
  created.users.push(user._id);
  return user;
};

const setup = async () => {
  const seller = await makeUser('ins_review_seller');
  const buyer = await makeUser('ins_review_buyer');
  const admin = await makeUser('ins_review_admin', 'admin');

  const transaction = await Transaction.create({
    listing: new mongoose.Types.ObjectId(),
    buyer: buyer._id,
    seller: seller._id,
    itemPrice: 100,
    currency: 'USD',
    paymentBreakdown: { subtotal: 100, totalPaid: 105, sellerEarnings: 92 },
    status: 'shipped',
  });
  created.transactions.push(transaction._id);

  const policy = await ShippingInsurance.create({
    transaction: transaction._id,
    seller: seller._id,
    itemValue: 100,
    premium: 2,
    coverageType: 'standard',
    coverageLimit: 500,
    status: 'claimed',
    claim: { status: 'pending', reason: 'Lost shipment', filedAt: new Date() },
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });
  created.policies.push(policy._id);
  return { seller, admin, policy };
};

beforeAll(async () => {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/trenddrop_test');
  }
});

afterAll(async () => {
  await ShippingInsurance.deleteMany({ _id: { $in: created.policies } });
  await Transaction.deleteMany({ _id: { $in: created.transactions } });
  await User.deleteMany({ _id: { $in: created.users } });
  await mongoose.connection.close();
});

describe('SIR.0 admin claim queue', () => {
  test('admins can list pending claims; sellers cannot', async () => {
    const { seller, admin, policy } = await setup();

    const forbidden = await request(app)
      .get('/api/shipping-insurance/admin/claims')
      .set('Authorization', `Bearer ${tokenFor(seller)}`);
    expect(forbidden.status).toBe(403);

    const listed = await request(app)
      .get('/api/shipping-insurance/admin/claims')
      .set('Authorization', `Bearer ${tokenFor(admin)}`);
    expect(listed.status).toBe(200);
    expect(listed.body.claims.map((c) => String(c._id))).toContain(String(policy._id));
  });
});

describe('SIR.1 only admins review insurance claims', () => {
  test('a non-admin cannot approve a claim', async () => {
    const { seller, policy } = await setup();
    const res = await request(app)
      .put(`/api/shipping-insurance/${policy._id}/claim/review`)
      .set('Authorization', `Bearer ${tokenFor(seller)}`)
      .send({ status: 'approved' });
    expect(res.status).toBe(403);

    const stored = await ShippingInsurance.findById(policy._id);
    expect(stored.claim.status).toBe('pending');
  });

  test('an admin approval stores the net payout after the premium', async () => {
    const { admin, policy } = await setup();
    const res = await request(app)
      .put(`/api/shipping-insurance/${policy._id}/claim/review`)
      .set('Authorization', `Bearer ${tokenFor(admin)}`)
      .send({ status: 'approved', payoutAmount: 100 });
    expect(res.status).toBe(200);

    const stored = await ShippingInsurance.findById(policy._id);
    expect(stored.claim.status).toBe('approved');
    expect(stored.claim.payoutAmount).toBe(98);
  });
});

describe('SIR.2 approved claims pay the net amount exactly once', () => {
  test('refund credits the payout minus premium and is idempotent', async () => {
    const { seller, admin, policy } = await setup();
    await request(app)
      .put(`/api/shipping-insurance/${policy._id}/claim/review`)
      .set('Authorization', `Bearer ${tokenFor(admin)}`)
      .send({ status: 'approved', payoutAmount: 100 });

    const first = await request(app)
      .post(`/api/shipping-insurance/${policy._id}/refund`)
      .set('Authorization', `Bearer ${tokenFor(seller)}`);
    expect(first.status).toBe(200);

    const after = await User.findById(seller._id);
    expect(after.balance.available).toBe(98);

    const second = await request(app)
      .post(`/api/shipping-insurance/${policy._id}/refund`)
      .set('Authorization', `Bearer ${tokenFor(seller)}`);
    expect(second.status).toBe(400);
    const finalUser = await User.findById(seller._id);
    expect(finalUser.balance.available).toBe(98);
  });
});
