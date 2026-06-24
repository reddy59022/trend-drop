const mongoose = require('mongoose');
const request = require('supertest');
const app = require('../server');
const User = require('../models/User');
const Listing = require('../models/Listing');
const { expireListings } = require('../config/cron');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';

let sellerToken, buyerToken;
let seller, buyer;

beforeAll(async () => {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/trenddrop_test');
  }
  
  const seedBase = `expire_${Date.now()}_`;
  
  seller = await User.create({
    name: 'Expire Seller', email: `${seedBase}seller@test.com`, password: 'password123',
    country: 'US', currency: 'USD', emailVerified: true, authProvider: 'email',
    shippingAddress: { fullName: 'Seller', street1: '123 St', city: 'City', state: 'CA', postalCode: '90210', country: 'US' },
    balance: { available: 0, pending: 0, totalEarned: 0, totalPaidOut: 0, currency: 'USD' },
    stats: { totalSales: 0, totalPurchases: 0, strikes: 0 },
  });
  sellerToken = jwt.sign({ id: seller._id }, JWT_SECRET, { expiresIn: '30d' });

  buyer = await User.create({
    name: 'Expire Buyer', email: `${seedBase}buyer@test.com`, password: 'password123',
    country: 'US', currency: 'USD', emailVerified: true, authProvider: 'email',
    shippingAddress: { fullName: 'Buyer', street1: '123 St', city: 'City', state: 'CA', postalCode: '90210', country: 'US' },
    balance: { available: 0, pending: 0, totalEarned: 0, totalPaidOut: 0, currency: 'USD' },
    stats: { totalSales: 0, totalPurchases: 0, strikes: 0 },
  });
  buyerToken = jwt.sign({ id: buyer._id }, JWT_SECRET, { expiresIn: '30d' });
});

afterAll(async () => {
  if (seller) await User.findByIdAndDelete(seller._id);
  if (buyer) await User.findByIdAndDelete(buyer._id);
  await mongoose.connection.close();
});

describe('Listing Auto-Expiration Tests', () => {
  test('1. Active listing without expiresAt stays active', async () => {
    const listing = await Listing.create({
      seller: seller._id, title: 'No Expiration Listing', description: 'Should stay active',
      price: 50, category: 'Men', condition: 'New with tags',
      status: 'active', available: true, quantity: 1,
    });
    expect(listing.status).toBe('active');
    expect(listing.available).toBe(true);
  });

  test('2. expireListings expires listings past expiresAt', async () => {
    // Create listing as ACTIVE with future expiresAt
    const expiredListing = await Listing.create({
      seller: seller._id, title: 'Already Expired Listing', description: 'Should get expired by cron',
      price: 50, category: 'Men', condition: 'New with tags',
      status: 'active', available: true, quantity: 1,
      expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000), // past
    });

    const expiredCount = await expireListings();
    expect(expiredCount).toBeGreaterThanOrEqual(1);

    const updated = await Listing.findById(expiredListing._id);
    expect(updated.status).toBe('draft');
    expect(updated.available).toBe(false);
  });

  test('3. Active listing with future expiresAt is NOT expired', async () => {
    const activeListing = await Listing.create({
      seller: seller._id, title: 'Future Expiration Listing', description: 'Should remain active',
      price: 50, category: 'Men', condition: 'New with tags',
      status: 'active', available: true, quantity: 1,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });

    await expireListings();

    const updated = await Listing.findById(activeListing._id);
    expect(updated.status).toBe('active');
    expect(updated.available).toBe(true);
  });

  test('4. Expired listings are hidden from public feed', async () => {
    // Create active listing that will be expired
    const expiredListing = await Listing.create({
      seller: seller._id, title: 'Hidden From Feed', description: 'Should not appear in feed',
      price: 50, category: 'Men', condition: 'New with tags',
      status: 'active', available: true, quantity: 1,
      expiresAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
    });

    await expireListings();

    const searchRes = await request(app).get('/api/listings').query({ search: 'Hidden From Feed' });
    const found = searchRes.body.listings?.find(l => l._id === expiredListing._id.toString() || l._id?.toString?.() === expiredListing._id.toString());
    expect(found).toBeUndefined();
  });

  test('5. Seller can see their own expired/draft listings', async () => {
    // seller can view by ID (bypasses available check)
    const listing = await Listing.findOne({ seller: seller._id });
    expect(listing).toBeDefined();
    
    const viewRes = await request(app)
      .get(`/api/listings/${listing._id}`)
      .set('Authorization', `Bearer ${sellerToken}`);
    expect(viewRes.status).toBe(200);
  });
});