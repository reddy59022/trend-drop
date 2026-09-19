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
let cancelledTransaction;

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

  cancelledTransaction = await Transaction.create({
    seller: user._id, buyer: user._id, amount: 999, status: 'cancelled',
    listing: testListing._id, itemPrice: 999,
    paymentBreakdown: { subtotal: 999, sellerEarnings: 999, totalPaid: 999 },
  });

  // These terminal loss states must never be reported as seller revenue.
  await Transaction.create([
    {
      seller: user._id, buyer: user._id, amount: 777, status: 'returned',
      listing: testListing._id, itemPrice: 777,
      paymentBreakdown: { subtotal: 777, sellerEarnings: 777, totalPaid: 777 },
    },
    {
      seller: user._id, buyer: user._id, amount: 888, status: 'chargeback_lost',
      listing: testListing._id, itemPrice: 888,
      paymentBreakdown: { subtotal: 888, sellerEarnings: 888, totalPaid: 888 },
    },
    {
      seller: user._id, buyer: user._id, amount: 666, status: 'disputed',
      listing: testListing._id, itemPrice: 666,
      paymentBreakdown: { subtotal: 666, sellerEarnings: 666, totalPaid: 666 },
    },
  ]);
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
    expect(res.body.totalRevenue).toBe(85);
    expect(res.body.netRevenue).toBe(85);
    expect(res.body.totalTransactions).toBe(1);
  });

  test('v50.3 - Should return seller average order value in overview', async () => {
    const res = await request(app)
      .get('/api/users/me/analytics/overview?period=30d')
      .set('Authorization', `Bearer ${userToken}`);

    expect(res.status).toBe(200);
    expect(res.body.overview.avgOrderValue).toBe(85);
  });

  test('v50.4 - Should exclude cancelled transactions from revenue analytics', async () => {
    const res = await request(app)
      .get('/api/users/me/analytics/revenue?period=30d')
      .set('Authorization', `Bearer ${userToken}`);

    expect(res.status).toBe(200);
    expect(res.body.revenue.reduce((sum, row) => sum + row.revenue, 0)).toBe(85);
  });

  test('v50.5 - Should get sales analytics', async () => {
    const res = await request(app)
      .get('/api/analytics/sales')
      .set('Authorization', `Bearer ${userToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0].amount).toBe(100);
  });

  test('v50.6 - Should get inventory analytics', async () => {
    const res = await request(app)
      .get('/api/analytics/inventory')
      .set('Authorization', `Bearer ${userToken}`);

    expect(res.status).toBe(200);
    expect(res.body.total).toBeDefined();
  });

  test('v50.7 - Should get forecast', async () => {
    const res = await request(app)
      .post('/api/analytics/forecast')
      .set('Authorization', `Bearer ${userToken}`);

    expect(res.status).toBe(200);
    expect(res.body.predictedSales).toBeDefined();
  });

  test('v50.8 - normalizes non-USD seller revenue to the reporting currency', async () => {
    const jpyTransaction = await Transaction.create({
      seller: user._id, buyer: user._id, amount: 14950, currency: 'JPY', status: 'completed',
      listing: testListing._id, itemPrice: 14950,
      paymentBreakdown: { subtotal: 14950, sellerEarnings: 14950, totalPaid: 14950 },
    });

    const res = await request(app)
      .get('/api/analytics/dashboard')
      .set('Authorization', `Bearer ${userToken}`);

    expect(res.status).toBe(200);
    expect(res.body.reportingCurrency).toBe('USD');
    expect(res.body.totalRevenue).toBeCloseTo(85 + 100, 2);
    await Transaction.findByIdAndDelete(jpyTransaction._id);
  });
});