const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const app = require('../server.js');
const authorizedPaymentIntent = require('./helpers/authorizedPayment');
const SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';
const PASS = bcrypt.hashSync('Pass1234!', 10);
const US = { fullName: 'U', street1: '1 St', city: 'C', state: 'S', postalCode: '11111', country: 'US' };

async function makeUser(name, email, country = 'US', cur = 'USD') {
  const User = require('../models/User');
  const u = await User.create({
    name, email, password: PASS, emailVerified: true, authProvider: 'email',
    country, currency: cur, shippingAddress: { ...US, country },
    balance: { available: 0, pending: 0, totalEarned: 0, totalPaidOut: 0, currency: cur },
    stats: { totalSales: 0, totalPurchases: 0, strikes: 0 },
  });
  return { user: u, token: jwt.sign({ id: u._id }, SECRET, { expiresIn: '30d' }) };
}

async function makeListing(seller, price, qty = 5) {
  const Listing = require('../models/Listing');
  return Listing.create({
    seller: seller._id, title: 'Item ' + seller.country, description: 'd',
    price, category: 'Men', condition: 'New with tags',
    currency: seller.currency, available: true, sold: false,
    quantity: qty, shipsFrom: seller.country, weight: 0.5,
  });
}

async function buy(buyerToken, listingId) {
  const r = await request(app).post('/api/transactions')
    .set('Authorization', 'Bearer ' + buyerToken)
    .send({ paymentIntentId: authorizedPaymentIntent(), listingId, shippingAddress: { ...US }, buyerCountry: 'US' });
  return r.body;
}

beforeAll(async () => {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/trend-drop-test');
  }
});

describe('RETURN FLOW - eligibility', () => {
  let seller, buyer, listing, txnId;
  beforeAll(async () => {
    seller = await makeUser('Seller', 'seller@test.com');
    buyer = await makeUser('Buyer', 'buyer@test.com');
    listing = await makeListing(seller.user, 100, 5);
    const t = await buy(buyer.token, listing._id);
    txnId = t._id;
    const Transaction = require('../models/Transaction');
    await Transaction.findByIdAndUpdate(txnId, { status: 'delivered', shipping: { actualDelivery: new Date() } });
  });
  test('E1 delivered item within window is eligible', async () => {
    const r = await request(app).get('/api/returns/eligible').set('Authorization', 'Bearer ' + buyer.token);
    expect(r.status).toBe(200);
    expect(r.body.returnWindowDays).toBe(3);
    expect(r.body.eligible.length).toBe(1);
    expect(r.body.eligible[0].transactionId).toBe(txnId);
  });
  test('E2 out-of-window item is ineligible', async () => {
    const Transaction = require('../models/Transaction');
    await Transaction.findByIdAndUpdate(txnId, { shipping: { actualDelivery: new Date(Date.now() - 10*24*60*60*1000) } });
    const r = await request(app).get('/api/returns/eligible').set('Authorization', 'Bearer ' + buyer.token);
    expect(r.body.eligible.length).toBe(0);
    expect(r.body.ineligible.length).toBe(1);
    expect(r.body.ineligible[0].reason).toMatch(/window closed/i);
    await Transaction.findByIdAndUpdate(txnId, { shipping: { actualDelivery: new Date() } });
  });
});

describe('RETURN FLOW - creation validation', () => {
  let seller, buyer, listing, txnId;
  beforeAll(async () => {
    seller = await makeUser('Seller2', 'seller2@test.com');
    buyer = await makeUser('Buyer2', 'buyer2@test.com');
    listing = await makeListing(seller.user, 100, 5);
    const t = await buy(buyer.token, listing._id);
    txnId = t._id;
    const Transaction = require('../models/Transaction');
    await Transaction.findByIdAndUpdate(txnId, { status: 'delivered', shipping: { actualDelivery: new Date() } });
  });
  test('R1 return with 1 photo succeeds', async () => {
    const r = await request(app).post('/api/returns').set('Authorization', 'Bearer ' + buyer.token)
      .send({ transactionId: txnId, reason: 'Item not as described', images: ['https://example.com/p.jpg'] });
    expect(r.status).toBe(201);
    expect(r.body.images.length).toBe(1);
  });
  test('R2 return without photos is rejected', async () => {
    const l2 = await makeListing(seller.user, 50, 3);
    const t2 = await buy(buyer.token, l2._id);
    const Transaction = require('../models/Transaction');
    await Transaction.findByIdAndUpdate(t2._id, { status: 'delivered', shipping: { actualDelivery: new Date() } });
    const r = await request(app).post('/api/returns').set('Authorization', 'Bearer ' + buyer.token)
      .send({ transactionId: t2._id, reason: 'Defective' });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/photo/i);
  });
  test('R3 return with >5 photos is rejected', async () => {
    const l3 = await makeListing(seller.user, 50, 3);
    const t3 = await buy(buyer.token, l3._id);
    const Transaction = require('../models/Transaction');
    await Transaction.findByIdAndUpdate(t3._id, { status: 'delivered', shipping: { actualDelivery: new Date() } });
    const imgs = Array.from({length:6}, (_,i) => 'https://example.com/p'+i+'.jpg');
    const r = await request(app).post('/api/returns').set('Authorization', 'Bearer ' + buyer.token)
      .send({ transactionId: t3._id, reason: 'Defective', images: imgs });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/photo/i);
  });
  test('R4 duplicate return rejected', async () => {
    const r = await request(app).post('/api/returns').set('Authorization', 'Bearer ' + buyer.token)
      .send({ transactionId: txnId, reason: 'Changed mind', images: ['https://example.com/p.jpg'] });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/already exists/i);
  });
});

