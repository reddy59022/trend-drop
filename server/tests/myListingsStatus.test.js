const mongoose = require('mongoose');
const request = require('supertest');
const app = require('../server');
const User = require('../models/User');
const Listing = require('../models/Listing');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';

let sellerToken, otherToken;
let seller, other;

beforeAll(async () => {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/trenddrop_test');
  }

  const seedBase = `mylist_${Date.now()}_`;

  seller = await User.create({
    name: 'MyList Seller',
    email: `${seedBase}seller@test.com`, password: 'password123',
    country: 'US', currency: 'USD', emailVerified: true, authProvider: 'email',
    shippingAddress: { fullName: 'Seller', street1: '123 St', city: 'City', state: 'CA', postalCode: '90210', country: 'US' },
    balance: { available: 0, pending: 0, totalEarned: 0, totalPaidOut: 0, currency: 'USD' },
    stats: { totalSales: 0, totalPurchases: 0, strikes: 0 },
  });
  sellerToken = jwt.sign({ id: seller._id }, JWT_SECRET, { expiresIn: '30d' });

  other = await User.create({
    name: 'MyList Other',
    email: `${seedBase}other@test.com`, password: 'password123',
    country: 'US', currency: 'USD', emailVerified: true, authProvider: 'email',
    shippingAddress: { fullName: 'Other', street1: '123 St', city: 'City', state: 'CA', postalCode: '90210', country: 'US' },
    balance: { available: 0, pending: 0, totalEarned: 0, totalPaidOut: 0, currency: 'USD' },
    stats: { totalSales: 0, totalPurchases: 0, strikes: 0 },
  });
  otherToken = jwt.sign({ id: other._id }, JWT_SECRET, { expiresIn: '30d' });

  // Seller has one draft and one active listing; other user has a draft too.
  await Listing.create({
    title: `${seedBase}My Draft`, description: 'draft', price: 10,
    category: 'Men', condition: 'New with tags', brand: 'B', size: 'M',
    seller: seller._id, status: 'draft', available: false,
  });
  await Listing.create({
    title: `${seedBase}My Active`, description: 'active', price: 20,
    category: 'Men', condition: 'New with tags', brand: 'B', size: 'M',
    seller: seller._id, status: 'active', available: true,
  });
  await Listing.create({
    title: `${seedBase}Other Draft`, description: 'draft', price: 30,
    category: 'Men', condition: 'New with tags', brand: 'B', size: 'M',
    seller: other._id, status: 'draft', available: false,
  });
});

afterAll(async () => {
  if (seller) await Listing.deleteMany({ seller: seller._id });
  if (other) await Listing.deleteMany({ seller: other._id });
  if (seller) await User.findByIdAndDelete(seller._id);
  if (other) await User.findByIdAndDelete(other._id);
  await mongoose.connection.close();
});

describe('GET /api/listings/my status filter', () => {
  test('status=draft returns the seller\'s drafts (not silently empty)', async () => {
    const res = await request(app)
      .get('/api/listings/my')
      .query({ status: 'draft' })
      .set('Authorization', `Bearer ${sellerToken}`);

    expect(res.status).toBe(200);
    const titles = (res.body.listings || []).map(l => l.title);
    expect(titles.some(t => t.includes('My Draft'))).toBe(true);
    expect(res.body.listings.length).toBeGreaterThanOrEqual(1);
    expect(res.body.listings.every(l => l.status === 'draft')).toBe(true);
    expect(titles.some(t => t.includes('My Active'))).toBe(false);
    // Never leaks other sellers' drafts
    expect(titles.some(t => t.includes('Other Draft'))).toBe(false);
  });

  test('status=draft does not leak other sellers\' listings', async () => {
    const res = await request(app)
      .get('/api/listings/my')
      .query({ status: 'draft' })
      .set('Authorization', `Bearer ${otherToken}`);
    expect(res.status).toBe(200);
    const titles = (res.body.listings || []).map(l => l.title);
    expect(titles.some(t => t.includes('My Draft'))).toBe(false);
    expect(titles.some(t => t.includes('Other Draft'))).toBe(true);
  });

  test('status=active keeps working and excludes drafts', async () => {
    const res = await request(app)
      .get('/api/listings/my')
      .query({ status: 'active' })
      .set('Authorization', `Bearer ${sellerToken}`);
    expect(res.status).toBe(200);
    expect((res.body.listings || []).every(l => l.status === 'active')).toBe(true);
  });

  test('default (no status) still returns active listings only', async () => {
    const res = await request(app)
      .get('/api/listings/my')
      .set('Authorization', `Bearer ${sellerToken}`);
    expect(res.status).toBe(200);
    expect((res.body.listings || []).every(l => l.status === 'active')).toBe(true);
  });

  test('invalid status value is rejected with 400, not silently empty', async () => {
    const res = await request(app)
      .get('/api/listings/my')
      .query({ status: 'bogus-status' })
      .set('Authorization', `Bearer ${sellerToken}`);
    expect(res.status).toBe(400);
  });
});
