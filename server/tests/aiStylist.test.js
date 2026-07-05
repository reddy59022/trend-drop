const mongoose = require('mongoose');
const request = require('supertest');
const app = require('../server');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Transaction = require('../models/Transaction');
const AIStylist = require('../models/AIStylist');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';

let user;
let userToken;
let testListing;

beforeAll(async () => {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/trenddrop_test');
  }
  
  const seedBase = `ai_${Date.now()}_`;
  
  user = await User.create({
    name: 'AI Stylist User', email: `${seedBase}user@test.com`, password: 'password123',
    country: 'US', currency: 'USD', emailVerified: true, authProvider: 'email',
    shippingAddress: { fullName: 'User', street1: '123 St', city: 'City', state: 'CA', postalCode: '90210', country: 'US' },
  });
  userToken = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '30d' });
  
  testListing = await Listing.create({
    title: 'Trendy Item',
    description: 'AI recommendation test item',
    price: 75,
    category: 'Women',
    condition: 'New with tags',
    brand: 'Zara',
    color: 'Blue',
    images: ['https://example.com/item.jpg'],
    seller: user._id,
    quantity: 1,
    status: 'active',
    likes: [user._id],
  });
});

afterAll(async () => {
  if (user) await User.findByIdAndDelete(user._id);
  if (testListing) await Listing.findByIdAndDelete(testListing._id);
  await AIStylist.deleteMany({});
  await mongoose.connection.close();
});

describe('v46.0 AI Stylist Recommendations', () => {
  test('v46.1 - Should get preferences (creates default if not exists)', async () => {
    const res = await request(app)
      .get('/api/ai-stylist/preferences')
      .set('Authorization', `Bearer ${userToken}`);
    
    expect(res.status).toBe(200);
    expect(res.body).toBeDefined();
  });

  test('v46.2 - Should update preferences', async () => {
    const preferences = {
      categories: ['Women', 'Accessories'],
      brands: ['Zara', 'H&M'],
      priceRange: { min: 50, max: 200 },
    };
    
    const res = await request(app)
      .put('/api/ai-stylist/preferences')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ preferences });
    
    expect(res.status).toBe(200);
    expect(res.body.categories).toEqual(preferences.categories);
  });

  test('v46.3 - Should require authentication for preferences', async () => {
    const res = await request(app)
      .get('/api/ai-stylist/preferences');
    
    expect(res.status).toBe(401);
  });

  test('v46.4 - Should generate recommendations', async () => {
    const res = await request(app)
      .post('/api/ai-stylist/generate')
      .set('Authorization', `Bearer ${userToken}`);
    
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('v46.5 - Should get recommendations', async () => {
    const res = await request(app)
      .get('/api/ai-stylist/recommendations')
      .set('Authorization', `Bearer ${userToken}`);
    
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('v46.6 - Should create and get outfits', async () => {
    const createRes = await request(app)
      .post('/api/ai-stylist/outfits')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        name: 'Summer Outfit',
        items: [testListing._id],
      });
    
    expect(createRes.status).toBe(200);
    expect(createRes.body.name).toBe('Summer Outfit');
    
    const getRes = await request(app)
      .get('/api/ai-stylist/outfits')
      .set('Authorization', `Bearer ${userToken}`);
    
    expect(getRes.status).toBe(200);
    expect(getRes.body.length).toBeGreaterThan(0);
  });

  test('v46.7 - Should get seasonal trends', async () => {
    const res = await request(app)
      .get('/api/ai-stylist/trends');
    
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('v46.8 - Should get outfit suggestions', async () => {
    const res = await request(app)
      .post('/api/ai-stylist/outfit-suggestion')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ category: 'Women', color: 'Blue' });
    
    expect(res.status).toBe(200);
    expect(res.body.suggestions).toBeDefined();
    expect(res.body.confidence).toBeDefined();
  });

  test('v46.9 - Should require authentication for recommendations', async () => {
    const res = await request(app)
      .get('/api/ai-stylist/recommendations');
    
    expect(res.status).toBe(401);
  });

  test('v46.10 - Should require authentication for outfits', async () => {
    const res = await request(app)
      .get('/api/ai-stylist/outfits');
    
    expect(res.status).toBe(401);
  });

  test('v46.11 - Should require authentication for outfit creation', async () => {
    const res = await request(app)
      .post('/api/ai-stylist/outfits')
      .send({ name: 'Test Outfit' });
    
    expect(res.status).toBe(401);
  });

  test('v46.12 - Should require authentication for generate', async () => {
    const res = await request(app)
      .post('/api/ai-stylist/generate');
    
    expect(res.status).toBe(401);
  });
});