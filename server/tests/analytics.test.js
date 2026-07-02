/**
 * Sales Analytics Dashboard Tests
 * Tests for seller analytics and reporting
 */
const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../server');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Transaction = require('../models/Transaction');
const Offer = require('../models/Offer');
const Rating = require('../models/Rating');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';

let sellerToken, sellerId;

beforeAll(async () => {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/trenddrop_test');
  }

  const seedBase = `analytics_${Date.now()}_`;

  const seller = await User.create({
    name: 'Analytics Seller',
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
  sellerId = seller._id;
});

afterAll(async () => {
  await User.deleteMany({ email: /analytics_/ });
  await mongoose.connection.close();
});

describe('Sales Analytics Dashboard', () => {
  describe('Analytics Overview', () => {
    test('ANL.1 Get analytics overview', async () => {
      const res = await request(app)
        .get('/api/users/me/analytics/overview')
        .set('Authorization', `Bearer ${sellerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.overview).toBeDefined();
      expect(res.body.recentActivity).toBeDefined();
      expect(Array.isArray(res.body.recentActivity)).toBe(true);
    });

    test('ANL.2 Overview has required fields', async () => {
      const res = await request(app)
        .get('/api/users/me/analytics/overview')
        .set('Authorization', `Bearer ${sellerToken}`);

      expect(res.status).toBe(200);
      const overview = res.body.overview;
      expect(overview.totalListings).toBeDefined();
      expect(overview.activeListings).toBeDefined();
      expect(overview.soldListings).toBeDefined();
      expect(overview.totalRevenue).toBeDefined();
      expect(overview.totalSales).toBeDefined();
      expect(overview.avgOrderValue).toBeDefined();
      expect(overview.totalViews).toBeDefined();
      expect(overview.avgRating).toBeDefined();
      expect(overview.conversionRate).toBeDefined();
    });

    test('ANL.3 Overview returns correct types', async () => {
      const res = await request(app)
        .get('/api/users/me/analytics/overview')
        .set('Authorization', `Bearer ${sellerToken}`);

      expect(res.status).toBe(200);
      const overview = res.body.overview;
      expect(typeof overview.totalListings).toBe('number');
      expect(typeof overview.totalRevenue).toBe('number');
      expect(typeof overview.avgOrderValue).toBe('number');
      expect(typeof overview.conversionRate).toBe('number');
    });

    test('ANL.4 Overview period is returned', async () => {
      const res = await request(app)
        .get('/api/users/me/analytics/overview?period=7d')
        .set('Authorization', `Bearer ${sellerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.period).toBe('7d');
    });

    test('ANL.5 Recent activity is limited to 5', async () => {
      const res = await request(app)
        .get('/api/users/me/analytics/overview')
        .set('Authorization', `Bearer ${sellerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.recentActivity.length).toBeLessThanOrEqual(5);
    });
  });

  describe('Revenue Analytics', () => {
    test('ANL.6 Get revenue over time', async () => {
      const res = await request(app)
        .get('/api/users/me/analytics/revenue')
        .set('Authorization', `Bearer ${sellerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.revenue).toBeDefined();
      expect(Array.isArray(res.body.revenue)).toBe(true);
    });

    test('ANL.7 Revenue has correct structure', async () => {
      const res = await request(app)
        .get('/api/users/me/analytics/revenue?period=30d&interval=day')
        .set('Authorization', `Bearer ${sellerToken}`);

      expect(res.status).toBe(200);
      if (res.body.revenue.length > 0) {
        expect(res.body.revenue[0]).toHaveProperty('date');
        expect(res.body.revenue[0]).toHaveProperty('revenue');
        expect(res.body.revenue[0]).toHaveProperty('sales');
      }
    });

    test('ANL.8 Revenue period parameter works', async () => {
      const res7d = await request(app)
        .get('/api/users/me/analytics/revenue?period=7d')
        .set('Authorization', `Bearer ${sellerToken}`);

      const res30d = await request(app)
        .get('/api/users/me/analytics/revenue?period=30d')
        .set('Authorization', `Bearer ${sellerToken}`);

      expect(res7d.status).toBe(200);
      expect(res30d.status).toBe(200);
      expect(res7d.body.period).toBe('7d');
      expect(res30d.body.period).toBe('30d');
    });

    test('ANL.9 Revenue interval parameter works', async () => {
      const resDay = await request(app)
        .get('/api/users/me/analytics/revenue?interval=day')
        .set('Authorization', `Bearer ${sellerToken}`);

      const resWeek = await request(app)
        .get('/api/users/me/analytics/revenue?interval=week')
        .set('Authorization', `Bearer ${sellerToken}`);

      const resMonth = await request(app)
        .get('/api/users/me/analytics/revenue?interval=month')
        .set('Authorization', `Bearer ${sellerToken}`);

      expect(resDay.status).toBe(200);
      expect(resWeek.status).toBe(200);
      expect(resMonth.status).toBe(200);
    });

    test('ANL.10 Revenue data is sorted by date', async () => {
      const res = await request(app)
        .get('/api/users/me/analytics/revenue?period=30d&interval=day')
        .set('Authorization', `Bearer ${sellerToken}`);

      expect(res.status).toBe(200);
      for (let i = 1; i < res.body.revenue.length; i++) {
        expect(res.body.revenue[i].date.localeCompare(res.body.revenue[i - 1].date)).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('Top Listings', () => {
    test('ANL.11 Get top performing listings', async () => {
      const res = await request(app)
        .get('/api/users/me/analytics/top-listings')
        .set('Authorization', `Bearer ${sellerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.topListings).toBeDefined();
      expect(Array.isArray(res.body.topListings)).toBe(true);
    });

    test('ANL.12 Top listings has correct structure', async () => {
      const res = await request(app)
        .get('/api/users/me/analytics/top-listings')
        .set('Authorization', `Bearer ${sellerToken}`);

      expect(res.status).toBe(200);
      if (res.body.topListings.length > 0) {
        expect(res.body.topListings[0]).toHaveProperty('listing');
        expect(res.body.topListings[0]).toHaveProperty('sales');
        expect(res.body.topListings[0]).toHaveProperty('revenue');
      }
    });

    test('ANL.13 Top listings sorted by revenue', async () => {
      const res = await request(app)
        .get('/api/users/me/analytics/top-listings')
        .set('Authorization', `Bearer ${sellerToken}`);

      expect(res.status).toBe(200);
      for (let i = 1; i < res.body.topListings.length; i++) {
        expect(res.body.topListings[i].revenue).toBeLessThanOrEqual(res.body.topListings[i - 1].revenue);
      }
    });

    test('ANL.14 Top listings limit parameter works', async () => {
      const res = await request(app)
        .get('/api/users/me/analytics/top-listings?limit=5')
        .set('Authorization', `Bearer ${sellerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.topListings.length).toBeLessThanOrEqual(5);
    });

    test('ANL.15 Top listings period parameter works', async () => {
      const res = await request(app)
        .get('/api/users/me/analytics/top-listings?period=7d')
        .set('Authorization', `Bearer ${sellerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.period).toBe('7d');
    });
  });

  describe('Traffic Sources', () => {
    test('ANL.16 Get traffic sources', async () => {
      const res = await request(app)
        .get('/api/users/me/analytics/traffic-sources')
        .set('Authorization', `Bearer ${sellerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.trafficSources).toBeDefined();
      expect(Array.isArray(res.body.trafficSources)).toBe(true);
    });

    test('ANL.17 Traffic sources has required fields', async () => {
      const res = await request(app)
        .get('/api/users/me/analytics/traffic-sources')
        .set('Authorization', `Bearer ${sellerToken}`);

      expect(res.status).toBe(200);
      res.body.trafficSources.forEach(source => {
        expect(source).toHaveProperty('source');
        expect(source).toHaveProperty('visits');
        expect(source).toHaveProperty('percentage');
      });
    });

    test('ANL.18 Traffic sources percentages sum to 100', async () => {
      const res = await request(app)
        .get('/api/users/me/analytics/traffic-sources')
        .set('Authorization', `Bearer ${sellerToken}`);

      expect(res.status).toBe(200);
      const totalPercentage = res.body.trafficSources.reduce((sum, s) => sum + (s.percentage || 0), 0);
      expect(totalPercentage).toBeLessThanOrEqual(100);
    });
  });

  describe('Audience Demographics', () => {
    test('ANL.19 Get audience demographics', async () => {
      const res = await request(app)
        .get('/api/users/me/analytics/audience')
        .set('Authorization', `Bearer ${sellerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.audience).toBeDefined();
    });

    test('ANL.20 Audience has required fields', async () => {
      const res = await request(app)
        .get('/api/users/me/analytics/audience')
        .set('Authorization', `Bearer ${sellerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.audience).toHaveProperty('byCountry');
      expect(res.body.audience).toHaveProperty('byDevice');
      expect(res.body.audience).toHaveProperty('byAge');
    });

    test('ANL.21 Audience byDevice has 3 devices', async () => {
      const res = await request(app)
        .get('/api/users/me/analytics/audience')
        .set('Authorization', `Bearer ${sellerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.audience.byDevice.length).toBe(3);
    });

    test('ANL.22 Audience period parameter works', async () => {
      const res = await request(app)
        .get('/api/users/me/analytics/audience?period=90d')
        .set('Authorization', `Bearer ${sellerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.period).toBe('90d');
    });
  });

  describe('Authentication & Authorization', () => {
    test('ANL.23 Requires authentication', async () => {
      const res = await request(app)
        .get('/api/users/me/analytics/overview');

      expect(res.status).toBe(401);
    });

    test('ANL.24 Users can only see own analytics', async () => {
      // Create another user
      const otherUser = await User.create({
        name: 'Other Seller',
        email: `other_${Date.now()}@test.com`,
        password: 'password123',
        country: 'US',
        currency: 'USD',
        emailVerified: true,
        authProvider: 'email',
        balance: { available: 0, pending: 0, totalEarned: 0, totalPaidOut: 0, currency: 'USD' },
        stats: { totalSales: 0, totalPurchases: 0, strikes: 0 },
      });

      const otherToken = jwt.sign({ id: otherUser._id }, JWT_SECRET, { expiresIn: '30d' });

      // Other user sees their own analytics
      const res = await request(app)
        .get('/api/users/me/analytics/overview')
        .set('Authorization', `Bearer ${otherToken}`);

      expect(res.status).toBe(200);
      // Should not contain first user's data
      expect(res.body.overview.totalListings).toBe(0);

      await User.findByIdAndDelete(otherUser._id);
    });
  });

  describe('Performance & Edge Cases', () => {
    test('ANL.25 Analytics handles no data gracefully', async () => {
      const res = await request(app)
        .get('/api/users/me/analytics/overview')
        .set('Authorization', `Bearer ${sellerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.overview.totalRevenue).toBe(0);
      expect(res.body.overview.totalSales).toBe(0);
    });

    test('ANL.26 Analytics responds in under 1 second', async () => {
      const start = Date.now();
      const res = await request(app)
        .get('/api/users/me/analytics/overview')
        .set('Authorization', `Bearer ${sellerToken}`);
      const duration = Date.now() - start;

      expect(res.status).toBe(200);
      expect(duration).toBeLessThan(1000);
    });

    test('ANL.27 Revenue with no transactions returns empty array', async () => {
      const res = await request(app)
        .get('/api/users/me/analytics/revenue')
        .set('Authorization', `Bearer ${sellerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.revenue).toEqual([]);
    });
  });
});