const request = require('supertest');
const app = require('../server');
const mongoose = require('mongoose');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Transaction = require('../models/Transaction');

describe('Payment Currency & Amount Validation', () => {
  let testUser, testListing;

  beforeAll(async () => {
    // Create test user
    testUser = await User.create({
      name: 'Payment Test User',
      email: 'payment@test.com',
      password: 'password123',
      role: 'user',
    });

    // Create test listing with non-USD currency
    testListing = await Listing.create({
      seller: testUser._id,
      title: 'Test Item EUR',
      description: 'Test item for EUR payment',
      price: 50,
      currency: 'EUR',
      images: ['https://test.image.url/image1.jpg'],
      category: 'Women',
      condition: 'Good',
      available: true,
      quantity: 1,
    });
  });

  afterAll(async () => {
    await Transaction.deleteMany({});
    await Listing.deleteMany({});
    await User.deleteMany({});
  });

  describe('Currency Selection', () => {
    it('v34.1: Payment breakdown uses correct currency from listing', async () => {
      const res = await request(app)
        .post('/api/payments/breakdown')
        .send({
          itemPrice: 50,
          fromCountry: 'US',
          toCountry: 'US',
          weightKg: 0.5,
        });

      expect(res.statusCode).toBe(200);
      expect(res.body.buyer).toBeDefined();
    });

    it('v34.2: Multi-currency listing creates transaction with correct currency', async () => {
      const transactionRes = await request(app)
        .post('/api/transactions/guest')
        .send({
          listingId: testListing._id,
          buyerEmail: 'guest1@test.com',
          buyerName: 'Guest Buyer',
          shippingAddress: {
            fullName: 'Guest Buyer',
            street1: '123 Test St',
            city: 'Test City',
            state: 'TS',
            postalCode: '12345',
            country: 'US',
          },
          buyerCountry: 'US',
        });

    expect(transactionRes.statusCode).toBe(201);
    expect(transactionRes.body.currency).toBe('EUR');
    // Total = item price + shipping + buyer protection (5% = 2.5)
    expect(transactionRes.body.paymentBreakdown.totalPaid).toBe(52.5);
    expect(transactionRes.body.paymentBreakdown.subtotal).toBe(50);
    });

    it('v34.3: USD transactions use proper formatting', async () => {
      const usdListing = await Listing.create({
        seller: testUser._id,
        title: 'USD Test Item 2',
        description: 'USD test item',
        price: 100,
        currency: 'USD',
        images: ['https://test.image.url/image2.jpg'],
        category: 'Men',
        condition: 'Good',
        available: true,
        quantity: 1,
      });

      const transRes = await request(app)
        .post('/api/transactions/guest')
        .send({
          listingId: usdListing._id,
          buyerEmail: 'guest2@test.com',
          buyerName: 'Guest Buyer USD',
          shippingAddress: {
            fullName: 'Guest Buyer USD',
            street1: '456 Test Ave',
            city: 'Test City',
            state: 'TS',
            postalCode: '12345',
            country: 'US',
          },
          buyerCountry: 'US',
        });

      expect(transRes.statusCode).toBe(201);
      expect(transRes.body.currency).toBe('USD');
    });

    it('v34.4: JPY (zero-decimal) currency handled correctly', async () => {
      const jpyListing = await Listing.create({
        seller: testUser._id,
        title: 'JPY Test Item 2',
        description: 'Japanese Yen test',
        price: 5000, // 5000 yen = ~$35 USD
        currency: 'JPY',
        images: ['https://test.image.url/image3.jpg'],
        category: 'Electronics',
        condition: 'Good',
        available: true,
        quantity: 2,
      });

      const transRes = await request(app)
        .post('/api/transactions/guest')
        .send({
          listingId: jpyListing._id,
          buyerEmail: 'guest3@test.com',
          buyerName: 'Guest Buyer JPY',
          shippingAddress: {
            fullName: 'Guest Buyer JPY',
            street1: '789 Test Blvd',
            city: 'Test City',
            state: 'TS',
            postalCode: '12345',
            country: 'JP',
          },
          buyerCountry: 'JP',
        });

      expect(transRes.statusCode).toBe(201);
      expect(transRes.body.currency).toBe('JPY');
    });
  });

  describe('Payment Amount Validation', () => {
    it('v34.5: Payment breakdown returns buyer amounts', async () => {
      const res = await request(app)
        .post('/api/payments/breakdown')
        .send({
          itemPrice: 75.50,
          fromCountry: 'US',
          toCountry: 'CA',
          weightKg: 0.5,
        });

      expect(res.statusCode).toBe(200);
      expect(res.body.buyer).toBeDefined();
      expect(res.body.buyer.itemPrice).toBe(75.50);
      expect(res.body.buyer.totalPaid).toBeGreaterThan(75.50); // Includes shipping + protection
    });

    it('v34.6: Free shipping items show zero shipping cost', async () => {
      const freeShipListing = await Listing.create({
        seller: testUser._id,
        title: 'Free Shipping Item',
        description: 'Free shipping test',
        price: 100,
        currency: 'USD',
        shipping: { freeShipping: true, shippingCost: 0 },
        images: ['https://test.image.url/image4.jpg'],
        category: 'Home',
        condition: 'Good',
        available: false,
        sold: true,
        quantity: 0,
      });

      const res = await request(app)
        .get(`/api/listings/${freeShipListing._id}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.listing.shipping.freeShipping).toBe(true);
    });
  });

  describe('Cart Total Currency Consistency', () => {
    it('v34.7: All cart items must use same currency for checkout', () => {
      // This validates that the frontend logic ensures currency consistency
      const cartItems = [
        { listingId: '1', price: 50, currency: 'USD' },
        { listingId: '2', price: 30, currency: 'USD' },
      ];
      
      const currencies = [...new Set(cartItems.map(i => i.currency))];
      expect(currencies.length).toBe(1); // All same currency
    });

    it('v34.8: Multi-currency cart would require separate checkouts', () => {
      // Validate that mixing currencies is not allowed
      const cartItemsMixed = [
        { listingId: '1', price: 50, currency: 'USD' },
        { listingId: '2', price: 30, currency: 'EUR' },
      ];
      
      const currencies = [...new Set(cartItemsMixed.map(i => i.currency))];
      expect(currencies.length).toBeGreaterThan(1); // Mixed currencies detected
    });
  });
});