// Bulk Listing Management Tests - v23.0
const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../server.js');
const User = require('../models/User');
const Listing = require('../models/Listing');
const jwt = require('jsonwebtoken');

let token;
let sellerId;

async function createUserAndToken() {
  const dummyId = new mongoose.Types.ObjectId();
  const uniqueEmail = `bulk_user_${Date.now()}_${dummyId}@example.com`;
  const seller = await User.create({
    _id: dummyId,
    name: 'BulkTestSeller',
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

describe('Bulk Listing Management', () => {
  beforeEach(async () => {
    await createUserAndToken();
  });

  afterEach(async () => {
    // Clean up test listings
    await Listing.deleteMany({ seller: sellerId });
  });

  describe('GET /api/listings/bulk-export', () => {
    it('BULK.1 should export user listings as CSV', async () => {
      // Create test listing
      await Listing.create({
        title: 'Test Item 1',
        description: 'Test description 1',
        price: 25,
        category: 'Men',
        condition: 'Good',
        seller: sellerId,
        available: true,
        sold: false,
        status: 'active',
      });

      const res = await request(app)
        .get('/api/listings/bulk-export')
        .set('Authorization', `Bearer ${token}`);

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.headers['content-disposition']).toContain('attachment');
      expect(res.text).toContain('title');
      expect(res.text).toContain('Test Item 1');
    });

    it('BULK.2 should require authentication', async () => {
      const res = await request(app).get('/api/listings/bulk-export');
      expect(res.statusCode).toBe(401);
    });
  });

  describe('PATCH /api/listings/bulk-status', () => {
    it('BULK.3 should update status of multiple listings', async () => {
      const listing1 = await Listing.create({
        title: 'Test Item 1',
        description: 'Test description 1',
        price: 25,
        category: 'Men',
        condition: 'Good',
        seller: sellerId,
        available: true,
        sold: false,
        status: 'active',
      });

      const listing2 = await Listing.create({
        title: 'Test Item 2',
        description: 'Test description 2',
        price: 35,
        category: 'Women',
        condition: 'Good',
        seller: sellerId,
        available: true,
        sold: false,
        status: 'draft',
      });

      const res = await request(app)
        .patch('/api/listings/bulk-status')
        .set('Authorization', `Bearer ${token}`)
        .send({ listingIds: [listing1._id, listing2._id], status: 'draft' });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.modified).toBe(2);

      const updated1 = await Listing.findById(listing1._id);
      const updated2 = await Listing.findById(listing2._id);
      expect(updated1.status).toBe('draft');
      expect(updated2.status).toBe('draft');
    });

    it('BULK.4 should validate status values', async () => {
      const listing1 = await Listing.create({
        title: 'Test Item 1',
        description: 'Test description 1',
        price: 25,
        category: 'Men',
        condition: 'Good',
        seller: sellerId,
        available: true,
        sold: false,
        status: 'active',
      });

      const res = await request(app)
        .patch('/api/listings/bulk-status')
        .set('Authorization', `Bearer ${token}`)
        .send({ listingIds: [listing1._id], status: 'invalid' });

      expect(res.statusCode).toBe(400);
      expect(res.body.message).toContain('Invalid status');
    });

    it('BULK.5 should require listingIds array', async () => {
      const res = await request(app)
        .patch('/api/listings/bulk-status')
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'active' });

      expect(res.statusCode).toBe(400);
    });
  });

  describe('PATCH /api/listings/bulk-price', () => {
    it('BULK.6 should update price of multiple listings', async () => {
      const listing1 = await Listing.create({
        title: 'Test Item 1',
        description: 'Test description 1',
        price: 25,
        category: 'Men',
        condition: 'Good',
        seller: sellerId,
        available: true,
        sold: false,
        status: 'active',
      });

      const listing3 = await Listing.create({
        title: 'Test Item 3',
        description: 'Test description 3',
        price: 45,
        category: 'Kids',
        condition: 'New with tags',
        seller: sellerId,
        available: true,
        sold: false,
        status: 'active',
      });

      const res = await request(app)
        .patch('/api/listings/bulk-price')
        .set('Authorization', `Bearer ${token}`)
        .send({ listingIds: [listing1._id, listing3._id], price: 50 });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.modified).toBe(2);
      expect(res.body.price).toBe(50);

      const updated1 = await Listing.findById(listing1._id);
      const updated3 = await Listing.findById(listing3._id);
      expect(updated1.price).toBe(50);
      expect(updated3.price).toBe(50);
    });

    it('BULK.7 should enforce minimum price of $5', async () => {
      const listing1 = await Listing.create({
        title: 'Test Item 1',
        description: 'Test description 1',
        price: 25,
        category: 'Men',
        condition: 'Good',
        seller: sellerId,
        available: true,
        sold: false,
        status: 'active',
      });

      const res = await request(app)
        .patch('/api/listings/bulk-price')
        .set('Authorization', `Bearer ${token}`)
        .send({ listingIds: [listing1._id], price: 3 });

      expect(res.statusCode).toBe(400);
      expect(res.body.message).toContain('at least $5');
    });
  });

  describe('DELETE /api/listings/bulk', () => {
    it('BULK.8 should delete multiple listings', async () => {
      const listing1 = await Listing.create({
        title: 'Test Item 1',
        description: 'Test description 1',
        price: 25,
        category: 'Men',
        condition: 'Good',
        seller: sellerId,
        available: true,
        sold: false,
        status: 'active',
      });

      const listing2 = await Listing.create({
        title: 'Test Item 2',
        description: 'Test description 2',
        price: 35,
        category: 'Women',
        condition: 'Good',
        seller: sellerId,
        available: true,
        sold: false,
        status: 'draft',
      });

      const res = await request(app)
        .delete('/api/listings/bulk')
        .set('Authorization', `Bearer ${token}`)
        .send({ listingIds: [listing1._id, listing2._id] });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.deleted).toBe(2);

      const count = await Listing.countDocuments({ _id: { $in: [listing1._id, listing2._id] } });
      expect(count).toBe(0);
    });

    it('BULK.9 should not delete sold listings', async () => {
      const listing1 = await Listing.create({
        title: 'Test Item 1',
        description: 'Test description 1',
        price: 25,
        category: 'Men',
        condition: 'Good',
        seller: sellerId,
        available: true,
        sold: false,
        status: 'active',
      });

      // Create a sold listing
      const soldListing = await Listing.create({
        title: 'Sold Item',
        description: 'Already sold',
        price: 20,
        category: 'Men',
        condition: 'Good',
        seller: sellerId,
        available: false,
        sold: true,
        status: 'sold',
      });

      const res = await request(app)
        .delete('/api/listings/bulk')
        .set('Authorization', `Bearer ${token}`)
        .send({ listingIds: [listing1._id, soldListing._id] });

      expect(res.statusCode).toBe(200);
      // Should only delete the non-sold listing
      expect(res.body.deleted).toBe(1);
    });
  });

  describe('POST /api/listings/bulk-boost', () => {
    it('BULK.10 should activate boost for multiple listings', async () => {
      const listing1 = await Listing.create({
        title: 'Test Item 1',
        description: 'Test description 1',
        price: 25,
        category: 'Men',
        condition: 'Good',
        seller: sellerId,
        available: true,
        sold: false,
        status: 'active',
      });

      const listing3 = await Listing.create({
        title: 'Test Item 3',
        description: 'Test description 3',
        price: 45,
        category: 'Kids',
        condition: 'New with tags',
        seller: sellerId,
        available: true,
        sold: false,
        status: 'active',
      });

      const res = await request(app)
        .post('/api/listings/bulk-boost')
        .set('Authorization', `Bearer ${token}`)
        .send({ listingIds: [listing1._id, listing3._id], tier: 'premium' });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.boosted).toBe(2);

      const updated1 = await Listing.findById(listing1._id);
      expect(updated1.boost.active).toBe(true);
      expect(updated1.boost.tier).toBe('premium');
    });

    it('BULK.11 should validate boost tiers', async () => {
      const listing1 = await Listing.create({
        title: 'Test Item 1',
        description: 'Test description 1',
        price: 25,
        category: 'Men',
        condition: 'Good',
        seller: sellerId,
        available: true,
        sold: false,
        status: 'active',
      });

      const res = await request(app)
        .post('/api/listings/bulk-boost')
        .set('Authorization', `Bearer ${token}`)
        .send({ listingIds: [listing1._id], tier: 'invalid' });

      expect(res.statusCode).toBe(400);
    });
  });

  describe('Authorization', () => {
    it('BULK.12 should only allow seller to modify their own listings', async () => {
      const listing1 = await Listing.create({
        title: 'Test Item 1',
        description: 'Test description 1',
        price: 25,
        category: 'Men',
        condition: 'Good',
        seller: sellerId,
        available: true,
        sold: false,
        status: 'active',
      });

      const otherSuffix = Date.now() + '-' + Math.random().toString(36).substr(2, 5);
      const otherSeller = await User.create({
        name: 'Other Seller',
        email: `other-${otherSuffix}@test.com`,
        password: 'password123',
      });

      const res = await request(app)
        .patch('/api/listings/bulk-status')
        .set('Authorization', `Bearer ${otherSeller.generateAuthToken()}`)
        .send({ listingIds: [listing1._id], status: 'draft' });

      expect(res.statusCode).toBe(200); // Operation succeeds but doesn't modify
      expect(res.body.modified).toBe(0);
    });
  });
});