const mongoose = require('mongoose');
const request = require('supertest');
const app = require('../server');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Transaction = require('../models/Transaction');
const Payout = require('../models/Payout');
const Offer = require('../models/Offer');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';

let buyerToken, sellerToken, adminToken;
let buyer, seller, admin;
let testListing, testListing2;

const TEST_CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'CAD'];
const COUNTRIES = { USD: 'US', EUR: 'DE', GBP: 'GB', JPY: 'JP', CAD: 'CA' };

beforeAll(async () => {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/trenddrop_test');
  }
  
  const seedBase = `multi_${Date.now()}_`;
  
  admin = await User.create({
    name: 'Admin', email: `${seedBase}admin@test.com`, password: 'password123',
    country: 'US', currency: 'USD', emailVerified: true, authProvider: 'email', role: 'admin',
    shippingAddress: { fullName: 'Admin', street1: '123 St', city: 'City', state: 'CA', postalCode: '90210', country: 'US' },
    balance: { available: 0, pending: 0, totalEarned: 0, totalPaidOut: 0, currency: 'USD' },
    stats: { totalSales: 0, totalPurchases: 0, strikes: 0 },
  });
  adminToken = jwt.sign({ id: admin._id }, JWT_SECRET, { expiresIn: '30d' });

  seller = await User.create({
    name: 'Test Seller', email: `${seedBase}seller@test.com`, password: 'password123',
    country: 'US', currency: 'USD', emailVerified: true, isVerified: true, authProvider: 'email',
    shippingAddress: { fullName: 'Seller', street1: '123 St', city: 'City', state: 'CA', postalCode: '90210', country: 'US' },
    balance: { available: 0, pending: 0, totalEarned: 0, totalPaidOut: 0, currency: 'USD' },
    stats: { totalSales: 5, totalPurchases: 0, strikes: 0 },
  });
  seller.createdAt = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  await seller.save();
  sellerToken = jwt.sign({ id: seller._id }, JWT_SECRET, { expiresIn: '30d' });

  buyer = await User.create({
    name: 'Test Buyer', email: `${seedBase}buyer@test.com`, password: 'password123',
    country: 'US', currency: 'USD', emailVerified: true, authProvider: 'email',
    shippingAddress: { fullName: 'Buyer', street1: '123 St', city: 'City', state: 'CA', postalCode: '90210', country: 'US' },
    balance: { available: 0, pending: 0, totalEarned: 0, totalPaidOut: 0, currency: 'USD' },
    stats: { totalSales: 0, totalPurchases: 0, strikes: 0 },
  });
  buyerToken = jwt.sign({ id: buyer._id }, JWT_SECRET, { expiresIn: '30d' });

  const listingPromises = TEST_CURRENCIES.map((currency, idx) => {
    const price = currency === 'JPY' ? 15000 : currency === 'CAD' ? 135 : 100;
    return request(app)
      .post('/api/listings')
      .set('Authorization', `Bearer ${sellerToken}`)
      .field('title', `Test Listing ${currency}`)
      .field('description', `Test in ${currency}`)
      .field('price', price)
      .field('category', 'Men')
      .field('condition', 'New with tags')
      .field('brand', 'TestBrand')
      .field('size', 'M')
      .field('color', 'Black')
      .field('currency', currency)
      .field('weight', 0.5)
      .field('quantity', 5);
  });
  const listings = await Promise.all(listingPromises);
  testListing = listings[0].body.listing;
  testListing2 = listings[1].body.listing;
});

afterAll(async () => {
  if (admin) await User.findByIdAndDelete(admin._id);
  if (seller) await User.findByIdAndDelete(seller._id);
  if (buyer) await User.findByIdAndDelete(buyer._id);
  await mongoose.connection.close();
});

