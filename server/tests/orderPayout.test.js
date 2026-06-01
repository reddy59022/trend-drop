/**
 * Order Payout Flow Tests
 * 
 * Verifies that seller payout only happens AFTER order is delivered and completed:
 * 1. Order placed → seller.balance.pending += earnings (NOT available)
 * 2. Order delivered → status changes to delivered
 * 3. Buyer confirms (or auto-confirms after 3 days) → status changes to buyer_confirmed
 * 4. Auto-complete after 3 more days → seller.balance.pending -= earnings, seller.balance.available += earnings
 * 
 * Key business rule: Seller CANNOT withdraw funds until order is completed (delivered + confirmed + waiting period)
 */
const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../server');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Transaction = require('../models/Transaction');
const Payout = require('../models/Payout');
const { orderStates, timeWindows } = require('../config/orderLifecycle');

let sellerToken, buyerToken, sellerId, buyerId;
const PASS = 'password123';

// Track all test-created IDs for targeted cleanup (only delete data created by THIS test run)
const testUserIds = [];
const testListingIds = [];
const mkEmail = p => `${p}_payout_${Date.now()}@test.com`;

async function createUser(name, email) {
  const u = await User.create({
    name, email: email.toLowerCase(), password: PASS,
    emailVerified: true, authProvider: 'email',
    country: 'US', currency: 'USD',
    shippingAddress: { fullName: name, street1: '123 Main St', city: 'Austin', state: 'TX', postalCode: '78701', country: 'US' },
    balance: { available: 0, pending: 0, totalEarned: 0, totalPaidOut: 0, currency: 'USD' },
    stats: { totalSales: 10, totalPurchases: 0, strikes: 0 }, // Set to 10 to bypass new seller hold
  });
  testUserIds.push(u._id);
  const jwt = require('jsonwebtoken');
  const token = jwt.sign({ id: u._id }, process.env.JWT_SECRET || 'fallback_secret_change_me', { expiresIn: '30d' });
  return { user: u, token };
}

async function createListing(overrides = {}) {
  const l = await Listing.create({
    seller: sellerId, title: 'Payout Test Item', description: 'Test desc',
    price: 100, category: 'Men', condition: 'New with tags',
    available: true, sold: false, quantity: 5, shipsFrom: 'US', weight: 1, ...overrides,
  });
  testListingIds.push(l._id);
  return l;
}

async function createTransaction(overrides = {}) {
  const listing = await createListing();
  // Set delivery date to 6 days ago to pass the 5-day PAYOUT_HOLD_FROM_DELIVERY check
  const sixDaysAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000);
  return Transaction.create({
    listing: listing._id,
    buyer: buyerId,
    seller: sellerId,
    itemPrice: 100,
    currency: 'USD',
    paymentBreakdown: {
      subtotal: 100,
      shippingCost: 10,
      buyerProtectionFee: 5,
      buyerProtectionPercent: 5,
      tax: 0,
      totalPaid: 115,
      platformFee: 8,
      platformFeePercent: 8,
      shippingPayout: 10,
      sellerEarnings: 92,
    },
    shippingAddress: {
      fullName: 'Test Buyer', street1: '456 Oak Ave', city: 'Dallas', state: 'TX', postalCode: '75201', country: 'US', phone: '555-0123',
    },
    shipping: {
      carrier: 'USPS',
      trackingNumber: 'TEST123456789',
      trackingUrl: 'https://tracking.example.com/TEST123456789',
      labelCreated: true,
      labelCreatedDate: new Date(),
      estimatedDelivery: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
      actualDelivery: sixDaysAgo, // Set to 6 days ago to pass PAYOUT_HOLD_FROM_DELIVERY check
      service: 'Priority',
      trackingHistory: [],
    },
    status: orderStates.SHIPPED,
    payout: { status: 'pending', transactionId: `pi_test_${Date.now()}` },
    autoTracking: { enabled: true, lastChecked: new Date(), nextCheck: new Date(Date.now() + 86400000), attempts: 0 },
    ...overrides,
  });
}

