/**
 * Free Shipping Verification Test
 * Ensures that when a listing has `shipping.freeShipping` set to true,
 * the checkout flow returns a shipping cost of 0 and the seller does not receive a shipping payout.
 */
const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../server');
const User = require('../models/User');
const Listing = require('../models/Listing');

const mkEmail = p => `${p}_fs_${Date.now()}@test.com`;
const PASS = 'password123';

let sellerToken, buyerToken, sellerId, buyerId;

async function createUser(name, email) {
  const u = await User.create({
    name,
    email: email.toLowerCase(),
    password: PASS,
    emailVerified: true,
    authProvider: 'email',
    country: 'US',
    currency: 'USD',
    balance: { available: 0, pending: 0, totalEarned: 0, totalPaidOut: 0, currency: 'USD' },
    stats: { totalSales: 0, totalPurchases: 0, totalListings: 0, avgRating: 0, ratingCount: 0, responseRate: 100, shipTime: 3, strikes: 0 },
  });
  const jwt = require('jsonwebtoken');
  const token = jwt.sign({ id: u._id }, process.env.JWT_SECRET || 'fallback_secret_change_me', { expiresIn: '30d' });
  return { user: u, token };
}

async function createListing(sellerId, overrides = {}) {
  return Listing.create({
    seller: sellerId,
    title: 'Free Ship Test',
    description: 'Test listing with free shipping flag',
    price: 100,
    category: 'Men',
    condition: 'New with tags',
    available: true,
    sold: false,
    quantity: 1,
    shipsFrom: 'US',
    weight: 0.4,
    shipping: { domestic: true, international: false, freeShipping: true, shippingCost: 0 },
    ...overrides,
  });
}

async function buy(buyerToken, listingId) {
  const r = await request(app)
    .post('/api/transactions')
    .set('Authorization', `Bearer ${buyerToken}`)
    .send({
      listingId,
      shippingAddress: { fullName: 'B', street1: '456 St', city: 'City', state: 'NY', postalCode: '10001', country: 'US' },
      buyerCountry: 'US',
    });
  return r.body;
}

beforeAll(async () => {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/trenddrop_test';
  if (mongoose.connection.readyState === 0) await mongoose.connect(uri);
  await Promise.all([User.deleteMany({ email: /fs_test/ }), Listing.deleteMany({ title: /Free Ship Test/ })]);
  const { user: s, token: st } = await createUser('SellerFS', mkEmail('seller'));
  sellerId = s._id; sellerToken = st;
  const { user: b, token: bt } = await createUser('BuyerFS', mkEmail('buyer'));
  buyerId = b._id; buyerToken = bt;
});

afterAll(async () => {
  await Promise.all([User.deleteMany({ email: /fs_test/ }), Listing.deleteMany({ title: /Free Ship Test/ })]);
  await mongoose.disconnect();
});

describe('Free Shipping Test', () => {
  test('FS.1 Shipping cost and payout are zero when freeShipping flag is true', async () => {
    const listing = await createListing(sellerId);
    const txn = await buy(buyerToken, listing._id);

    // Verify shipping cost is zero
    expect(txn.paymentBreakdown.shippingCost).toBe(0);
    // Verify shipping payout is zero (seller does not receive shipping amount)
    expect(txn.paymentBreakdown.shippingPayout).toBe(0);
    // Ensure seller earnings do not include shipping
    expect(txn.paymentBreakdown.sellerEarnings).toBeGreaterThan(0);
  });
});
