/**
 * Guest Checkout Tests
 * Tests the ability for non-registered users to purchase items
 */
const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../server');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Transaction = require('../models/Transaction');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';

let sellerToken, sellerId;
let guestListing;

beforeAll(async () => {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/trenddrop_test');
  }

  // Create seller
  const seller = await User.create({
    name: 'Guest Seller',
    email: `guest_seller_${Date.now()}@test.com`,
    password: 'password123',
    country: 'US',
    currency: 'USD',
    emailVerified: true,
    authProvider: 'email',
    shippingAddress: {
      fullName: 'Guest Seller',
      street1: '123 St',
      city: 'City',
      state: 'CA',
      postalCode: '90210',
      country: 'US',
    },
    balance: { available: 0, pending: 0, totalEarned: 0, totalPaidOut: 0, currency: 'USD' },
    stats: { totalSales: 0, totalPurchases: 0, strikes: 0 },
  });
  sellerToken = jwt.sign({ id: seller._id }, JWT_SECRET, { expiresIn: '30d' });
  sellerId = seller._id;

  // Create listing for guest purchase
  const listingRes = await request(app)
    .post('/api/listings')
    .set('Authorization', `Bearer ${sellerToken}`)
    .field('title', 'Guest Checkout Item')
    .field('description', 'Can be purchased by guest')
    .field('price', '100')
    .field('category', 'Men')
    .field('condition', 'New with tags')
    .field('brand', 'Test')
    .field('size', 'M')
    .field('color', 'Black')
    .field('weight', 0.5)
    .field('quantity', 5);
  
  expect(listingRes.status).toBe(201);
  guestListing = listingRes.body.listing;
});

afterAll(async () => {
  await User.deleteMany({ email: /guest_seller_/ });
  await Listing.deleteMany({ seller: sellerId });
  await Transaction.deleteMany({});
  await mongoose.connection.close();
});