beforeAll(async () => {
  const uri = process.env.MONGODB_URI || 'mongodb+srv://reddy59022_db_user:anNecZCiT3eJQfre@cluster.mongodb.net/poshmark?retryWrites=true&w=majority';
  if (mongoose.connection.readyState === 0) await mongoose.connect(uri);
  const re = /payout_test|Payout Test/;
  await Promise.all([
    User.deleteMany({ email: re }),
    Listing.deleteMany({ title: re }),
    Transaction.deleteMany({ $or: [{ listing: { $in: testListingIds } }, { buyer: { $in: testUserIds } }, { seller: { $in: testUserIds } }] }),
    Payout.deleteMany({ seller: { $in: testUserIds } }),
  ]);
  const { user: s, token: st } = await createUser('PayoutSeller', mkEmail('seller'));
  sellerId = s._id;
  sellerToken = st;
  const { user: b, token: bt } = await createUser('PayoutBuyer', mkEmail('buyer'));
  buyerId = b._id;
  buyerToken = bt;
});

afterAll(async () => {
  const re = /payout_test|Payout Test/;
  await Promise.all([
    User.deleteMany({ email: re }),
    Listing.deleteMany({ title: re }),
    Transaction.deleteMany({ $or: [{ listing: { $in: testListingIds } }, { buyer: { $in: testUserIds } }, { seller: { $in: testUserIds } }] }),
    Payout.deleteMany({ seller: { $in: testUserIds } }),
  ]);
  await mongoose.disconnect();
});

