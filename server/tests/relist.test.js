// Relist / Reposh Feature Tests
const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../server.js');
const User = require('../models/User');
const Listing = require('../models/Listing');
const jwt = require('jsonwebtoken');

const secret = process.env.JWT_SECRET || 'fallback_secret_change_me';

let sellerToken;
let sellerId;
let soldListingId;
let seed;

describe('Relist / Reposh Feature', () => {
  beforeEach(async () => {
    seed = `rel_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const seller = await User.create({
      _id: new mongoose.Types.ObjectId(),
      name: 'Relist Seller',
      email: `${seed}@test.com`,
      password: 'password123',
      emailVerified: true,
      authProvider: 'email',
      country: 'US',
      currency: 'USD',
    });
    sellerId = seller._id;
    sellerToken = jwt.sign({ id: sellerId }, secret, { expiresIn: '1h' });

    const sold = await Listing.create({
      seller: sellerId,
      title: 'Vintage Denim Jacket',
      description: 'Sold item that will be relisted',
      price: 65,
      originalPrice: 120,
      category: 'Women',
      condition: 'Good',
      images: ['jacket1.jpg', 'jacket2.jpg'],
      brand: 'Levi',
      size: 'M',
      available: false,
      sold: true,
      status: 'sold',
      soldAt: new Date(),
    });
    soldListingId = sold._id;
  });

  test('REL.1 - Should reject relist without auth', async () => {
    const res = await request(app).post(`/api/listings/${soldListingId}/relist`).send({});
    expect(res.status).toBe(401);
  });

  test('REL.2 - Seller can relist a sold item with one click', async () => {
    const res = await request(app)
      .post(`/api/listings/${soldListingId}/relist`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.listing.title).toBe('Vintage Denim Jacket');
    expect(res.body.listing.available).toBe(true);
    expect(res.body.listing.sold).toBe(false);
    expect(res.body.listing.status).toBe('active');
    expect(res.body.listing._id).not.toBe(soldListingId);
  });

  test('REL.3 - Relisted item keeps original images and details', async () => {
    const res = await request(app)
      .post(`/api/listings/${soldListingId}/relist`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.listing.images.length).toBe(2);
    expect(res.body.listing.brand).toBe('Levi');
    expect(res.body.listing.price).toBe(65);
    expect(res.body.listing.condition).toBe('Good');
  });

  test('REL.4 - Seller can relist with updated price', async () => {
    const res = await request(app)
      .post(`/api/listings/${soldListingId}/relist`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ price: 55, description: 'Back in the closet!' });
    expect(res.status).toBe(200);
    expect(res.body.listing.price).toBe(55);
    expect(res.body.listing.description).toBe('Back in the closet!');
  });

  test('REL.5 - Cannot relist an item that is not sold', async () => {
    const active = await Listing.create({
      seller: sellerId,
      title: 'Active Item',
      description: 'Still for sale',
      price: 20,
      category: 'Accessories',
      condition: 'Good',
      available: true,
      sold: false,
      status: 'active',
    });
    const res = await request(app)
      .post(`/api/listings/${active._id}/relist`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({});
    expect(res.status).toBe(400);
  });

  test('REL.6 - Only the seller can relist their own item', async () => {
    const other = await User.create({
      _id: new mongoose.Types.ObjectId(),
      name: 'Other User',
      email: `other_${seed}@test.com`,
      password: 'password123',
      emailVerified: true,
      authProvider: 'email',
      country: 'US',
      currency: 'USD',
    });
    const otherToken = jwt.sign({ id: other._id }, secret, { expiresIn: '1h' });
    const res = await request(app)
      .post(`/api/listings/${soldListingId}/relist`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({});
    expect(res.status).toBe(403);
  });
});