describe('RETURN FLOW - approval + label visibility', () => {
  let seller, buyer, listing, txnId, returnId;
  beforeAll(async () => {
    seller = await makeUser('Seller3', 'seller3@test.com');
    buyer = await makeUser('Buyer3', 'buyer3@test.com');
    listing = await makeListing(seller.user, 100, 5);
    const t = await buy(buyer.token, listing._id);
    txnId = t._id;
    const Transaction = require('../models/Transaction');
    await Transaction.findByIdAndUpdate(txnId, { status: 'delivered', shipping: { actualDelivery: new Date() } });
    const ret = await request(app).post('/api/returns').set('Authorization', 'Bearer ' + buyer.token)
      .send({ transactionId: txnId, reason: 'Item not as described', images: ['https://example.com/p.jpg'] });
    returnId = ret.body._id;
  });
  test('R5 seller approves -> approved (label stripped from seller response)', async () => {
    const r = await request(app).put('/api/returns/' + returnId + '/approve').set('Authorization', 'Bearer ' + seller.token).send({});
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('approved');
    // Label is stripped from seller response (privacy); tracking number visible to both
    expect(r.body.returnTrackingNumber).toBeTruthy();
    expect(r.body.returnLabel).toBeUndefined();
  });
  test('R6 buyer sees label; seller does not', async () => {
    const bv = await request(app).get('/api/returns/' + returnId).set('Authorization', 'Bearer ' + buyer.token);
    expect(bv.body.returnLabel).toBeTruthy();
    expect(bv.body.returnTrackingNumber).toBeTruthy();
    const sv = await request(app).get('/api/returns/' + returnId).set('Authorization', 'Bearer ' + seller.token);
    expect(sv.body.returnLabel).toBeUndefined();
    expect(sv.body.returnTrackingNumber).toBeTruthy();
  });
});

describe('RETURN FLOW - shipping + receipt + refund', () => {
  let seller, buyer, listing, txnId, returnId;
  beforeAll(async () => {
    seller = await makeUser('Seller4', 'seller4@test.com');
    buyer = await makeUser('Buyer4', 'buyer4@test.com');
    listing = await makeListing(seller.user, 100, 5);
    const t = await buy(buyer.token, listing._id);
    txnId = t._id;
    const Transaction = require('../models/Transaction');
    await Transaction.findByIdAndUpdate(txnId, { status: 'delivered', shipping: { actualDelivery: new Date() } });
    const ret = await request(app).post('/api/returns').set('Authorization', 'Bearer ' + buyer.token)
      .send({ transactionId: txnId, reason: 'Item not as described', images: ['https://example.com/p.jpg'] });
    returnId = ret.body._id;
    await request(app).put('/api/returns/' + returnId + '/approve').set('Authorization', 'Bearer ' + seller.token).send({});
  });
  test('R7 buyer ships item back', async () => {
    const r = await request(app).put('/api/returns/' + returnId + '/ship').set('Authorization', 'Bearer ' + buyer.token).send({ trackingNumber: '1ZRETURN' });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('shipped');
  });
  test('R8 seller confirms receipt -> refunded + inventory restored', async () => {
    const r = await request(app).put('/api/returns/' + returnId + '/receive').set('Authorization', 'Bearer ' + seller.token).send({ inspectionNotes: 'OK' });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('refunded');
    const Listing = require('../models/Listing');
    const l = await Listing.findById(listing._id);
    expect(l.quantity).toBe(5);
    expect(l.sold).toBe(false);
  });
  test('R9 non-participant cannot access return', async () => {
    const other = await makeUser('Other', 'other@test.com');
    const r = await request(app).get('/api/returns/' + returnId).set('Authorization', 'Bearer ' + other.token);
    expect(r.status).toBe(403);
  });
});
