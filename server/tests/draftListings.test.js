const mongoose = require('mongoose');
const request = require('supertest');
const app = require('../server');
const User = require('../models/User');
const Listing = require('../models/Listing');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';

let sellerToken, buyerToken;
let seller, buyer;

beforeAll(async () => {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/trenddrop_test');
  }
  
  const seedBase = `draft_${Date.now()}_`;
  
  seller = await User.create({
    name: 'Draft Seller',
    email: `${seedBase}seller@test.com`, password: 'password123',
    country: 'US', currency: 'USD', emailVerified: true, authProvider: 'email',
    shippingAddress: { fullName: 'Seller', street1: '123 St', city: 'City', state: 'CA', postalCode: '90210', country: 'US' },
    balance: { available: 0, pending: 0, totalEarned: 0, totalPaidOut: 0, currency: 'USD' },
    stats: { totalSales: 0, totalPurchases: 0, strikes: 0 },
  });
  sellerToken = jwt.sign({ id: seller._id }, JWT_SECRET, { expiresIn: '30d' });

  buyer = await User.create({
    name: 'Draft Buyer', email: `${seedBase}buyer@test.com`, password: 'password123',
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

describe('Draft Listing Tests', () => {
  test('1. Create listing with status=draft', async () => {
    const res = await request(app)
      .post('/api/listings')
      .set('Authorization', `Bearer ${sellerToken}`)
      .field('title', 'Draft Test Listing')
      .field('description', 'This is a draft')
      .field('price', 75)
      .field('category', 'Men')
      .field('condition', 'New with tags')
      .field('brand', 'DraftBrand')
      .field('size', 'L')
      .field('color', 'Red')
      .field('status', 'draft')
      .field('currency', 'USD')
      .field('weight', 0.5)
      .field('quantity', 1);
    expect(res.status).toBe(201);
    expect(res.body.listing.status).toBe('draft');
    expect(res.body.listing.available).toBe(false);
  });

  test('2. Draft listings hidden from public feed', async () => {
    const feedRes = await request(app).get('/api/listings');
    const draftListings = feedRes.body.listings?.filter(l => l.status === 'draft') || [];
    expect(draftListings.length).toBe(0);
  });

  test('3. Draft listings not returned in search results', async () => {
    const searchRes = await request(app)
      .get('/api/listings')
      .query({ search: 'Draft Test Listing' });
    const found = searchRes.body.listings?.find(l => l.title === 'Draft Test Listing');
    expect(found).toBeUndefined();
  });

  test('4. Seller can see own draft listings', async () => {
    const listing = await Listing.findOne({ seller: seller._id, status: 'draft' });
    expect(listing).toBeDefined();
    
    const viewRes = await request(app)
      .get(`/api/listings/${listing._id}`)
      .set('Authorization', `Bearer ${sellerToken}`);
    expect(viewRes.status).toBe(200);
    expect(viewRes.body.listing.status).toBe('draft');
  });

  test('5. Buyer cannot see draft listing by ID', async () => {
    const listing = await Listing.findOne({ seller: seller._id, status: 'draft' });
    
    const viewRes = await request(app)
      .get(`/api/listings/${listing._id}`)
      .set('Authorization', `Bearer ${buyerToken}`);
    
    expect(viewRes.status).toBe(404);
  });

  test('6. Can publish draft listing (change status to active)', async () => {
    const listing = await Listing.findOne({ seller: seller._id, status: 'draft' });
    
    const editRes = await request(app)
      .put(`/api/listings/${listing._id}`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .field('status', 'active');
    
    expect(editRes.status).toBe(200);
    expect(editRes.body.listing.status).toBe('active');
    expect(editRes.body.listing.available).toBe(true);
  });
});