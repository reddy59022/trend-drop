// Fraud Detection Tests - v25.0
const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../server.js');
const User = require('../models/User');
const Listing = require('../models/Listing');
const jwt = require('jsonwebtoken');

let token;
let sellerId;
let buyerId;

async function createUser(email) {
  const dummyId = new mongoose.Types.ObjectId();
  return await User.create({
    _id: dummyId,
    name: 'TestUser',
    email: email,
    password: 'hashed',
    emailVerified: true,
    authProvider: 'email',
    country: 'US',
    currency: 'USD',
  });
}

describe('Fraud Detection', () => {
  beforeEach(async () => {
    const seller = await createUser(`seller_${Date.now()}@example.com`);
    sellerId = seller._id;
    const buyer = await createUser(`buyer_${Date.now()}@example.com`);
    buyerId = buyer._id;
    const secret = process.env.JWT_SECRET || 'fallback_secret_change_me';
    token = jwt.sign({ id: buyerId }, secret, { expiresIn: '1h' });
  });

  afterEach(async () => {
    await User.deleteMany({ _id: { $in: [buyerId, sellerId] } });
  });

  describe('POST /api/fraud/check', () => {
    it('FRAUD.1 should return low risk for normal transaction', async () => {
      const listing = await Listing.create({
        title: 'Test Item',
        description: 'Test',
        price: 25,
        category: 'Men',
        condition: 'Good',
        seller: sellerId,
        available: true,
        sold: false,
        status: 'active',
      });

      const res = await request(app)
        .post('/api/fraud/check')
        .set('Authorization', `Bearer ${token}`)
        .send({ listingId: listing._id, amount: 25 });

      expect(res.statusCode).toBe(200);
      expect(res.body.riskScore).toBeGreaterThanOrEqual(0);
      expect(res.body.riskLevel).toBeDefined();
    });

    it('FRAUD.2 should detect high-value transaction risk', async () => {
      const listing = await Listing.create({
        title: 'Expensive Item',
        description: 'Test',
        price: 100,
        category: 'Men',
        condition: 'Good',
        seller: sellerId,
        available: true,
        sold: false,
        status: 'active',
      });

      const res = await request(app)
        .post('/api/fraud/check')
        .set('Authorization', `Bearer ${token}`)
        .send({ listingId: listing._id, amount: 600 });

      expect(res.statusCode).toBe(200);
      expect(res.body.risks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'high_value' }),
        ])
      );
    });

    it('FRAUD.3 should require listingId and amount', async () => {
      const res = await request(app)
        .post('/api/fraud/check')
        .set('Authorization', `Bearer ${token}`)
        .send({});

      expect(res.statusCode).toBe(400);
      expect(res.body.message).toContain('required');
    });

    it('FRAUD.4 should flag invalid listing', async () => {
      const fakeId = new mongoose.Types.ObjectId();
      const res = await request(app)
        .post('/api/fraud/check')
        .set('Authorization', `Bearer ${token}`)
        .send({ listingId: fakeId, amount: 25 });

      expect(res.statusCode).toBe(200);
      expect(res.body.risks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'invalid_listing' }),
        ])
      );
    });

    it('FRAUD.5 should include IP address in check', async () => {
      const listing = await Listing.create({
        title: 'Test Item',
        description: 'Test',
        price: 25,
        category: 'Men',
        condition: 'Good',
        seller: sellerId,
        available: true,
        sold: false,
        status: 'active',
      });

      const res = await request(app)
        .post('/api/fraud/check')
        .set('Authorization', `Bearer ${token}`)
        .send({ listingId: listing._id, amount: 25, ipAddress: '192.168.1.1' });

      expect(res.statusCode).toBe(200);
      expect(res.body.risks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'ip_check' }),
        ])
      );
    });
  });

  describe('GET /api/fraud/settings', () => {
    it('FRAUD.6 should return fraud settings', async () => {
      const res = await request(app).get('/api/fraud/settings');

      expect(res.statusCode).toBe(200);
      expect(res.body.highValueThreshold).toBe(500);
      expect(res.body.velocityThreshold).toBe(5);
      expect(res.body.manualReviewThreshold).toBe(25);
    });
  });
});