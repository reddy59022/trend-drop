// Price Suggestion AI Tests - v28.0
const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../server.js');
const User = require('../models/User');
const Listing = require('../models/Listing');
const jwt = require('jsonwebtoken');

let sellerToken;
let sellerId;

async function createUser(email, role = 'user') {
  const dummyId = new mongoose.Types.ObjectId();
  return await User.create({
    _id: dummyId,
    name: 'TestUser',
    email: email,
    password: 'hashed',
    emailVerified: true,
    authProvider: 'email',
    role,
    country: 'US',
    currency: 'USD',
  });
}

describe('Price Suggestion AI', () => {
  beforeEach(async () => {
    const seller = await createUser(`seller_pricesuggest_${Date.now()}@example.com`);
    sellerId = seller._id;
    
    const secret = process.env.JWT_SECRET || 'fallback_secret_change_me';
    sellerToken = jwt.sign({ id: sellerId }, secret, { expiresIn: '1h' });
  });

  afterEach(async () => {
    await Listing.deleteMany({ seller: sellerId });
    await User.deleteMany({ _id: sellerId });
  });

  describe('GET /api/price-suggestions/settings', () => {
    it('PRICE.1 should return price suggestion settings', async () => {
      const res = await request(app).get('/api/price-suggestions/settings');

      expect(res.statusCode).toBe(200);
      expect(res.body.seasonalityMultiplier).toBeDefined();
      expect(res.body.conditionMultipliers).toBeDefined();
    });
  });

  describe('POST /api/price-suggestions/suggest', () => {
    it('PRICE.2 should require authentication', async () => {
      const res = await request(app)
        .post('/api/price-suggestions/suggest')
        .send({
          title: 'Nike Shoes',
          category: 'Men',
          brand: 'Nike',
          condition: 'Good',
        });

      expect(res.statusCode).toBe(401);
    });

    it('PRICE.3 should suggest price based on title and category', async () => {
      const res = await request(app)
        .post('/api/price-suggestions/suggest')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({
          title: 'Nike Air Max 2023',
          category: 'Men',
          brand: 'Nike',
          condition: 'Good',
        });

      expect(res.statusCode).toBe(200);
      expect(res.body.suggestedPrice).toBeDefined();
      expect(res.body.suggestedPrice).toBeGreaterThan(0);
    });

    it('PRICE.4 should adjust price based on condition', async () => {
      const newRes = await request(app)
        .post('/api/price-suggestions/suggest')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({
          title: 'Nike Air Max',
          category: 'Men',
          brand: 'Nike',
          condition: 'New',
        });

      const usedRes = await request(app)
        .post('/api/price-suggestions/suggest')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({
          title: 'Nike Air Max',
          category: 'Men',
          brand: 'Nike',
          condition: 'Good',
        });

      expect(newRes.statusCode).toBe(200);
      expect(usedRes.statusCode).toBe(200);
      expect(newRes.body.suggestedPrice).toBeGreaterThan(usedRes.body.suggestedPrice);
    });

    it('PRICE.5 should provide price range', async () => {
      const res = await request(app)
        .post('/api/price-suggestions/suggest')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({
          title: 'Designer Handbag',
          category: 'Women',
          brand: 'Louis Vuitton',
          condition: 'Like New',
        });

      expect(res.statusCode).toBe(200);
      expect(res.body.priceRange).toBeDefined();
      expect(res.body.priceRange.min).toBeGreaterThan(0);
      expect(res.body.priceRange.max).toBeGreaterThan(res.body.priceRange.min);
    });
  });

  describe('POST /api/price-suggestions/similar', () => {
    it('PRICE.6 should find similar sold listings', async () => {
      // Create some sold listings first
      await Listing.create({
        title: 'Nike Air Max Size 10',
        description: 'Used sneakers',
        price: 80,
        category: 'Men',
        condition: 'Good',
        brand: 'Nike',
        seller: sellerId,
        available: false,
        sold: true,
      });

      const res = await request(app)
        .post('/api/price-suggestions/similar')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({
          title: 'Nike Air Max Size 9',
          category: 'Men',
          brand: 'Nike',
        });

      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.body.similar)).toBe(true);
    });
  });

  describe('GET /api/price-suggestions/trends', () => {
    it('PRICE.7 should return market trends', async () => {
      const res = await request(app)
        .get('/api/price-suggestions/trends')
        .query({ category: 'Men' });

      expect(res.statusCode).toBe(200);
      expect(res.body.trendingCategories).toBeDefined();
    });
  });
});