/**
 * Risk Controls & Fraud Detection Tests
 * 
 * Tests for:
 * - Fix #1: Return window vs payout window conflict (5-day hold from delivery)
 * - Fix #2: 10% rolling seller reserve (held 60 days)
 * - Fix #3: New seller risk controls (first 5 sales held 14 days)
 * - Fix #5: High-value fee cap ($500)
 * - Fix #8: Fraud scoring system
 * - Fix #9: Return abuse tracking
 */
const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../server');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Transaction = require('../models/Transaction');
const Payout = require('../models/Payout');
const { orderStates, timeWindows } = require('../config/orderLifecycle');
const { calculatePaymentBreakdown, countryCommissions } = require('../config/payments');
const {
  calculateSellerRiskScore,
  calculateBuyerRiskScore,
  assessTransactionRisk,
  checkReturnAbuse,
  RISK_THRESHOLDS,
} = require('../config/fraudDetection');

let sellerToken, buyerToken, sellerId, buyerId;
const PASS = 'password123';

// Track all test-created IDs for targeted cleanup (only delete data created by THIS test run)
const testUserIds = [];
const testListingIds = [];
const mkEmail = p => `${p}_risk_${Date.now()}@test.com`;

async function createUser(name, email, overrides = {}) {
  const u = await User.create({
    name, email: email.toLowerCase(), password: PASS,
    emailVerified: true, authProvider: 'email',
    country: 'US', currency: 'USD',
    shippingAddress: { fullName: name, street1: '123 Main St', city: 'Austin', state: 'TX', postalCode: '78701', country: 'US' },
    balance: { available: 0, pending: 0, totalEarned: 0, totalPaidOut: 0, currency: 'USD' },
    stats: { totalSales: 0, totalPurchases: 0, strikes: 0 },
    ...overrides,
  });
  const jwt = require('jsonwebtoken');
  const token = jwt.sign({ id: u._id }, process.env.JWT_SECRET || 'fallback_secret_change_me', { expiresIn: '30d' });
  return { user: u, token };
}

async function createListing(overrides = {}) {
  return Listing.create({
    seller: sellerId, title: 'Risk Test Item', description: 'Test desc',
    price: 100, category: 'Men', condition: 'New with tags',
    available: true, sold: false, quantity: 5, shipsFrom: 'US', weight: 1, ...overrides,
  });
}

async function createTransaction(overrides = {}) {
  const listing = await createListing();
  return Transaction.create({
    listing: listing._id,
    buyer: buyerId,
    seller: sellerId,
    itemPrice: 100,
    currency: 'USD',
    paymentBreakdown: {
      subtotal: 100, shippingCost: 10, buyerProtectionFee: 5,
      buyerProtectionPercent: 5, tax: 0, totalPaid: 115,
      platformFee: 8, platformFeePercent: 8, shippingPayout: 10, sellerEarnings: 92,
    },
    shippingAddress: { fullName: 'Test Buyer', street1: '456 Oak Ave', city: 'Dallas', state: 'TX', postalCode: '75201', country: 'US', phone: '555-0123' },
    shipping: { carrier: 'USPS', trackingNumber: 'TEST123', trackingUrl: 'https://tracking.example.com', labelCreated: true, labelCreatedDate: new Date(), estimatedDelivery: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000), service: 'Priority', trackingHistory: [] },
    status: orderStates.SHIPPED,
    payout: { status: 'pending', transactionId: `pi_test_${Date.now()}` },
    autoTracking: { enabled: true, lastChecked: new Date(), nextCheck: new Date(Date.now() + 86400000), attempts: 0 },
    ...overrides,
  });
}

