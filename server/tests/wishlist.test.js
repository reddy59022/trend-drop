/**
 * Wishlist Comprehensive Tests
 * Ensures wishlist functionality works correctly for add, remove, check, list, and persistence.
 * Prevents regression of the "heart icon doesn't add to wishlist" bug.
 */
const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../server');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Wishlist = require('../models/Wishlist');
const jwt = require('jsonwebtoken');

const PASS = 'password123';
const mkEmail = p => `${p}_wl_${Date.now()}_${Math.random().toString(36).slice(2, 7)}@test.com`;

let sellerToken, buyerToken, sellerId, buyerId, buyerUser;
let listing1, listing2, listing3;

async function createUser(name, email) {
  const u = await User.create({
    name,
    email: email.toLowerCase(),
    password: PASS,
    emailVerified: true,
    authProvider: 'email',
    country: 'US',
    currency: 'USD',
    balance: { available: 0, pending: 0, totalEarned: 0, totalPaidOut: 0, currency: 'USD' },
    stats: { totalSales: 0, totalPurchases: 0, totalListings: 0, avgRating: 0, ratingCount: 0, responseRate: 100, shipTime: 3, strikes: 0 },
  });
  const token = jwt.sign({ id: u._id }, process.env.JWT_SECRET || 'fallback_secret_change_me', { expiresIn: '30d' });
  return { user: u, token };
}

async function createListing(sellerId, overrides = {}) {
  return Listing.create({
    seller: sellerId,
    title: 'Wishlist Test Item',
    description: 'Test description',
    price: 50,
    category: 'Women',
    condition: 'New with tags',
    available: true,
    sold: false,
    quantity: 1,
    shipsFrom: 'US',
    weight: 0.5,
    ...overrides,
  });
}

beforeAll(async () => {
  // Clean up any existing wishlist data
  await Wishlist.deleteMany({});
  await Listing.deleteMany({});
  await User.deleteMany({});

  // Create seller
  const seller = await createUser('Test Seller', mkEmail('seller'));
  sellerToken = seller.token;
  sellerId = seller.user._id;

  // Create buyer
  const buyer = await createUser('Test Buyer', mkEmail('buyer'));
  buyerToken = buyer.token;
  buyerId = buyer.user._id;
  buyerUser = buyer.user;

  // Create test listings
  listing1 = await createListing(sellerId, { title: 'Vintage Jacket' });
  listing2 = await createListing(sellerId, { title: 'Designer Bag' });
  listing3 = await createListing(sellerId, { title: 'Sneakers' });
});

afterAll(async () => {
  await Wishlist.deleteMany({});
  await Listing.deleteMany({});
  await User.deleteMany({});
  await mongoose.connection.close();
});

