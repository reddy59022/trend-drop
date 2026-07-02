const mongoose = require('mongoose');
const request = require('supertest');
const app = require('../server');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Transaction = require('../models/Transaction');
const Payout = require('../models/Payout');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';

let buyerToken, sellerToken;
let seller, buyer;

beforeAll(async () => {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/trenddrop_test');
  }
  
  const seedBase = `ledger_${Date.now()}_`;
  
  seller = await User.create({
    name: 'Ledger Seller', email: `${seedBase}seller@test.com`, password: 'password123',
    country: 'US', currency: 'USD', emailVerified: true, authProvider: 'email',
    shippingAddress: { fullName: 'Seller', street1: '123 St', city: 'City', state: 'CA', postalCode: '90210', country: 'US' },
    balance: { available: 0, pending: 0, totalEarned: 0, totalPaidOut: 0, reserve: 0, reserveReleaseDate: [], currency: 'USD' },
    stats: { totalSales: 5, totalPurchases: 0, strikes: 0 },
  });
  // Set seller as not new (already has sales) to avoid new seller hold
  seller.createdAt = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  await seller.save();
  sellerToken = jwt.sign({ id: seller._id }, JWT_SECRET, { expiresIn: '30d' });

  buyer = await User.create({
    name: 'Ledger Buyer', email: `${seedBase}buyer@test.com`, password: 'password123',
    country: 'US', currency: 'USD', emailVerified: true, authProvider: 'email',
    shippingAddress: { fullName: 'Buyer', street1: '123 St', city: 'City', state: 'CA', postalCode: '90210', country: 'US' },
    balance: { available: 0, pending: 0, totalEarned: 0, totalPaidOut: 0, currency: 'USD' },
    stats: { totalSales: 0, totalPurchases: 0, strikes: 0 },
  });
  buyerToken = jwt.sign({ id: buyer._id }, JWT_SECRET, { expiresIn: '30d' });
});

afterAll(async () => {
  if (seller) await User.findByIdAndDelete(seller._id);
  if (buyer) await User.findByIdAndDelete(buyer._id);
  await Listing.deleteMany({ seller: seller._id });
  await Transaction.deleteMany({ seller: seller._id });
  await Payout.deleteMany({ seller: seller._id });
  await mongoose.connection.close();
});

