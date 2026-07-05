const mongoose = require('mongoose');
const request = require('supertest');
const app = require('../server');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Transaction = require('../models/Transaction');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';

let user;
let userToken;
let testListing;

beforeAll(async () => {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/trenddrop_test');
  }
  
  const seedBase = `analytics_${Date.now()}_`;
  
  user = await User.create({
    name: 'Analytics Seller', email: `${seedBase}seller@test.com`, password: 'password123',
    country: 'US', currency: 'USD', emailVerified: true, authProvider: 'email',
    shippingAddress: { fullName: 'Seller', street1: '123 St', city: 'City', state: 'CA', postalCode: '90210', country: 'US' },
  });

  userToken = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '30d' });

  testListing = await Listing.create({
    title: 'Analytics Item', description: 'Test', price: 100, category: 'Women',
    condition: 'New with tags', images: ['https://example.com/item.jpg'], seller: user._id, quantity: 1, status: 'active',
  });

  await Transaction.create({
    seller: user._id, buyer: user._id, amount: 50, status: 'completed',
    listing: testListing._id, itemPrice: 100,
    paymentBreakdown: { subtotal: 100, sellerEarnings: 85, totalPaid: 108 },
  });
});

afterAll(async () => {
  if (user) await User.findByIdAndDelete(user._id);
  if (testListing) await Listing.findByIdAndDelete(testListing._id);
  await Transaction.deleteMany({ seller: user._id });
  await mongoose.connection.close();
});

describe('v50.0 Advanced Analytics Dashboard', () => {
  test('v50.1 - Should require auth for dashboard', async () => {
    const res = await request(app).get('/api/analytics/dashboard');
    expect(res.status).toBe(401);
  });

  test('v50.2 - Should get analytics dashboard', async () => {
    const res = await request(app)
      .get('/api/analytics/dashboard')
      .set('Authorization', `Bearer ${userToken}`);

    expect(res.status).toBe(200);
    expect(res.body.totalListings).toBeDefined();
  });

  test('v50.3 - Should get sales analytics', async () => {
    const res = await request(app)
      .get('/api/analytics/sales')
      .set('Authorization', `Bearer ${userToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('v50.4 - Should get inventory analytics', async () => {
    const res = await request(app)
      .get('/api/analytics/inventory')
      .set('Authorization', `Bearer ${userToken}`);

    expect(res.status).toBe(200);
    expect(res.body.total).toBeDefined();
  });

  test('v50.5 - Should get forecast', async () => {
    const res = await request(app)
      .post('/api/analytics/forecast')
      .set('Authorization', `Bearer ${userToken}`);

    expect(res.status).toBe(200);
    expect(res.body.predictedSales).toBeDefined();
  });
});