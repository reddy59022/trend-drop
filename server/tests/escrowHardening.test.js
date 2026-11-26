/**
 * TDD round: escrow must only operate on paid, live transactions.
 * A refunded/cancelled transaction with an active escrow must never release
 * money to the seller.
 */
const mongoose = require('mongoose');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../server');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Transaction = require('../models/Transaction');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';
const tokenFor = (user) => jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '30d' });
const created = { users: [], listings: [], transactions: [] };

const makeUser = async (label) => {
  const user = await User.create({
    name: `${label} User`,
    email: `${label}_${Date.now()}_${Math.random().toString(36).slice(2)}@test.com`,
    password: 'password123',
    country: 'US',
    currency: 'USD',
    emailVerified: true,
    authProvider: 'email',
    balance: { available: 0, pending: 0, totalEarned: 0, totalPaidOut: 0, currency: 'USD' },
    shippingAddress: { fullName: label, street1: '1 Main St', city: 'City', state: 'CA', postalCode: '90210', country: 'US' },
  });
  created.users.push(user._id);
  return user;
};

const setup = async (status, escrowStatus = 'inactive') => {
  const buyer = await makeUser('escrow_buyer');
  const seller = await makeUser('escrow_seller');
  const listing = await Listing.create({
    title: 'Escrow fixture item',
    description: 'Fixture',
    price: 600,
    category: 'Men',
    condition: 'Good',
    images: ['https://example.com/item.jpg'],
    seller: seller._id,
    quantity: 0,
    quantitySold: 1,
    available: false,
    sold: true,
    status: 'active',
  });
  created.listings.push(listing._id);

  const transaction = await Transaction.create({
    listing: listing._id,
    buyer: buyer._id,
    seller: seller._id,
    itemPrice: 600,
    currency: 'USD',
    paymentBreakdown: { subtotal: 600, totalPaid: 600, sellerEarnings: 540 },
    status,
    escrow: {
      status: escrowStatus,
      amount: escrowStatus === 'active' ? 600 : 0,
      releaseConditions: { buyerConfirmed: false, sellerConfirmed: false },
    },
  });
  created.transactions.push(transaction._id);
  return { buyer, seller, listing, transaction };
};

beforeAll(async () => {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/trenddrop_test');
  }
});

afterAll(async () => {
  await Transaction.deleteMany({ _id: { $in: created.transactions } });
  await Listing.deleteMany({ _id: { $in: created.listings } });
  await User.deleteMany({ _id: { $in: created.users } });
  await mongoose.connection.close();
});

describe('EH.1 escrow initiation requires a live paid transaction', () => {
  test.each(['refunded', 'cancelled', 'cancelled_by_buyer', 'auto_cancelled', 'chargeback_lost'])(
    'rejects a %s transaction',
    async (status) => {
      const { buyer, transaction } = await setup(status);
      const res = await request(app)
        .post('/api/escrow/initiate')
        .set('Authorization', `Bearer ${tokenFor(buyer)}`)
        .send({ transactionId: transaction._id, amount: 600 });
      expect(res.status).toBe(400);
    },
  );

  test('a pending (unpaid) transaction cannot be escrowed', async () => {
    const { buyer, transaction } = await setup('pending');
    const res = await request(app)
      .post('/api/escrow/initiate')
      .set('Authorization', `Bearer ${tokenFor(buyer)}`)
      .send({ transactionId: transaction._id, amount: 600 });
    expect(res.status).toBe(400);
  });

  test('a paid transaction can still be escrowed', async () => {
    const { buyer, transaction } = await setup('paid');
    const res = await request(app)
      .post('/api/escrow/initiate')
      .set('Authorization', `Bearer ${tokenFor(buyer)}`)
      .send({ transactionId: transaction._id, amount: 600 });
    expect(res.status).toBe(200);
    expect(res.body.transaction.escrow.status).toBe('active');
  });
});

describe('EH.2 a refunded escrow cannot be confirmed or released', () => {
  test('buyer confirmation is rejected after a refund', async () => {
    const { buyer, transaction } = await setup('refunded', 'active');
    const res = await request(app)
      .post('/api/escrow/confirm-buyer')
      .set('Authorization', `Bearer ${tokenFor(buyer)}`)
      .send({ transactionId: transaction._id });
    expect(res.status).toBe(400);

    const stored = await Transaction.findById(transaction._id);
    expect(stored.escrow.status).toBe('active');
    expect(stored.escrow.releaseConditions.buyerConfirmed).toBe(false);
  });

  test('seller confirmation is rejected after cancellation', async () => {
    const { seller, transaction } = await setup('cancelled', 'active');
    const res = await request(app)
      .post('/api/escrow/confirm-seller')
      .set('Authorization', `Bearer ${tokenFor(seller)}`)
      .send({ transactionId: transaction._id });
    expect(res.status).toBe(400);

    const stored = await Transaction.findById(transaction._id);
    expect(stored.escrow.releaseConditions.sellerConfirmed).toBe(false);
  });
});
