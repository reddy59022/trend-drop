/**
 * Dashboard Accuracy & Revenue-Protection Tests
 *
 * The seller payout dashboard must reconcile EXACTLY: every gross sales
 * dollar is either platform revenue (commission + boost fees + other
 * platform share) or seller payout. Regression coverage for:
 *   - legacy payout docs where `amount` = seller NET (not gross)
 *   - old buggy payout docs (salePrice = amount, payout = amount − 8%·amount)
 *   - payouts that already contain the platform's cut (boost fees included)
 *   - completed transactions that have no payout record yet
 *   - /api/payouts/balance agreeing with /api/payouts/dashboard
 */
const mongoose = require('mongoose');
const request = require('supertest');
const app = require('../server');
const User = require('../models/User');
const Payout = require('../models/Payout');
const Transaction = require('../models/Transaction');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';
const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;

async function createSeller() {
  const u = await User.create({
    name: 'Accuracy Seller',
    email: `accuracy_${Date.now()}_${Math.random().toString(36).slice(2, 7)}@test.com`,
    password: 'password123',
    emailVerified: true,
    authProvider: 'email',
    country: 'US',
    currency: 'USD',
    shippingAddress: { fullName: 'A', street1: '1 St', city: 'C', state: 'CA', postalCode: '90210', country: 'US' },
    balance: { available: 0, pending: 0, totalEarned: 0, totalPaidOut: 0, currency: 'USD' },
    stats: { totalSales: 0, totalPurchases: 0, strikes: 0 },
  });
  const token = require('jsonwebtoken').sign({ id: u._id }, JWT_SECRET, { expiresIn: '30d' });
  return { user: u, token };
}

const oid = () => new mongoose.Types.ObjectId();

async function insertLegacyPayout(sellerId, { amount, status }) {
  await Payout.collection.insertOne({
    seller: sellerId, transaction: oid(), listing: oid(),
    amount, currency: 'USD', status,
    createdAt: new Date(), updatedAt: new Date(),
  });
}

