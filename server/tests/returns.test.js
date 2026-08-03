// Returns & Refund Management Tests
const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../server.js');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Transaction = require('../models/Transaction');
const jwt = require('jsonwebtoken');

const secret = process.env.JWT_SECRET || 'fallback_secret_change_me';

let buyerToken;
let sellerToken;
let buyerId;
let sellerId;
let returnId;
let transactionId;

describe('Returns & Refund Management', () => {
  beforeEach(async () => {
    const seed = `ret_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const seller = await User.create({
      _id: new mongoose.Types.ObjectId(),
      name: 'Return Seller',
      email: `${seed}seller@test.com`,
      password: 'password123',
      emailVerified: true,
      authProvider: 'email',
      country: 'US',
      currency: 'USD',
      shippingAddress: { fullName: 'Seller', street1: '123 St', city: 'City', state: 'CA', postalCode: '90210', country: 'US' },
    });
    sellerId = seller._id;

    const buyer = await User.create({
      _id: new mongoose.Types.ObjectId(),
      name: 'Return Buyer',
      email: `${seed}buyer@test.com`,
      password: 'password123',
      emailVerified: true,
      authProvider: 'email',
      country: 'US',
      currency: 'USD',
      shippingAddress: { fullName: 'Buyer', street1: '456 Ave', city: 'Town', state: 'NY', postalCode: '10001', country: 'US' },
    });
    buyerId = buyer._id;

    buyerToken = jwt.sign({ id: buyerId }, secret, { expiresIn: '1h' });
    sellerToken = jwt.sign({ id: sellerId }, secret, { expiresIn: '1h' });

    const listing = await Listing.create({
      seller: sellerId,
      title: 'Test Return Item',
      description: 'A test item',
      price: 50,
      originalPrice: 80,
      category: 'Women',
      condition: 'New with tags',
      images: ['img1.jpg'],
      brand: 'Nike',
      size: 'M',
      available: true,
      sold: false,
      status: 'active',
    });

    const transaction = await Transaction.create({
      buyer: buyerId,
      seller: sellerId,
      listing: listing._id,
      itemPrice: 50,
      currency: 'USD',
      paymentBreakdown: {
        subtotal: 50,
        shippingCost: 0,
        buyerProtectionFee: 2.5,
        buyerProtectionPercent: 5,
        tax: 0,
        totalPaid: 56.5,
        platformFee: 4,
        platformFeePercent: 10,
        shippingPayout: 0,
        sellerEarnings: 44,
      },
      status: 'completed',
      paymentMethod: 'stripe',
    });
    transactionId = transaction._id;
  });

  test('RET.1 - Buyer should not return without auth', async () => {
    const res = await request(app).post('/api/returns').send({ transactionId, reason: 'Defective' });
    expect(res.status).toBe(401);
  });

  test('RET.2 - Buyer should create a return request', async () => {
    const res = await request(app)
      .post('/api/returns')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ transactionId, reason: 'Item not as described', description: 'Wrong color received' });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('pending');
    expect(res.body.reason).toBe('Item not as described');
    returnId = res.body._id;
    expect(returnId).toBeDefined();
  });

  test('RET.3 - Buyer cannot create duplicate return for same transaction', async () => {
    const res = await request(app)
      .post('/api/returns')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ transactionId, reason: 'Item not as described' });
    expect(res.status).toBe(201);
    const dup = await request(app)
      .post('/api/returns')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ transactionId, reason: 'Changed mind' });
    expect(dup.status).toBe(400);
  });

  test('RET.4 - Seller should see pending return requests', async () => {
    await request(app)
      .post('/api/returns')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ transactionId, reason: 'Defective' });
    const res = await request(app)
      .get('/api/returns')
      .set('Authorization', `Bearer ${sellerToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
  });

  test('RET.5 - Buyer should see their return requests', async () => {
    await request(app)
      .post('/api/returns')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ transactionId, reason: 'Defective' });
    const res = await request(app)
      .get('/api/returns')
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('RET.6 - Seller should approve a return request', async () => {
    const created = await request(app)
      .post('/api/returns')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ transactionId, reason: 'Defective' });
    const res = await request(app)
      .put(`/api/returns/${created.body._id}/approve`)
      .set('Authorization', `Bearer ${sellerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('approved');
  });

  test('RET.7 - Return details should show approved status and refund amount', async () => {
    const created = await request(app)
      .post('/api/returns')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ transactionId, reason: 'Item not as described' });
    await request(app)
      .put(`/api/returns/${created.body._id}/approve`)
      .set('Authorization', `Bearer ${sellerToken}`);
    const res = await request(app)
      .get(`/api/returns/${created.body._id}`)
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('approved');
    expect(res.body.refundAmount).toBeDefined();
    expect(res.body.refundAmount).toBeGreaterThan(0);
  });

  test('RET.8 - Buyer should confirm return shipped', async () => {
    const created = await request(app)
      .post('/api/returns')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ transactionId, reason: 'Defective' });
    await request(app)
      .put(`/api/returns/${created.body._id}/approve`)
      .set('Authorization', `Bearer ${sellerToken}`);
    const res = await request(app)
      .put(`/api/returns/${created.body._id}/ship`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ trackingNumber: 'RET1Z123456789' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('shipped');
    expect(res.body.trackingNumber).toBe('RET1Z123456789');
  });

  test('RET.9 - Seller should confirm return received and process refund', async () => {
    const created = await request(app)
      .post('/api/returns')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ transactionId, reason: 'Item not as described' });
    await request(app)
      .put(`/api/returns/${created.body._id}/approve`)
      .set('Authorization', `Bearer ${sellerToken}`);
    await request(app)
      .put(`/api/returns/${created.body._id}/ship`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ trackingNumber: 'RET1Z123456789' });
    const res = await request(app)
      .put(`/api/returns/${created.body._id}/receive`)
      .set('Authorization', `Bearer ${sellerToken}`);
    expect(res.status).toBe(200);
    expect(['refunded', 'completed']).toContain(res.body.status);
  });

  test('RET.10 - Seller can deny a return request', async () => {
    const created = await request(app)
      .post('/api/returns')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ transactionId, reason: 'Changed mind' });
    const res = await request(app)
      .put(`/api/returns/${created.body._id}/deny`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ reason: 'Item is exactly as described' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('denied');
  });
});