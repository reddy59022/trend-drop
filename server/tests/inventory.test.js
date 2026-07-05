const mongoose = require('mongoose');
const request = require('supertest');
const app = require('../server');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Inventory = require('../models/Inventory');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';

let user;
let userToken;
let testListing;

beforeAll(async () => {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/trenddrop_test');
  }
  
  const seedBase = `inv_${Date.now()}_`;
  
  user = await User.create({
    name: 'Inventory User', email: `${seedBase}inv@test.com`, password: 'password123',
    country: 'US', currency: 'USD', emailVerified: true, authProvider: 'email',
    shippingAddress: { fullName: 'User', street1: '123 St', city: 'City', state: 'CA', postalCode: '90210', country: 'US' },
  });

  userToken = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '30d' });

  testListing = await Listing.create({
    title: 'Inventory Item', description: 'Test', price: 50, category: 'Women',
    condition: 'New with tags', images: ['https://example.com/inv.jpg'], seller: user._id, quantity: 5, status: 'active',
  });
});

afterAll(async () => {
  if (user) await User.findByIdAndDelete(user._id);
  if (testListing) await Listing.findByIdAndDelete(testListing._id);
  await Inventory.deleteMany({});
  await mongoose.connection.close();
});

describe('v56.0 Advanced Inventory Management', () => {
  test('v56.1 - Should require auth for inventory', async () => {
    const res = await request(app).get('/api/inventory');
    expect(res.status).toBe(401);
  });

  test('v56.2 - Should get user inventory', async () => {
    const res = await request(app)
      .get('/api/inventory')
      .set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('v56.3 - Should sync inventory', async () => {
    const res = await request(app)
      .post('/api/inventory/sync')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        warehouse: 'WH-001',
        items: [{ listingId: testListing._id, quantity: 10 }]
      });
    expect(res.status).toBe(200);
  });

  test('v56.4 - Should check stock alerts', async () => {
    await Inventory.create({
      seller: user._id,
      listing: testListing._id,
      quantity: 3,
      lowStockThreshold: 5
    });
    
    const res = await request(app)
      .post('/api/inventory/alerts')
      .set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(200);
    expect(res.body.alerts).toBeDefined();
  });
});