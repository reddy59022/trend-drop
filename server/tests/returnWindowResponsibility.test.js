/**
 * TDD — Return window & reason-based return-shipping responsibility.
 *
 * BUSINESS_RULES.md (authoritative):
 *   - "Return window: 3 days after delivery confirmation"
 *   - "Return shipping cost responsibility varies by reason (buyer/seller)"
 *
 * Bugs proven here (all failed before the fix):
 *   RW.1  POST /api/returns accepted returns for transactions delivered long
 *         after the 3-day window closed (only /eligible enforced the window).
 *   RW.3/4 Every return was created with refundAmount = itemPrice and NO
 *         responsibility classification, while receipt refunded 100% of
 *         totalPaid for every reason.
 *   RW.5  A "Changed mind" (buyer-responsibility) return refunded outbound
 *         shipping + buyer protection to the buyer via a FULL Stripe refund.
 *   RW.6  Seller-fault returns must still refund the FULL totalPaid.
 */
const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const app = require('../server.js');
const authorizedPaymentIntent = require('./helpers/authorizedPayment');
const SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';
const PASS = bcrypt.hashSync('Pass1234!', 10);
const US = { fullName: 'U', street1: '1 St', city: 'C', state: 'S', postalCode: '11111', country: 'US' };

async function makeUser(name, email) {
  const User = require('../models/User');
  const u = await User.create({
    name, email, password: PASS, emailVerified: true, authProvider: 'email',
    country: 'US', currency: 'USD', shippingAddress: { ...US, country: 'US' },
    balance: { available: 0, pending: 0, totalEarned: 0, totalPaidOut: 0, currency: 'USD' },
    stats: { totalSales: 0, totalPurchases: 0, strikes: 0 },
  });
  return { user: u, token: jwt.sign({ id: u._id }, SECRET, { expiresIn: '30d' }) };
}

async function makeListing(seller, price, qty = 5) {
  const Listing = require('../models/Listing');
  return Listing.create({
    seller: seller._id, title: 'Item ' + seller.name, description: 'd',
    price, category: 'Men', condition: 'New with tags',
    currency: 'USD', available: true, sold: false,
    quantity: qty, shipsFrom: 'US', weight: 0.5,
  });
}

// Buy at $100 (domestic US→US) and mark it delivered. Returns the transaction
// body + the mock payment intent id used for the purchase.
async function buyAndDeliver(buyerToken, listing, deliveredDaysAgo = 0) {
  const pi = authorizedPaymentIntent();
  const r = await request(app).post('/api/transactions')
    .set('Authorization', 'Bearer ' + buyerToken)
    .send({ paymentIntentId: pi, listingId: listing._id, shippingAddress: { ...US }, buyerCountry: 'US' });
  expect(r.status).toBe(201);
  const txn = r.body;
  const Transaction = require('../models/Transaction');
  await Transaction.findByIdAndUpdate(txn._id, {
    status: 'delivered',
    shipping: { actualDelivery: new Date(Date.now() - deliveredDaysAgo * 24 * 60 * 60 * 1000) },
  });
  return { txn, pi };
}

const createReturn = (buyerToken, transactionId, reason) =>
  request(app).post('/api/returns')
    .set('Authorization', 'Bearer ' + buyerToken)
    .send({ transactionId, reason, images: ['https://example.com/p.jpg'] });

beforeAll(async () => {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/trend-drop-test');
  }
});

