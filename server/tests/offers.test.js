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
  await mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true });
  // Create users
  seller = await User.create({ name: 'Seller', email: 'seller@example.com', password: 'pass' });
  buyer = await User.create({ name: 'Buyer', email: 'buyer@example.com', password: 'pass' });
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

  test('Buyer accepts counter and transaction is created', async () => {
    const res = await request(app)
      .patch(`/api/offers/${offerId}/accept-counter`)
      .set('Authorization', `Bearer ${buyer.generateAuthToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.transaction).toBeDefined();
    expect(res.body.transaction.itemPrice).toBe(90);
  });
});
