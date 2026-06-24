const mongoose = require('mongoose');
const request = require('supertest');
const app = require('../server');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Transaction = require('../models/Transaction');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';

let buyer1Token, buyer2Token, sellerToken;
let seller, buyer1, buyer2;
let listing;

beforeAll(async () => {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/trenddrop_test');
  }
  
  const seedBase = `concurrent_${Date.now()}_`;
  
  seller = await User.create({
    name: 'Concurrent Seller',
    email: `${seedBase}seller@test.com`,
    password: 'password123',
    country: 'US',
    currency: 'USD',
    emailVerified: true,
    authProvider: 'email',
    shippingAddress: { fullName: 'Seller', street1: '123 St', city: 'City', state: 'CA', postalCode: '90210', country: 'US' },
    balance: { available: 0, pending: 0, totalEarned: 0, totalPaidOut: 0, currency: 'USD' },
    stats: { totalSales: 0, totalPurchases: 0, strikes: 0 },
  });
  sellerToken = jwt.sign({ id: seller._id }, JWT_SECRET, { expiresIn: '30d' });

  buyer1 = await User.create({
    name: 'Buyer 1',
    email: `${seedBase}buyer1@test.com`,
    password: 'password123',
    country: 'US',
    currency: 'USD',
    emailVerified: true,
    authProvider: 'email',
    shippingAddress: { fullName: 'Buyer 1', street1: '123 St', city: 'City', state: 'CA', postalCode: '90210', country: 'US' },
    balance: { available: 0, pending: 0, totalEarned: 0, totalPaidOut: 0, currency: 'USD' },
    stats: { totalSales: 0, totalPurchases: 0, strikes: 0 },
  });
  buyer1Token = jwt.sign({ id: buyer1._id }, JWT_SECRET, { expiresIn: '30d' });

  buyer2 = await User.create({
    name: 'Buyer 2',
    email: `${seedBase}buyer2@test.com`,
    password: 'password123',
    country: 'US',
    currency: 'USD',
    emailVerified: true,
    authProvider: 'email',
    shippingAddress: { fullName: 'Buyer 2', street1: '123 St', city: 'City', state: 'CA', postalCode: '90210', country: 'US' },
    balance: { available: 0, pending: 0, totalEarned: 0, totalPaidOut: 0, currency: 'USD' },
    stats: { totalSales: 0, totalPurchases: 0, strikes: 0 },
  });
  buyer2Token = jwt.sign({ id: buyer2._id }, JWT_SECRET, { expiresIn: '30d' });

  const listingRes = await request(app)
    .post('/api/listings')
    .set('Authorization', `Bearer ${sellerToken}`)
    .field('title', 'Race Condition Item')
    .field('description', 'Only 1 available')
    .field('price', 50)
    .field('category', 'Clothing')
    .field('condition', 'New with tags')
    .field('brand', 'Test')
    .field('size', 'M')
    .field('color', 'Black')
    .field('currency', 'USD')
    .field('weight', 0.5)
    .field('quantity', 1);
  expect(listingRes.status).toBe(201);
  listing = listingRes.body.listing;
});

afterAll(async () => {
  if (seller) await User.findByIdAndDelete(seller._id);
  if (buyer1) await User.findByIdAndDelete(buyer1._id);
  if (buyer2) await User.findByIdAndDelete(buyer2._id);
  if (listing) await Listing.findByIdAndDelete(listing._id);
  await mongoose.connection.close();
});

describe('Concurrent Purchase Tests', () => {
  test('1. Only one buyer can purchase a single-quantity item', async () => {
    const [res1, res2] = await Promise.all([
      request(app)
        .post('/api/transactions')
        .set('Authorization', `Bearer ${buyer1Token}`)
        .send({ listingId: listing._id, buyerCountry: 'US' }),
      request(app)
        .post('/api/transactions')
        .set('Authorization', `Bearer ${buyer2Token}`)
        .send({ listingId: listing._id, buyerCountry: 'US' }),
    ]);

    const successes = [res1, res2].filter(r => r.status === 201);
    const failures = [res1, res2].filter(r => r.status !== 201);
    expect(successes.length).toBe(1);
    expect(failures.length).toBe(1);
  });

  test('2. Atomic inventory update prevents oversell', async () => {
    const listingRes = await request(app)
      .post('/api/listings')
      .set('Authorization', `Bearer ${sellerToken}`)
      .field('title', 'Two Available Item')
      .field('description', '2 available')
      .field('price', 30)
      .field('category', 'Accessories')
      .field('condition', 'New with tags')
      .field('brand', 'Test')
      .field('size', 'One Size')
      .field('color', 'White')
      .field('currency', 'USD')
      .field('weight', 0.5)
      .field('quantity', 2);
    expect(listingRes.status).toBe(201);
    const multiQtyListing = listingRes.body.listing;

    const [r1, r2, r3] = await Promise.all([
      request(app).post('/api/transactions').set('Authorization', `Bearer ${buyer1Token}`).send({ listingId: multiQtyListing._id, buyerCountry: 'US' }),
      request(app).post('/api/transactions').set('Authorization', `Bearer ${buyer2Token}`).send({ listingId: multiQtyListing._id, buyerCountry: 'US' }),
      request(app).post('/api/transactions').set('Authorization', `Bearer ${buyer1Token}`).send({ listingId: multiQtyListing._id, buyerCountry: 'US' }),
    ]);

    const successes = [r1, r2, r3].filter(r => r.status === 201);
    expect(successes.length).toBe(2);

    const updated = await Listing.findById(multiQtyListing._id);
    expect(updated.quantitySold).toBe(2);
    expect(updated.quantity).toBe(0);
  });
});