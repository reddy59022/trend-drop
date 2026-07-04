const mongoose = require('mongoose');
const request = require('supertest');
const app = require('../server');
const User = require('../models/User');
const Listing = require('../models/Listing');
const AdvancedSearch = require('../models/AdvancedSearch');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';

let user;
let userToken;
let testListing;

beforeAll(async () => {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/trenddrop_test');
  }
  
  const seedBase = `search_${Date.now()}_`;
  
  user = await User.create({
    name: 'Search User', email: `${seedBase}user@test.com`, password: 'password123',
    country: 'US', currency: 'USD', emailVerified: true, authProvider: 'email',
    shippingAddress: { fullName: 'User', street1: '123 St', city: 'City', state: 'CA', postalCode: '90210', country: 'US' },
  });
  userToken = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '30d' });
  
  testListing = await Listing.create({
    title: 'Nike Running Shoes',
    description: 'Branded shoes for testing',
    price: 100,
    category: 'Women',
    condition: 'New with tags',
    brand: 'Nike',
    color: 'Black',
    size: '10',
    images: ['https://example.com/shoes.jpg'],
    seller: user._id,
    quantity: 1,
    status: 'active',
  });
});

afterAll(async () => {
  if (user) {
    await AdvancedSearch.deleteMany({ userId: user._id });
    await User.findByIdAndDelete(user._id);
  }
  if (testListing) await Listing.findByIdAndDelete(testListing._id);
  await mongoose.connection.close();
});

describe('v44.0 Advanced Search & Filtering', () => {
  test('v44.1 - Should get brands autocomplete', async () => {
    const res = await request(app).get('/api/search/brands');
    
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('v44.2 - Should get colors by category', async () => {
    const res = await request(app).get('/api/search/colors?category=Shoes');
    
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('v44.3 - Should get sizes by category', async () => {
    const res = await request(app).get('/api/search/sizes?category=Shoes');
    
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('v44.4 - Should save a search (authenticated)', async () => {
    const res = await request(app)
      .post('/api/search/save')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        query: 'running shoes',
        filters: { category: 'Shoes', brand: 'Nike' },
        name: 'My Saved Search',
      });
    
    expect(res.status).toBe(200);
    expect(res.body.saved).toBe(true);
    expect(res.body.name).toBe('My Saved Search');
  });

  test('v44.5 - Should require authentication for saving', async () => {
    const res = await request(app)
      .post('/api/search/save')
      .send({ query: 'test' });
    
    expect(res.status).toBe(401);
  });

  test('v44.6 - Should get user saved searches', async () => {
    // Save a search first
    await request(app)
      .post('/api/search/save')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ query: 'test query', filters: {}, name: 'Test' });
    
    const res = await request(app)
      .get('/api/search/saved')
      .set('Authorization', `Bearer ${userToken}`);
    
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});