describe('Dashboard Accuracy & Revenue Protection', () => {
  let sellerToken, sellerId;

  beforeAll(async () => {
    const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/trend-drop-test';
    if (mongoose.connection.readyState === 0) await mongoose.connect(uri);
    const s = await createSeller();
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

  async function getDashboard() {
    const r = await request(app).get('/api/payouts/dashboard').set('Authorization', `Bearer ${sellerToken}`);
    expect(r.status).toBe(200);
    return r.body;
  }

  // ─────────────────────────────────────────────────────────────
  // PROD FIGURE REGRESSION — the shape reported for reddy59021@gmail.com.
  // Legacy seed-era test data is imperfect by nature, but the revenue
  // invariant must still hold EXACTLY on it: Total Sales =
  // Platform Cut + Seller Payouts, to the cent, no float ghosts.
  test('DA.0 reported prod shape reconciles exactly (gross = cut + payouts)', async () => {
    // legacy completed net 150 → gross 163.04 / cut 13.04 / net 150
    await insertLegacyPayout(sellerId, { amount: 150, status: 'completed' });
    // two pending legacy nets reproducing the pending-heavy reported shape
    await insertLegacyPayout(sellerId, { amount: 2500, status: 'pending' });
    await insertLegacyPayout(sellerId, { amount: 1795.6, status: 'pending' });

    const d = await getDashboard();

    // Seller-visible numbers.
    expect(d.totalEarnings).toBe(150);
    expect(d.pendingAmount).toBe(4295.6);
    // Gross is the sum of per-payout gross legs in cents (no float drift).
    const expectedGross = round2(163.04 + round2(2500 / 0.92) + round2(1795.6 / 0.92));
    expect(d.totalSales).toBe(expectedGross);
    // THE invariant — exact, integer-cent equality:
    expect(d.reconciledTotalSales).toBe(d.totalSales);
    expect(round2(d.totalCommission + d.totalPayouts)).toBe(d.totalSales);
    expect(d.totalCommission).toBe(round2(d.totalSales - d.totalPayouts));
    // Earnings + pending partition the seller's total exactly.
    expect(round2(d.totalEarnings + d.pendingAmount)).toBe(d.totalPayouts);
  });

  // ─────────────────────────────────────────────────────────────
  // FLOAT-GHOST GUARD — many small payouts must still reconcile exactly.
  // Summing round2() per row in floats can drift by cents; cents-math cannot.
  test('DA.0b 37 small payouts reconcile exactly (no float drift)', async () => {
    for (let i = 0; i < 37; i++) {
      await Payout.create({
        seller: sellerId, transaction: oid(), listing: oid(),
        salePrice: 19.99, commissionRate: 0.08, commissionAmount: 1.6,
        payoutAmount: 18.39, status: i % 2 ? 'completed' : 'pending',
      });
    }
    const d = await getDashboard();
    expect(d.reconciledTotalSales).toBe(d.totalSales);
    expect(round2(d.totalCommission + d.totalPayouts)).toBe(d.totalSales);
    expect(d.totalSales).toBe(round2(19.99 * 37));
  });


  // ─────────────────────────────────────────────────────────────
  test('DA.1 legacy seed-like dataset reconciles exact numbers', async () => {
    // Seed-style legacy payout (only `amount` = the NET the seller received).
    await insertLegacyPayout(sellerId, { amount: 150, status: 'completed' });
    await insertLegacyPayout(sellerId, { amount: 100, status: 'pending' });

    const d = await getDashboard();

    // legacy 150 → salePrice 163.04, commission 13.04, payout 150
    // legacy 100 → salePrice 108.70, commission 8.70,  payout 100
    expect(d.totalSales).toBe(round2(163.04 + 108.70));      // 271.74
    expect(d.totalEarnings).toBe(150);                       // completed payout only
    expect(d.totalCommission).toBe(round2(13.04 + 8.70));    // 21.74
    expect(d.pendingAmount).toBe(100);
    expect(d.totalPayouts).toBe(250);                        // 150 + 100
    expect(d.totalSalesCount).toBe(1);
    expect(d.pendingCount).toBe(1);

    // Revenue invariant: every gross dollar is platform revenue or seller money.
    expect(d.reconciledTotalSales).toBe(d.totalSales);
    expect(d.totalSales).toBe(d.totalCommission + d.totalPayouts);
  });

  // ─────────────────────────────────────────────────────────────
  test('DA.2 modern + old-buggy + legacy payouts all reconcile', async () => {
    // Modern (correct) completed payout.
    await Payout.create({
      seller: sellerId, transaction: oid(), listing: oid(),
      salePrice: 100, commissionRate: 0.08, commissionAmount: 8, payoutAmount: 92,
      status: 'completed', paidAt: new Date(),
    });
    // Old-buggy formula: salePrice=amount, payout=amount − 8%·amount (must be corrected).
    await Payout.collection.insertOne({
      seller: sellerId, transaction: oid(), listing: oid(),
      amount: 200, salePrice: 200, commissionAmount: 16, payoutAmount: 184,
      currency: 'USD', status: 'completed', createdAt: new Date(), updatedAt: new Date(),
    });
    // Pure legacy pending payout.
    await insertLegacyPayout(sellerId, { amount: 75, status: 'pending' });

    const d = await getDashboard();

    expect(d.totalSales).toBe(round2(100 + 217.39 + 81.52)); // 398.91
    expect(d.totalCommission).toBe(round2(8 + 17.39 + 6.52));// 31.91
    expect(d.totalEarnings).toBe(292);                        // 92 + 200
    expect(d.pendingAmount).toBe(75);
    expect(d.totalPayouts).toBe(367);                         // 92 + 200 + 75

    expect(d.reconciledTotalSales).toBe(d.totalSales);
    expect(d.totalSales).toBe(d.totalCommission + d.totalPayouts);
  });
// ─────────────────────────────────────────────────────────────
  test('DA.3 boost-fee payout reports the platform cut (no revenue leak)', async () => {
    // Payout with a boost fee: sellerEarnings was 184, $7 boost deducted → payout 177.
    // Platform actually keeps 23 (8% commission 16 + boost 7), NOT just 16.
    await Payout.collection.insertOne({
      seller: sellerId, transaction: oid(), listing: oid(),
      salePrice: 200, commissionAmount: 16, payoutAmount: 177,
      currency: 'USD', status: 'completed', createdAt: new Date(), updatedAt: new Date(),
    });

    const d = await getDashboard();

    expect(d.totalSales).toBe(200);
    expect(d.totalCommission).toBe(23);   // 16 fee + 7 boost — the real platform cut
    expect(d.totalEarnings).toBe(177);
    expect(d.totalPayouts).toBe(177);

    expect(d.reconciledTotalSales).toBe(d.totalSales);
    expect(d.totalSales).toBe(d.totalCommission + d.totalPayouts);
  });

  // ─────────────────────────────────────────────────────────────
  test('DA.4 completed transaction without a payout record feeds pending only', async () => {
    // One documented payout…
    await Payout.create({
      seller: sellerId, transaction: oid(), listing: oid(),
      salePrice: 100, commissionRate: 0.08, commissionAmount: 8, payoutAmount: 92,
      status: 'completed', paidAt: new Date(),
    });
    // …and one completed transaction with NO payout record yet. It counts as
    // pending (its seller earnings) but does NOT enter the recorded totals —
    // the documented totalSales contract is over payout docs only.
    await Transaction.create({
      seller: sellerId, buyer: oid(), listing: oid(),
      itemPrice: 50, currency: 'USD', status: 'completed',
      paymentBreakdown: { subtotal: 50, totalPaid: 50, shippingCost: 0, buyerProtectionFee: 0, tax: 0, platformFee: 4, sellerEarnings: 46 },
    });

    const d = await getDashboard();

    expect(d.totalSales).toBe(100);          // payout docs only
    expect(d.totalCommission).toBe(8);
    expect(d.totalEarnings).toBe(92);        // completed payout only
    expect(d.pendingAmount).toBe(46);        // orphan seller earnings feed pending
    expect(d.totalPayouts).toBe(92);
    expect(d.pendingCount).toBe(1);
    // Audit field keeps the full gross recognisable for platform accounting.
    expect(d.salesWithoutPayoutRecord).toBe(50);

    expect(d.reconciledTotalSales).toBe(d.totalSales);
    expect(d.totalSales).toBe(d.totalCommission + d.totalPayouts);
  });

  // ─────────────────────────────────────────────────────────────
  test('DA.5 balance endpoint agrees with dashboard for legacy/buggy payouts', async () => {
    await insertLegacyPayout(sellerId, { amount: 150, status: 'completed' });
    await Payout.collection.insertOne({
      seller: sellerId, transaction: oid(), listing: oid(),
      amount: 200, salePrice: 200, commissionAmount: 16, payoutAmount: 184,
      currency: 'USD', status: 'completed', createdAt: new Date(), updatedAt: new Date(),
    });

    const dash = await getDashboard();
    const bal = (await request(app).get('/api/payouts/balance').set('Authorization', `Bearer ${sellerToken}`)).body;

    expect(dash.totalEarnings).toBe(350);      // 150 + 200 (buggy corrected)
    expect(bal.totalEarned).toBe(dash.totalEarnings);
    expect(bal.availableBalance).toBe(dash.availableBalance);
    // Platform cut also consistent: (163.04−150) + (217.39−200) = 13.04 + 17.39
    expect(bal.totalCommissionPaid).toBe(round2(13.04 + 17.39));
  });
});