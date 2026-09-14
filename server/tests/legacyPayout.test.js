// Legacy Payout Normalization Tests
// Verifies the fix for Bug: legacy payout `amount` field incorrectly treated as salePrice
// instead of payoutAmount (net earnings). This caused dashboard totals to not add up.
const mongoose = require('mongoose');
const request = require('supertest');
const app = require('../server');
const authorizedPaymentIntent = require('./helpers/authorizedPayment');
const User = require('../models/User');
const Payout = require('../models/Payout');
const Transaction = require('../models/Transaction');
const Listing = require('../models/Listing');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';

async function createTestSeller(email) {
  const u = await User.create({
    name: 'Test Seller',
    email: email.toLowerCase(),
    password: 'password123',
    emailVerified: true,
    authProvider: 'email',
    country: 'US',
    currency: 'USD',
    shippingAddress: { fullName: 'Test', street1: '123 St', city: 'City', state: 'CA', postalCode: '90210', country: 'US' },
    balance: { available: 0, pending: 0, totalEarned: 0, totalPaidOut: 0, currency: 'USD' },
    stats: { totalSales: 0, totalPurchases: 0, strikes: 0 },
  });
  const token = require('jsonwebtoken').sign({ id: u._id }, JWT_SECRET, { expiresIn: '30d' });
  return { user: u, token };
}

async function createTestTransaction(sellerId) {
  const listing = await Listing.create({
    seller: sellerId,
    title: 'Test Item',
    description: 'Test',
    price: 100,
    category: 'Men',
    condition: 'New with tags',
    available: true,
    sold: false,
    quantity: 1,
    shipsFrom: 'US',
    weight: 1,
    currency: 'USD',
  });
  const buyer = await User.create({
    name: 'Test Buyer',
    email: `buyer_${Date.now()}@test.com`,
    password: 'password123',
    emailVerified: true,
    authProvider: 'email',
    country: 'US',
    currency: 'USD',
    shippingAddress: { fullName: 'Buyer', street1: '456 St', city: 'City', state: 'NY', postalCode: '10001', country: 'US' },
    balance: { available: 500, pending: 0, totalEarned: 0, totalPaidOut: 0, currency: 'USD' },
    stats: { totalSales: 0, totalPurchases: 0, strikes: 0 },
  });
  const buyerToken = require('jsonwebtoken').sign({ id: buyer._id }, JWT_SECRET, { expiresIn: '30d' });
  const r = await request(app)
    .post('/api/transactions')
    .set('Authorization', `Bearer ${buyerToken}`)
    .send({
      paymentIntentId: authorizedPaymentIntent(),
      listingId: listing._id,
      shippingAddress: { fullName: 'B', street1: '456 St', city: 'City', state: 'NY', postalCode: '10001', country: 'US' },
      buyerCountry: 'US',
    });
  await Listing.deleteOne({ _id: listing._id });
  await User.deleteOne({ _id: buyer._id });
  return r.body;
}

