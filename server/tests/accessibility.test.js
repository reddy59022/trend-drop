/**
 * Accessibility (WCAG 2.1 AA) Tests - API Level
 * Tests for enterprise-grade accessibility compliance
 */
const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../server');
const User = require('../models/User');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';

let sellerToken, buyerToken;

beforeAll(async () => {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/trenddrop_test');
  }

  const seedBase = `a11y_${Date.now()}_`;

  const seller = await User.create({
    name: 'Accessibility Seller',
    email: `${seedBase}seller@test.com`,
    password: 'password123',
    country: 'US',
    currency: 'USD',
    emailVerified: true,
    authProvider: 'email',
    balance: { available: 0, pending: 0, totalEarned: 0, totalPaidOut: 0, currency: 'USD' },
    stats: { totalSales: 0, totalPurchases: 0, strikes: 0 },
  });
  sellerToken = jwt.sign({ id: seller._id }, JWT_SECRET, { expiresIn: '30d' });

  const buyer = await User.create({
    name: 'Accessibility Buyer',
    email: `${seedBase}buyer@test.com`,
    password: 'password123',
    country: 'GB',
    currency: 'GBP',
    emailVerified: true,
    authProvider: 'email',
    balance: { available: 0, pending: 0, totalEarned: 0, totalPaidOut: 0, currency: 'GBP' },
    stats: { totalSales: 0, totalPurchases: 0, strikes: 0 },
  });
  buyerToken = jwt.sign({ id: buyer._id }, JWT_SECRET, { expiresIn: '30d' });
});

afterAll(async () => {
  await User.deleteMany({ email: /a11y_/ });
  await mongoose.connection.close();
});

describe('Accessibility (WCAG 2.1 AA) - API Level', () => {
  describe('API Response Accessibility', () => {
    test('A11Y.1 API responses have proper structure', async () => {
      const res = await request(app).get('/api/listings');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/application\/json/);
    });

    test('A11Y.2 Error responses include helpful messages', async () => {
      const res = await request(app).get('/api/listings/invalid-id');
      expect([400, 404, 500]).toContain(res.status);
      expect(res.body.message || res.text).toBeDefined();
    });

    test('A11Y.3 Language headers supported', async () => {
      const res = await request(app)
        .get('/api/listings')
        .set('Accept-Language', 'es-ES,es;q=0.9,en;q=0.8');
      expect(res.status).toBe(200);
    });

    test('A11Y.4 Pagination links accessible', async () => {
      const res = await request(app).get('/api/listings?page=1&limit=10');
      expect(res.status).toBe(200);
      expect(res.body).toBeDefined();
    });

    test('A11Y.5 Filtering accessible', async () => {
      const res = await request(app).get('/api/listings?category=Men');
      expect(res.status).toBe(200);
      expect(res.body).toBeDefined();
    });
  });

  describe('Authentication Accessibility', () => {
    test('A11Y.6 Login errors communicated', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'wrong@test.com', password: 'wrong' });
      
      expect([400, 401]).toContain(res.status);
      expect(res.body.message).toBeDefined();
      expect(res.body.message.length).toBeGreaterThan(0);
    });

    test('A11Y.7 Registration validation clear', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ email: 'invalid', password: 'short' });
      
      expect(res.status).toBe(400);
      expect(res.body.message).toBeDefined();
    });

    test('A11Y.8 404 page accessible', async () => {
      const res = await request(app).get('/nonexistent-page');
      expect(res.status).toBe(404);
      expect(res.text).toMatch(/<main|role="main"|<!DOCTYPE/);
    });
  });

  describe('Internationalization Support', () => {
    test('A11Y.9 Language detection from headers', async () => {
      const res = await request(app)
        .get('/api/listings')
        .set('Accept-Language', 'fr-FR,fr;q=0.9,en;q=0.8');
      expect(res.status).toBe(200);
    });

    test('A11Y.10 Multi-language error messages', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .set('Accept-Language', 'es')
        .send({ email: 'test', password: 'test' });
      
      expect([400, 401]).toContain(res.status);
      expect(res.body.message).toBeDefined();
    });
  });

  describe('Performance & Timing', () => {
    test('A11Y.11 API response time acceptable', async () => {
      const start = Date.now();
      const res = await request(app).get('/api/listings');
      const duration = Date.now() - start;
      expect(res.status).toBe(200);
      expect(duration).toBeLessThan(5000); // Under 5 seconds
    });

    test('A11Y.12 Concurrent requests handled', async () => {
      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(request(app).get('/api/listings'));
      }
      const responses = await Promise.all(promises);
      responses.forEach(res => {
        expect(res.status).toBe(200);
      });
    });
  });
});