describe('Wishlist Functionality', () => {

  describe('POST /api/wishlist - Add to Wishlist', () => {
    test('1a Adds a new item to wishlist successfully', async () => {
      const r = await request(app)
        .post('/api/wishlist')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({ listingId: listing1._id.toString() });

      expect(r.status).toBe(200);
      expect(r.body.message).toBe('Added to wishlist');
    });

    test('1b Wishlist contains the added item in DB', async () => {
      const wishlist = await Wishlist.findOne({ user: buyerId });
      expect(wishlist).toBeTruthy();
      expect(wishlist.items.length).toBeGreaterThanOrEqual(1);
      const ids = wishlist.items.map(i => i.listing.toString());
      expect(ids).toContain(listing1._id.toString());
    });

    test('1c Adding same item twice does not create duplicates', async () => {
      await request(app)
        .post('/api/wishlist')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({ listingId: listing1._id.toString() });

      await request(app)
        .post('/api/wishlist')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({ listingId: listing1._id.toString() });

      const wishlist = await Wishlist.findOne({ user: buyerId });
      const count = wishlist.items.filter(i => i.listing.toString() === listing1._id.toString()).length;
      expect(count).toBe(1);
    });

    test('1d Can add multiple different items', async () => {
      await request(app)
        .post('/api/wishlist')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({ listingId: listing2._id.toString() });

      await request(app)
        .post('/api/wishlist')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({ listingId: listing3._id.toString() });

      const r = await request(app)
        .get('/api/wishlist')
        .set('Authorization', `Bearer ${buyerToken}`);

      expect(r.status).toBe(200);
      expect(Array.isArray(r.body)).toBe(true);
      expect(r.body.length).toBe(3);
    });

    test('1e Returns 401 without auth token', async () => {
      const r = await request(app)
        .post('/api/wishlist')
        .send({ listingId: listing1._id.toString() });
      expect(r.status).toBe(401);
    });
  });

  describe('GET /api/wishlist - Get User Wishlist', () => {
    test('2a Returns the user wishlist as an array', async () => {
      const r = await request(app)
        .get('/api/wishlist')
        .set('Authorization', `Bearer ${buyerToken}`);

      expect(r.status).toBe(200);
      expect(Array.isArray(r.body)).toBe(true);
    });

    test('2b Wishlist items are populated with listing details', async () => {
      const r = await request(app)
        .get('/api/wishlist')
        .set('Authorization', `Bearer ${buyerToken}`);

      expect(r.body.length).toBeGreaterThan(0);
      // Each item should have listing details
      const firstItem = r.body[0];
      expect(firstItem).toHaveProperty('listing');
    });

    test('2c Returns empty array for new user with no wishlist', async () => {
      const newUser = await createUser('New User', mkEmail('new'));
      const r = await request(app)
        .get('/api/wishlist')
        .set('Authorization', `Bearer ${newUser.token}`);

      expect(r.status).toBe(200);
      expect(r.body).toEqual([]);
    });

    test('2d Different users have separate wishlists', async () => {
      const otherUser = await createUser('Other User', mkEmail('other'));
      await request(app)
        .post('/api/wishlist')
        .set('Authorization', `Bearer ${otherUser.token}`)
        .send({ listingId: listing1._id.toString() });

      const otherWishlist = await request(app)
        .get('/api/wishlist')
        .set('Authorization', `Bearer ${otherUser.token}`);

      const buyerWishlist = await request(app)
        .get('/api/wishlist')
        .set('Authorization', `Bearer ${buyerToken}`);

      // Both should have listing1, but they are separate wishlists
      expect(otherWishlist.body.length).toBeGreaterThan(0);
      expect(buyerWishlist.body.length).toBeGreaterThan(0);
    });
  });

  describe('GET /api/wishlist/check/:listingId - Check if in Wishlist', () => {
    test('3a Returns true for item in wishlist', async () => {
      const r = await request(app)
        .get(`/api/wishlist/check/${listing1._id}`)
        .set('Authorization', `Bearer ${buyerToken}`);

      expect(r.status).toBe(200);
      expect(r.body.inWishlist).toBe(true);
    });

    test('3b Returns false for item not in wishlist', async () => {
      // Create a new listing not in wishlist
      const newListing = await createListing(sellerId, { title: 'Not in wishlist' });
      const r = await request(app)
        .get(`/api/wishlist/check/${newListing._id}`)
        .set('Authorization', `Bearer ${buyerToken}`);

      expect(r.status).toBe(200);
      expect(r.body.inWishlist).toBe(false);
    });

    test('3c Returns false for user with no wishlist', async () => {
      const newUser = await createUser('No Wishlist User', mkEmail('none'));
      const r = await request(app)
        .get(`/api/wishlist/check/${listing1._id}`)
        .set('Authorization', `Bearer ${newUser.token}`);

      expect(r.status).toBe(200);
      expect(r.body.inWishlist).toBe(false);
    });
  });

  describe('DELETE /api/wishlist/:listingId - Remove from Wishlist', () => {
    test('4a Removes item from wishlist', async () => {
      const r = await request(app)
        .delete(`/api/wishlist/${listing1._id}`)
        .set('Authorization', `Bearer ${buyerToken}`);

      expect(r.status).toBe(200);
      expect(r.body.message).toBe('Removed from wishlist');
    });

    test('4b Item is no longer in wishlist after deletion', async () => {
      const check = await request(app)
        .get(`/api/wishlist/check/${listing1._id}`)
        .set('Authorization', `Bearer ${buyerToken}`);
      expect(check.body.inWishlist).toBe(false);

      const wishlist = await Wishlist.findOne({ user: buyerId });
      const ids = wishlist.items.map(i => i.listing.toString());
      expect(ids).not.toContain(listing1._id.toString());
    });

    test('4c Removing non-existent item is safe (no error)', async () => {
      const newListing = await createListing(sellerId, { title: 'Never added' });
      const r = await request(app)
        .delete(`/api/wishlist/${newListing._id}`)
        .set('Authorization', `Bearer ${buyerToken}`);

      expect(r.status).toBe(200);
    });

    test('4d Removing from user with no wishlist is safe (no error)', async () => {
      const newUser = await createUser('No WL User', mkEmail('remove'));
      const r = await request(app)
        .delete(`/api/wishlist/${listing1._id}`)
        .set('Authorization', `Bearer ${newUser.token}`);

      expect(r.status).toBe(200);
    });

    test('4e Removing one item preserves other items', async () => {
      // Re-add listing1, then add listing2 (listing3 should still be there from earlier)
      await request(app)
        .post('/api/wishlist')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({ listingId: listing1._id.toString() });

      await request(app)
        .delete(`/api/wishlist/${listing2._id}`)
        .set('Authorization', `Bearer ${buyerToken}`);

      const r = await request(app)
        .get('/api/wishlist')
        .set('Authorization', `Bearer ${buyerToken}`);

      const ids = r.body.map(item => {
        const l = item.listing;
        return l && l._id ? l._id : (l ? l.toString() : null);
      });
      expect(ids).toContain(listing1._id.toString());
      expect(ids).toContain(listing3._id.toString());
      expect(ids).not.toContain(listing2._id.toString());
    });
  });

  describe('End-to-End Heart Icon Flow', () => {
    test('5a Complete add/check/remove cycle works correctly', async () => {
      const testListing = await createListing(sellerId, { title: 'E2E Test' });

      // 1. Initial: not in wishlist
      let check = await request(app)
        .get(`/api/wishlist/check/${testListing._id}`)
        .set('Authorization', `Bearer ${buyerToken}`);
      expect(check.body.inWishlist).toBe(false);

      // 2. Add to wishlist
      const addRes = await request(app)
        .post('/api/wishlist')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({ listingId: testListing._id.toString() });
      expect(addRes.status).toBe(200);

      // 3. Verify it's in wishlist
      check = await request(app)
        .get(`/api/wishlist/check/${testListing._id}`)
        .set('Authorization', `Bearer ${buyerToken}`);
      expect(check.body.inWishlist).toBe(true);

      // 4. Get wishlist and verify it contains the item
      const listRes = await request(app)
        .get('/api/wishlist')
        .set('Authorization', `Bearer ${buyerToken}`);
      const ids = listRes.body.map(item => {
        const l = item.listing;
        return l && l._id ? l._id : (l ? l.toString() : null);
      });
      expect(ids).toContain(testListing._id.toString());

      // 5. Remove from wishlist
      const removeRes = await request(app)
        .delete(`/api/wishlist/${testListing._id}`)
        .set('Authorization', `Bearer ${buyerToken}`);
      expect(removeRes.status).toBe(200);

      // 6. Verify it's no longer in wishlist
      check = await request(app)
        .get(`/api/wishlist/check/${testListing._id}`)
        .set('Authorization', `Bearer ${buyerToken}`);
      expect(check.body.inWishlist).toBe(false);
    });
  });
});