describe('Legacy Payout Normalization', () => {
  let sellerToken, sellerId;

  beforeAll(async () => {
    const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/trend-drop-test';
    if (mongoose.connection.readyState === 0) await mongoose.connect(uri);
    const s = await createTestSeller(`legacy_test_${Date.now()}@test.com`);
    sellerToken = s.token;
    sellerId = s.user._id;
  });

  afterAll(async () => {
    await Payout.deleteMany({ seller: sellerId });
    await Transaction.deleteMany({ seller: sellerId });
    await User.deleteMany({ _id: sellerId });
  });

  beforeEach(async () => {
    await Payout.deleteMany({ seller: sellerId });
    await Transaction.deleteMany({ seller: sellerId });
  });

  // TEST: Legacy payout with amount as net should normalize correctly
  test('LN.1 Legacy payout: amount=150 (net) → salePrice=163.04, commission=13.04, payout=150', async () => {
    // Create a legacy-style payout by bypassing Mongoose validation
    // (the legacy schema didn't require salePrice/commissionAmount/payoutAmount)
    await Payout.collection.insertOne({
      seller: sellerId,
      transaction: new mongoose.Types.ObjectId(),
      listing: new mongoose.Types.ObjectId(),
      amount: 150.00,        // Legacy: this is the NET payout (payoutAmount)
      currency: 'USD',
      status: 'completed',
      method: 'stripe',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const r = await request(app)
      .get('/api/payouts/dashboard')
      .set('Authorization', `Bearer ${sellerToken}`);

    expect(r.status).toBe(200);
    
    // After normalization: salePrice = 150 / 0.92 = 163.04
    const expectedSalePrice = Math.round(150 / (1 - 0.08) * 100) / 100;
    const expectedCommission = Math.round(expectedSalePrice * 0.08 * 100) / 100;
    
    expect(r.body.totalSales).toBeCloseTo(expectedSalePrice, 2);
    expect(r.body.totalCommission).toBeCloseTo(expectedCommission, 2);
    expect(r.body.totalEarnings).toBeCloseTo(150, 2);
    
    // INVARIANT: salePrice = commissionAmount + payoutAmount
    expect(r.body.totalSales).toBeCloseTo(
      r.body.totalCommission + r.body.totalEarnings, 2
    );
  });

  // TEST: Multiple legacy payouts sum correctly
  test('LN.2 Multiple legacy payouts: totals add up correctly', async () => {
    await Payout.collection.insertOne({
      seller: sellerId, transaction: new mongoose.Types.ObjectId(),
      listing: new mongoose.Types.ObjectId(), amount: 100, currency: 'USD',
      status: 'completed', createdAt: new Date(), updatedAt: new Date(),
    });
    await Payout.collection.insertOne({
      seller: sellerId, transaction: new mongoose.Types.ObjectId(),
      listing: new mongoose.Types.ObjectId(), amount: 200, currency: 'USD',
      status: 'completed', createdAt: new Date(), updatedAt: new Date(),
    });

    const r = await request(app)
      .get('/api/payouts/dashboard')
      .set('Authorization', `Bearer ${sellerToken}`);

    expect(r.status).toBe(200);
    
    // Total net payouts = 100 + 200 = 300
    expect(r.body.totalEarnings).toBeCloseTo(300, 2);
    
    // Total sales = 100/0.92 + 200/0.92 = 326.09
    const expectedTotalSales = Math.round((100 + 200) / (1 - 0.08) * 100) / 100;
    expect(r.body.totalSales).toBeCloseTo(expectedTotalSales, 2);
    
    // INVARIANT: totalSales = totalCommission + totalEarnings
    expect(r.body.totalSales).toBeCloseTo(
      r.body.totalCommission + r.body.totalEarnings, 2
    );
  });

  // TEST: Mixed legacy and modern payouts work together
  test('LN.3 Mixed legacy and modern payouts: both normalize correctly', async () => {
    // Create a modern payout (with explicit fields)
    const txn = await createTestTransaction(sellerId);
    await Payout.create({
      seller: sellerId, transaction: txn._id,
      listing: txn.listingId || txn.listing,
      salePrice: 100, commissionRate: 0.08, commissionAmount: 8, payoutAmount: 92,
      status: 'completed', paidAt: new Date(),
    });

    // Create a legacy payout
    await Payout.collection.insertOne({
      seller: sellerId, transaction: new mongoose.Types.ObjectId(),
      listing: new mongoose.Types.ObjectId(), amount: 50, currency: 'USD',
      status: 'completed', createdAt: new Date(), updatedAt: new Date(),
    });

    const r = await request(app)
      .get('/api/payouts/dashboard')
      .set('Authorization', `Bearer ${sellerToken}`);

    expect(r.status).toBe(200);
    
    // Modern: payout=92, Legacy: payout=50
    expect(r.body.totalEarnings).toBeCloseTo(92 + 50, 2);
    
    // INVARIANT: totalSales = totalCommission + totalEarnings
    expect(r.body.totalSales).toBeCloseTo(
      r.body.totalCommission + r.body.totalEarnings, 2
    );
  });

  // TEST: Pending legacy payouts included in pendingAmount
  test('LN.4 Pending legacy payout: correctly counted in pendingAmount', async () => {
    await Payout.collection.insertOne({
      seller: sellerId, transaction: new mongoose.Types.ObjectId(),
      listing: new mongoose.Types.ObjectId(), amount: 75, currency: 'USD',
      status: 'pending', createdAt: new Date(), updatedAt: new Date(),
    });

    const r = await request(app)
      .get('/api/payouts/dashboard')
      .set('Authorization', `Bearer ${sellerToken}`);

    expect(r.status).toBe(200);
    
    // Pending payout: payoutAmount = 75
    expect(r.body.pendingAmount).toBeCloseTo(75, 2);
    expect(r.body.pendingCount).toBe(1);
    
    // totalSales includes pending payouts
    const expectedTotalSales = Math.round(75 / (1 - 0.08) * 100) / 100;
    expect(r.body.totalSales).toBeCloseTo(expectedTotalSales, 2);
    
    // totalEarnings only includes completed (0 in this case)
    expect(r.body.totalEarnings).toBe(0);
    
    // INVARIANT holds for pending too: totalSales = totalCommission + pendingAmount (when no completed)
    expect(r.body.totalSales).toBeCloseTo(
      r.body.totalCommission + r.body.pendingAmount, 2
    );
  });

  // TEST: Edge case - very small amount
  test('LN.5 Legacy payout with small amount: normalization still works', async () => {
    await Payout.collection.insertOne({
      seller: sellerId, transaction: new mongoose.Types.ObjectId(),
      listing: new mongoose.Types.ObjectId(), amount: 10, currency: 'USD',
      status: 'completed', createdAt: new Date(), updatedAt: new Date(),
    });

    const r = await request(app)
      .get('/api/payouts/dashboard')
      .set('Authorization', `Bearer ${sellerToken}`);

    expect(r.status).toBe(200);
    
    // salePrice = 10 / 0.92 = 10.87
    const expectedSalePrice = Math.round(10 / (1 - 0.08) * 100) / 100;
    expect(r.body.totalSales).toBeCloseTo(expectedSalePrice, 2);
    expect(r.body.totalEarnings).toBeCloseTo(10, 2);
    
    // INVARIANT
    expect(r.body.totalSales).toBeCloseTo(
      r.body.totalCommission + r.body.totalEarnings, 2
    );
  });

  // TEST: Edge case - large amount
  test('LN.6 Legacy payout with large amount: normalization still works', async () => {
    await Payout.collection.insertOne({
      seller: sellerId, transaction: new mongoose.Types.ObjectId(),
      listing: new mongoose.Types.ObjectId(), amount: 5000, currency: 'USD',
      status: 'completed', createdAt: new Date(), updatedAt: new Date(),
    });

    const r = await request(app)
      .get('/api/payouts/dashboard')
      .set('Authorization', `Bearer ${sellerToken}`);

    expect(r.status).toBe(200);
    
    // salePrice = 5000 / 0.92 = 5434.78
    const expectedSalePrice = Math.round(5000 / (1 - 0.08) * 100) / 100;
    expect(r.body.totalSales).toBeCloseTo(expectedSalePrice, 2);
    expect(r.body.totalEarnings).toBeCloseTo(5000, 2);
    expect(r.body.totalCommission).toBeCloseTo(Math.round(expectedSalePrice * 0.08 * 100) / 100, 2);
    
    // INVARIANT
    expect(r.body.totalSales).toBeCloseTo(
      r.body.totalCommission + r.body.totalEarnings, 2
    );
  });

  // TEST: Payouts created with OLD buggy formula (salePrice=amount, payout=amount-amount*0.08)
  // These need to be detected and fixed on read
  test('LN.7 Old buggy payouts: detected and corrected on read', async () => {
    // Simulate a payout created with the OLD buggy code:
    // salePrice was set to amount (wrong), payoutAmount was amount - amount*0.08 (wrong)
    const buggyAmount = 200;
    const buggySalePrice = buggyAmount;  // OLD BUG: treated amount as salePrice
    const buggyCommission = Math.round(buggyAmount * 0.08 * 100) / 100;  // 16
    const buggyPayout = Math.round((buggyAmount - buggyCommission) * 100) / 100;  // 184
    
    await Payout.collection.insertOne({
      seller: sellerId,
      transaction: new mongoose.Types.ObjectId(),
      listing: new mongoose.Types.ObjectId(),
      amount: buggyAmount,
      salePrice: buggySalePrice,      // BUG: should be 217.39, not 200
      commissionAmount: buggyCommission, // BUG: should be 17.39, not 16
      payoutAmount: buggyPayout,        // BUG: should be 200, not 184
      currency: 'USD',
      status: 'completed',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const r = await request(app)
      .get('/api/payouts/dashboard')
      .set('Authorization', `Bearer ${sellerToken}`);

    expect(r.status).toBe(200);
    
    // After correction:
    // salePrice should = 200 / 0.92 = 217.39
    // commission should = 217.39 * 0.08 = 17.39
    // payout should = 200 (the amount)
    const expectedSalePrice = Math.round(buggyAmount / (1 - 0.08) * 100) / 100;
    expect(r.body.totalSales).toBeCloseTo(expectedSalePrice, 2);
    expect(r.body.totalEarnings).toBeCloseTo(buggyAmount, 2);  // Should be 200, not 184
    expect(r.body.totalCommission).toBeCloseTo(Math.round(expectedSalePrice * 0.08 * 100) / 100, 2);
    
    // INVARIANT: totalSales = totalCommission + totalEarnings
    expect(r.body.totalSales).toBeCloseTo(
      r.body.totalCommission + r.body.totalEarnings, 2
    );
  });
});