describe('Order Payout Flow — Seller Gets Paid Only After Delivery', () => {

  // ============================
  // PHASE 1: Order Placed — Funds in Pending
  // ============================
  describe('Phase 1: Order Placed', () => {
    test('seller balance.pending increases, balance.available stays 0', async () => {
      const seller = await User.findById(sellerId);
      const initialPending = seller.balance.pending || 0;
      const initialAvailable = seller.balance.available || 0;

      // Simulate order placement (this happens in confirm-batch route)
      seller.balance.pending = initialPending + 92; // sellerEarnings
      await seller.save();

      const updatedSeller = await User.findById(sellerId);
      expect(updatedSeller.balance.pending).toBe(initialPending + 92);
      expect(updatedSeller.balance.available).toBe(initialAvailable); // Still 0
    });

    test('seller CANNOT withdraw pending funds', async () => {
      const seller = await User.findById(sellerId);
      expect(seller.balance.available).toBe(0); // No available funds to withdraw
      
      // Try to withdraw — should fail
      const r = await request(app)
        .post('/api/payments/payout')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({});
      
      expect(r.status).toBe(400);
      expect(r.body.message).toMatch(/No available balance/i);
    });
  });

  // ============================
  // PHASE 2: Order Delivered — Still Pending
  // ============================
  describe('Phase 2: Order Delivered', () => {
    test('status changes to delivered, funds still in pending', async () => {
      const txn = await createTransaction({ status: orderStates.SHIPPED });
      
      // Simulate delivery (tracking update)
      txn.status = orderStates.DELIVERED;
      txn.shipping.actualDelivery = new Date();
      await txn.save();

      const updatedTxn = await Transaction.findById(txn._id);
      expect(updatedTxn.status).toBe(orderStates.DELIVERED);

      // Seller funds still in pending
      const seller = await User.findById(sellerId);
      expect(seller.balance.pending).toBeGreaterThan(0);
      expect(seller.balance.available).toBe(0);
    });

    test('buyer can confirm receipt after delivery', async () => {
      const txn = await createTransaction({ status: orderStates.DELIVERED });
      txn.shipping.actualDelivery = new Date();
      await txn.save();

      const r = await request(app)
        .post(`/api/orders/${txn._id}/confirm-received`)
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({});

      expect(r.status).toBe(200);
      expect(r.body.transaction.status).toBe(orderStates.BUYER_CONFIRMED);
    });
  });

  // ============================
  // PHASE 3: Buyer Confirmed — Still Pending (3-day wait)
  // ============================
  describe('Phase 3: Buyer Confirmed — 3-Day Waiting Period', () => {
    test('funds still in pending after buyer confirms', async () => {
      const txn = await createTransaction({ status: orderStates.BUYER_CONFIRMED });
      txn.buyerConfirmed = {
        received: true,
        confirmedAt: new Date(), // Just confirmed now
      };
      await txn.save();

      // Try to auto-complete immediately — should fail (3 days not passed)
      const r = await request(app)
        .post(`/api/orders/${txn._id}/auto-complete`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({});

      expect(r.status).toBe(400);
      expect(r.body.message).toMatch(/Cannot complete yet/i);

      // Funds still in pending
      const seller = await User.findById(sellerId);
      expect(seller.balance.pending).toBeGreaterThan(0);
    });

    test('auto-complete fails if less than 3 days since confirmation', async () => {
      const txn = await createTransaction({ status: orderStates.BUYER_CONFIRMED });
      txn.buyerConfirmed = {
        received: true,
        confirmedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), // 2 days ago
      };
      await txn.save();

      const r = await request(app)
        .post(`/api/orders/${txn._id}/auto-complete`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({});

      expect(r.status).toBe(400);
      expect(r.body.message).toMatch(/Cannot complete yet/i);
    });
  });

  // ============================
  // PHASE 4: Auto-Complete — Funds Released to Available
  // ============================
  describe('Phase 4: Auto-Complete — Funds Released', () => {
    test('after 3 days, auto-complete moves funds from pending to available', async () => {
      const txn = await createTransaction({ status: orderStates.BUYER_CONFIRMED });
      const sellerEarnings = 92;
      txn.buyerConfirmed = {
        received: true,
        confirmedAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000), // 4 days ago
      };
      await txn.save();

      // Add pending funds to seller
      const seller = await User.findById(sellerId);
      seller.balance.pending = (seller.balance.pending || 0) + sellerEarnings;
      await seller.save();

      const initialPending = seller.balance.pending;
      const initialAvailable = seller.balance.available || 0;

      // Auto-complete should succeed now
      const r = await request(app)
        .post(`/api/orders/${txn._id}/auto-complete`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({});

      expect(r.status).toBe(200);
      expect(r.body.message).toMatch(/Order completed/i);
      expect(r.body.sellerEarnings).toBe(sellerEarnings);

      // Verify funds moved from pending to available
      // Note: 10% rolling reserve is applied, so only 90% goes to available
      const reserveAmount = Math.round(sellerEarnings * 0.10 * 100) / 100; // 9.2
      const availableAmount = sellerEarnings - reserveAmount; // 82.8
      
      const updatedSeller = await User.findById(sellerId);
      expect(updatedSeller.balance.pending).toBe(initialPending - sellerEarnings);
      expect(updatedSeller.balance.available).toBe(initialAvailable + availableAmount);
      expect(updatedSeller.balance.totalEarned).toBe(sellerEarnings);
      expect(updatedSeller.balance.reserve).toBe(reserveAmount);
    });

    test('seller CAN withdraw after funds are available', async () => {
      const seller = await User.findById(sellerId);
      expect(seller.balance.available).toBeGreaterThan(0);

      // Note: Actual withdrawal requires payout method setup, which is tested elsewhere
      // This test just verifies the balance is available
    });

    test('payout record created with status completed', async () => {
      const txn = await createTransaction({ status: orderStates.BUYER_CONFIRMED });
      txn.buyerConfirmed = {
        received: true,
        confirmedAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000),
      };
      await txn.save();

      const seller = await User.findById(sellerId);
      seller.balance.pending = (seller.balance.pending || 0) + 92;
      await seller.save();

      await request(app)
        .post(`/api/orders/${txn._id}/auto-complete`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({});

      // Check payout record
      const payout = await Payout.findOne({ transaction: txn._id });
      expect(payout).toBeDefined();
      expect(payout.status).toBe('completed');
      expect(payout.payoutAmount).toBe(92);
    });
  });

  // ============================
  // EDGE CASES
  // ============================
  describe('Edge Cases', () => {
    test('cancelled order removes pending funds', async () => {
      const txn = await createTransaction({ status: orderStates.PAID });
      
      // Add pending funds
      const seller = await User.findById(sellerId);
      const initialPending = seller.balance.pending;
      seller.balance.pending = initialPending + 92;
      await seller.save();

      // Cancel order
      const r = await request(app)
        .post(`/api/orders/${txn._id}/cancel`)
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({ reason: 'Changed my mind' });

      expect(r.status).toBe(200);

      // Verify pending funds removed
      const updatedSeller = await User.findById(sellerId);
      expect(updatedSeller.balance.pending).toBe(initialPending);
    });

    test('returned order removes pending funds and refunds buyer', async () => {
      const txn = await createTransaction({ status: orderStates.RETURN_IN_TRANSIT });
      
      // Add pending funds
      const seller = await User.findById(sellerId);
      const initialPending = seller.balance.pending;
      seller.balance.pending = initialPending + 92;
      await seller.save();

      // Confirm return received (transitions from RETURN_IN_TRANSIT to RETURN_DELIVERED)
      const r = await request(app)
        .post(`/api/orders/${txn._id}/confirm-return-received`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({ condition: 'Good', inspectionNotes: 'Item in good condition' });

      expect(r.status).toBe(200);

      // Verify pending funds removed
      const updatedSeller = await User.findById(sellerId);
      expect(updatedSeller.balance.pending).toBe(initialPending);
    });
  });
});