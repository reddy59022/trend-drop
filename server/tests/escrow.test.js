// Escrow Service Tests - v26.0
const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../server.js');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Transaction = require('../models/Transaction');
const jwt = require('jsonwebtoken');

let buyerToken;
let sellerToken;
let adminToken;
let buyerId;
let sellerId;
let adminId;
let listingId;
let transactionId;

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
    balance: { available: 1000, pending: 0 },
    stats: { totalSales: 10, totalPurchases: 5 },
  });
}

describe('Escrow Service', () => {
  beforeEach(async () => {
    const buyer = await createUser(`buyer_escrow_${Date.now()}@example.com`);
    buyerId = buyer._id;
    const seller = await createUser(`seller_escrow_${Date.now()}@example.com`);
    sellerId = seller._id;
    const admin = await createUser(`admin_escrow_${Date.now()}@example.com`, 'admin');
    adminId = admin._id;
    
    const secret = process.env.JWT_SECRET || 'fallback_secret_change_me';
    buyerToken = jwt.sign({ id: buyerId }, secret, { expiresIn: '1h' });
    sellerToken = jwt.sign({ id: sellerId }, secret, { expiresIn: '1h' });
    adminToken = jwt.sign({ id: adminId }, secret, { expiresIn: '1h' });
    
    const listing = await Listing.create({
      title: 'High Value Item',
      description: 'Test',
      price: 600,
      category: 'Men',
      condition: 'Good',
      seller: sellerId,
      available: true,
      sold: false,
      quantity: 0,
      quantitySold: 1,
      status: 'active',
    });
    listingId = listing._id;
    
    const transaction = await Transaction.create({
      listing: listingId,
      buyer: buyerId,
      seller: sellerId,
      itemPrice: 600,
      currency: 'USD',
      paymentBreakdown: {
        subtotal: 600,
        totalPaid: 600,
        sellerEarnings: 540,
        paymentIntentId: `pi_escrow_${Date.now()}`,
      },
      status: 'paid',
      shipping: {
        carrier: 'UPS',
        labelCreated: true,
        estimatedDelivery: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
      escrow: {
        status: 'inactive',
        amount: 0,
        releaseConditions: {
          buyerConfirmed: false,
          sellerConfirmed: false,
        },
      },
    });
    transactionId = transaction._id;
  });

  afterEach(async () => {
    await Transaction.deleteMany({ _id: { $in: [transactionId] } });
    await Listing.deleteMany({ _id: { $in: [listingId] } });
    await User.deleteMany({ _id: { $in: [buyerId, sellerId, adminId] } });
  });

  describe('POST /api/escrow/initiate', () => {
    it('ESCROW.1 should require transactionId and amount', async () => {
      const res = await request(app)
        .post('/api/escrow/initiate')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({});

      expect(res.statusCode).toBe(400);
      expect(res.body.message).toContain('required');
    });

    it('ESCROW.2 should require authentication', async () => {
      const res = await request(app)
        .post('/api/escrow/initiate')
        .send({ transactionId, amount: 600 });

      expect(res.statusCode).toBe(401);
    });

    it('ESCROW.3 should only allow buyer to initiate escrow', async () => {
      const res = await request(app)
        .post('/api/escrow/initiate')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({ transactionId, amount: 600 });

      expect(res.statusCode).toBe(403);
    });

    it('ESCROW.4 should reject transactions under $500', async () => {
      const res = await request(app)
        .post('/api/escrow/initiate')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({ transactionId, amount: 400 });

      expect(res.statusCode).toBe(400);
      expect(res.body.message).toContain('over $500');
    });

    it('ESCROW.5 should initiate escrow for high-value transaction', async () => {
      const res = await request(app)
        .post('/api/escrow/initiate')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({ transactionId, amount: 600 });

      expect(res.statusCode).toBe(200);
      expect(res.body.transaction.escrow.status).toBe('active');
      expect(res.body.transaction.escrow.amount).toBe(600);
    });
  });

  describe('POST /api/escrow/confirm-buyer', () => {
    it('ESCROW.6 should require authentication', async () => {
      const res = await request(app)
        .post('/api/escrow/confirm-buyer')
        .send({ transactionId });

      expect(res.statusCode).toBe(401);
    });

    it('ESCROW.7 should only allow buyer to confirm', async () => {
      // First initiate escrow
      await Transaction.findByIdAndUpdate(transactionId, {
        escrow: { 
          status: 'active', 
          amount: 600, 
          initiatedAt: new Date(),
          releaseConditions: { buyerConfirmed: false, sellerConfirmed: false, inspectionPeriodDays: 7 },
        },
      });

      const res = await request(app)
        .post('/api/escrow/confirm-buyer')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({ transactionId });

      expect(res.statusCode).toBe(403);
    });

    it('ESCROW.8 should confirm buyer satisfaction', async () => {
      // First initiate escrow
      await Transaction.findByIdAndUpdate(transactionId, {
        escrow: { 
          status: 'active', 
          amount: 600, 
          initiatedAt: new Date(),
          releaseConditions: { buyerConfirmed: false, sellerConfirmed: false, inspectionPeriodDays: 7 },
        },
      });

      const res = await request(app)
        .post('/api/escrow/confirm-buyer')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({ transactionId });

      expect(res.statusCode).toBe(200);
      expect(res.body.transaction.escrow.releaseConditions.buyerConfirmed).toBe(true);
    });
  });

  describe('POST /api/escrow/confirm-seller', () => {
    it('ESCROW.9 should require authentication', async () => {
      const res = await request(app)
        .post('/api/escrow/confirm-seller')
        .send({ transactionId });

      expect(res.statusCode).toBe(401);
    });

    it('ESCROW.10 should only allow seller to confirm', async () => {
      // First initiate escrow
      await Transaction.findByIdAndUpdate(transactionId, {
        escrow: { 
          status: 'active', 
          amount: 600, 
          initiatedAt: new Date(),
          releaseConditions: { buyerConfirmed: false, sellerConfirmed: false, inspectionPeriodDays: 7 },
        },
      });

      const res = await request(app)
        .post('/api/escrow/confirm-seller')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({ transactionId });

      expect(res.statusCode).toBe(403);
    });

    it('ESCROW.11 should release funds when both parties confirm', async () => {
      // Set buyer confirmation first
      await Transaction.findByIdAndUpdate(transactionId, {
        escrow: { 
          status: 'active', 
          amount: 600, 
          initiatedAt: new Date(),
          releaseConditions: { buyerConfirmed: true, sellerConfirmed: false, inspectionPeriodDays: 7 },
        },
      });

      const res = await request(app)
        .post('/api/escrow/confirm-seller')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({ transactionId });

      expect(res.statusCode).toBe(200);
      expect(res.body.transaction.escrow.status).toBe('released');
    });
  });

  describe('POST /api/escrow/dispute', () => {
    it('ESCROW.12 should require reason', async () => {
      await Transaction.findByIdAndUpdate(transactionId, {
        escrow: { 
          status: 'active', 
          amount: 600, 
          initiatedAt: new Date(),
          releaseConditions: { buyerConfirmed: false, sellerConfirmed: false, inspectionPeriodDays: 7 },
        },
      });

      const res = await request(app)
        .post('/api/escrow/dispute')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({ transactionId });

      expect(res.statusCode).toBe(400);
    });

    it('ESCROW.13 should file dispute for active escrow', async () => {
      await Transaction.findByIdAndUpdate(transactionId, {
        escrow: { 
          status: 'active', 
          amount: 600, 
          initiatedAt: new Date(),
          releaseConditions: { buyerConfirmed: false, sellerConfirmed: false, inspectionPeriodDays: 7 },
        },
      });

      const res = await request(app)
        .post('/api/escrow/dispute')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({ transactionId, reason: 'Item not as described' });

      expect(res.statusCode).toBe(200);
      expect(res.body.transaction.escrow.status).toBe('disputed');
    });
  });

  describe('POST /api/escrow/resolve-dispute', () => {
    it('ESCROW.14 should require admin role', async () => {
      await Transaction.findByIdAndUpdate(transactionId, {
        escrow: { 
          status: 'disputed', 
          amount: 600,
          releaseConditions: { buyerConfirmed: false, sellerConfirmed: false, inspectionPeriodDays: 7 },
        },
      });

      const res = await request(app)
        .post('/api/escrow/resolve-dispute')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({ transactionId, resolution: 'release_to_buyer' });

      expect(res.statusCode).toBe(403);
    });

    it('ESCROW.14b rejects an unknown resolution without mutating the dispute', async () => {
      await Transaction.findByIdAndUpdate(transactionId, {
        escrow: {
          status: 'disputed',
          amount: 600,
          releaseConditions: { buyerConfirmed: false, sellerConfirmed: false, inspectionPeriodDays: 7 },
        },
      });
      const res = await request(app)
        .post('/api/escrow/resolve-dispute')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ transactionId, resolution: 'pay_someone_else' });
      expect(res.statusCode).toBe(400);
      expect((await Transaction.findById(transactionId)).escrow.status).toBe('disputed');
    });

    it('ESCROW.14c leaves local state untouched when the provider reference is missing', async () => {
      await Transaction.findByIdAndUpdate(transactionId, {
        escrow: {
          status: 'disputed',
          amount: 600,
          releaseConditions: { buyerConfirmed: false, sellerConfirmed: false, inspectionPeriodDays: 7 },
        },
        'paymentBreakdown.paymentIntentId': '',
        'payout.transactionId': '',
      });
      const res = await request(app)
        .post('/api/escrow/resolve-dispute')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ transactionId, resolution: 'release_to_buyer' });
      expect(res.statusCode).toBe(502);
      const fresh = await Transaction.findById(transactionId);
      expect(fresh.escrow.status).toBe('disputed');
      expect((await Listing.findById(listingId)).quantity).toBe(0);
    });

    it('ESCROW.15 refunds the provider and unwinds buyer-side ledger state', async () => {
      await Transaction.findByIdAndUpdate(transactionId, {
        escrow: { 
          status: 'disputed', 
          amount: 600,
          releaseConditions: { buyerConfirmed: false, sellerConfirmed: false, inspectionPeriodDays: 7 },
        },
      });

      const paymentIntentId = `pi_escrow_buyer_${transactionId}`;
      global.__mockPaymentIntents = global.__mockPaymentIntents || {};
      global.__mockPaymentIntents[paymentIntentId] = {
        id: paymentIntentId,
        status: 'succeeded',
        amount: 60000,
        metadata: {},
      };
      await Transaction.findByIdAndUpdate(transactionId, {
        'paymentBreakdown.paymentIntentId': paymentIntentId,
        'payout.transactionId': paymentIntentId,
      });

      const res = await request(app)
        .post('/api/escrow/resolve-dispute')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ transactionId, resolution: 'release_to_buyer' });

      expect(res.statusCode).toBe(200);
      expect(res.body.transaction.escrow.status).toBe('resolved');
      expect(res.body.transaction.status).toBe('refunded');
      expect(global.__mockPaymentIntents[paymentIntentId].status).toBe('refunded');
      expect((await Listing.findById(listingId)).quantity).toBe(1);
      expect((await Transaction.findById(transactionId)).payout.status).toBe('refunded');
    });

    it('ESCROW.16 releases seller escrow exactly once and clears pending funds', async () => {
      await Transaction.findByIdAndUpdate(transactionId, {
        escrow: { 
          status: 'disputed', 
          amount: 600,
          releaseConditions: { buyerConfirmed: false, sellerConfirmed: false, inspectionPeriodDays: 7 },
        },
      });

      await User.findByIdAndUpdate(sellerId, {
        'balance.pending': 540,
        'balance.available': 1000,
      });

      const res = await request(app)
        .post('/api/escrow/resolve-dispute')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ transactionId, resolution: 'release_to_seller' });

      expect(res.statusCode).toBe(200);
      expect(res.body.transaction.escrow.status).toBe('resolved');
      const sellerAfter = await User.findById(sellerId);
      expect(sellerAfter.balance.pending).toBe(0);
      expect(sellerAfter.balance.available).toBe(1486);
      expect(sellerAfter.balance.reserve).toBe(54);
      expect((await Transaction.findById(transactionId)).status).toBe('completed');
    });
  });

  describe('GET /api/escrow/settings', () => {
    it('ESCROW.17 should return escrow settings', async () => {
      const res = await request(app).get('/api/escrow/settings');

      expect(res.statusCode).toBe(200);
      expect(res.body.threshold).toBe(500);
      expect(res.body.inspectionPeriodDays).toBe(7);
    });
  });
});