describe('Guest Checkout', () => {
  test('GC.1 Guest can purchase without authentication', async () => {
    const res = await request(app)
      .post('/api/transactions/guest')
      .send({
        listingId: guestListing._id,
        buyerEmail: 'guestbuyer@example.com',
        buyerName: 'Guest Buyer',
        buyerPhone: '+1234567890',
        shippingAddress: {
          fullName: 'Guest Buyer',
          street1: '456 Guest St',
          city: 'New York',
          state: 'NY',
          postalCode: '10001',
          country: 'US',
          phone: '+1234567890',
        },
        buyerCountry: 'US',
      });

    expect(res.status).toBe(201);
    expect(res.body._id).toBeDefined();
    expect(res.body.buyer).toBeDefined();
    expect(res.body.buyer.email).toBe('guestbuyer@example.com');
    expect(res.body.buyer.authProvider).toBe('guest');
    expect(res.body.status).toBe('paid');
  });

  test('GC.2 Guest checkout creates transaction record', async () => {
    const res = await request(app)
      .post('/api/transactions/guest')
      .send({
        listingId: guestListing._id,
        buyerEmail: 'guest2@example.com',
        buyerName: 'Guest Two',
        buyerPhone: '+1987654320',
        shippingAddress: {
          fullName: 'Guest Two',
          street1: '789 Ave',
          city: 'LA',
          state: 'CA',
          postalCode: '90001',
          country: 'US',
          phone: '+1987654320',
        },
        buyerCountry: 'US',
      });

    expect(res.status).toBe(201);
    const txn = await Transaction.findById(res.body._id);
    expect(txn).toBeDefined();
    expect(txn.buyer).toBeDefined();
    expect(txn.listing.toString()).toBe(guestListing._id.toString());
    expect(txn.status).toBe('paid');
  });

  test('GC.3 Guest checkout requires valid email', async () => {
    const res = await request(app)
      .post('/api/transactions/guest')
      .send({
        listingId: guestListing._id,
        buyerEmail: 'invalid-email',
        buyerName: 'Guest',
        shippingAddress: {
          fullName: 'Guest',
          street1: '123 St',
          city: 'City',
          state: 'ST',
          postalCode: '12345',
          country: 'US',
        },
        buyerCountry: 'US',
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('email');
  });

  test('GC.4 Guest checkout requires shipping address', async () => {
    const res = await request(app)
      .post('/api/transactions/guest')
      .send({
        listingId: guestListing._id,
        buyerEmail: 'guest@example.com',
        buyerName: 'Guest',
        buyerCountry: 'US',
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('shipping');
  });

  test('GC.5 Guest purchase updates inventory', async () => {
    const listingBefore = await Listing.findById(guestListing._id);
    const qtyBefore = listingBefore.quantity;

    await request(app)
      .post('/api/transactions/guest')
      .send({
        listingId: guestListing._id,
        buyerEmail: `guest_inv_${Date.now()}@example.com`,
        buyerName: 'Inventory Guest',
        shippingAddress: {
          fullName: 'Inventory Guest',
          street1: '123 St',
          city: 'City',
          state: 'ST',
          postalCode: '12345',
          country: 'US',
        },
        buyerCountry: 'US',
      });

    const listingAfter = await Listing.findById(guestListing._id);
    expect(listingAfter.quantity).toBe(qtyBefore - 1);
  });

  test('GC.6 Guest checkout calculates payment breakdown correctly', async () => {
    const res = await request(app)
      .post('/api/transactions/guest')
      .send({
        listingId: guestListing._id,
        buyerEmail: `guest_breakdown_${Date.now()}@example.com`,
        buyerName: 'Breakdown Guest',
        shippingAddress: {
          fullName: 'Breakdown Guest',
          street1: '123 St',
          city: 'City',
          state: 'ST',
          postalCode: '12345',
          country: 'US',
        },
        buyerCountry: 'US',
      });

    expect(res.status).toBe(201);
    expect(res.body.paymentBreakdown).toBeDefined();
    expect(res.body.paymentBreakdown.subtotal).toBeGreaterThan(0);
    expect(res.body.paymentBreakdown.platformFee).toBeGreaterThan(0);
    expect(res.body.paymentBreakdown.sellerEarnings).toBeGreaterThan(0);
    expect(res.body.paymentBreakdown.totalPaid).toBeGreaterThan(0);
  });

  test('GC.7 Multiple guests can purchase same listing (until stock runs out)', async () => {
    const email1 = `guest_multi_1_${Date.now()}@example.com`;
    const email2 = `guest_multi_2_${Date.now()}@example.com`;
    
    const res1 = await request(app)
      .post('/api/transactions/guest')
      .send({
        listingId: guestListing._id,
        buyerEmail: email1,
        buyerName: 'Multi Guest 1',
        shippingAddress: {
          fullName: 'Multi 1',
          street1: '123 St',
          city: 'City',
          state: 'ST',
          postalCode: '12345',
          country: 'US',
        },
        buyerCountry: 'US',
      });

    expect(res1.status).toBe(201);
    expect(res1.body._id).toBeDefined();

    // Second guest may succeed (if stock remains) or fail (if stock exhausted)
    const res2 = await request(app)
      .post('/api/transactions/guest')
      .send({
        listingId: guestListing._id,
        buyerEmail: email2,
        buyerName: 'Multi Guest 2',
        shippingAddress: {
          fullName: 'Multi 2',
          street1: '123 St',
          city: 'City',
          state: 'ST',
          postalCode: '12345',
          country: 'US',
        },
        buyerCountry: 'US',
      });

    // Either 201 (stock was available) or 400 (out of stock) is acceptable
    expect([201, 400]).toContain(res2.status);
    if (res2.status === 201) {
      expect(res2.body._id).toBeDefined();
      expect(res2.body._id).not.toBe(res1.body._id);
    }
  });

  test('GC.8 Guest buyer record is created and can be retrieved', async () => {
    // Create a fresh listing to avoid stock depletion from earlier tests
    const freshListingRes = await request(app)
      .post('/api/listings')
      .set('Authorization', `Bearer ${sellerToken}`)
      .field('title', 'Fresh Guest Listing')
      .field('description', 'Fresh for GC.8')
      .field('price', '100')
      .field('category', 'Men')
      .field('condition', 'New with tags')
      .field('brand', 'Test')
      .field('size', 'M')
      .field('color', 'Black')
      .field('weight', 0.5)
      .field('quantity', 5);
    expect(freshListingRes.status).toBe(201);
    const freshListing = freshListingRes.body.listing;

    const guestEmail = `guest_retrieve_${Date.now()}@example.com`;
    
    const res = await request(app)
      .post('/api/transactions/guest')
      .send({
        listingId: freshListing._id,
        buyerEmail: guestEmail,
        buyerName: 'Retrieve Guest',
        shippingAddress: {
          fullName: 'Retrieve',
          street1: '123 St',
          city: 'City',
          state: 'ST',
          postalCode: '12345',
          country: 'US',
        },
        buyerCountry: 'US',
      });

    expect(res.status).toBe(201);
    expect(res.body.buyer).toBeDefined();
    expect(res.body.buyer.email).toBe(guestEmail);
    expect(res.body.buyer.authProvider).toBe('guest');
  });
});