// Seller Shipping Insurance Tests - v31.0
const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../server.js');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const ShippingInsurance = require('../models/ShippingInsurance');
const jwt = require('jsonwebtoken');

let sellerToken;
let sellerId;
let buyerId;
let transactionId;

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

describe('Seller Shipping Insurance', () => {
  beforeEach(async () => {
    // Create seller
    const seller = await createUser(`seller_${Date.now()}@example.com`, 'Seller');
    sellerId = seller._id;
    
    // Create buyer
    const buyer = await createUser(`buyer_${Date.now()}@example.com`, 'Buyer');
    buyerId = buyer._id;
    
    // Create transaction
    const txn = await Transaction.create({
      listing: new mongoose.Types.ObjectId(),
      buyer: buyerId,
      seller: sellerId,
      itemPrice: 100,
      currency: 'USD',
      paymentBreakdown: {
        subtotal: 100,
        shippingCost: 5,
        totalPaid: 105,
        sellerEarnings: 92,
      },
      status: 'shipped',
    });
    transactionId = txn._id;
    
    const secret = process.env.JWT_SECRET || 'fallback_secret_change_me';
    sellerToken = jwt.sign({ id: sellerId }, secret, { expiresIn: '1h' });
  });

  afterEach(async () => {
    await ShippingInsurance.deleteMany({ seller: sellerId });
    await Transaction.deleteMany({ seller: sellerId });
    await User.deleteMany({ _id: { $in: [sellerId, buyerId] } });
  });

  describe('GET /api/shipping-insurance/settings', () => {
    it('INS.1 should return insurance settings', async () => {
      const res = await request(app).get('/api/shipping-insurance/settings');
      expect(res.statusCode).toBe(200);
      expect(res.body.enabled).toBe(true);
      expect(res.body.coverageTypes).toBeDefined();
    });
  });

  describe('POST /api/shipping-insurance/calculate', () => {
    it('INS.2 should calculate premium for item value', async () => {
      const res = await request(app)
        .post('/api/shipping-insurance/calculate')
        .send({ itemValue: 100, coverageType: 'standard' });

      expect(res.statusCode).toBe(200);
      expect(res.body.premium).toBeGreaterThan(0);
      expect(res.body.limit).toBe(500);
    });

    it('INS.3 should require valid item value', async () => {
      const res = await request(app)
        .post('/api/shipping-insurance/calculate')
        .send({ itemValue: 0 });

      expect(res.statusCode).toBe(400);
    });
  });

  describe('POST /api/shipping-insurance/purchase', () => {
    it('INS.4 should purchase insurance for transaction', async () => {
      const res = await request(app)
        .post('/api/shipping-insurance/purchase')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({ transactionId, coverageType: 'standard' });

      expect(res.statusCode).toBe(201);
      expect(res.body.insurance).toBeDefined();
      expect(res.body.insurance.premium).toBeGreaterThan(0);
    });

    it('INS.5 should reject purchase for non-seller', async () => {
      const otherSeller = await createUser(`other_${Date.now()}@example.com`, 'Other');
      const otherToken = jwt.sign({ id: otherSeller._id }, process.env.JWT_SECRET || 'fallback_secret_change_me', { expiresIn: '1h' });

      const res = await request(app)
        .post('/api/shipping-insurance/purchase')
        .set('Authorization', `Bearer ${otherToken}`)
        .send({ transactionId });

      expect(res.statusCode).toBe(403);
      await User.deleteMany({ _id: otherSeller._id });
    });

    it('INS.6 should reject purchase for non-existent transaction', async () => {
      const res = await request(app)
        .post('/api/shipping-insurance/purchase')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({ transactionId: new mongoose.Types.ObjectId() });

      expect(res.statusCode).toBe(404);
    });
  });

  describe('GET /api/shipping-insurance/my', () => {
    it('INS.7 should return seller policies', async () => {
      // First purchase some insurance
      await ShippingInsurance.create({
        transaction: transactionId,
        seller: sellerId,
        itemValue: 100,
        premium: 2,
        coverageType: 'standard',
      });

      const res = await request(app)
        .get('/api/shipping-insurance/my')
        .set('Authorization', `Bearer ${sellerToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.policies).toBeDefined();
      expect(res.body.policies.length).toBeGreaterThan(0);
    });
  });

  describe('POST /api/shipping-insurance/:id/claim', () => {
    it('INS.8 should file claim for insurance', async () => {
      const insurance = await ShippingInsurance.create({
        transaction: transactionId,
        seller: sellerId,
        itemValue: 100,
        premium: 2,
        coverageType: 'standard',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });

      const res = await request(app)
        .post(`/api/shipping-insurance/${insurance._id}/claim`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({ reason: 'Lost shipment', description: 'Package never arrived' });

      expect(res.statusCode).toBe(200);
      expect(res.body.insurance.claim.status).toBe('pending');
    });

    it('INS.9 should reject claim from non-seller', async () => {
      const insurance = await ShippingInsurance.create({
        transaction: transactionId,
        seller: sellerId,
        itemValue: 100,
        premium: 2,
        coverageType: 'standard',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });

      const otherUser = await createUser(`other_${Date.now()}@example.com`, 'Other');
      const otherToken = jwt.sign({ id: otherUser._id }, process.env.JWT_SECRET || 'fallback_secret_change_me', { expiresIn: '1h' });

      const res = await request(app)
        .post(`/api/shipping-insurance/${insurance._id}/claim`)
        .set('Authorization', `Bearer ${otherToken}`)
        .send({ reason: 'Lost shipment' });

      expect(res.statusCode).toBe(403);
      await User.deleteMany({ _id: otherUser._id });
    });
  });
});