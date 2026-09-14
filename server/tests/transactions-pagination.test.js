// Transactions Pagination & Filter Tests
const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../server.js');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Transaction = require('../models/Transaction');
const jwt = require('jsonwebtoken');

const secret = process.env.JWT_SECRET || 'fallback_secret_change_me';

let buyer, buyerToken;
let seller, sellerToken;
let listings = [];

async function createTransaction(status = 'paid', overrides = {}) {
  return Transaction.create({
    listing: listings[0]._id,
    buyer: buyer._id,
    seller: seller._id,
    quantity: 1,
    itemPrice: 50,
    currency: 'USD',
    paymentBreakdown: {
      subtotal: 50, shippingCost: 5, buyerProtectionFee: 2.5, tax: 0,
      totalPaid: 57.5, platformFee: 5, shippingPayout: 5, sellerEarnings: 47.5,
    },
    status,
    shipping: { carrier: '', trackingNumber: '' },
    ...overrides,
  });
}

beforeEach(async () => {
  await User.deleteMany({});
  await Listing.deleteMany({});
  await Transaction.deleteMany({});

  const seed = `txn_pag_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  buyer = await User.create({
    _id: new mongoose.Types.ObjectId(),
    name: 'Txn Buyer',
    email: `${seed}_buyer@test.com`,
    password: 'password123',
    emailVerified: true,
    authProvider: 'email',
    country: 'US',
    currency: 'USD',
  });
  buyerToken = jwt.sign({ id: buyer._id }, secret, { expiresIn: '1h' });

  seller = await User.create({
    _id: new mongoose.Types.ObjectId(),
    name: 'Txn Seller',
    email: `${seed}_seller@test.com`,
    password: 'password123',
    emailVerified: true,
    authProvider: 'email',
    country: 'US',
    currency: 'USD',
  });
  sellerToken = jwt.sign({ id: seller._id }, secret, { expiresIn: '1h' });

  listings = [await Listing.create({
    seller: seller._id,
    title: 'Test Item',
    description: 'Test',
    price: 50,
    currency: 'USD',
    category: 'Men',
    brand: 'TestBrand',
    size: 'M',
    condition: 'Good',
    images: [],
    available: true,
    sold: false,
    quantity: 100,
    shipsFrom: 'US',
  })];
});

describe('Transactions Pagination & Filtering', () => {
  describe('Basic Pagination', () => {
    test('TP.1 Returns paginated response structure', async () => {
      await createTransaction('paid');
      const res = await request(app)
        .get('/api/transactions')
        .set('Authorization', `Bearer ${buyerToken}`)
        .expect(200);
      expect(res.body).toHaveProperty('transactions');
      expect(res.body).toHaveProperty('pagination');
      expect(res.body.pagination).toHaveProperty('total');
      expect(res.body.pagination).toHaveProperty('totalPages');
      expect(res.body.pagination).toHaveProperty('currentPage');
      expect(res.body.pagination).toHaveProperty('limit');
      expect(res.body.pagination).toHaveProperty('hasMore');
      expect(res.body.pagination).toHaveProperty('hasNextPage');
      expect(res.body.pagination).toHaveProperty('hasPrevPage');
      expect(res.body.pagination).toHaveProperty('nextPage');
      expect(res.body.pagination).toHaveProperty('prevPage');
    });

    test('TP.2 Default pagination: page 1, limit 20', async () => {
      for (let i = 0; i < 5; i++) await createTransaction('paid');
      const res = await request(app)
        .get('/api/transactions')
        .set('Authorization', `Bearer ${buyerToken}`)
        .expect(200);
      expect(res.body.transactions).toHaveLength(5);
      expect(res.body.pagination.currentPage).toBe(1);
      expect(res.body.pagination.limit).toBe(20);
      expect(res.body.pagination.total).toBe(5);
      expect(res.body.pagination.totalPages).toBe(1);
      expect(res.body.pagination.hasMore).toBe(false);
    });

    test('TP.3 Pagination with custom limit', async () => {
      for (let i = 0; i < 10; i++) await createTransaction('paid');
      const res = await request(app)
        .get('/api/transactions?limit=3')
        .set('Authorization', `Bearer ${buyerToken}`)
        .expect(200);
      expect(res.body.transactions).toHaveLength(3);
      expect(res.body.pagination.limit).toBe(3);
      expect(res.body.pagination.total).toBe(10);
      expect(res.body.pagination.totalPages).toBe(4);
      expect(res.body.pagination.hasMore).toBe(true);
      expect(res.body.pagination.hasNextPage).toBe(true);
      expect(res.body.pagination.nextPage).toBe(2);
    });

    test('TP.4 Navigate to next page', async () => {
      for (let i = 0; i < 10; i++) await createTransaction('paid');
      const res = await request(app)
        .get('/api/transactions?page=2&limit=3')
        .set('Authorization', `Bearer ${buyerToken}`)
        .expect(200);
      expect(res.body.transactions).toHaveLength(3);
      expect(res.body.pagination.currentPage).toBe(2);
      expect(res.body.pagination.hasPrevPage).toBe(true);
      expect(res.body.pagination.prevPage).toBe(1);
      expect(res.body.pagination.nextPage).toBe(3);
    });

    test('TP.5 Last page has correct remaining items', async () => {
      for (let i = 0; i < 10; i++) await createTransaction('paid');
      const res = await request(app)
        .get('/api/transactions?page=4&limit=3')
        .set('Authorization', `Bearer ${buyerToken}`)
        .expect(200);
      expect(res.body.transactions).toHaveLength(1);
      expect(res.body.pagination.currentPage).toBe(4);
      expect(res.body.pagination.hasNextPage).toBe(false);
      expect(res.body.pagination.nextPage).toBe(null);
    });

    test('TP.6 Limit is capped at 100', async () => {
      const res = await request(app)
        .get('/api/transactions?limit=500')
        .set('Authorization', `Bearer ${buyerToken}`)
        .expect(200);
      expect(res.body.pagination.limit).toBe(100);
    });
    test('TP.6 Limit is capped at 100', async () => {
      const res = await request(app)
        .get('/api/transactions?limit=500')
        .set('Authorization', `Bearer ${buyerToken}`)
        .expect(200);
      expect(res.body.pagination.limit).toBe(100);
    });
  });

  describe('Status Filtering', () => {
    beforeEach(async () => {
      await createTransaction('paid');
      await createTransaction('processing');
      await createTransaction('shipped');
      await createTransaction('delivered');
      await createTransaction('completed');
      await createTransaction('cancelled');
      await createTransaction('refunded');
    });

    test('TF.1 Filter by single status', async () => {
      const res = await request(app)
        .get('/api/transactions?status=paid')
        .set('Authorization', `Bearer ${buyerToken}`)
        .expect(200);
      expect(res.body.transactions.length).toBeGreaterThanOrEqual(1);
      res.body.transactions.forEach(t => expect(t.status).toBe('paid'));
    });

    test('TF.2 Filter by multiple statuses (comma-separated)', async () => {
      const res = await request(app)
        .get('/api/transactions?status=paid,processing')
        .set('Authorization', `Bearer ${buyerToken}`)
        .expect(200);
      expect(res.body.transactions.length).toBe(2);
      res.body.transactions.forEach(t => expect(['paid', 'processing']).toContain(t.status));
    });

    test('TF.3 Filter by shipped status', async () => {
      const res = await request(app)
        .get('/api/transactions?status=shipped')
        .set('Authorization', `Bearer ${buyerToken}`)
        .expect(200);
      expect(res.body.transactions.length).toBe(1);
      expect(res.body.transactions[0].status).toBe('shipped');
    });

    test('TF.4 Filter with no matches returns empty', async () => {
      const res = await request(app)
        .get('/api/transactions?status=disputed')
        .set('Authorization', `Bearer ${buyerToken}`)
        .expect(200);
      expect(res.body.transactions).toHaveLength(0);
      expect(res.body.pagination.total).toBe(0);
    });
    test('TF.4 Filter with no matches returns empty', async () => {
      const res = await request(app)
        .get('/api/transactions?status=disputed')
        .set('Authorization', `Bearer ${buyerToken}`)
        .expect(200);
      expect(res.body.transactions).toHaveLength(0);
      expect(res.body.pagination.total).toBe(0);
    });
  });

  describe('Type + Status Default Filters', () => {
    beforeEach(async () => {
      await createTransaction('paid');
      await createTransaction('processing');
      await createTransaction('shipped');
      await createTransaction('delivered');
      await createTransaction('completed');
      await createTransaction('cancelled');
    });

    test('TS.1 Sold tab defaults to paid+processing', async () => {
      const res = await request(app)
        .get('/api/transactions?type=sold')
        .set('Authorization', `Bearer ${sellerToken}`)
        .expect(200);
      expect(res.body.transactions.length).toBe(2);
      res.body.transactions.forEach(t => expect(['paid', 'processing']).toContain(t.status));
    });

    test('TS.2 Bought tab defaults to active orders', async () => {
      const res = await request(app)
        .get('/api/transactions?type=bought')
        .set('Authorization', `Bearer ${buyerToken}`)
        .expect(200);
      res.body.transactions.forEach(t => expect(['paid', 'processing', 'shipped', 'in_transit']).toContain(t.status));
    });

    test('TS.3 All tab shows everything', async () => {
      const res = await request(app)
        .get('/api/transactions?type=all')
        .set('Authorization', `Bearer ${buyerToken}`)
        .expect(200);
      expect(res.body.transactions.length).toBe(6);
    });

    test('TS.4 Explicit status overrides default', async () => {
      const res = await request(app)
        .get('/api/transactions?type=sold&status=delivered')
        .set('Authorization', `Bearer ${sellerToken}`)
        .expect(200);
      expect(res.body.transactions.length).toBe(1);
      expect(res.body.transactions[0].status).toBe('delivered');
    });
    test('TS.4 Explicit status overrides default', async () => {
      const res = await request(app)
        .get('/api/transactions?type=sold&status=delivered')
        .set('Authorization', `Bearer ${sellerToken}`)
        .expect(200);
      expect(res.body.transactions.length).toBe(1);
      expect(res.body.transactions[0].status).toBe('delivered');
    });
  });

  describe('Pagination + Filter Combinations', () => {
    beforeEach(async () => {
      for (let i = 0; i < 25; i++) await createTransaction('paid');
      for (let i = 0; i < 10; i++) await createTransaction('shipped');
    });

    test('TC.1 Paginate filtered results', async () => {
      const res = await request(app)
        .get('/api/transactions?status=paid&limit=10')
        .set('Authorization', `Bearer ${buyerToken}`)
        .expect(200);
      expect(res.body.transactions).toHaveLength(10);
      expect(res.body.pagination.total).toBe(25);
      expect(res.body.pagination.totalPages).toBe(3);
    });

    test('TC.2 Navigate filtered pages', async () => {
      const res = await request(app)
        .get('/api/transactions?status=paid&page=2&limit=10')
        .set('Authorization', `Bearer ${buyerToken}`)
        .expect(200);
      expect(res.body.transactions).toHaveLength(10);
      expect(res.body.pagination.currentPage).toBe(2);
    });

    test('TC.3 Last page of filtered results', async () => {
      const res = await request(app)
        .get('/api/transactions?status=paid&page=3&limit=10')
        .set('Authorization', `Bearer ${buyerToken}`)
        .expect(200);
      expect(res.body.transactions).toHaveLength(5);
      expect(res.body.pagination.hasNextPage).toBe(false);
    });

    test('TC.4 Type+status+pagination combined', async () => {
      const res = await request(app)
        .get('/api/transactions?type=sold&status=shipped&limit=5')
        .set('Authorization', `Bearer ${sellerToken}`)
        .expect(200);
      expect(res.body.transactions.length).toBeLessThanOrEqual(5);
      res.body.transactions.forEach(t => expect(t.status).toBe('shipped'));
    });

    test('TC.5 Empty result with metadata', async () => {
      const res = await request(app)
        .get('/api/transactions?status=disputed&limit=10')
        .set('Authorization', `Bearer ${buyerToken}`)
        .expect(200);
      expect(res.body.transactions).toHaveLength(0);
      expect(res.body.pagination.total).toBe(0);
      expect(res.body.pagination.total).toBe(0);
    });
  });

  describe('Edge Cases & Robustness', () => {
    test('TE.1 Invalid page defaults to 1', async () => {
      await createTransaction('paid');
      const res = await request(app)
        .get('/api/transactions?page=-1')
        .set('Authorization', `Bearer ${buyerToken}`)
        .expect(200);
      expect(res.body.pagination.currentPage).toBe(1);
    });

    test('TE.2 Invalid limit defaults to 20', async () => {
      const res = await request(app)
        .get('/api/transactions?limit=abc')
        .set('Authorization', `Bearer ${buyerToken}`)
        .expect(200);
      expect(res.body.pagination.limit).toBe(20);
    });

    test('TE.3 Zero limit defaults to 1', async () => {
      const res = await request(app)
        .get('/api/transactions?limit=0')
        .set('Authorization', `Bearer ${buyerToken}`)
        .expect(200);
      expect(res.body.pagination.limit).toBe(1);
    });

    test('TE.4 Large dataset pagination', async () => {
      for (let i = 0; i < 50; i++) await createTransaction('paid');
      const res = await request(app)
        .get('/api/transactions?limit=20&page=3')
        .set('Authorization', `Bearer ${buyerToken}`)
        .expect(200);
      expect(res.body.transactions).toHaveLength(10);
      expect(res.body.pagination.total).toBe(50);
      expect(res.body.pagination.totalPages).toBe(3);
    });

    test('TE.5 Populated with buyer/seller/listing', async () => {
      await createTransaction('paid');
      const res = await request(app)
        .get('/api/transactions')
        .set('Authorization', `Bearer ${buyerToken}`)
        .expect(200);
      const txn = res.body.transactions[0];
      expect(txn.buyer).toHaveProperty('name');
      expect(txn.seller).toHaveProperty('name');
      expect(txn.listing).toHaveProperty('title');
    });

    test('TE.6 Sorted by createdAt descending', async () => {
      await createTransaction('paid');
      await new Promise(r => setTimeout(r, 10));
      await createTransaction('processing');
      await new Promise(r => setTimeout(r, 10));
      await createTransaction('shipped');
      const res = await request(app)
        .get('/api/transactions?type=all')
        .set('Authorization', `Bearer ${buyerToken}`)
        .expect(200);
      const dates = res.body.transactions.map(t => new Date(t.createdAt).getTime());
      for (let i = 1; i < dates.length; i++) {
        expect(dates[i - 1]).toBeGreaterThanOrEqual(dates[i]);
      }
    });

    test('TE.7 Authentication required', async () => {
      await request(app)
        .get('/api/transactions')
        .expect(401);
    });

    test('TE.8 Buyer only sees own transactions', async () => {
      const otherBuyer = await User.create({
        _id: new mongoose.Types.ObjectId(),
        name: 'Other Buyer',
        email: `other_${Date.now()}@test.com`,
        password: 'password123',
        emailVerified: true,
        authProvider: 'email',
        country: 'US',
        currency: 'USD',
      });
      const otherToken = jwt.sign({ id: otherBuyer._id }, secret, { expiresIn: '1h' });
      await createTransaction('paid');
      const res = await request(app)
        .get('/api/transactions?type=bought')
        .set('Authorization', `Bearer ${otherToken}`)
        .expect(200);
      expect(res.body.transactions).toHaveLength(0);
    });
  });
});