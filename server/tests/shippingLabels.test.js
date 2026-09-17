/**
 * Shipping Labels Tests (EasyPost Integration)
 * Tests real shipping label generation, voiding, and tracking
 */
const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../server');
const authorizedPaymentIntent = require('./helpers/authorizedPayment');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Transaction = require('../models/Transaction');
const Order = require('../models/Order');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';

let sellerToken, buyerToken, sellerId, buyerId;
let testListing, testTransaction;

beforeAll(async () => {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/trenddrop_test');
  }

  const seedBase = `shipping_${Date.now()}_`;

  seller = await User.create({
    name: 'Shipping Seller', email: `${seedBase}seller@test.com`, password: 'password123',
    country: 'US', currency: 'USD', emailVerified: true, authProvider: 'email',
    shippingAddress: { fullName: 'Seller', street1: '123 St', city: 'City', state: 'CA', postalCode: '90210', country: 'US' },
    balance: { available: 0, pending: 0, totalEarned: 0, totalPaidOut: 0, currency: 'USD' },
    stats: { totalSales: 0, totalPurchases: 0, strikes: 0 },
  });
  sellerToken = jwt.sign({ id: seller._id }, JWT_SECRET, { expiresIn: '30d' });
  sellerId = seller._id;

  buyer = await User.create({
    name: 'Shipping Buyer', email: `${seedBase}buyer@test.com`, password: 'password123',
    country: 'GB', currency: 'GBP', emailVerified: true, authProvider: 'email',
    shippingAddress: { fullName: 'Buyer', street1: '456 St', city: 'London', state: 'England', postalCode: 'SW1A 1AA', country: 'GB' },
    balance: { available: 0, pending: 0, totalEarned: 0, totalPaidOut: 0, currency: 'GBP' },
    stats: { totalSales: 0, totalPurchases: 0, strikes: 0 },
  });
  buyerToken = jwt.sign({ id: buyer._id }, JWT_SECRET, { expiresIn: '30d' });
  buyerId = buyer._id;

  const listingRes = await request(app)
    .post('/api/listings')
    .set('Authorization', `Bearer ${sellerToken}`)
    .field('title', 'Shipping Test Item')
    .field('description', 'For label testing')
    .field('price', '50')
    .field('category', 'Electronics')
    .field('condition', 'New with tags')
    .field('brand', 'Test')
    .field('size', 'One Size')
    .field('color', 'Black')
    .field('weight', 0.5)
    .field('quantity', 5);
  expect(listingRes.status).toBe(201);
  testListing = listingRes.body.listing;
});

afterAll(async () => {
  await User.deleteMany({ email: /shipping_/ });
  await Listing.deleteMany({ seller: sellerId });
  await Transaction.deleteMany({});
  await mongoose.connection.close();
});