beforeAll(async () => {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/trend-drop-test';
  if (mongoose.connection.readyState === 0) await mongoose.connect(uri);
  const re = /risk_test|Risk Test/;
  await Promise.all([
    User.deleteMany({ email: re }),
    Listing.deleteMany({ title: re }),
    Transaction.deleteMany({ $or: [{ listing: { $in: testListingIds } }, { buyer: { $in: testUserIds } }, { seller: { $in: testUserIds } }] }),
    Payout.deleteMany({ seller: { $in: testUserIds } }),
  ]);
  const { user: s, token: st } = await createUser('RiskSeller', mkEmail('seller'));
  sellerId = s._id;
  sellerToken = st;
  const { user: b, token: bt } = await createUser('RiskBuyer', mkEmail('buyer'));
  buyerId = b._id;
  buyerToken = bt;
});

afterAll(async () => {
  const re = /risk_test|Risk Test/;
  await Promise.all([
    User.deleteMany({ email: re }),
    Listing.deleteMany({ title: re }),
    Transaction.deleteMany({ $or: [{ listing: { $in: testListingIds } }, { buyer: { $in: testUserIds } }, { seller: { $in: testUserIds } }] }),
    Payout.deleteMany({ seller: { $in: testUserIds } }),
  ]);
  // Do NOT disconnect — jest.setup.js afterAll cleans DB between files
});

