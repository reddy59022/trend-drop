/**
 * TDD round: voiding a label must allow the seller to generate a replacement,
 * instead of returning the voided tracking number as "already generated".
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
  await Transaction.deleteMany({ _id: { $in: created.transactions } });
  await Listing.deleteMany({ _id: { $in: created.listings } });
  await User.deleteMany({ _id: { $in: created.users } });
  await mongoose.connection.close();
});

describe('SLH.1 voided labels can be replaced', () => {
  test('generate-label issues a new tracking number after voiding', async () => {
    const seller = await makeUser('label_seller');
    const buyer = await makeUser('label_buyer');
    const listing = await Listing.create({
      seller: seller._id,
      title: 'Label fixture item',
      description: 'Fixture',
      price: 50,
      category: 'Men',
      condition: 'Good',
      images: ['https://example.com/item.jpg'],
      quantity: 1,
      available: true,
      sold: false,
      status: 'active',
    });
    created.listings.push(listing._id);

    const transaction = await Transaction.create({
      listing: listing._id,
      buyer: buyer._id,
      seller: seller._id,
      itemPrice: 50,
      currency: 'USD',
      paymentBreakdown: { subtotal: 50, totalPaid: 55, sellerEarnings: 46 },
      status: 'paid',
      shippingAddress: { fullName: 'Buyer', street1: '2 Main St', city: 'City', state: 'CA', postalCode: '90211', country: 'US' },
      sellerAddress: { fullName: 'Seller', street1: '1 Main St', city: 'City', state: 'CA', postalCode: '90210', country: 'US' },
      shipping: {
        carrier: 'USPS',
        trackingNumber: '1ZOLDTRACKINGNUMBER',
        trackingUrl: 'https://example.com/old',
        labelCreated: true,
        labelCreatedDate: new Date(),
        service: 'Priority Mail',
      },
    });
    created.transactions.push(transaction._id);
    const token = tokenFor(seller);

    const voided = await request(app)
      .post(`/api/shipping/void/${transaction._id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(voided.status).toBe(200);

    const regenerated = await request(app)
      .post('/api/shipping/generate-label')
      .set('Authorization', `Bearer ${token}`)
      .send({ transactionId: transaction._id });
    expect(regenerated.status).toBe(200);
    expect(regenerated.body.trackingNumber).toBeDefined();
    expect(regenerated.body.trackingNumber).not.toBe('1ZOLDTRACKINGNUMBER');

    const stored = await Transaction.findById(transaction._id);
    expect(stored.shipping.trackingNumber).not.toBe('1ZOLDTRACKINGNUMBER');
    expect(stored.shipping.voided).toBe(false);
  });
});
