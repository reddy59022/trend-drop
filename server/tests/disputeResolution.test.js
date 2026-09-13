const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const app = require('../server');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Transaction = require('../models/Transaction');
const Payout = require('../models/Payout');

const PASS = 'password123';
const SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';
const mkEmail = p => `${p}_dispute_${Date.now()}_${Math.random().toString(36).slice(2,6)}@test.com`;
const ADDRESS = { fullName: 'DB', street1: '1 St', city: 'Austin', state: 'TX', postalCode: '78701', country: 'US' };

function mockPi(status = 'succeeded') {
  const id = `pi_dr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  if (!global.__mockPaymentIntents) global.__mockPaymentIntents = {};
  global.__mockPaymentIntents[id] = { id, status, amount: 0 };
  return id;
}

async function makeUser(name, email, country, currency, role) {
  const u = await User.create({
    name, email: email.toLowerCase(), password: PASS, emailVerified: true,
    authProvider: 'email', country, currency, role: role || 'user',
    shippingAddress: { fullName: name, street1: '1 St', city: 'C', state: 'S', postalCode: '11111', country },
    balance: { available: 0, pending: 0, totalEarned: 0, totalPaidOut: 0, currency },
    stats: { totalSales: 5, totalPurchases: 0, strikes: 0 },
    payoutMethod: { type: 'bank', details: { accountNumber: '111', routingNumber: '222', accountHolderName: name } },
  });
  return { user: u, token: jwt.sign({ id: u._id }, SECRET, { expiresIn: '30d' }) };
}

async function makeDeliveredTxn(seller, buyer, buyerToken, price) {
  const listing = await Listing.create({
    seller: seller._id, title: 'Dispute Item', description: 'd', price: price || 100,
    category: 'Men', condition: 'New with tags', currency: 'USD',
    available: true, sold: false, quantity: 5, shipsFrom: 'US', weight: 1,
  });
  const pi = mockPi('succeeded');
  const items = [{ listingId: listing._id, quantity: 1 }];
  const ci = await request(app).post('/api/payments/create-intent')
    .set('Authorization', 'Bearer ' + buyerToken)
    .send({ items, shippingAddress: ADDRESS });
  expect(ci.status).toBe(200);
  await request(app).post('/api/payments/test-confirm')
    .set('Authorization', 'Bearer ' + buyerToken)
    .send({ paymentIntentId: ci.body.paymentIntentId });
  const conf = await request(app).post('/api/payments/confirm-batch')
    .set('Authorization', 'Bearer ' + buyerToken)
    .send({ paymentIntentId: ci.body.paymentIntentId, items, shippingAddress: ADDRESS });
  expect([200, 201]).toContain(conf.status);
  const orderId = conf.body.orders[0]._id;
  const txnId = conf.body.transactions[0]._id;
  await request(app).post('/api/orders/' + orderId + '/ship')
    .set('Authorization', 'Bearer ' + seller.token)
    .send({ shipmentIndex: 0, trackingNumber: 'D1', carrier: 'UPS' });
  await request(app).post('/api/shipping/tracking-event')
    .set('x-tracking-secret', 'trenddrop-tracking-dev')
    .send({ transactionId: txnId, status: 'delivered', trackingNumber: 'D1' });
  return { listing, orderId, txnId };
}

function disputeReq(token, txnId, reason) {
  return request(app).post('/api/orders/' + txnId + '/dispute')
    .set('Authorization', 'Bearer ' + token)
    .send({ reason: reason || 'Not as described' });
}

function resolveReq(token, txnId, resolution, notes) {
  return request(app).post('/api/orders/' + txnId + '/resolve-dispute')
    .set('Authorization', 'Bearer ' + token)
    .send({ resolution, notes: notes || '' });
}

describe('DISPUTE RESOLUTION lifecycle (Gap G4)', () => {
  let seller, buyer;
  let disputeTxnId;

  beforeAll(async () => {
    const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/trend-drop-test';
    if (mongoose.connection.readyState === 0) await mongoose.connect(uri);
    seller = await makeUser('DispSeller', mkEmail('ds'), 'US', 'USD');
    buyer = await makeUser('DispBuyer', mkEmail('db'), 'US', 'USD');
    process.env.INTERNATIONAL_SHOPPING_ENABLED = 'true';
    const r = await makeDeliveredTxn(seller.user, buyer.user, buyer.token, 100);
    disputeTxnId = r.txnId;
    const d = await disputeReq(buyer.token, disputeTxnId, 'Not as described');
    expect(d.status).toBe(200);
  });

  afterAll(async () => {
    process.env.INTERNATIONAL_SHOPPING_ENABLED = '';
    await Payout.deleteMany({});
    await Transaction.deleteMany({});
    await Listing.deleteMany({});
    await User.deleteMany({});
  });

  test('DR.1 seller resolves with refund: refunded, inventory restored, payout refunded', async () => {
    const r = await resolveReq(seller.token, disputeTxnId, 'refund', 'Agreed');
    expect(r.status).toBe(200);
    expect(r.body.resolution).toBe('refund');
    const txn = await Transaction.findById(disputeTxnId);
    expect(txn.status).toBe('refunded');
    const listing = await Listing.findById(txn.listing);
    expect(listing.sold).toBe(false);
    expect(listing.available).toBe(true);
    const payout = await Payout.findOne({ transaction: disputeTxnId });
    expect(payout.status).toBe('refunded');
  });

  test('DR.2 seller resolves with release: dispute_resolved (seller keeps funds)', async () => {
    const r0 = await makeDeliveredTxn(seller.user, buyer.user, buyer.token, 80);
    await disputeReq(buyer.token, r0.txnId, 'Damaged');
    const r = await resolveReq(seller.token, r0.txnId, 'release');
    expect(r.status).toBe(200);
    expect(r.body.resolution).toBe('release');
    const txn = await Transaction.findById(r0.txnId);
    expect(txn.status).toBe('dispute_resolved');
  });

  test('DR.3 buyer cannot resolve their own dispute (403)', async () => {
    const r0 = await makeDeliveredTxn(seller.user, buyer.user, buyer.token, 60);
    await disputeReq(buyer.token, r0.txnId, 'X');
    const r = await resolveReq(buyer.token, r0.txnId, 'refund');
    expect(r.status).toBe(403);
  });

  test('DR.4 cannot resolve a non-disputed order (400)', async () => {
    const r0 = await makeDeliveredTxn(seller.user, buyer.user, buyer.token, 40);
    const r = await resolveReq(seller.token, r0.txnId, 'refund');
    expect(r.status).toBe(400);
  });

  test('DR.5 invalid resolution value is rejected (400)', async () => {
    const r0 = await makeDeliveredTxn(seller.user, buyer.user, buyer.token, 30);
    await disputeReq(buyer.token, r0.txnId, 'Y');
    const r = await resolveReq(seller.token, r0.txnId, 'banana');
    expect(r.status).toBe(400);
  });
});
