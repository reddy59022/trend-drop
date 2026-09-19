const mongoose = require('mongoose');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../server');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Transaction = require('../models/Transaction');
const Payout = require('../models/Payout');

const SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';
let seller;
let buyer;
let listing;
let transaction;
let buyerToken;

beforeAll(async () => {
  if (mongoose.connection.readyState !== 1) await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/trenddrop_test');
  seller = await User.create({ name: 'Payout Seller', email: `payout-seller-${Date.now()}@test.com`, password: 'password123', emailVerified: true, authProvider: 'email' });
  buyer = await User.create({ name: 'Payout Buyer', email: `payout-buyer-${Date.now()}@test.com`, password: 'password123', emailVerified: true, authProvider: 'email' });
  buyerToken = jwt.sign({ id: buyer._id }, SECRET, { expiresIn: '30d' });
  listing = await Listing.create({ seller: seller._id, title: 'Payout auth item', description: 'test', price: 100, category: 'Women', condition: 'Good', quantity: 0, quantitySold: 1, sold: true, available: false });
  transaction = await Transaction.create({
    seller: seller._id, buyer: buyer._id, listing: listing._id, itemPrice: 100, status: 'completed',
    paymentBreakdown: { subtotal: 100, totalPaid: 108, sellerEarnings: 92, platformFee: 8 },
  });
});

afterAll(async () => {
  await Payout.deleteMany({ transaction: transaction._id });
  await Transaction.deleteMany({ _id: transaction._id });
  await Listing.deleteMany({ _id: listing._id });
  await User.deleteMany({ _id: { $in: [seller._id, buyer._id] } });
  await mongoose.connection.close();
});

test('PA.1 buyer cannot create a payout for a seller transaction', async () => {
  const response = await request(app)
    .post('/api/payouts/auto-create')
    .set('Authorization', `Bearer ${buyerToken}`)
    .send({ transactionId: transaction._id });

  expect(response.status).toBe(403);
  expect(await Payout.countDocuments({ transaction: transaction._id })).toBe(0);
});