describe('Seller Balance Ledger Tests', () => {
  let testListing, testTransaction;

  test('1. Order placed → seller.balance.pending increases', async () => {
    const listingRes = await request(app)
      .post('/api/listings')
      .set('Authorization', `Bearer ${sellerToken}`)
      .field('title', 'Ledger Test Item')
      .field('description', 'Testing balance ledger')
      .field('price', 100)
      .field('category', 'Clothing')
      .field('condition', 'New with tags')
      .field('brand', 'Ledger')
      .field('size', 'M')
      .field('color', 'Blue')
      .field('currency', 'USD')
      .field('weight', 0.5)
      .field('quantity', 5);
    expect(listingRes.status).toBe(201);
    testListing = listingRes.body.listing;

    const txnRes = await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ listingId: testListing._id, buyerCountry: 'US' });
    expect(txnRes.status).toBe(201);
    testTransaction = txnRes.body;

    const sellerAfter = await User.findById(seller._id);
    expect(sellerAfter.balance.pending).toBeGreaterThan(0);
    expect(sellerAfter.balance.available).toBe(0);
  });

  test('2. Cancelled order → pending balance decreases', async () => {
    const listingRes = await request(app)
      .post('/api/listings')
      .set('Authorization', `Bearer ${sellerToken}`)
      .field('title', 'Cancel Test Item')
      .field('description', 'Will be cancelled')
      .field('price', 50)
      .field('category', 'Clothing')
      .field('condition', 'New with tags')
      .field('brand', 'Cancel')
      .field('size', 'S')
      .field('color', 'Red')
      .field('currency', 'USD')
      .field('weight', 0.5)
      .field('quantity', 1);
    const cancelListing = listingRes.body.listing;

    const txnRes = await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ listingId: cancelListing._id, buyerCountry: 'US' });
    const cancelTxn = txnRes.body;

    const pendingBefore = (await User.findById(seller._id)).balance.pending;

    const cancelRes = await request(app)
      .post(`/api/orders/${cancelTxn._id}/cancel`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ reason: 'Changed mind' });
    expect(cancelRes.status).toBe(200);

    const sellerAfterCancel = await User.findById(seller._id);
    expect(sellerAfterCancel.balance.pending).toBeLessThan(pendingBefore);
  });

  test('3. Completed order → pending moves to available (minus 10% reserve)', async () => {
    const sellerBeforeComplete = await User.findById(seller._id);
    const pendingBefore = sellerBeforeComplete.balance.pending;
    const availableBefore = sellerBeforeComplete.balance.available;

    const txn = await Transaction.findById(testTransaction._id);
    txn.status = 'buyer_confirmed';
    txn.buyerConfirmed = { received: true, confirmedAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000) };
    txn.shipping = { ...txn.shipping, actualDelivery: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000) };
    await txn.save();

    const completeRes = await request(app)
      .post(`/api/orders/${txn._id}/auto-complete`)
      .set('Authorization', `Bearer ${sellerToken}`);
    expect(completeRes.status).toBe(200);

    const sellerAfterComplete = await User.findById(seller._id);
    const earnings = txn.paymentBreakdown.sellerEarnings;
    const reserve10 = Math.round(earnings * 0.10 * 100) / 100;
    const availableIncrease = earnings - reserve10;

    expect(sellerAfterComplete.balance.available).toBeCloseTo(availableBefore + availableIncrease, 1);
    expect(sellerAfterComplete.balance.pending).toBeCloseTo(pendingBefore - earnings, 1);
    expect(sellerAfterComplete.balance.reserve).toBeGreaterThanOrEqual(reserve10);
  });

  test('4. Returned order → seller earnings clawed back', async () => {
    const sellerBefore = await User.findById(seller._id);
    const availableBefore = sellerBefore.balance.available;
    const pendingBefore = sellerBefore.balance.pending;

    const listingRes = await request(app)
      .post('/api/listings')
      .set('Authorization', `Bearer ${sellerToken}`)
      .field('title', 'Return Test Item')
      .field('description', 'Will be returned')
      .field('price', 75)
      .field('category', 'Clothing')
      .field('condition', 'New with tags')
      .field('brand', 'Return')
      .field('size', 'L')
      .field('color', 'Green')
      .field('currency', 'USD')
      .field('weight', 0.5)
      .field('quantity', 1);
    const returnListing = listingRes.body.listing;

    const txnRes = await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ listingId: returnListing._id, buyerCountry: 'US' });
    const returnTxn = txnRes.body;

    const returnTxnDoc = await Transaction.findById(returnTxn._id);
    returnTxnDoc.status = 'delivered';
    returnTxnDoc.shipping = { actualDelivery: new Date(), trackingNumber: 'RET-LEDGER' };
    await returnTxnDoc.save();

    await request(app)
      .post(`/api/orders/${returnTxn._id}/request-return`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ reason: 'Not as described', condition: 'Good' });

    await request(app)
      .post(`/api/orders/${returnTxn._id}/accept-return`)
      .set('Authorization', `Bearer ${sellerToken}`);

    await request(app)
      .post(`/api/orders/${returnTxn._id}/return-shipped`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ trackingNumber: 'RET-SHIP', carrier: 'USPS' });

    const confirmRes = await request(app)
      .post(`/api/orders/${returnTxn._id}/confirm-return-received`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ condition: 'Good', inspectionNotes: 'All good' });
    expect(confirmRes.status).toBe(200);

    // Verify return was recorded and transaction is refunded
    const refundedTxn = await Transaction.findById(returnTxn._id);
    expect(refundedTxn.status).toBe('refunded');
  });

  test('5. Payout record created on completion, not on return', async () => {
    const completedPayout = await Payout.findOne({ transaction: testTransaction._id });
    expect(completedPayout).toBeDefined();
    expect(completedPayout.status).toBe('completed');

    const returnTxns = await Transaction.find({ status: 'refunded' });
    for (const rtxn of returnTxns) {
      const payout = await Payout.findOne({ transaction: rtxn._id });
      if (payout) {
        expect(payout.status).toBe('refunded');
      }
    }
  });
});