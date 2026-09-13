/**
 * PAYOUT COMMISSION PARITY — regression for Bug B4.
 *
 * The legacy POST /api/shipping/confirm-received endpoint auto-creates a
 * Payout record when a transaction has none. It historically used a hardcoded
 * 10% commission while the platform fee is 8% everywhere else
 * (config/payments.js countryCommissions + routes/payouts.js COMMISSION_RATE),
 * so any transaction missing a payout would overpay the seller by 2%.
 */
const mongoose = require('mongoose');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../server');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Transaction = require('../models/Transaction');
const Payout = require('../models/Payout');

const SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';
const RUN = `pc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
const mkEmail = (p) => `${p}_${RUN}@test.com`;

let seller, buyer, buyerToken;
const testUserIds = [];
const testListingIds = [];

async function mkUser(name, p) {
  const u = await User.create({
    name, email: mkEmail(p), password: 'password123', emailVerified: true, authProvider: 'email',
    country: 'US', currency: 'USD',
    shippingAddress: { fullName: name, street1: '1 St', city: 'C', state: 'S', postalCode: '00000', country: 'US' },
    balance: { available: 0, pending: 0, totalEarned: 0, totalPaidOut: 0, currency: 'USD' },
    stats: { totalSales: 5, totalPurchases: 0, strikes: 0 },
  });
  testUserIds.push(u._id);
  return u;
}

async function mkListing() {
  const l = await Listing.create({
    seller: seller._id, title: `PC Item ${RUN}`, description: 'd', price: 100,
    category: 'Men', condition: 'New with tags', available: true, sold: false,
    quantity: 5, shipsFrom: 'US', currency: 'USD',
  });
  testListingIds.push(l._id);
  return l;
}

// A paid transaction with NO Payout record — the exact case the legacy
// confirm-received path tries to repair by auto-creating one.
async function mkPaidTxnWithoutPayout() {
  const listing = await mkListing();
  return Transaction.create({
    listing: listing._id,
    buyer: buyer._id,
    seller: seller._id,
    itemPrice: 100,
    currency: 'USD',
    paymentBreakdown: { subtotal: 100, shippingCost: 5, buyerProtectionFee: 5, buyerProtectionPercent: 5, tax: 0, totalPaid: 110, platformFee: 8, platformFeePercent: 8, shippingPayout: 5, sellerEarnings: 92 },
    shippingAddress: { fullName: 'PC Buyer', street1: '1 St', city: 'C', state: 'S', postalCode: '00000', country: 'US' },
    status: 'shipped',
    payout: { status: 'pending', transactionId: `pi_pc_${Date.now()}` },
  });
}

beforeAll(async () => {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/trenddrop_test');
  }
  seller = await mkUser('PC Seller', 'seller');
  buyer = await mkUser('PC Buyer', 'buyer');
  buyerToken = jwt.sign({ id: buyer._id }, SECRET, { expiresIn: '30d' });
});

afterAll(async () => {
  await Transaction.deleteMany({ $or: [{ buyer: { $in: testUserIds } }, { seller: { $in: testUserIds } }] });
  await Payout.deleteMany({ seller: { $in: testUserIds } });
  await Listing.deleteMany({ _id: { $in: testListingIds } });
  await User.deleteMany({ _id: { $in: testUserIds } });
});

describe('PC · Legacy confirm-received payout uses the 8% platform commission', () => {
  test('PC.1 auto-created payout matches the 8% platform rate (not 10%)', async () => {
    const txn = await mkPaidTxnWithoutPayout();
    const res = await request(app)
      .post('/api/shipping/confirm-received')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ transactionId: txn._id });
    expect(res.status).toBe(200);

    const payout = await Payout.findOne({ transaction: txn._id });
    expect(payout).toBeTruthy();
    // Platform commission is 8% (config/payments.js + routes/payouts.js).
    expect(payout.commissionRate).toBe(0.08);
    // salePrice here is totalPaid (110) per legacy contract; commission 8% of that.
    expect(Math.round(payout.commissionAmount * 100) / 100).toBe(Math.round(110 * 0.08 * 100) / 100);
    expect(Math.round(payout.payoutAmount * 100) / 100).toBe(Math.round((110 - 110 * 0.08) * 100) / 100);
  });

  test('PC.2 existing checkout-created payout is NOT overwritten', async () => {
    const txn = await mkPaidTxnWithoutPayout();
    // The checkout flow already created the payout at 8%.
    const existing = await Payout.create({
      seller: seller._id, transaction: txn._id, listing: txn.listing,
      salePrice: 100, commissionRate: 0.08, commissionAmount: 8, payoutAmount: 92, status: 'pending',
    });
    const res = await request(app)
      .post('/api/shipping/confirm-received')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ transactionId: txn._id });
    expect(res.status).toBe(200);
    const payout = await Payout.findById(existing._id);
    expect(payout.commissionRate).toBe(0.08);
    expect(payout.commissionAmount).toBe(8);
    const count = await Payout.countDocuments({ transaction: txn._id });
    expect(count).toBe(1);
  });
});
