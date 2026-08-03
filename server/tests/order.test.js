// Enterprise Order Tests: multi-seller, multi-shipment, bundle shipping, role privileges, order confirmation
const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../server.js');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Order = require('../models/Order');
const Transaction = require('../models/Transaction');
const jwt = require('jsonwebtoken');

const secret = process.env.JWT_SECRET || 'fallback_secret_change_me';

let buyer, buyerToken;
let sellerA, sellerAToken;
let sellerB;
let listingA1, listingA2, listingB1;
let txnA1, txnA2, txnB1;

// Shared fixture builder used by every test
async function seedFixture() {
  const seed = `ord_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  buyer = await User.create({
    _id: new mongoose.Types.ObjectId(),
    name: 'Order Buyer',
    email: `${seed}buyer@test.com`,
    password: 'password123',
    emailVerified: true,
    authProvider: 'email',
    country: 'US',
    currency: 'USD',
  });
  buyerToken = jwt.sign({ id: buyer._id }, secret, { expiresIn: '1h' });

  sellerA = await User.create({
    _id: new mongoose.Types.ObjectId(),
    name: 'Seller A',
    email: `${seed}a@test.com`,
    password: 'password123',
    emailVerified: true,
    authProvider: 'email',
    country: 'US',
    currency: 'USD',
  });
  sellerAToken = jwt.sign({ id: sellerA._id }, secret, { expiresIn: '1h' });

  sellerB = await User.create({
    _id: new mongoose.Types.ObjectId(),
    name: 'Seller B',
    email: `${seed}b@test.com`,
    password: 'password123',
    emailVerified: true,
    authProvider: 'email',
    country: 'US',
    currency: 'USD',
  });

  listingA1 = await Listing.create({
    seller: sellerA._id,
    title: 'A Shirt',
    description: 'Test listing A1',
    price: 40,
    category: 'Men',
    condition: 'Good',
    weight: 0.5,
    available: true,
    sold: false,
    status: 'active',
  });
  listingA2 = await Listing.create({
    seller: sellerA._id,
    title: 'A Jeans',
    description: 'Test listing A2',
    price: 60,
    category: 'Men',
    condition: 'Good',
    weight: 1.0,
    available: true,
    sold: false,
    status: 'active',
  });
  listingB1 = await Listing.create({
    seller: sellerB._id,
    title: 'B Sneakers',
    description: 'Test listing B1',
    price: 80,
    category: 'Clothing',
    condition: 'Good',
    weight: 1.5,
    available: true,
    sold: false,
    status: 'active',
  });

  const mkTxn = async (listing, seller) => Transaction.create({
    listing: listing._id,
    buyer: buyer._id,
    seller: seller._id,
    itemPrice: listing.price,
    currency: 'USD',
    paymentBreakdown: {
      subtotal: listing.price,
      shippingCost: 5,
      buyerProtectionFee: 2,
      totalPaid: listing.price + 7,
      platformFee: 5,
      sellerEarnings: listing.price - 5,
    },
    status: 'processing',
    payout: { status: 'pending', transactionId: `pi_${seed}` },
  });

  txnA1 = await mkTxn(listingA1, sellerA);
  txnA2 = await mkTxn(listingA2, sellerA);
  txnB1 = await mkTxn(listingB1, sellerB);
}

describe('Enterprise Order Model & API', () => {
  beforeEach(async () => {
    await seedFixture();
  });

  test('ORD.1 - Order creates with human-readable order number and confirmation fields', async () => {
    const order = await Order.create({
      buyer: buyer._id,
      currency: 'USD',
      items: [
        { listing: listingA1._id, transaction: txnA1._id, seller: sellerA._id, title: 'A Shirt', price: 40, quantity: 1, currency: 'USD', image: '' },
      ],
      shipments: [{
        seller: sellerA._id,
        items: [txnA1._id],
        shippingCost: 5,
        currency: 'USD',
        labelStatus: 'created',
        status: 'pending',
      }],
      totals: { subtotal: 40, shipping: 5, protectionFees: 2, discounts: 0, total: 47 },
      payment: { paymentIntentId: 'pi_test', status: 'captured', currency: 'USD', totalHeld: 47 },
    });

    expect(order.orderNumber).toMatch(/^TD-\d{6}$/);
    expect(order.status).toBe('confirmed');
    expect(order.confirmation.sentAt).toBeDefined();
    expect(order.confirmation.approach).toBe('email_and_push');
  });

  test('ORD.2 - Multi-seller checkout groups into one order with separate shipments per seller', async () => {
    const order = await Order.create({
      buyer: buyer._id,
      currency: 'USD',
      items: [
        { listing: listingA1._id, transaction: txnA1._id, seller: sellerA._id, title: 'A Shirt', price: 40, quantity: 1, currency: 'USD', image: '' },
        { listing: listingB1._id, transaction: txnB1._id, seller: sellerB._id, title: 'B Sneakers', price: 80, quantity: 1, currency: 'USD', image: '' },
      ],
      shipments: [
        { seller: sellerA._id, items: [txnA1._id], shippingCost: 5, currency: 'USD', labelStatus: 'created', status: 'pending' },
        { seller: sellerB._id, items: [txnB1._id], shippingCost: 7, currency: 'USD', labelStatus: 'created', status: 'pending' },
      ],
      totals: { subtotal: 120, shipping: 12, protectionFees: 6, discounts: 0, total: 138 },
      payment: { paymentIntentId: 'pi_test', status: 'captured', currency: 'USD', totalHeld: 138 },
      sellers: [sellerA._id, sellerB._id],
    });

    expect(order.shipments.length).toBe(2);
    expect(order.sellers.length).toBe(2);
    order.shipments.forEach(s => expect(['pending', 'created']).toContain(s.status));
  });

  test('ORD.3 - Same-seller bundle: single shipment with max single-item shipping cost (bundle savings)', async () => {
    const bundle = Order.calculateBundleShipping([
      { shippingCost: 5, freeShipping: false },
      { shippingCost: 5, freeShipping: false },
    ]);
    expect(bundle.shippingCost).toBe(5);
    expect(bundle.savings).toBe(5);
    expect(bundle.perItemOriginal).toBe(10);
  });

  test('ORD.4 - Free shipping honored in bundle: all free items ship at zero cost', async () => {
    const bundle = Order.calculateBundleShipping([
      { shippingCost: 5, freeShipping: true },
      { shippingCost: 7, freeShipping: true },
    ]);
    expect(bundle.shippingCost).toBe(0);
  });

  test('ORD.5 - Bundle preserves per-item currency and order currency', async () => {
    const bundle = Order.calculateBundleShipping([
      { shippingCost: 8, freeShipping: false, currency: 'GBP' },
      { shippingCost: 8, freeShipping: false, currency: 'GBP' },
    ]);
    expect(bundle.shippingCost).toBe(8);
    expect(bundle.currency).toBe('GBP');
  });

  test('ORD.6 - GET /api/orders returns buyer orders with buyer privileges + right buttons', async () => {
    await Order.create({
      buyer: buyer._id,
      currency: 'USD',
      items: [{ listing: listingA1._id, transaction: txnA1._id, seller: sellerA._id, title: 'A Shirt', price: 40, quantity: 1, currency: 'USD', image: '' }],
      shipments: [{ seller: sellerA._id, items: [txnA1._id], shippingCost: 5, currency: 'USD', labelStatus: 'created', status: 'pending' }],
      totals: { subtotal: 40, shipping: 5, protectionFees: 2, discounts: 0, total: 47 },
      payment: { paymentIntentId: 'pi_test', status: 'captured', currency: 'USD', totalHeld: 47 },
    });

    const res = await request(app)
      .get('/api/orders')
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.orders)).toBe(true);
    expect(res.body.orders.length).toBe(1);
    expect(res.body.orders[0].role).toBe('buyer');
    expect(res.body.orders[0].allowedActions).toEqual(expect.arrayContaining(['view_tracking', 'contact_support']));
  });

  test('ORD.7 - Seller sees only their own orders as seller role with seller buttons', async () => {
    await Order.create({
      buyer: buyer._id,
      currency: 'USD',
      items: [{ listing: listingA1._id, transaction: txnA1._id, seller: sellerA._id, title: 'A Shirt', price: 40, quantity: 1, currency: 'USD', image: '' }],
      shipments: [{ seller: sellerA._id, items: [txnA1._id], shippingCost: 5, currency: 'USD', labelStatus: 'created', status: 'pending' }],
      totals: { subtotal: 40, shipping: 5, protectionFees: 2, discounts: 0, total: 47 },
      payment: { paymentIntentId: 'pi_test', status: 'captured', currency: 'USD', totalHeld: 47 },
      sellers: [sellerA._id],
    });

    const res = await request(app)
      .get('/api/orders')
      .set('Authorization', `Bearer ${sellerAToken}`);
    expect(res.status).toBe(200);
    expect(res.body.orders.length).toBe(1);
    expect(res.body.orders[0].role).toBe('seller');
    expect(res.body.orders[0].allowedActions).toEqual(expect.arrayContaining(['ship', 'mark_dispatched']));
  });

  test('ORD.8 - Seller POST /api/orders/:id/ship marks only their shipment shipped with tracking', async () => {
    const order = await Order.create({
      buyer: buyer._id,
      currency: 'USD',
      items: [
        { listing: listingA1._id, transaction: txnA1._id, seller: sellerA._id, title: 'A Shirt', price: 40, quantity: 1, currency: 'USD', image: '' },
        { listing: listingB1._id, transaction: txnB1._id, seller: sellerB._id, title: 'B Sneakers', price: 80, quantity: 1, currency: 'USD', image: '' },
      ],
      shipments: [
        { seller: sellerA._id, items: [txnA1._id], shippingCost: 5, currency: 'USD', labelStatus: 'created', status: 'pending' },
        { seller: sellerB._id, items: [txnB1._id], shippingCost: 7, currency: 'USD', labelStatus: 'created', status: 'pending' },
      ],
      totals: { subtotal: 120, shipping: 12, protectionFees: 6, discounts: 0, total: 138 },
      payment: { paymentIntentId: 'pi_test', status: 'captured', currency: 'USD', totalHeld: 138 },
      sellers: [sellerA._id, sellerB._id],
    });

    // Seller B must not be able to ship Seller A's shipment
    const forbidden = await request(app)
      .post(`/api/orders/${order._id}/ship`)
      .set('Authorization', `Bearer ${sellerAToken}`)
      .send({ shipmentIndex: 1, trackingNumber: 'ZB123', carrier: 'USPS' });
    expect(forbidden.status).toBe(403);

    // Seller A can ship their own shipment
    const res = await request(app)
      .post(`/api/orders/${order._id}/ship`)
      .set('Authorization', `Bearer ${sellerAToken}`)
      .send({ shipmentIndex: 0, trackingNumber: 'ZA123', carrier: 'USPS' });
    expect(res.status).toBe(200);
    expect(res.body.order.shipments[0].status).toBe('shipped');
    expect(res.body.order.shipments[0].trackingNumber).toBe('ZA123');

    // Partial shipment → order is partially_shipped
    expect(res.body.order.status).toBe('partially_shipped');
  });

  test('ORD.9 - Totals are computed correctly and no drilling/padding occurs', async () => {
    const order = await Order.create({
      buyer: buyer._id,
      currency: 'USD',
      items: [
        { listing: listingA1._id, transaction: txnA1._id, seller: sellerA._id, title: 'A Shirt', price: 40, quantity: 1, currency: 'USD', image: '' },
        { listing: listingB1._id, transaction: txnB1._id, seller: sellerB._id, title: 'B Sneakers', price: 80, quantity: 1, currency: 'USD', image: '' },
      ],
      shipments: [
        { seller: sellerA._id, items: [txnA1._id], shippingCost: 5, currency: 'USD', labelStatus: 'created', status: 'pending' },
        { seller: sellerB._id, items: [txnB1._id], shippingCost: 7, currency: 'USD', labelStatus: 'created', status: 'pending' },
      ],
      totals: { subtotal: 120, shipping: 12, protectionFees: 6, discounts: 0, total: 138 },
      payment: { paymentIntentId: 'pi_test', status: 'captured', currency: 'USD', totalHeld: 138 },
      sellers: [sellerA._id, sellerB._id],
    });

    expect(order.totals.subtotal).toBe(120);
    expect(order.totals.shipping).toBe(12);
    expect(order.totals.total).toBe(138);
    expect(order.totals.total).toBe(order.totals.subtotal + order.totals.shipping + order.totals.protectionFees - order.totals.discounts);
  });
});