describe('RW — return window enforcement', () => {
  test('RW.1 out-of-window return is rejected (3 days after delivery)', async () => {
    const seller = await makeUser('RWSeller', `rwseller_${Date.now()}@test.com`);
    const buyer = await makeUser('RWBuyer', `rwbuyer_${Date.now()}@test.com`);
    const listing = await makeListing(seller.user, 100);
    const { txn } = await buyAndDeliver(buyer.token, listing, 10); // delivered 10 days ago

    const r = await createReturn(buyer.token, txn._id, 'Changed mind');
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/window/i);
  });

  test('RW.2 in-window return still succeeds (regression guard)', async () => {
    const seller = await makeUser('RWSeller2', `rwseller2_${Date.now()}@test.com`);
    const buyer = await makeUser('RWBuyer2', `rwbuyer2_${Date.now()}@test.com`);
    const listing = await makeListing(seller.user, 100);
    const { txn } = await buyAndDeliver(buyer.token, listing, 0); // delivered today

    const r = await createReturn(buyer.token, txn._id, 'Changed mind');
    expect(r.status).toBe(201);
    expect(r.body.returnShippingResponsibility).toBe('buyer');
  });
});
describe('RW — reason-based shipping responsibility & refund amount', () => {
  test('RW.3 buyer-remorse reason: buyer responsibility, item-price refund', async () => {
    const seller = await makeUser('RWSeller3', `rwseller3_${Date.now()}@test.com`);
    const buyer = await makeUser('RWBuyer3', `rwbuyer3_${Date.now()}@test.com`);
    const listing = await makeListing(seller.user, 100);
    const { txn } = await buyAndDeliver(buyer.token, listing, 0);

    const r = await createReturn(buyer.token, txn._id, 'Changed mind');
    expect(r.status).toBe(201);
    expect(r.body.returnShippingResponsibility).toBe('buyer');
    // Buyer-remorse: outbound shipping + protection stay with the buyer.
    expect(r.body.refundAmount).toBe(txn.itemPrice);
  });

  test('RW.4 seller-fault reason: seller responsibility, full totalPaid refund', async () => {
    const seller = await makeUser('RWSeller4', `rwseller4_${Date.now()}@test.com`);
    const buyer = await makeUser('RWBuyer4', `rwbuyer4_${Date.now()}@test.com`);
    const listing = await makeListing(seller.user, 100);
    const { txn } = await buyAndDeliver(buyer.token, listing, 0);

    const r = await createReturn(buyer.token, txn._id, 'Defective');
    expect(r.status).toBe(201);
    expect(r.body.returnShippingResponsibility).toBe('seller');
    // Seller fault: buyer gets everything back (item + shipping + protection).
    expect(r.body.refundAmount).toBe(txn.paymentBreakdown.totalPaid);
  });

  test('RW.5 remorse return receipt refunds ONLY the item price', async () => {
    const seller = await makeUser('RWSeller5', `rwseller5_${Date.now()}@test.com`);
    const buyer = await makeUser('RWBuyer5', `rwbuyer5_${Date.now()}@test.com`);
    const listing = await makeListing(seller.user, 100);
    const { txn, pi } = await buyAndDeliver(buyer.token, listing, 0);

    const ret = await createReturn(buyer.token, txn._id, 'Changed mind');
    const returnId = ret.body._id;
    await request(app).put(`/api/returns/${returnId}/approve`).set('Authorization', 'Bearer ' + seller.token).send({});
    await request(app).put(`/api/returns/${returnId}/ship`).set('Authorization', 'Bearer ' + buyer.token).send({ trackingNumber: '1ZR5' });

    // Simulate a captured payment so receipt issues a Stripe refund.
    global.__mockPaymentIntents[pi].status = 'succeeded';
    const rec = await request(app).put(`/api/returns/${returnId}/receive`).set('Authorization', 'Bearer ' + seller.token).send({});
    expect(rec.status).toBe(200);

    // The refund issued to the buyer must be the item price ONLY — not
    // shipping + protection (those are the buyer's cost of a remorse return).
    const refundRecord = global.__mockRefunds && global.__mockRefunds[pi];
    expect(refundRecord).toBeDefined();
    expect(refundRecord.amount).toBe(Math.round(txn.itemPrice * 100));
    expect(refundRecord.amount).not.toBe(Math.round(txn.paymentBreakdown.totalPaid * 100));

    // The Return document reconciles with what was actually refunded.
    const Return = require('../models/Return');
    const doc = await Return.findById(returnId).lean();
    expect(doc.refundAmount).toBe(txn.itemPrice);
    expect(doc.returnShippingResponsibility).toBe('buyer');
  });

  test('RW.6 seller-fault return receipt still refunds the FULL totalPaid', async () => {
    const seller = await makeUser('RWSeller6', `rwseller6_${Date.now()}@test.com`);
    const buyer = await makeUser('RWBuyer6', `rwbuyer6_${Date.now()}@test.com`);
    const listing = await makeListing(seller.user, 100);
    const { txn, pi } = await buyAndDeliver(buyer.token, listing, 0);

    const ret = await createReturn(buyer.token, txn._id, 'Defective');
    const returnId = ret.body._id;
    await request(app).put(`/api/returns/${returnId}/approve`).set('Authorization', 'Bearer ' + seller.token).send({});
    await request(app).put(`/api/returns/${returnId}/ship`).set('Authorization', 'Bearer ' + buyer.token).send({ trackingNumber: '1ZR6' });

    global.__mockPaymentIntents[pi].status = 'succeeded';
    const rec = await request(app).put(`/api/returns/${returnId}/receive`).set('Authorization', 'Bearer ' + seller.token).send({});
    expect(rec.status).toBe(200);

    // Full refund: no partial amount passed to the provider.
    const refundRecord = global.__mockRefunds && global.__mockRefunds[pi];
    expect(refundRecord).toBeDefined();
    expect(refundRecord.amount).toBeUndefined();

    const Return = require('../models/Return');
    const doc = await Return.findById(returnId).lean();
    expect(doc.refundAmount).toBe(txn.paymentBreakdown.totalPaid);
    expect(doc.returnShippingResponsibility).toBe('seller');
  });
});