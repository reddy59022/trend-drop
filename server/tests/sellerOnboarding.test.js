/**
 * Seller Onboarding Flow Tests
 * Tests for guided onboarding experience for new sellers
 */
const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../server');
const User = require('../models/User');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';

describe('Seller Onboarding Flow', () => {
  let sellerToken, sellerId;

  beforeEach(async () => {
    // Create fresh user for each test
    const seedBase = `onboard_${Date.now()}_`;

    const seller = await User.create({
      name: 'Onboarding Seller',
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
    await User.deleteMany({ email: /onboard_/ });
    await mongoose.connection.close();
  });

  describe('Onboarding Status', () => {
    test('ONB.1 New seller has onboarding incomplete (auto-initialized)', async () => {
      const res = await request(app)
        .get('/api/users/me/onboarding')
        .set('Authorization', `Bearer ${sellerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.onboarding).toBeDefined();
      expect(res.body.onboarding.completed).toBe(false);
      expect(res.body.onboarding.currentStep).toBe(0);
    });

    test('ONB.2 Onboarding steps are defined', async () => {
      const res = await request(app)
        .get('/api/users/me/onboarding')
        .set('Authorization', `Bearer ${sellerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.onboarding.steps).toBeDefined();
      expect(res.body.onboarding.steps.profileSetup).toBeDefined();
      expect(res.body.onboarding.steps.firstListing).toBeDefined();
      expect(res.body.onboarding.steps.shippingSetup).toBeDefined();
      expect(res.body.onboarding.steps.paymentSetup).toBeDefined();
      expect(res.body.onboarding.steps.tipsReview).toBeDefined();
    });

    test('ONB.3 All steps initially incomplete', async () => {
      const res = await request(app)
        .get('/api/users/me/onboarding')
        .set('Authorization', `Bearer ${sellerToken}`);

      expect(res.status).toBe(200);
      const steps = res.body.onboarding.steps;
      Object.values(steps).forEach(step => {
        expect(step.completed).toBe(false);
        expect(step.completedAt).toBeNull();
      });
    });
  });

  describe('Step Completion', () => {
    test('ONB.4 Complete profile setup step', async () => {
      const res = await request(app)
        .post('/api/users/me/onboarding/complete-step')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({ step: 'profileSetup' });

      expect(res.status).toBe(200);
      expect(res.body.onboarding.steps.profileSetup.completed).toBe(true);
      expect(res.body.onboarding.steps.profileSetup.completedAt).toBeDefined();
    });

    test('ONB.5 Complete first listing step', async () => {
      const res = await request(app)
        .post('/api/users/me/onboarding/complete-step')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({ step: 'firstListing' });

      expect(res.status).toBe(200);
      expect(res.body.onboarding.steps.firstListing.completed).toBe(true);
    });

    test('ONB.6 Complete shipping setup step', async () => {
      const res = await request(app)
        .post('/api/users/me/onboarding/complete-step')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({ step: 'shippingSetup' });

      expect(res.status).toBe(200);
      expect(res.body.onboarding.steps.shippingSetup.completed).toBe(true);
    });

    test('ONB.7 Complete payment setup step', async () => {
      const res = await request(app)
        .post('/api/users/me/onboarding/complete-step')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({ step: 'paymentSetup' });

      expect(res.status).toBe(200);
      expect(res.body.onboarding.steps.paymentSetup.completed).toBe(true);
    });

    test('ONB.8 Complete tips review step', async () => {
      const res = await request(app)
        .post('/api/users/me/onboarding/complete-step')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({ step: 'tipsReview' });

      expect(res.status).toBe(200);
      expect(res.body.onboarding.steps.tipsReview.completed).toBe(true);
    });
  });

  describe('Onboarding Completion', () => {
    test('ONB.9 Complete all steps marks onboarding as done', async () => {
      // Complete all 5 steps
      await request(app)
        .post('/api/users/me/onboarding/complete-step')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({ step: 'profileSetup' });

      await request(app)
        .post('/api/users/me/onboarding/complete-step')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({ step: 'firstListing' });

      await request(app)
        .post('/api/users/me/onboarding/complete-step')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({ step: 'shippingSetup' });

      await request(app)
        .post('/api/users/me/onboarding/complete-step')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({ step: 'paymentSetup' });

      const res = await request(app)
        .post('/api/users/me/onboarding/complete-step')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({ step: 'tipsReview' });

      expect(res.status).toBe(200);
      expect(res.body.onboarding.completed).toBe(true);
      expect(res.body.onboarding.currentStep).toBe(5);
    });

    test('ONB.10 Completed onboarding has timestamp', async () => {
      // Complete all steps
      await request(app)
        .post('/api/users/me/onboarding/complete-step')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({ step: 'profileSetup' });

      await request(app)
        .post('/api/users/me/onboarding/complete-step')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({ step: 'firstListing' });

      await request(app)
        .post('/api/users/me/onboarding/complete-step')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({ step: 'shippingSetup' });

      await request(app)
        .post('/api/users/me/onboarding/complete-step')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({ step: 'paymentSetup' });

      const res = await request(app)
        .post('/api/users/me/onboarding/complete-step')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({ step: 'tipsReview' });

      expect(res.status).toBe(200);
      expect(res.body.onboarding.completedAt).toBeDefined();
    });
  });

  describe('Onboarding Tips', () => {
    test('ONB.11 Get onboarding tips', async () => {
      const res = await request(app)
        .get('/api/onboarding/tips')
        .set('Authorization', `Bearer ${sellerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.tips).toBeDefined();
      expect(Array.isArray(res.body.tips)).toBe(true);
      expect(res.body.tips.length).toBeGreaterThan(0);
    });

    test('ONB.12 Tips cover photography', async () => {
      const res = await request(app)
        .get('/api/onboarding/tips')
        .set('Authorization', `Bearer ${sellerToken}`);

      expect(res.status).toBe(200);
      const photographyTips = res.body.tips.filter(tip => tip.category === 'photography');
      expect(photographyTips.length).toBeGreaterThan(0);
    });

    test('ONB.13 Tips cover pricing', async () => {
      const res = await request(app)
        .get('/api/onboarding/tips')
        .set('Authorization', `Bearer ${sellerToken}`);

      expect(res.status).toBe(200);
      const pricingTips = res.body.tips.filter(tip => tip.category === 'pricing');
      expect(pricingTips.length).toBeGreaterThan(0);
    });

    test('ONB.14 Tips cover shipping', async () => {
      const res = await request(app)
        .get('/api/onboarding/tips')
        .set('Authorization', `Bearer ${sellerToken}`);

      expect(res.status).toBe(200);
      const shippingTips = res.body.tips.filter(tip => tip.category === 'shipping');
      expect(shippingTips.length).toBeGreaterThan(0);
    });
  });

  describe('Onboarding Progress', () => {
    test('ONB.15 Progress increases with completed steps', async () => {
      // Complete 2 steps
      await request(app)
        .post('/api/users/me/onboarding/complete-step')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({ step: 'profileSetup' });

      await request(app)
        .post('/api/users/me/onboarding/complete-step')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({ step: 'firstListing' });

      const res = await request(app)
        .get('/api/users/me/onboarding/progress')
        .set('Authorization', `Bearer ${sellerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.progress).toBe(40); // 2/5 = 40%
    });

    test('ONB.16 Progress is 0% with no steps', async () => {
      const freshUser = await User.create({
        name: 'Fresh Seller',
        email: `fresh_${Date.now()}@test.com`,
        password: 'password123',
        country: 'US',
        currency: 'USD',
        emailVerified: true,
        authProvider: 'email',
        balance: { available: 0, pending: 0, totalEarned: 0, totalPaidOut: 0, currency: 'USD' },
        stats: { totalSales: 0, totalPurchases: 0, strikes: 0 },
      });

      const freshToken = jwt.sign({ id: freshUser._id }, JWT_SECRET, { expiresIn: '30d' });

      const res = await request(app)
        .get('/api/users/me/onboarding/progress')
        .set('Authorization', `Bearer ${freshToken}`);

      expect(res.status).toBe(200);
      expect(res.body.progress).toBe(0);

      await User.findByIdAndDelete(freshUser._id);
    });
  });

  describe('Onboarding Reset', () => {
    test('ONB.17 Can reset onboarding', async () => {
      // Complete a step first
      await request(app)
        .post('/api/users/me/onboarding/complete-step')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({ step: 'profileSetup' });

      const res = await request(app)
        .post('/api/users/me/onboarding/reset')
        .set('Authorization', `Bearer ${sellerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.onboarding.completed).toBe(false);
      expect(res.body.onboarding.currentStep).toBe(0);
    });

    test('ONB.18 Reset clears all step completions', async () => {
      // Complete a step then reset
      await request(app)
        .post('/api/users/me/onboarding/complete-step')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({ step: 'profileSetup' });

      await request(app)
        .post('/api/users/me/onboarding/reset')
        .set('Authorization', `Bearer ${sellerToken}`);

      const res = await request(app)
        .get('/api/users/me/onboarding')
        .set('Authorization', `Bearer ${sellerToken}`);

      expect(res.status).toBe(200);
      const steps = res.body.onboarding.steps;
      Object.values(steps).forEach(step => {
        expect(step.completed).toBe(false);
        expect(step.completedAt).toBeNull();
      });
    });
  });

  describe('Onboarding Validation', () => {
    test('ONB.19 Invalid step name returns error', async () => {
      const res = await request(app)
        .post('/api/users/me/onboarding/complete-step')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({ step: 'invalidStep' });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/invalid|unknown/i);
    });

    test('ONB.20 Completing same step twice is idempotent', async () => {
      const res1 = await request(app)
        .post('/api/users/me/onboarding/complete-step')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({ step: 'profileSetup' });

      expect(res1.status).toBe(200);
      expect(res1.body.onboarding.steps.profileSetup.completed).toBe(true);

      const res2 = await request(app)
        .post('/api/users/me/onboarding/complete-step')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({ step: 'profileSetup' });

      expect(res2.status).toBe(200);
      expect(res2.body.onboarding.steps.profileSetup.completed).toBe(true);
    });
  });

  describe('Onboarding UI Integration', () => {
    test('ONB.21 Get onboarding checklist', async () => {
      const res = await request(app)
        .get('/api/onboarding/checklist')
        .set('Authorization', `Bearer ${sellerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.checklist).toBeDefined();
      expect(Array.isArray(res.body.checklist)).toBe(true);
      expect(res.body.checklist.length).toBe(5);
    });

    test('ONB.22 Checklist items have title and description', async () => {
      const res = await request(app)
        .get('/api/onboarding/checklist')
        .set('Authorization', `Bearer ${sellerToken}`);

      expect(res.status).toBe(200);
      res.body.checklist.forEach(item => {
        expect(item.title).toBeDefined();
        expect(item.description).toBeDefined();
        expect(item.step).toBeDefined();
      });
    });

    test('ONB.23 Checklist items show completion status', async () => {
      const res = await request(app)
        .get('/api/onboarding/checklist')
        .set('Authorization', `Bearer ${sellerToken}`);

      expect(res.status).toBe(200);
      res.body.checklist.forEach(item => {
        expect(item.completed).toBeDefined();
        expect(typeof item.completed).toBe('boolean');
      });
    });
  });
});