describe('Risk Controls & Fraud Detection', () => {

  // ============================
  // FIX #1: Return Window vs Payout Window Conflict
  // ============================
  describe('Fix #1: Return Window Protection (5-day hold from delivery)', () => {
    test('auto-complete blocked if less than 5 days since delivery', async () => {
      const txn = await createTransaction({ status: orderStates.BUYER_CONFIRMED });
      txn.buyerConfirmed = { received: true, confirmedAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000) }; // 4 days ago
      txn.shipping.actualDelivery = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000); // Only 3 days since delivery
      await txn.save();

      const seller = await User.findById(sellerId);
      seller.balance.pending = (seller.balance.pending || 0) + 92;
      await seller.save();

      const r = await request(app)
        .post(`/api/orders/${txn._id}/auto-complete`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({});

      expect(r.status).toBe(400);
      expect(r.body.reason).toBe('return_window_protection');
      expect(r.body.message).toMatch(/Return window still active/i);
    });

    test('auto-complete succeeds after 5 days from delivery', async () => {
      const txn = await createTransaction({ status: orderStates.BUYER_CONFIRMED });
      txn.buyerConfirmed = { received: true, confirmedAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000) };
      txn.shipping.actualDelivery = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000); // 6 days since delivery
      await txn.save();

      const seller = await User.findById(sellerId);
      seller.balance.pending = (seller.balance.pending || 0) + 92;
      seller.stats.totalSales = 10; // Ensure not a new seller (bypass new seller hold)
      await seller.save();

      const r = await request(app)
        .post(`/api/orders/${txn._id}/auto-complete`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({});

      expect(r.status).toBe(200);
      expect(r.body.message).toMatch(/Order completed/i);
    });
  });

  // ============================
  // FIX #2: 10% Rolling Seller Reserve
  // ============================
  describe('Fix #2: 10% Rolling Seller Reserve (60-day hold)', () => {
    test('10% of earnings held in reserve on auto-complete', async () => {
      const txn = await createTransaction({ status: orderStates.BUYER_CONFIRMED });
      txn.buyerConfirmed = { received: true, confirmedAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000) };
      txn.shipping.actualDelivery = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000);
      await txn.save();

      const seller = await User.findById(sellerId);
      const sellerEarnings = 92;
      // Capture initial values to check the difference (handles test isolation)
      const initialReserve = seller.balance.reserve || 0;
      const initialAvailable = seller.balance.available || 0;
      seller.balance.pending = sellerEarnings;
      seller.stats.totalSales = 10; // Not a new seller
      await seller.save();

      const r = await request(app)
        .post(`/api/orders/${txn._id}/auto-complete`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({});

      expect(r.status).toBe(200);

      const updatedSeller = await User.findById(sellerId);
      const expectedReserveAdded = Math.round(sellerEarnings * 0.10 * 100) / 100; // $9.20
      const expectedAvailableAdded = sellerEarnings - expectedReserveAdded; // $82.80

      // Check the difference (not absolute value) to handle test isolation
      const reserveAdded = updatedSeller.balance.reserve - initialReserve;
      const availableAdded = updatedSeller.balance.available - initialAvailable;

      expect(reserveAdded).toBe(expectedReserveAdded);
      expect(availableAdded).toBe(expectedAvailableAdded);
      expect(updatedSeller.balance.reserveReleaseDate).toBeDefined();
      expect(updatedSeller.balance.reserveReleaseDate.length).toBeGreaterThan(0);
    });

    test('reserve release date is 60 days from completion', async () => {
      const txn = await createTransaction({ status: orderStates.BUYER_CONFIRMED });
      txn.buyerConfirmed = { received: true, confirmedAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000) };
      txn.shipping.actualDelivery = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000);
      await txn.save();

      const seller = await User.findById(sellerId);
      seller.balance.pending = (seller.balance.pending || 0) + 92;
      seller.stats.totalSales = 10;
      await seller.save();

      await request(app)
        .post(`/api/orders/${txn._id}/auto-complete`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({});

      const updatedSeller = await User.findById(sellerId);
      const releaseDate = new Date(updatedSeller.balance.reserveReleaseDate[0].releaseDate);
      const expectedRelease = new Date(Date.now() + timeWindows.SELLER_RESERVE_HOLD_DAYS);
      
      // Allow 1 minute tolerance
      expect(Math.abs(releaseDate.getTime() - expectedRelease.getTime())).toBeLessThan(60000);
    });
  });

  // ============================
  // FIX #3: New Seller Risk Controls
  // ============================
  describe('Fix #3: New Seller Hold (first 5 sales held 14 days)', () => {
    test('new seller (less than 5 sales) funds held for 14 days', async () => {
      // Create a new seller
      const { user: newSeller, token: newSellerToken } = await createUser('NewRiskSeller', mkEmail('newseller'));
      
      const listing = await Listing.create({
        seller: newSeller._id, title: 'Risk Test Item New', description: 'Test',
        price: 100, category: 'Men', condition: 'New with tags',
        available: true, sold: false, quantity: 5, shipsFrom: 'US', weight: 1,
      });

      const txn = await Transaction.create({
        listing: listing._id, buyer: buyerId, seller: newSeller._id,
        itemPrice: 100, currency: 'USD',
        paymentBreakdown: { subtotal: 100, shippingCost: 10, buyerProtectionFee: 5, buyerProtectionPercent: 5, tax: 0, totalPaid: 115, platformFee: 8, platformFeePercent: 8, shippingPayout: 10, sellerEarnings: 92 },
        shippingAddress: { fullName: 'Test', street1: '123', city: 'Austin', state: 'TX', postalCode: '78701', country: 'US' },
        shipping: { carrier: 'USPS', trackingNumber: 'TEST', labelCreated: true, labelCreatedDate: new Date(), estimatedDelivery: new Date(), service: 'Priority', trackingHistory: [] },
        status: orderStates.BUYER_CONFIRMED,
        payout: { status: 'pending', transactionId: `pi_test_${Date.now()}` },
        buyerConfirmed: { received: true, confirmedAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000) },
      });
      txn.shipping.actualDelivery = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000);
      await txn.save();

      newSeller.balance.pending = 92;
      newSeller.stats.totalSales = 2; // Less than 5 sales
      await newSeller.save();

      const r = await request(app)
        .post(`/api/orders/${txn._id}/auto-complete`)
        .set('Authorization', `Bearer ${newSellerToken}`)
        .send({});

      expect(r.status).toBe(400);
      expect(r.body.reason).toBe('new_seller_hold');
      expect(r.body.message).toMatch(/New seller hold active/i);
    });

    test('established seller (5+ sales) can complete normally', async () => {
      const txn = await createTransaction({ status: orderStates.BUYER_CONFIRMED });
      txn.buyerConfirmed = { received: true, confirmedAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000) };
      txn.shipping.actualDelivery = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000);
      await txn.save();

      const seller = await User.findById(sellerId);
      seller.balance.pending = (seller.balance.pending || 0) + 92;
      seller.stats.totalSales = 10; // More than 5 sales
      await seller.save();

      const r = await request(app)
        .post(`/api/orders/${txn._id}/auto-complete`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({});

      expect(r.status).toBe(200);
    });
  });

  // ============================
  // FIX #5: High-Value Fee Cap
  // ============================
  describe('Fix #5: High-Value Fee Cap ($500)', () => {
    test('$5000 item pays $400 fee (8% capped at $500)', () => {
      const breakdown = calculatePaymentBreakdown(5000, 'US', 'US', 1);
      expect(breakdown.seller.platformFee).toBe(400); // 8% of $5000 = $400 (under $500 cap)
    });

    test('$10000 item pays $500 fee (8% would be $800, capped at $500)', () => {
      const breakdown = calculatePaymentBreakdown(10000, 'US', 'US', 1);
      expect(breakdown.seller.platformFee).toBe(500); // Capped at $500
    });

    test('$100 item pays $8 fee (8% under cap)', () => {
      const breakdown = calculatePaymentBreakdown(100, 'US', 'US', 1);
      expect(breakdown.seller.platformFee).toBe(8);
    });

    test('maxFee is $500 for USD', () => {
      expect(countryCommissions.US.maxFee).toBe(500);
    });

    test('maxFee is $400 for GBP', () => {
      expect(countryCommissions.GB.maxFee).toBe(400);
    });

    test('maxFee is $450 for EUR', () => {
      expect(countryCommissions.DE.maxFee).toBe(450);
      expect(countryCommissions.FR.maxFee).toBe(450);
    });
  });

  // ============================
  // FIX #8: Fraud Scoring System
  // ============================
  describe('Fix #8: Fraud Scoring System', () => {
    test('new seller gets high risk score', async () => {
      const { user: newSeller } = await createUser('FraudNewSeller', mkEmail('fraudnew'));
      const result = await calculateSellerRiskScore(newSeller._id);
      
      expect(result.score).toBeGreaterThanOrEqual(30); // At least new account penalty
      expect(result.factors.some(f => f.includes('new_account'))).toBe(true);
    });

    test('established seller with no strikes gets low risk score', async () => {
      const { user: goodSeller } = await createUser('GoodSeller', mkEmail('goodseller'), {
        createdAt: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000), // 1 year old
      });
      goodSeller.stats.totalSales = 50;
      goodSeller.stats.strikes = 0;
      await goodSeller.save();

      const result = await calculateSellerRiskScore(goodSeller._id);
      expect(result.score).toBeLessThan(40);
      expect(result.risk).toBe('low');
    });

    test('seller with strikes gets higher risk score', async () => {
      const { user: badSeller } = await createUser('BadSeller', mkEmail('badseller'), {
        createdAt: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000),
      });
      badSeller.stats.strikes = 2;
      await badSeller.save();

      const result = await calculateSellerRiskScore(badSeller._id);
      expect(result.score).toBeGreaterThanOrEqual(30); // 2 strikes * 15 = 30
      expect(result.factors).toContain('2_strikes');
    });

    test('buyer with high return rate gets flagged', async () => {
      const { user: returnBuyer } = await createUser('ReturnBuyer', mkEmail('returnbuyer'));
      returnBuyer.stats.totalPurchases = 10;
      returnBuyer.stats.totalReturns = 5; // 50% return rate
      await returnBuyer.save();

      // Create some return transactions
      for (let i = 0; i < 5; i++) {
        await Transaction.create({
          listing: new mongoose.Types.ObjectId(),
          buyer: returnBuyer._id,
          seller: sellerId,
          itemPrice: 100, currency: 'USD',
          paymentBreakdown: { subtotal: 100, shippingCost: 10, buyerProtectionFee: 5, buyerProtectionPercent: 5, tax: 0, totalPaid: 115, platformFee: 8, platformFeePercent: 8, shippingPayout: 10, sellerEarnings: 92 },
          shippingAddress: { fullName: 'Test', street1: '123', city: 'Austin', state: 'TX', postalCode: '78701', country: 'US' },
          shipping: { carrier: 'USPS', trackingNumber: `TEST${i}`, labelCreated: true, labelCreatedDate: new Date(), estimatedDelivery: new Date(), service: 'Priority', trackingHistory: [] },
          status: 'refunded',
          payout: { status: 'refunded' },
        });
      }

      const result = await calculateBuyerRiskScore(returnBuyer._id);
      expect(result.score).toBeGreaterThanOrEqual(30); // High return rate penalty
      expect(result.factors.some(f => f.includes('high_return_rate'))).toBe(true);
    });

    test('transaction risk assessment combines buyer and seller scores', async () => {
      const result = await assessTransactionRisk(buyerId, sellerId, 100);
      
      expect(result.score).toBeDefined();
      expect(result.risk).toBeDefined();
      expect(result.action).toBeDefined();
      expect(['low', 'medium', 'high']).toContain(result.risk);
      expect(['approve', 'monitor', 'review']).toContain(result.action);
    });

    test('high-value transaction gets additional risk', async () => {
      const result = await assessTransactionRisk(buyerId, sellerId, 5000);
      expect(result.factors.some(f => f.includes('very_high_value'))).toBe(true);
    });
  });

  // ============================
  // FIX #9: Return Abuse Tracking
  // ============================
  describe('Fix #9: Return Abuse Tracking', () => {
    test('buyer with low return rate is not flagged as abusive', async () => {
      const { user: goodBuyer } = await createUser('GoodBuyer', mkEmail('goodbuyer'));
      goodBuyer.stats.totalPurchases = 10;
      goodBuyer.stats.totalReturns = 1; // 10% return rate
      await goodBuyer.save();

      const result = await checkReturnAbuse(goodBuyer._id);
      expect(result.isAbusive).toBe(false);
    });

    test('buyer with high return rate is flagged as abusive', async () => {
      const { user: abusiveBuyer } = await createUser('AbusiveBuyer', mkEmail('abusivebuyer'));
      abusiveBuyer.stats.totalPurchases = 10;
      abusiveBuyer.stats.totalReturns = 5; // 50% return rate
      await abusiveBuyer.save();

      // Create return transactions
      for (let i = 0; i < 5; i++) {
        await Transaction.create({
          listing: new mongoose.Types.ObjectId(),
          buyer: abusiveBuyer._id,
          seller: sellerId,
          itemPrice: 100, currency: 'USD',
          paymentBreakdown: { subtotal: 100, shippingCost: 10, buyerProtectionFee: 5, buyerProtectionPercent: 5, tax: 0, totalPaid: 115, platformFee: 8, platformFeePercent: 8, shippingPayout: 10, sellerEarnings: 92 },
          shippingAddress: { fullName: 'Test', street1: '123', city: 'Austin', state: 'TX', postalCode: '78701', country: 'US' },
          shipping: { carrier: 'USPS', trackingNumber: `ABUSE${i}`, labelCreated: true, labelCreatedDate: new Date(), estimatedDelivery: new Date(), service: 'Priority', trackingHistory: [] },
          status: 'refunded',
          payout: { status: 'refunded' },
        });
      }

      const result = await checkReturnAbuse(abusiveBuyer._id);
      expect(result.isAbusive).toBe(true);
      expect(result.reason).toBe('high_return_rate');
      expect(result.returnRate).toBeGreaterThan(RISK_THRESHOLDS.HIGH_RETURN_RATE);
    });

    test('buyer with insufficient history is not flagged', async () => {
      const { user: newBuyer } = await createUser('NewBuyer', mkEmail('newbuyer'));
      newBuyer.stats.totalPurchases = 2; // Less than MIN_PURCHASES_FOR_RATE
      await newBuyer.save();

      const result = await checkReturnAbuse(newBuyer._id);
      expect(result.isAbusive).toBe(false);
      expect(result.reason).toBe('insufficient_history');
    });
  });
});