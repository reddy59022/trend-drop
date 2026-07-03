// Abandoned Cart Recovery Tests - v29.0
const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../server.js');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Cart = require('../models/Cart');
const jwt = require('jsonwebtoken');

let userToken;
let userId;
let listingId;

async function createUser(email) {
  const dummyId = new mongoose.Types.ObjectId();
  return await User.create({
    _id: dummyId,
    name: 'TestUser',
    email: email,
    password: 'hashed',
    emailVerified: true,
    authProvider: 'email',
    role: 'user',
    country: 'US',
    currency: 'USD',
  });
}

describe('Abandoned Cart Recovery', () => {
  beforeEach(async () => {
    const user = await createUser(`cart_user_${Date.now()}@example.com`);
    userId = user._id;
    
    const listing = await Listing.create({
      title: 'Test Item',
      description: 'Test',
      price: 50,
      category: 'Men',
      condition: 'Good',
      seller: userId,
      available: true,
      sold: false,
      status: 'active',
    });
    listingId = listing._id;
    
    const secret = process.env.JWT_SECRET || 'fallback_secret_change_me';
    userToken = jwt.sign({ id: userId }, secret, { expiresIn: '1h' });
  });

  afterEach(async () => {
    await Cart.deleteMany({ user: userId });
    await Listing.deleteMany({ seller: userId });
    await User.deleteMany({ _id: userId });
  });

  describe('GET /api/cart', () => {
    it('CART.1 should require authentication', async () => {
      const res = await request(app).get('/api/cart');
      expect(res.statusCode).toBe(401);
    });

    it('CART.2 should return user cart', async () => {
      // Add item to cart
      await Cart.create({
        user: userId,
        items: [{ listing: listingId, quantity: 1 }],
        status: 'active',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });

      const res = await request(app)
        .get('/api/cart')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.cart).toBeDefined();
      expect(res.body.cart.items).toBeDefined();
    });
  });

  describe('POST /api/cart/items', () => {
    it('CART.3 should add item to cart', async () => {
      const res = await request(app)
        .post('/api/cart/items')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ listingId, quantity: 1 });

      expect(res.statusCode).toBe(200);
      expect(res.body.cart.items.length).toBe(1);
    });

    it('CART.4 should not add unavailable listing to cart', async () => {
      const unavailableListing = await Listing.create({
        title: 'Sold Item',
        description: 'Test',
        price: 50,
        category: 'Men',
        condition: 'Good',
        seller: userId,
        available: false,
        sold: true,
        status: 'sold',
      });

      const res = await request(app)
        .post('/api/cart/items')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ listingId: unavailableListing._id, quantity: 1 });

      expect(res.statusCode).toBe(400);
    });
  });

  describe('DELETE /api/cart/items/:id', () => {
    it('CART.5 should remove item from cart', async () => {
      const cart = await Cart.create({
        user: userId,
        items: [{ listing: listingId, quantity: 1 }],
        status: 'active',
      });

      const res = await request(app)
        .delete(`/api/cart/items/${listingId}`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.cart.items.length).toBe(0);
    });
  });

  describe('POST /api/cart/checkout', () => {
    it('CART.6 should convert cart to order', async () => {
      await Cart.create({
        user: userId,
        items: [{ listing: listingId, quantity: 1 }],
        status: 'active',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });

      const res = await request(app)
        .post('/api/cart/checkout')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.transaction).toBeDefined();
    });
  });

  describe('GET /api/cart/recovery/settings', () => {
    it('CART.7 should return recovery settings', async () => {
      const res = await request(app).get('/api/cart/recovery/settings');
      expect(res.statusCode).toBe(200);
      expect(res.body.reminderHours).toBeDefined();
    });
  });
});