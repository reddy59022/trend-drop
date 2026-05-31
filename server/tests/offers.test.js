/**
 * Basic integration tests for the new offer negotiation flow.
 * These tests use the supertest library to hit the API endpoints.
 * Ensure you have a test database configured (e.g., via MONGODB_URI env var).
 */

const request = require('supertest');
const app = require('../server'); // assuming server.js exports the Express app
const mongoose = require('mongoose');
const Offer = require('../models/Offer');
const Listing = require('../models/Listing');
const User = require('../models/User');

let seller, buyer, listing;

beforeAll(async () => {
  // Connect to test db (jest config should set NODE_ENV=test)
  // Ensure MONGODB_URI is defined for the test environment; fall back to a local instance.
   const testMongoUri = process.env.MONGODB_URI || "mongodb://localhost:27017/trend-drop-test";
   // Connect only if not already connected to avoid multiple connections error
   if (mongoose.connection.readyState === 0) {
     await mongoose.connect(testMongoUri, { useNewUrlParser: true, useUnifiedTopology: true });
   }
  // Create users
  // Use passwords that satisfy the minimum length validation (>=6 characters)
  seller = await User.create({ name: 'Seller', email: 'seller@example.com', password: 'password' });
  buyer = await User.create({ name: 'Buyer', email: 'buyer@example.com', password: 'password' });
  // Create a listing
  listing = await Listing.create({
    seller: seller._id,
    title: 'Test Item',
    description: 'Test description',
    category: 'Electronics',
    condition: 'New with tags',
    price: 100,
    currency: 'USD',
    available: true,
    quantity: 5,
  });
});

afterAll(async () => {
  await Offer.deleteMany({});
  await Listing.deleteMany({});
  await User.deleteMany({});
  await mongoose.disconnect();
});

describe('Offer negotiation flow', () => {
  let offerId;

  test('Buyer creates an offer', async () => {
    const res = await request(app)
      .post('/api/offers')
      .set('Authorization', `Bearer ${buyer.generateAuthToken()}`)
      .send({ listingId: listing._id, amount: 80 });
    expect(res.status).toBe(201);
    expect(res.body.amount).toBe(80);
    offerId = res.body._id;
  });

  test('Seller counters the offer', async () => {
    const res = await request(app)
      .patch(`/api/offers/${offerId}/counter`)
      .set('Authorization', `Bearer ${seller.generateAuthToken()}`)
      .send({ counterAmount: 90 });
    expect(res.status).toBe(200);
    expect(res.body.counterAmount).toBe(90);
    expect(res.body.status).toBe('countered');
  });

  test('Buyer accepts counter and then creates a transaction via the offer endpoint', async () => {
    // Buyer accepts the seller's counter. No transaction is created at this step.
    const acceptRes = await request(app)
      .patch(`/api/offers/${offerId}/accept-counter`)
      .set('Authorization', `Bearer ${buyer.generateAuthToken()}`);
    expect(acceptRes.status).toBe(200);
    expect(acceptRes.body.transaction).toBeUndefined();
    // Now the buyer creates a transaction based on the accepted offer.
    const transactionRes = await request(app)
      .post(`/api/transactions/offer/${offerId}`)
      .set('Authorization', `Bearer ${buyer.generateAuthToken()}`);
    expect(transactionRes.status).toBe(201);
    expect(transactionRes.body.transaction).toBeDefined();
    expect(transactionRes.body.transaction.itemPrice).toBe(90);
  });
});
