const request = require('supertest');
const app = require('../server');
const mongoose = require('mongoose');
const User = require('../models/User');
const Listing = require('../models/Listing');
const jwt = require('jsonwebtoken');

let token;
let userId;

/**
 * Create a unique user for the test run and return a JWT.
 * Using a timestamp + ObjectId in the email guarantees uniqueness
 * and avoids duplicate‑key errors across test executions.
 */
async function createUserAndToken() {
  const dummyId = new mongoose.Types.ObjectId();
  const uniqueEmail = `search_user_${Date.now()}_${dummyId}@example.com`;
  await User.create({
    _id: dummyId,
    name: 'SearchUser',
    email: uniqueEmail,
    password: 'hashed',
    emailVerified: true,
    authProvider: 'email',
    country: 'US',
    currency: 'USD',
    shippingAddress: { fullName: 'Search', street1: '1 St', city: 'City', state: 'CA', postalCode: '12345', country: 'US' },
    balance: { available: 0, pending: 0, totalEarned: 0, totalPaidOut: 0, currency: 'USD' },
    stats: { totalSales: 0, totalPurchases: 0, strikes: 0 },
  });
  const secret = process.env.JWT_SECRET || 'fallback_secret_change_me';
  token = jwt.sign({ id: dummyId }, secret, { expiresIn: '1h' });
  userId = dummyId;
}

/**
 * Insert a listing belonging to the test user.
 * The category and condition must match the enums defined in the Listing schema.
 */
async function createListing() {
  const seller = await User.findById(userId);
  await Listing.create({
    seller: seller._id,
    title: 'Alpha Search Item',
    description: 'Contains the word Alpha for search testing',
    price: 100,
    category: 'Men',   // valid enum value
    condition: 'Good', // valid enum value
    quantity: 1,
    available: true,
    sold: false,
    shipsFrom: 'US',
    weight: 1,
    weightUnit: 'kg',
    images: [],
  });
}

describe('GET /api/listings/search', () => {
  beforeAll(async () => {
    await createUserAndToken();
    await createListing();
  });

  test('returns 200 and a listings array for a matching query', async () => {
    const res = await request(app)
      .get('/api/listings/search')
      .set('Authorization', `Bearer ${token}`)
      .query({ q: 'Alpha', limit: 5 });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.listings)).toBe(true);
    expect(res.body).toHaveProperty('totalPages');
    // Ensure at least one result matches the created listing title.
    const titles = res.body.listings.map(l => l.title);
    expect(titles).toContain('Alpha Search Item');
  });
});
