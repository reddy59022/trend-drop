// Social Login Tests - Apple & Facebook (v24.0)
const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../server.js');
const User = require('../models/User');
const jwt = require('jsonwebtoken');

let token;
let sellerId;

async function createUserAndToken() {
  const dummyId = new mongoose.Types.ObjectId();
  const uniqueEmail = `social_user_${Date.now()}_${dummyId}@example.com`;
  const seller = await User.create({
    _id: dummyId,
    name: 'SocialTestUser',
    email: uniqueEmail,
    password: 'hashed',
    emailVerified: true,
    authProvider: 'email',
    country: 'US',
    currency: 'USD',
  });
  sellerId = dummyId;
  const secret = process.env.JWT_SECRET || 'fallback_secret_change_me';
  token = jwt.sign({ id: dummyId }, secret, { expiresIn: '1h' });
}

describe('Social Login - Apple & Facebook', () => {
  beforeEach(async () => {
    await createUserAndToken();
  });

  afterEach(async () => {
    await User.deleteMany({ _id: sellerId });
  });

  describe('POST /api/auth/apple', () => {
    it('SOCIAL.1 should create user with Apple Sign-In', async () => {
      // Create a mock Apple identity token (JWT format)
      const mockPayload = {
        sub: 'apple_user_123',
        email: `apple_${Date.now()}@example.com`,
        name: { firstName: 'Apple', lastName: 'User' },
      };
      const appleToken = global.testJwt.signAppleIdentityToken(mockPayload);
      
      const res = await request(app)
        .post('/api/auth/apple')
        .send({
          identityToken: appleToken,
          name: 'Apple User',
          email: mockPayload.email,
        });

      expect(res.statusCode).toBe(200);
      expect(res.body.token).toBeDefined();
      expect(res.body.user.authProvider).toBe('apple');
    });

    it('SOCIAL.2 should require identity token and email', async () => {
      const res = await request(app)
        .post('/api/auth/apple')
        .send({});

      expect(res.statusCode).toBe(400);
      expect(res.body.message).toContain('required');
    });

    it('SOCIAL.3 should link Apple to existing user', async () => {
      // Create a user with email
      const existingEmail = `existing_${Date.now()}@example.com`;
      await User.create({
        name: 'Existing User',
        email: existingEmail,
        authProvider: 'email',
        emailVerified: true,
      });

      const mockPayload = {
        sub: 'apple_user_456',
        email: existingEmail,
      };
      const appleToken = global.testJwt.signAppleIdentityToken(mockPayload);

      const res = await request(app)
        .post('/api/auth/apple')
        .send({
          identityToken: appleToken,
          email: existingEmail,
        });

      expect(res.statusCode).toBe(200);
    });
  });

  describe('POST /api/auth/facebook', () => {
    it('SOCIAL.4 should create user with Facebook Login', async () => {
      const res = await request(app)
        .post('/api/auth/facebook')
        .send({
          accessToken: 'mock_facebook_token',
          name: 'Facebook User',
          email: `fb_${Date.now()}@example.com`,
        });

      expect(res.statusCode).toBe(200);
      expect(res.body.token).toBeDefined();
      expect(res.body.user.authProvider).toBe('facebook');
    });

    it('SOCIAL.5 should require access token and email', async () => {
      const res = await request(app)
        .post('/api/auth/facebook')
        .send({});

      expect(res.statusCode).toBe(400);
      expect(res.body.message).toContain('required');
    });

    it('SOCIAL.6 should link Facebook to existing user', async () => {
      const existingEmail = `existing_fb_${Date.now()}@example.com`;
      await User.create({
        name: 'Existing FB User',
        email: existingEmail,
        authProvider: 'email',
        emailVerified: true,
      });

      const res = await request(app)
        .post('/api/auth/facebook')
        .send({
          accessToken: 'mock_token',
          email: existingEmail,
        });

      expect(res.statusCode).toBe(200);
    });
  });
});