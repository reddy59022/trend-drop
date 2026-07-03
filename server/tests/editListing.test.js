const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../server');
const User = require('../models/User');
const Listing = require('../models/Listing');

const PASS = 'password123';

async function createUser(name, email) {
  const u = await User.create({
    name, email: email.toLowerCase(), password: PASS,
    emailVerified: true, authProvider: 'email',
    country: 'US', currency: 'USD',
    shippingAddress: { fullName: name, street1: '123 Main St', city: 'Austin', state: 'TX', postalCode: '78701', country: 'US' },
    balance: { available: 0, pending: 0, totalEarned: 0, totalPaidOut: 0, currency: 'USD' },
    stats: { totalSales: 0, totalPurchases: 0, strikes: 0 },
  });
  const jwt = require('jsonwebtoken');
  const token = jwt.sign({ id: u._id }, process.env.JWT_SECRET || 'fallback_secret_change_me', { expiresIn: '30d' });
  return { user: u, token };
}

describe('Edit Listing - Full Field Update', () => {
  let testUser, testListing, token;

  beforeAll(async () => {
    const result = await createUser('EditSeller', 'editlisting@test.com');
    testUser = result.user;
    token = result.token;

    // Create test listing with all fields
    testListing = await Listing.create({
      seller: testUser._id,
      title: 'Original Title',
      description: 'Original description',
      price: 50,
      originalPrice: 100,
      currency: 'USD',
      images: ['https://test.image.url/image1.jpg'],
      videoUrl: 'https://youtube.com/watch?v=original',
      category: 'Women',
      brand: 'Nike',
      size: 'M',
      condition: 'Good',
      color: 'Black',
      weight: 0.5,
      weightUnit: 'kg',
      shipsFrom: 'US',
      shipping: {
        domestic: true,
        international: false,
        freeShipping: false,
        shippingCost: 3.99,
      },
      quantity: 1,
      status: 'active',
      available: true,
    });
  });

  afterAll(async () => {
    const re = /editlisting@test.com/;
    await Promise.all([
      User.deleteMany({ email: re }),
      Listing.deleteMany({ seller: testUser._id }),
    ]);
  });

  describe('v35.1 - Update all listing fields', () => {
    it('should allow updating all listing fields', async () => {
      const res = await request(app)
        .put(`/api/listings/${testListing._id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          title: 'Updated Title',
          description: 'Updated description',
          price: 75,
          originalPrice: 150,
          category: 'Men',
          brand: 'Adidas',
          size: 'L',
          condition: 'New with tags',
          color: 'White',
          weight: 1.0,
          weightUnit: 'kg',
          shipsFrom: 'CA',
          domesticShipping: true,
          internationalShipping: true,
          freeShipping: false,
          shippingCost: 9.99,
          quantity: 3,
          status: 'active',
          videoUrl: 'https://instagram.com/reel/updated',
        });

      expect(res.statusCode).toBe(200);
      expect(res.body.listing.title).toBe('Updated Title');
      expect(res.body.listing.description).toBe('Updated description');
      expect(res.body.listing.price).toBe(75);
      expect(res.body.listing.brand).toBe('Adidas');
      expect(res.body.listing.condition).toBe('New with tags');
      expect(res.body.listing.shipping.international).toBe(true);
    });

    it('v35.2 - should allow updating to draft status', async () => {
      const res = await request(app)
        .put(`/api/listings/${testListing._id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          title: 'Draft Listing',
          status: 'draft',
        });

      expect(res.statusCode).toBe(200);
      expect(res.body.listing.status).toBe('draft');
      expect(res.body.listing.available).toBe(false);
    });
  });

  describe('v35.3 - Boost update on edit', () => {
    it('should allow adding boost when editing listing', async () => {
      // First reactivate the listing
      await Listing.findByIdAndUpdate(testListing._id, { status: 'active', available: true });

      const res = await request(app)
        .put(`/api/listings/${testListing._id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          title: 'Boosted Listing',
          boostTier: 'premium',
          boostDuration: 21,
        });

      expect(res.statusCode).toBe(200);
      expect(res.body.listing.boost.active).toBe(true);
      expect(res.body.listing.boost.tier).toBe('premium');
      expect(res.body.listing.boost.durationDays).toBe(21);
    });

    it('v35.4 - should allow removing boost when editing listing', async () => {
      const res = await request(app)
        .put(`/api/listings/${testListing._id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          removeBoost: 'true',
        });

      expect(res.statusCode).toBe(200);
      expect(res.body.listing.boost.active).toBe(false);
    });
  });

  describe('v35.5 - Video URL update', () => {
    it('should allow updating video URL', async () => {
      const res = await request(app)
        .put(`/api/listings/${testListing._id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          videoUrl: 'https://youtube.com/watch?v=newvideo123',
        });

      expect(res.statusCode).toBe(200);
      expect(res.body.listing.videoUrl).toBe('https://youtube.com/watch?v=newvideo123');
    });
  });

  describe('v35.6 - Authorization checks', () => {
    it('v35.6 - should not allow non-owner to edit', async () => {
      const otherResult = await createUser('OtherEditor', 'othereditlisting@test.com');
      const otherToken = otherResult.token;

      const res = await request(app)
        .put(`/api/listings/${testListing._id}`)
        .set('Authorization', `Bearer ${otherToken}`)
        .send({ title: 'Hacked Title' });

      expect(res.statusCode).toBe(403);
      expect(res.body.message).toContain('Not authorized');
    });
  });
});