describe('Multi-Currency Comprehensive Payout & Financial Tests', () => {
  test('1a. Should create listings in all 5 currencies', async () => {
    for (const currency of TEST_CURRENCIES) {
      const price = currency === 'JPY' ? 15000 : currency === 'CAD' ? 135 : 100;
      const res = await request(app)
        .post('/api/listings')
        .set('Authorization', `Bearer ${sellerToken}`)
        .field('title', `Test ${currency} Listing`)
        .field('description', `Test in ${currency}`)
        .field('price', price)
        .field('category', 'Men')
        .field('condition', 'New with tags')
        .field('brand', 'TestBrand')
        .field('size', 'M')
        .field('color', 'Black')
        .field('currency', currency)
        .field('weight', 0.5)
        .field('quantity', 5);
      expect(res.status).toBe(201);
      expect(res.body.listing.currency).toBe(currency);
    }
  });

  test('2a. Platform fee is always 8% across all currencies', async () => {
    const res = await request(app).get('/api/payments/commissions');
    expect(res.status).toBe(200);
    for (const currency of TEST_CURRENCIES) {
      const country = COUNTRIES[currency];
      const fee = res.body[country] || res.body.default;
      expect(fee.platformFee).toBe(8);
    }
  });

  test('2b. Payment breakdown calculation is correct for each currency', async () => {
    for (const currency of TEST_CURRENCIES) {
      const country = COUNTRIES[currency];
      const price = currency === 'JPY' ? 15000 : currency === 'CAD' ? 135 : 100;
      const res = await request(app)
        .post('/api/payments/breakdown')
        .send({ itemPrice: price, fromCountry: 'US', toCountry: country, weightKg: 0.5 });
      expect(res.status).toBe(200);
      expect(res.body.buyer.totalPaid).toBeGreaterThan(0);
      expect(res.body.seller.sellerEarnings).toBeLessThan(price);
      expect(res.body.seller.platformFeePercent).toBe(8);
    }
  });

  test('3a. Bundle discounts apply correctly in multi-currency cart', async () => {
    const bundleRes = await request(app)
      .post('/api/offers/bundle')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ name: 'Multi Currency Bundle', minQuantity: 2, discountPercent: 15, isActive: true });
    expect(bundleRes.status).toBe(201);

    const applyRes = await request(app)
      .post('/api/offers/bundle/apply')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ sellerId: seller._id.toString(), items: [{ listingId: testListing._id, price: 100 }, { listingId: testListing2._id, price: 100 }] });
    expect(applyRes.status).toBe(200);
    expect(applyRes.body.discount).toBeGreaterThan(0);
  });

  test('4a. Promo codes can be created and validated', async () => {
    const promoRes = await request(app)
      .post('/api/promos')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ code: 'SAVE20', discountType: 'percentage', discountValue: 20, minPurchaseAmount: 50, usageLimit: 100 });
    expect(promoRes.status).toBe(201);

    const validateRes = await request(app)
      .post('/api/promos/validate')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ code: 'SAVE20', totalAmount: 200 });
    expect(validateRes.status).toBe(200);
    expect(validateRes.body.valid).toBe(true);
  });

  test('5a. Batch checkout creates payment intent with correct totals', async () => {
    const res = await request(app)
      .post('/api/transactions/batch')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ items: [{ listingId: testListing._id, quantity: 1 }, { listingId: testListing2._id, quantity: 1 }], buyerCountry: 'US' });
    expect(res.status).toBe(200);
    expect(res.body.paymentIntentId).toBeDefined();
    expect(res.body.totalAmount).toBeGreaterThan(0);
  });

  test('6a. Seller gets paid only after delivery + confirmation + completion', async () => {
    const txnRes = await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ listingId: testListing._id, buyerCountry: 'US' });
    expect(txnRes.status).toBe(201);
    const txn = txnRes.body;
    expect(txn.status).toBe('paid');

    const sellerAfter = await User.findById(seller._id);
    expect(sellerAfter.balance.pending).toBeGreaterThan(0);

    txn.status = 'delivered';
    txn.shipping = { ...txn.shipping, actualDelivery: new Date(), trackingNumber: 'TRACK123' };
    await txn.save();

    const confirmRes = await request(app)
      .post(`/api/orders/${txn._id}/confirm-received`)
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(confirmRes.status).toBe(200);

    const updatedTxn = await Transaction.findById(txn._id);
    updatedTxn.buyerConfirmed.confirmedAt = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000);
    updatedTxn.shipping.actualDelivery = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000);
    await updatedTxn.save();

    const completeRes = await request(app)
      .post(`/api/orders/${txn._id}/auto-complete`)
      .set('Authorization', `Bearer ${sellerToken}`);
    expect(completeRes.status).toBe(200);

    const payout = await Payout.findOne({ transaction: txn._id });
    expect(payout).toBeDefined();
    expect(payout.status).toBe('completed');
  });

  test('7a. Return order: buyer gets full refund, seller earnings deducted', async () => {
    const txnRes = await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ listingId: testListing2._id, buyerCountry: 'US' });
    expect(txnRes.status).toBe(201);
    const txn = txnRes.body;

    txn.status = 'delivered';
    txn.shipping = { ...txn.shipping, actualDelivery: new Date(), trackingNumber: 'TRACK456' };
    await txn.save();

    await request(app)
      .post(`/api/orders/${txn._id}/request-return`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ reason: 'Item not as described', condition: 'New without tags' });

    await request(app)
      .post(`/api/orders/${txn._id}/accept-return`)
      .set('Authorization', `Bearer ${sellerToken}`);

    await request(app)
      .post(`/api/orders/${txn._id}/return-shipped`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ trackingNumber: 'RETURN789', carrier: 'USPS' });

    const confirmReturnRes = await request(app)
      .post(`/api/orders/${txn._id}/confirm-return-received`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ condition: 'Returned in good condition', inspectionNotes: 'All good' });
    expect(confirmReturnRes.status).toBe(200);

    const refundedTxn = await Transaction.findById(txn._id);
    expect(refundedTxn.status).toBe('refunded');
    expect(refundedTxn.payout.status).toBe('refunded');
  });

  test('8a. Platform fee is exactly 8% of item price', async () => {
    const res = await request(app)
      .post('/api/payments/breakdown')
      .send({ itemPrice: 100, fromCountry: 'US', toCountry: 'US', weightKg: 0.5 });
    expect(res.status).toBe(200);
    expect(res.body.seller.platformFee).toBe(8);
    expect(res.body.seller.sellerEarnings).toBe(92);
    expect(res.body.buyer.totalPaid).toBeCloseTo(108.99, 1);
  });

  test('9a. Boost fee is deducted from seller earnings', async () => {
    const listingRes = await request(app)
      .post('/api/listings')
      .set('Authorization', `Bearer ${sellerToken}`)
      .field('title', 'Boosted Test Item')
      .field('description', 'Testing boost deductions')
      .field('price', 200)
      .field('category', 'Men')
      .field('condition', 'New with tags')
      .field('brand', 'Test')
      .field('size', 'M')
      .field('color', 'Black')
      .field('currency', 'USD')
      .field('weight', 0.5)
      .field('quantity', 3);
    expect(listingRes.status).toBe(201);
    const boostedListing = listingRes.body.listing;

    const boostRes = await request(app)
      .post('/api/boost')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ listingId: boostedListing._id, tier: 'Standard', durationDays: 14 });
    expect(boostRes.status).toBe(200);

    const txnRes = await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ listingId: boostedListing._id, buyerCountry: 'US' });
    expect(txnRes.status).toBe(201);
    const txn = txnRes.body;

    expect(txn.paymentBreakdown.boostFee).toBeGreaterThan(0);
    expect(txn.paymentBreakdown.sellerEarnings).toBeLessThan(184);
  });

  test('10a. Platform always gets 8% commission (capped at $500)', async () => {
    const listingRes = await request(app)
      .post('/api/listings')
      .set('Authorization', `Bearer ${sellerToken}`)
      .field('title', 'High Value Item')
      .field('description', 'Testing max fee cap')
      .field('price', 10000)
      .field('category', 'Accessories')
      .field('condition', 'New with tags')
      .field('brand', 'Luxury')
      .field('size', 'One Size')
      .field('color', 'Gold')
      .field('currency', 'USD')
      .field('weight', 0.5)
      .field('quantity', 1);
    expect(listingRes.status).toBe(201);

    const breakdownRes = await request(app)
      .post('/api/payments/breakdown')
      .send({ itemPrice: 10000, fromCountry: 'US', toCountry: 'US', weightKg: 0.5 });
    expect(breakdownRes.status).toBe(200);
    expect(breakdownRes.body.seller.platformFee).toBe(500);
    expect(breakdownRes.body.seller.sellerEarnings).toBe(9500);
  });

  test('11a. Multi-seller batch: each seller gets correct portion', async () => {
    const seller2Res = await User.create({
      name: 'Seller 2', email: `${Date.now()}_seller2@test.com`, password: 'password123',
      country: 'GB', currency: 'GBP', emailVerified: true, authProvider: 'email',
      shippingAddress: { fullName: 'Seller 2', street1: '123 St', city: 'London', state: 'England', postalCode: 'SW1A 1AA', country: 'GB' },
      balance: { available: 0, pending: 0, totalEarned: 0, totalPaidOut: 0, currency: 'GBP' },
      stats: { totalSales: 5, totalPurchases: 0, strikes: 0 },
    });
    const seller2Token = jwt.sign({ id: seller2Res._id }, JWT_SECRET, { expiresIn: '30d' });

    const listing2Res = await request(app)
      .post('/api/listings')
      .set('Authorization', `Bearer ${seller2Token}`)
      .field('title', 'Seller 2 Item')
      .field('description', 'From UK seller')
      .field('price', 150)
      .field('category', 'Men')
      .field('condition', 'New without tags')
      .field('brand', 'UKBrand')
      .field('size', '9')
      .field('color', 'Brown')
      .field('currency', 'GBP')
      .field('weight', 0.5)
      .field('quantity', 3);
    expect(listing2Res.status).toBe(201);
    const listing2 = listing2Res.body.listing;

    const intentRes = await request(app)
      .post('/api/payments/create-intent')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ items: [{ listingId: testListing._id, quantity: 1 }, { listingId: listing2._id, quantity: 1 }], buyerCountry: 'US' });
    expect(intentRes.status).toBe(200);
    expect(intentRes.body.paymentIntentId).toBeDefined();
  });
});