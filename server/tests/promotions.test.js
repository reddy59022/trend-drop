/**
 * Tests for Promotions / Coupon Codes (Section 28c)
 * Tests: create, list, update, delete, validate, use promo codes
 */
const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../server');
const Promo = require('../models/Promo');
const Listing = require('../models/Listing');
const User = require('../models/User');

const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';
const generateToken = (userId) => jwt.sign({ id: userId }, JWT_SECRET, { expiresIn: '30d' });

let seller, buyer, sellerToken, buyerToken, listing;
const testUserIds = [];
const testListingIds = [];
const testPromoIds = [];

beforeAll(async () => {
  const uri = process.env.MONGODB_URI || 'mongodb+srv://reddy59022_db_user:anNecZCiT3eJQfre@cluster.mongodb.net/poshmark?retryWrites=true&w=majority';
  if (mongoose.connection.readyState === 0) await mongoose.connect(uri);

  seller = await User.create({ name: 'PromoSeller', email: `promo_seller_${Date.now()}@test.com`, password: 'password123', emailVerified: true, country: 'US', currency: 'USD' });
  testUserIds.push(seller._id);
  buyer = await User.create({ name: 'PromoBuyer', email: `promo_buyer_${Date.now()}@test.com`, password: 'password123', emailVerified: true, country: 'US', currency: 'USD' });
  testUserIds.push(buyer._id);
  sellerToken = generateToken(seller._id);
  buyerToken = generateToken(buyer._id);

  listing = await Listing.create({ seller: seller._id, title: 'Promo Test Item', description: 'Test', price: 100, category: 'Women', condition: 'New with tags', available: true, quantity: 5, shipsFrom: 'US', weight: 1 });
  testListingIds.push(listing._id);
});

afterAll(async () => {
  await Promo.deleteMany({ _id: { $in: testPromoIds } });
  await Listing.deleteMany({ _id: { $in: testListingIds } });
  await User.deleteMany({ _id: { $in: testUserIds } });
  await mongoose.disconnect();
});

describe('Promotions / Coupon Codes (Section 28c)', () => {
  let promoId;

  test('PC.1 Create promo code (percentage)', async () => {
    const res = await request(app)
      .post('/api/promos')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ code: 'SAVE10', discountType: 'percentage', discountValue: 10, description: '10% off everything' });
    expect(res.status).toBe(201);
    expect(res.body.code).toBe('SAVE10');
    expect(res.body.discountType).toBe('percentage');
    expect(res.body.discountValue).toBe(10);
    promoId = res.body._id;
    testPromoIds.push(promoId);
  });

  test('PC.2 Create promo code (fixed amount)', async () => {
    const res = await request(app)
      .post('/api/promos')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ code: 'FLAT5', discountType: 'fixed', discountValue: 5, usageLimit: 10 });
    expect(res.status).toBe(201);
    expect(res.body.code).toBe('FLAT5');
    expect(res.body.discountType).toBe('fixed');
    testPromoIds.push(res.body._id);
  });

  test('PC.3 List seller promo codes', async () => {
    const res = await request(app).get('/api/promos').set('Authorization', `Bearer ${sellerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(2);
  });

  test('PC.4 Update promo code', async () => {
    const res = await request(app)
      .put(`/api/promos/${promoId}`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ discountValue: 15, usageLimit: 50 });
    expect(res.status).toBe(200);
    expect(res.body.discountValue).toBe(15);
    expect(res.body.usageLimit).toBe(50);
  });

  test('PC.5 Delete promo code', async () => {
    const createRes = await request(app)
      .post('/api/promos')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ code: 'TEMP', discountType: 'percentage', discountValue: 5 });
    const tempId = createRes.body._id;

    const res = await request(app).delete(`/api/promos/${tempId}`).set('Authorization', `Bearer ${sellerToken}`);
    expect(res.status).toBe(200);
    const found = await Promo.findById(tempId);
    expect(found).toBeNull();
  });

  test('PC.6 Validate valid promo code', async () => {
    const res = await request(app)
      .post('/api/promos/validate')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ code: 'SAVE10', items: [{ listingId: listing._id, price: 100, quantity: 1 }] });
    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(true);
    expect(res.body.promo.discountAmount).toBe(15); // 15% of 100
  });

  test('PC.7 Validate invalid promo code', async () => {
    const res = await request(app)
      .post('/api/promos/validate')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ code: 'INVALID' });
    expect(res.status).toBe(400);
  });

  test('PC.8 Use promo code increments usage count', async () => {
    const res = await request(app)
      .post(`/api/promos/${promoId}/use`)
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.usageCount).toBe(1);
  });

  test('PC.9 Duplicate code rejected', async () => {
    const res = await request(app)
      .post('/api/promos')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ code: 'SAVE10', discountType: 'percentage', discountValue: 20 });
    expect(res.status).toBe(400);
  });

  test('PC.10 Update other seller promo fails', async () => {
    const res = await request(app)
      .put(`/api/promos/${promoId}`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ discountValue: 5 });
    expect(res.status).toBe(403);
  });

  test('PC.11 Unauthorized access', async () => {
    const res = await request(app).post('/api/promos').send({ code: 'HACK', discountType: 'percentage', discountValue: 10 });
    expect(res.status).toBe(401);
  });
});