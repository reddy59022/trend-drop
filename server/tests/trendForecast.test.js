const mongoose = require('mongoose');
const request = require('supertest');
const app = require('../server');
const User = require('../models/User');
const Listing = require('../models/Listing');
const TrendForecast = require('../models/TrendForecast');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';

let user;
let userToken;
let testListing;

beforeAll(async () => {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/trenddrop_test');
  }
  
  const seedBase = `trend_${Date.now()}_`;
  
  user = await User.create({
    name: 'Trend User', email: `${seedBase}trend@test.com`, password: 'password123',
    country: 'US', currency: 'USD', emailVerified: true, authProvider: 'email',
    shippingAddress: { fullName: 'User', street1: '123 St', city: 'City', state: 'CA', postalCode: '90210', country: 'US' },
  });

  userToken = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '30d' });

  testListing = await Listing.create({
    title: 'Trend Item', description: 'Test', price: 75, category: 'Women',
    condition: 'New with tags', images: ['https://example.com/trend.jpg'], seller: user._id, quantity: 1, status: 'active',
  });
});

afterAll(async () => {
  if (user) await User.findByIdAndDelete(user._id);
  if (testListing) await Listing.findByIdAndDelete(testListing._id);
  await TrendForecast.deleteMany({});
  await mongoose.connection.close();
});

describe('v53.0 AI-Powered Trend Forecasting', () => {
  test('v53.1 - Should require auth for forecasts', async () => {
    const res = await request(app).get('/api/trend-forecast');
    expect(res.status).toBe(401);
  });

  test('v53.2 - Should get trend forecasts for all categories', async () => {
    await TrendForecast.create({
      category: 'Women',
      predictedDemand: 45,
      confidence: 85,
      timeframe: 'weekly',
      trendingItems: [{ listing: testListing._id, trendScore: 95 }],
      isActive: true
    });

    const res = await request(app)
      .get('/api/trend-forecast')
      .set('Authorization', `Bearer ${userToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('v53.3 - Should get forecast for specific category', async () => {
    const res = await request(app)
      .get('/api/trend-forecast/Women')
      .set('Authorization', `Bearer ${userToken}`);

    expect(res.status).toBe(200);
    expect(res.body.category).toBe('Women');
    expect(res.body.predictedDemand).toBeDefined();
    expect(res.body.confidence).toBeDefined();
  });

  test('v53.4 - Should return 404 for non-existent category', async () => {
    const res = await request(app)
      .get('/api/trend-forecast/Nonexistent')
      .set('Authorization', `Bearer ${userToken}`);

    expect(res.status).toBe(404);
  });

  test('v53.5 - Should get trending items for category', async () => {
    const res = await request(app)
      .get('/api/trend-forecast/Women/trending')
      .set('Authorization', `Bearer ${userToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('v53.6 - Should generate new forecast data', async () => {
    const res = await request(app)
      .post('/api/trend-forecast/generate')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ category: 'Men', timeframe: 'weekly' });

    expect(res.status).toBe(200);
    expect(res.body.category).toBe('Men');
    expect(res.body.predictedDemand).toBeDefined();
    expect(res.body.confidence).toBeGreaterThan(0);
  });

  test('v53.7 - Should set up trend alerts', async () => {
    const res = await request(app)
      .post('/api/trend-forecast/alerts')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ categories: ['Women', 'Men'] });

    expect(res.status).toBe(200);
    expect(res.body.alerts).toBeDefined();
    expect(Array.isArray(res.body.alerts)).toBe(true);
  });

  test('v53.8 - Should get personalized trend recommendations', async () => {
    // Create a forecast for the user's category (Women) from testListing
    const forecast = await TrendForecast.create({
      category: 'Women',
      predictedDemand: 45,
      confidence: 85,
      timeframe: 'weekly',
      isActive: true
    });
    
    const res = await request(app)
      .get('/api/trend-forecast/personalized')
      .set('Authorization', `Bearer ${userToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});
