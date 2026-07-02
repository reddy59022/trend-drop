/**
 * Shipping Labels Tests (EasyPost Integration)
 * Tests real shipping label generation, voiding, and tracking
 */
const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../server');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Transaction = require('../models/Transaction');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';

let sellerToken, buyerToken, sellerId, buyerId;
let testListing, testTransaction;

beforeAll(async () => {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/trenddrop_test');
  }

  const seedBase = `shipping_${Date.now()}_`;

  seller = await User.create({
    name: 'Shipping Seller', email: `${seedBase}seller@test.com`, password: 'password123',
    country: 'US', currency: 'USD', emailVerified: true, authProvider: 'email',
    shippingAddress: { fullName: 'Seller', street1: '123 St', city: 'City', state: 'CA', postalCode: '90210', country: 'US' },
    balance: { available: 0, pending: 0, totalEarned: 0, totalPaidOut: 0, currency: 'USD' },
    stats: { totalSales: 0, totalPurchases: 0, strikes: 0 },
  });
  sellerToken = jwt.sign({ id: seller._id }, JWT_SECRET, { expiresIn: '30d' });
  sellerId = seller._id;

  buyer = await User.create({
    name: 'Shipping Buyer', email: `${seedBase}buyer@test.com`, password: 'password123',
    country: 'GB', currency: 'GBP', emailVerified: true, authProvider: 'email',
    shippingAddress: { fullName: 'Buyer', street1: '456 St', city: 'London', state: 'England', postalCode: 'SW1A 1AA', country: 'GB' },
    balance: { available: 0, pending: 0, totalEarned: 0, totalPaidOut: 0, currency: 'GBP' },
    stats: { totalSales: 0, totalPurchases: 0, strikes: 0 },
  });
  buyerToken = jwt.sign({ id: buyer._id }, JWT_SECRET, { expiresIn: '30d' });
  buyerId = buyer._id;

  const listingRes = await request(app)
    .post('/api/listings')
    .set('Authorization', `Bearer ${sellerToken}`)
    .field('title', 'Shipping Test Item')
    .field('description', 'For label testing')
    .field('price', '50')
    .field('category', 'Electronics')
    .field('condition', 'New with tags')
    .field('brand', 'Test')
    .field('size', 'One Size')
    .field('color', 'Black')
    .field('weight', 0.5)
    .field('quantity', 5);
  expect(listingRes.status).toBe(201);
  testListing = listingRes.body.listing;
});

afterAll(async () => {
  await User.deleteMany({ email: /shipping_/ });
  await Listing.deleteMany({ seller: sellerId });
  await Transaction.deleteMany({});
  await mongoose.connection.close();
});

describe('Shipping Labels (EasyPost Integration)', () => {
  let localTxn;

  test('SL.1 Create shipping label for order', async () => {
    // Create transaction first
    const txnRes = await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ listingId: testListing._id, buyerCountry: 'GB' });
    expect(txnRes.status).toBe(201);
    localTxn = txnRes.body;
    testTransaction = localTxn;

    // Generate label
    const labelRes = await request(app)
      .post(`/api/shipping/label/${localTxn._id}`)
      .set('Authorization', `Bearer ${sellerToken}`);

    expect(labelRes.status).toBe(200);
    expect(labelRes.body.trackingNumber).toBeDefined();
    expect(labelRes.body.carrier).toBeDefined();
    expect(labelRes.body.labelPdfUrl).toBeDefined();
    expect(labelRes.body.trackingUrl).toBeDefined();
  });

  test('SL.2 Cannot create label for someone else\'s order', async () => {
    const labelRes = await request(app)
      .post(`/api/shipping/label/${testTransaction._id}`)
      .set('Authorization', `Bearer ${buyerToken}`);

    expect(labelRes.status).toBe(403);
  });

  test('SL.3 Void label and refund shipping', async () => {
    // Create new transaction for void test
    const txnRes = await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ listingId: testListing._id, buyerCountry: 'GB' });
    const txn = txnRes.body;

    // Generate label
    const labelRes = await request(app)
      .post(`/api/shipping/label/${txn._id}`)
      .set('Authorization', `Bearer ${sellerToken}`);
    expect(labelRes.status).toBe(200);

    // Void label
    const voidRes = await request(app)
      .post(`/api/shipping/void/${txn._id}`)
      .set('Authorization', `Bearer ${sellerToken}`);

    expect(voidRes.status).toBe(200);
    expect(voidRes.body.refunded).toBe(true);
    expect(voidRes.body.refundAmount).toBeGreaterThanOrEqual(0);
  });

  test('SL.4 Track shipment status', async () => {
    // Create own transaction
    const txnRes = await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ listingId: testListing._id, buyerCountry: 'GB' });
    const txn = txnRes.body;
    testTransaction = txn;

    // Generate label first
    await request(app)
      .post(`/api/shipping/label/${txn._id}`)
      .set('Authorization', `Bearer ${sellerToken}`);

    const trackingRes = await request(app)
      .get(`/api/shipping/track/${txn._id}`)
      .set('Authorization', `Bearer ${sellerToken}`);

    expect(trackingRes.status).toBe(200);
    expect(trackingRes.body.trackingNumber).toBeDefined();
    expect(trackingRes.body.status).toBeDefined();
    expect(trackingRes.body.trackingHistory).toBeDefined();
  });

  test('SL.5 Label includes correct address', async () => {
    // Create own transaction
    const txnRes = await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ listingId: testListing._id, buyerCountry: 'GB' });
    const txn = txnRes.body;
    testTransaction = txn;

    const labelRes = await request(app)
      .post(`/api/shipping/label/${txn._id}`)
      .set('Authorization', `Bearer ${sellerToken}`);

    expect(labelRes.status).toBe(200);
    expect(labelRes.body.toAddress).toBeDefined();
    expect(labelRes.body.toAddress.country).toBe('GB');
    expect(labelRes.body.fromAddress).toBeDefined();
    expect(labelRes.body.fromAddress.country).toBe('US');
  });

  test('SL.6 Cannot void already delivered shipment', async () => {
    // Update transaction to delivered
    await Transaction.findByIdAndUpdate(testTransaction._id, { status: 'delivered' });

    const voidRes = await request(app)
      .post(`/api/shipping/void/${testTransaction._id}`)
      .set('Authorization', `Bearer ${sellerToken}`);

    expect(voidRes.status).toBe(400);
    expect(voidRes.body.message).toContain('delivered');
  });
});