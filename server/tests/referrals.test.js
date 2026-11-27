// Referral Program Tests - v30.0
const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../server.js');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Referral = require('../models/Referral');
const jwt = require('jsonwebtoken');

let userToken;
let userId;
let referrerId;
let secondReferrerId;
let secondUserId;

async function createUser(email, name = 'TestUser') {
  const dummyId = new mongoose.Types.ObjectId();
  return await User.create({
    _id: dummyId,
    name: name,
    email: email,
    password: 'hashed',
    emailVerified: true,
    authProvider: 'email',
    role: 'user',
    country: 'US',
    currency: 'USD',
  });
}

describe('Referral Program', () => {
  beforeEach(async () => {
    // Create referrer
    const referrer = await createUser(`referrer_${Date.now()}@example.com`, 'Referrer');
    referrerId = referrer._id;
    
    const user = await createUser(`user_${Date.now()}@example.com`, 'User');
    userId = user._id;
    secondUserId = null;
    secondReferrerId = null;
    
    const secret = process.env.JWT_SECRET || 'fallback_secret_change_me';
    userToken = jwt.sign({ id: userId }, secret, { expiresIn: '1h' });
    referrerToken = jwt.sign({ id: referrerId }, secret, { expiresIn: '1h' });
  });

  afterEach(async () => {
    await Referral.deleteMany({ referrer: { $in: [userId, referrerId, secondReferrerId].filter(Boolean) } });
    await User.deleteMany({ _id: { $in: [userId, referrerId, secondReferrerId, secondUserId].filter(Boolean) } });
  });

  describe('GET /api/referrals/settings', () => {
    it('REF.1 should return referral settings', async () => {
      const res = await request(app).get('/api/referrals/settings');
      expect(res.statusCode).toBe(200);
      expect(res.body.enabled).toBe(true);
      expect(res.body.rewardAmount).toBeDefined();
    });
  });

  describe('POST /api/referrals/generate', () => {
    it('REF.2 should generate referral code for authenticated user', async () => {
      const res = await request(app)
        .post('/api/referrals/generate')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.statusCode).toBe(201);
      expect(res.body.referral).toBeDefined();
      expect(res.body.referral.code).toBeDefined();
      expect(res.body.referral.code.length).toBe(8);
    });

    it('REF.3 should return existing code if already exists', async () => {
      // First request
      await request(app)
        .post('/api/referrals/generate')
        .set('Authorization', `Bearer ${userToken}`);

      // Second request
      const res = await request(app)
        .post('/api/referrals/generate')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.referral).toBeDefined();
    });
  });

  describe('POST /api/referrals/apply', () => {
    it('REF.4 should apply valid referral code', async () => {
      // Generate a code first
      const genRes = await request(app)
        .post('/api/referrals/generate')
        .set('Authorization', `Bearer ${referrerToken}`);
      
      const code = genRes.body.referral.code;

      const res = await request(app)
        .post('/api/referrals/apply')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ code, userId });

      expect(res.statusCode).toBe(200);
      expect(res.body.valid).toBe(true);
    });

    it('REF.5 should atomically accept a referred user only once', async () => {
      const genRes = await request(app)
        .post('/api/referrals/generate')
        .set('Authorization', `Bearer ${referrerToken}`);
      const code = genRes.body.referral.code;

      const responses = await Promise.all([
        request(app).post('/api/referrals/apply').set('Authorization', `Bearer ${userToken}`).send({ code, userId }),
        request(app).post('/api/referrals/apply').set('Authorization', `Bearer ${userToken}`).send({ code, userId }),
      ]);

      expect(responses.filter((res) => res.statusCode === 200)).toHaveLength(1);
      expect(responses.filter((res) => res.statusCode === 400)).toHaveLength(1);
      const referral = await Referral.findOne({ code });
      expect(referral.uses).toBe(1);
      expect(referral.referred).toEqual(userId);
      expect(referral.referredUsers).toHaveLength(1);
    });

    it('REF.5b should let an account be attributed to only one referral code', async () => {
      const first = await request(app)
        .post('/api/referrals/generate')
        .set('Authorization', `Bearer ${referrerToken}`);
      const secondReferrer = await createUser(`referrer2_${Date.now()}@example.com`, 'Referrer Two');
      secondReferrerId = secondReferrer._id;
      const secondToken = jwt.sign(
        { id: secondReferrerId },
        process.env.JWT_SECRET || 'fallback_secret_change_me',
        { expiresIn: '1h' },
      );
      const second = await request(app)
        .post('/api/referrals/generate')
        .set('Authorization', `Bearer ${secondToken}`);

      const firstApply = await request(app)
        .post('/api/referrals/apply')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ code: first.body.referral.code, userId });
      expect(firstApply.statusCode).toBe(200);

      const secondApply = await request(app)
        .post('/api/referrals/apply')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ code: second.body.referral.code, userId });
      expect(secondApply.statusCode).toBe(400);

      const secondReferral = await Referral.findOne({ code: second.body.referral.code });
      expect(secondReferral.uses).toBe(0);
      expect(secondReferral.referredUsers).toHaveLength(0);
    });

    it('REF.6-unauthenticated cannot attach the code to another user', async () => {
      const genRes = await request(app)
        .post('/api/referrals/generate')
        .set('Authorization', `Bearer ${referrerToken}`);
      const code = genRes.body.referral.code;

      const res = await request(app)
        .post('/api/referrals/apply')
        .send({ code, userId });

      expect(res.statusCode).toBe(401);
      const referral = await Referral.findOne({ code });
      expect(referral.uses).toBe(0);
      expect(referral.referredUsers).toHaveLength(0);
    });

    it('REF.6 should reject invalid referral code', async () => {
      const res = await request(app)
        .post('/api/referrals/apply')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ code: 'INVALIDCODE' });

      expect(res.statusCode).toBe(404);
    });
  });

  describe('GET /api/referrals/my', () => {
    it('REF.7 should return user referral stats', async () => {
      const res = await request(app)
        .get('/api/referrals/my')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.stats).toBeDefined();
    });
  });

  describe('POST /api/referrals/claim', () => {
    it('REF.8 should claim the reward for every referred user exactly once', async () => {
      const genRes = await request(app)
        .post('/api/referrals/generate')
        .set('Authorization', `Bearer ${referrerToken}`);
      const code = genRes.body.referral.code;
      const secondUser = await createUser(`second_${Date.now()}@example.com`, 'Second User');
      secondUserId = secondUser._id;

      const secondToken = jwt.sign(
        { id: secondUserId },
        process.env.JWT_SECRET || 'fallback_secret_change_me',
        { expiresIn: '1h' },
      );
      await request(app).post('/api/referrals/apply').set('Authorization', `Bearer ${userToken}`).send({ code, userId });
      await request(app).post('/api/referrals/apply').set('Authorization', `Bearer ${secondToken}`).send({ code, userId: secondUserId });

      const before = await User.findById(referrerId);
      const res = await request(app)
        .post('/api/referrals/claim')
        .set('Authorization', `Bearer ${referrerToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.newBalance).toBe((before.balance?.available || 0) + 20);
    });

    it('REF.8b should allow claiming referrals earned before the code expired', async () => {
      const genRes = await request(app)
        .post('/api/referrals/generate')
        .set('Authorization', `Bearer ${referrerToken}`);
      const code = genRes.body.referral.code;
      await request(app).post('/api/referrals/apply').set('Authorization', `Bearer ${userToken}`).send({ code, userId });
      await Referral.updateOne({ code }, { $set: { status: 'expired', expiresAt: new Date(Date.now() - 1000) } });

      const before = await User.findById(referrerId);
      const res = await request(app)
        .post('/api/referrals/claim')
        .set('Authorization', `Bearer ${referrerToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.newBalance).toBe((before.balance?.available || 0) + 10);
    });
  });

  describe('GET /api/referrals/:code', () => {
    it('REF.9 should validate referral code', async () => {
      // Generate a code first
      const genRes = await request(app)
        .post('/api/referrals/generate')
        .set('Authorization', `Bearer ${referrerToken}`);
      
      const code = genRes.body.referral.code;

      const res = await request(app)
        .get(`/api/referrals/${code}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.valid).toBe(true);
    });
  });
});