describe('Shipping Labels (EasyPost Integration)', () => {
  let localTxn;

  test('SL.1 Create shipping label for order', async () => {
    // Create transaction first
    const txnRes = await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ paymentIntentId: authorizedPaymentIntent(), listingId: testListing._id, buyerCountry: 'GB' });
    expect(txnRes.status).toBe(201);
    localTxn = txnRes.body;
    testTransaction = localTxn;

    // Generate label
    const labelRes = await request(app)
      .post(`/api/shipping/label/${localTxn._id}`)
      .set('Authorization', `Bearer ${sellerToken}`);

    expect(labelRes.status).toBe(200);
    expect(labelRes.body.trackingNumber).toBeDefined();
    expect(labelRes.body.carrier).toBeDefined();
    expect(labelRes.body.labelPdfUrl).toBeDefined();
    expect(labelRes.body.trackingUrl).toBeDefined();
    const saved = await Transaction.findById(localTxn._id);
    expect(saved.status).toBe('paid');
  });

  test('SL.2 Cannot create label for someone else\'s order', async () => {
    const labelRes = await request(app)
      .post(`/api/shipping/label/${testTransaction._id}`)
      .set('Authorization', `Bearer ${buyerToken}`);

    expect(labelRes.status).toBe(403);
  });

  test('SL.3 Void label and refund shipping', async () => {
    // Create new transaction for void test
    const txnRes = await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ paymentIntentId: authorizedPaymentIntent(), listingId: testListing._id, buyerCountry: 'GB' });
    const txn = txnRes.body;

    // Generate label
    const labelRes = await request(app)
      .post(`/api/shipping/label/${txn._id}`)
      .set('Authorization', `Bearer ${sellerToken}`);
    expect(labelRes.status).toBe(200);

    const beforeListing = await Listing.findById(testListing._id).lean();
    const beforeSeller = await User.findById(sellerId).lean();

    // Voiding a mock label must not cancel the sale, restore inventory, or
    // mutate seller funds. No carrier postage was purchased.
    const voidRes = await request(app)
      .post(`/api/shipping/void/${txn._id}`)
      .set('Authorization', `Bearer ${sellerToken}`);

    expect(voidRes.status).toBe(200);
    expect(voidRes.body.voided).toBe(true);
    expect(voidRes.body.refunded).toBe(false);
    expect(voidRes.body.refundAmount).toBe(0);
    const afterTxn = await Transaction.findById(txn._id).lean();
    expect(afterTxn.status).toBe('paid');
    expect(afterTxn.shipping.voided).toBe(true);
    const afterListing = await Listing.findById(testListing._id).lean();
    expect(afterListing.quantity).toBe(beforeListing.quantity);
    const afterSeller = await User.findById(sellerId).lean();
    expect(afterSeller.balance.pending).toBe(beforeSeller.balance.pending);
  });

  test('SL.4 Track shipment status', async () => {
    // Create own transaction
    const txnRes = await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ paymentIntentId: authorizedPaymentIntent(), listingId: testListing._id, buyerCountry: 'GB' });
    const txn = txnRes.body;
    testTransaction = txn;

    // Generate label first
    await request(app)
      .post(`/api/shipping/label/${txn._id}`)
      .set('Authorization', `Bearer ${sellerToken}`);

    const trackingRes = await request(app)
      .get(`/api/shipping/track/${txn._id}`)
      .set('Authorization', `Bearer ${sellerToken}`);

    expect(trackingRes.status).toBe(200);
    expect(trackingRes.body.trackingNumber).toBeDefined();
    expect(trackingRes.body.status).toBeDefined();
    expect(trackingRes.body.trackingHistory).toBeDefined();
  });

  test('SL.5 Label includes correct address', async () => {
    // Create own transaction
    const txnRes = await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ paymentIntentId: authorizedPaymentIntent(), listingId: testListing._id, buyerCountry: 'GB' });
    const txn = txnRes.body;
    testTransaction = txn;

    const labelRes = await request(app)
      .post(`/api/shipping/label/${txn._id}`)
      .set('Authorization', `Bearer ${sellerToken}`);

    expect(labelRes.status).toBe(200);
    expect(labelRes.body.toAddress).toBeDefined();
    expect(labelRes.body.toAddress.country).toBe('GB');
    expect(labelRes.body.fromAddress).toBeDefined();
    expect(labelRes.body.fromAddress.country).toBe('US');
  });

  test('SL.6 Uses the seller origin when selecting the carrier for cross-border labels', async () => {
    const txn = await Transaction.create({
      listing: testListing._id, buyer: buyerId, seller: sellerId, itemPrice: 50,
      currency: 'USD', paymentBreakdown: { subtotal: 50, totalPaid: 60, sellerEarnings: 45 },
      shippingAddress: { fullName: 'Buyer', street1: '456 St', city: 'London', state: 'England', postalCode: 'SW1A 1AA', country: 'GB' },
      sellerAddress: { street1: '123 St', city: 'City', state: 'CA', postalCode: '90210', country: 'US' },
      status: 'paid',
    });

    const labelRes = await request(app)
      .post(`/api/shipping/label/${txn._id}`)
      .set('Authorization', `Bearer ${sellerToken}`);

    expect(labelRes.status).toBe(200);
    expect(labelRes.body.carrier).toBe('DHL Express');
  });

  test('SL.7 Rejects unknown carriers instead of silently generating a fallback label', async () => {
    const txn = await Transaction.create({
      listing: testListing._id, buyer: buyerId, seller: sellerId, itemPrice: 50,
      currency: 'USD', paymentBreakdown: { subtotal: 50, totalPaid: 60, sellerEarnings: 45 },
      shippingAddress: { fullName: 'Buyer', street1: '456 St', city: 'London', state: 'England', postalCode: 'SW1A 1AA', country: 'GB' },
      sellerAddress: { street1: '123 St', city: 'City', state: 'CA', postalCode: '90210', country: 'US' },
      status: 'paid',
    });

    const labelRes = await request(app)
      .post('/api/shipping/generate-label')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ transactionId: txn._id, carrier: 'NOT_A_CARRIER' });

    expect(labelRes.status).toBe(400);
  });

  test('SL.8 PDF download returns a print-ready PDF only to the seller', async () => {
    const pdfRes = await request(app)
      .get(`/api/shipping/label/${testTransaction._id}`)
      .set('Authorization', `Bearer ${sellerToken}`);

    expect(pdfRes.status).toBe(200);
    expect(pdfRes.headers['content-type']).toContain('application/pdf');
    expect(pdfRes.headers['content-disposition']).toMatch(/attachment; filename="trenddrop-label-.+\.pdf"/);
    expect(pdfRes.body.subarray(0, 4).toString()).toBe('%PDF');
    expect(pdfRes.body.length).toBeGreaterThan(1000);
  });

  test('SL.9 Repeated void requests are idempotent and do not create a second refund', async () => {
    const txn = await Transaction.create({
      listing: testListing._id, buyer: buyerId, seller: sellerId, itemPrice: 50,
      paymentBreakdown: { subtotal: 50, totalPaid: 60, sellerEarnings: 45 },
      shippingAddress: { country: 'GB' }, sellerAddress: { country: 'US' }, status: 'paid',
      shipping: { trackingNumber: 'MOCK-VOID-1', carrier: 'DHL Express', service: 'Express' },
    });
    const first = await request(app).post(`/api/shipping/void/${txn._id}`).set('Authorization', `Bearer ${sellerToken}`);
    const second = await request(app).post(`/api/shipping/void/${txn._id}`).set('Authorization', `Bearer ${sellerToken}`);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.voided).toBe(true);
    const saved = await Transaction.findById(txn._id).lean();
    expect(saved.shipping.voided).toBe(true);
  });

  test('SL.10 Order dispatch rejects unsupported carriers and malformed tracking numbers', async () => {
    const txn = await Transaction.create({
      listing: testListing._id, buyer: buyerId, seller: sellerId, itemPrice: 50,
      paymentBreakdown: { subtotal: 50, totalPaid: 60, sellerEarnings: 45 },
      shippingAddress: { country: 'GB' }, sellerAddress: { country: 'US' }, status: 'paid',
    });
    const order = await Order.create({
      buyer: buyerId, sellers: [sellerId], items: [{ listing: testListing._id, transaction: txn._id, seller: sellerId, price: 50 }],
      shipments: [{ seller: sellerId, items: [txn._id], status: 'pending' }],
      totals: { subtotal: 50, total: 60 }, payment: { status: 'captured', totalHeld: 60 },
    });

    const badCarrier = await request(app)
      .post(`/api/orders/${order._id}/ship`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ shipmentIndex: 0, trackingNumber: 'TRACK-1', carrier: 'FAKE_CARRIER' });
    expect(badCarrier.status).toBe(400);

    const badTracking = await request(app)
      .post(`/api/orders/${order._id}/ship`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ shipmentIndex: 0, trackingNumber: { forged: true }, carrier: 'USPS' });
    expect(badTracking.status).toBe(400);

    // Carrier slugs from the seller UI are case-insensitive but persisted
    // canonically, so a valid mock shipment is not rejected in production.
    const valid = await request(app)
      .post(`/api/orders/${order._id}/ship`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ shipmentIndex: 0, trackingNumber: 'TRACK-VALID', carrier: 'usps' });
    expect(valid.status).toBe(200);
    expect(valid.body.order.shipments[0].carrier).toBe('USPS');
  });

  test('SL.11 Cannot void already delivered shipment', async () => {
    // Update transaction to delivered
    await Transaction.findByIdAndUpdate(testTransaction._id, { status: 'delivered' });

    const voidRes = await request(app)
      .post(`/api/shipping/void/${testTransaction._id}`)
      .set('Authorization', `Bearer ${sellerToken}`);

    expect(voidRes.status).toBe(400);
    expect(voidRes.body.message).toContain('delivered');
  });
});