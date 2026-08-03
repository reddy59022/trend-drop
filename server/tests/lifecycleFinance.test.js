/**
 * FINANCIAL LIFE-CYCLE INTEGRITY (TDD)
 *
 * End-to-end: listing create → edit → multi-currency cart (qty add/remove)
 * → checkout (label + escrow) → confirmation (customer currency)
 * → payout release → multi-seller split → zero-leakage ledger.
 *
 * Ledger identity per item:
 *   buyerPaid = sellerEarnings + platformCommission + shippingCost + buyerProtectionFee
 *   sellerPending = qty × sellerEarnings
 *   inventoryDecrement = qty
 */
const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const app = require('../server');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Transaction = require('../models/Transaction');
const Payout = require('../models/Payout');
const Order = require('../models/Order');
const Cart = require('../models/Cart');

const PASS = 'password123';
const SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';
const mkEmail = p => `${p}_lifecycle_${Date.now()}@test.com`;
const shippingAddress = {
  fullName: 'Lifecycle Buyer', street1: '1 Main St', city: 'Austin',
  state: 'TX', postalCode: '78701', country: 'US', phone: '555-0001',
};

let seller1, seller2, buyer;
let s1Token, s2Token, bToken;

async function makeUser(name, email, country, currency) {
  const u = await User.create({
    name, email: email.toLowerCase(), password: PASS, emailVerified: true,
    authProvider: 'email', country, currency,
    shippingAddress: { fullName: name, street1: '1 St', city: 'C', state: 'S', postalCode: '11111', country },
    balance: { available: 0, pending: 0, totalEarned: 0, totalPaidOut: 0, currency },
    stats: { totalSales: 5, totalPurchases: 0, strikes: 0 },
  });
  return { user: u, token: jwt.sign({ id: u._id }, SECRET, { expiresIn: '30d' }) };
}

function mockPi(status = 'succeeded') {
  const id = `pi_lc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  if (!global.__mockPaymentIntents) global.__mockPaymentIntents = {};
  global.__mockPaymentIntents[id] = { id, status, amount: 0 };
  return id;
}

async function seedListing(seller, overrides = {}) {
  return Listing.create({
    seller: seller._id, title: 'Lifecycle Item', description: 'desc',
    price: 50, category: 'Men', condition: 'New with tags',
    currency: seller.currency || 'USD', available: true, sold: false,
    quantity: 10, shipsFrom: seller.country || 'US', weight: 1,
    ...overrides,
  });
}

beforeAll(async () => {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/trend-drop-test';
  if (mongoose.connection.readyState === 0) await mongoose.connect(uri);
  const re = /lifecycle/;
  await Promise.all([
    User.deleteMany({ email: re }),
    Listing.deleteMany({ title: re }),
    Transaction.deleteMany({}),
    Payout.deleteMany({}),
    Order.deleteMany({}),
    Cart.deleteMany({}),
  ]);

  const a = await makeUser('LS1', mkEmail('s1'), 'US', 'USD'); seller1 = a.user; s1Token = a.token;
  const b = await makeUser('LS2', mkEmail('s2'), 'GB', 'GBP'); seller2 = b.user; s2Token = b.token;
  const c = await makeUser('LSB', mkEmail('buyer'), 'US', 'USD'); buyer = c.user; bToken = c.token;
});

afterAll(async () => {
  const re = /lifecycle/;
  await Promise.all([
    User.deleteMany({ email: re }),
    Listing.deleteMany({ title: re }),
    Transaction.deleteMany({}),
    Payout.deleteMany({}),
    Order.deleteMany({}),
    Cart.deleteMany({}),
  ]);
  await mongoose.disconnect();
});

describe('Financial Life-Cycle Integrity (zero leakage)', () => {
  test('1. listing created and visible (opened) with exact price/currency/qty', async () => {
    const res = await request(app)
      .post('/api/listings')
      .set('Authorization', `Bearer ${s1Token}`)
      .field('title', 'Lifecycle Item USD')
      .field('description', 'desc')
      .field('price', 50)
      .field('category', 'Men')
      .field('condition', 'New with tags')
      .field('brand', 'B')
      .field('size', 'M')
      .field('color', 'Black')
      .field('currency', 'USD')
      .field('weight', 1)
      .field('quantity', 10);
    expect(res.status).toBe(201);
    const l = res.body.listing;
    expect(l.price).toBe(50);
    expect(l.currency).toBe('USD');
    expect(l.quantity).toBe(10);

    const open = await request(app).get(`/api/listings/${l._id}`);
    expect(open.status).toBe(200);
    expect(open.body.listing).toBeDefined();
    global.USD_LISTING = l._id;
  });

  test('2. listing can be edited (price change) and persists', async () => {
    const listingId = global.USD_LISTING;
    const edit = await request(app)
      .put(`/api/listings/${listingId}`)
      .set('Authorization', `Bearer ${s1Token}`)
      .field('price', 60)
      .field('quantity', 8);
    expect(edit.status).toBe(200);
    const updated = await Listing.findById(listingId);
    expect(updated.price).toBe(60);
    expect(updated.quantity).toBe(8);
  });

  test('3. multi-currency cart: add qty 2 US$60 + qty 1 UK£40, verify shipping', async () => {
    const usd = await seedListing(seller1, { title: 'Lifecycle Item B', price: 60, quantity: 8 });
    const gbp = await seedListing(seller2, { title: 'Lifecycle Item C', price: 40, quantity: 5, currency: 'GBP' });
    global.LUS = usd._id;
    global.LGB = gbp._id;

    const r1 = await request(app).post('/api/cart/items').set('Authorization', `Bearer ${bToken}`)
      .send({ listingId: usd._id.toString(), quantity: 2 });
    expect(r1.status).toBe(200);
    expect(r1.body.cart.items.length).toBe(1);
    expect(r1.body.cart.items[0].quantity).toBe(2);

    const r2 = await request(app).post('/api/cart/items').set('Authorization', `Bearer ${bToken}`)
      .send({ listingId: gbp._id.toString(), quantity: 1 });
    expect(r2.status).toBe(200);
    expect(r2.body.cart.items.length).toBe(2);

    // quantity mutation: bump USD to 3
    const r3 = await request(app).post('/api/cart/items').set('Authorization', `Bearer ${bToken}`)
      .send({ listingId: usd._id.toString(), quantity: 3 });
    expect(r3.status).toBe(200);
    const usdItem = r3.body.cart.items.find(i => i.listing._id.toString() === usd._id.toString());
    expect(usdItem.quantity).toBe(3);
  });

  test('4. cart remove scenario: removing GBP then re-adding works', async () => {
    const del = await request(app).delete(`/api/cart/items/${global.LGB}`).set('Authorization', `Bearer ${bToken}`);
    expect(del.status).toBe(200);
    expect(del.body.cart.items.length).toBe(1);

    const re = await request(app).post('/api/cart/items').set('Authorization', `Bearer ${bToken}`)
      .send({ listingId: global.LGB.toString(), quantity: 1 });
    expect(re.status).toBe(200);
    expect(re.body.cart.items.length).toBe(2);
  });

  test('5. cart prevents quantity above stock', async () => {
    const over = await request(app).post('/api/cart/items').set('Authorization', `Bearer ${bToken}`)
      .send({ listingId: global.LUS.toString(), quantity: 999 });
    expect(over.status).toBe(400);
    expect(over.body.message).toMatch(/available/i);
  });

  test('6. confirm-batch checkout: one order, per-seller shipments, labels, escrow', async () => {
    const pi = mockPi('succeeded');
    const r = await request(app)
      .post('/api/payments/confirm-batch')
      .set('Authorization', `Bearer ${bToken}`)
      .send({
        paymentIntentId: pi,
        items: [
          { listingId: global.LUS.toString(), quantity: 3 },
          { listingId: global.LGB.toString(), quantity: 1 },
        ],
        shippingAddress,
        buyerCurrency: 'USD',
      });
    expect(r.status).toBe(200);
    expect(r.body.orders).toBeDefined();
    const order = r.body.orders[0] || r.body.order;
    expect(order).toBeDefined();
    expect(order.orderNumber).toMatch(/^TD-/);
    global.ORDER_ID = order._id;
    global.TXNS = r.body.transactions;
    expect(r.body.transactions.length).toBe(2);
  });

  test('7. NO LEAKAGE: inventory decremented by exact quantity', async () => {
    const usd = await Listing.findById(global.LUS); // 8 → buy 3 → 5
    expect(usd.quantity).toBe(5);
    const gbp = await Listing.findById(global.LGB); // 5 → buy 1 → 4
    expect(gbp.quantity).toBe(4);
  });

  test('8. NO LEAKAGE: item subtotal = qty × price, platform fee on full subtotal', async () => {
    const usdTxn = await Transaction.findOne({ listing: global.LUS });
    const gbpTxn = await Transaction.findOne({ listing: global.LGB });
    expect(usdTxn.itemPrice).toBe(180);            // 3 × 60
    expect(usdTxn.paymentBreakdown.subtotal).toBe(180);
    expect(gbpTxn.itemPrice).toBe(40);             // 1 × 40 GBP
    expect(gbpTxn.currency).toBe('GBP');
    // platform fee = 8% × 180
    expect(usdTxn.paymentBreakdown.platformFee).toBeCloseTo(14.4, 1);
  });

  test('9. ESCROW: seller pending credited qty × earnings, available untouched', async () => {
    const s1 = await User.findById(seller1._id);
    expect(s1.balance.pending).toBeGreaterThan(0);
    expect(s1.balance.available).toBe(0);
    // 3 × (60 − 4.8) = 165.6
    expect(s1.balance.pending).toBeCloseTo(165.6, 1);
  });

  test('10. LABEL generated per transaction', async () => {
    const usdTxn = await Transaction.findOne({ listing: global.LUS });
    expect(usdTxn.shipping.labelCreated).toBe(true);
    expect(usdTxn.shipping.trackingNumber).toBeTruthy();
  });

  test('11. multi-seller split: each seller credited THEIR currency earnings', async () => {
    const s1 = await User.findById(seller1._id);
    const s2 = await User.findById(seller2._id);
    // GB: 1 × (40 − 3.2) = 36.8 credited in GBP balance
    expect(s2.balance.currency).toBe('GBP');
    expect(s2.balance.pending).toBeGreaterThan(0);
    const gbpTxn = await Transaction.findOne({ listing: global.LGB });
    expect(gbpTxn.currency).toBe('GBP');
  });

  test('12. LEDGER: no platform leakage — fees reconcile exactly per item', async () => {
    const usdTxn = await Transaction.findOne({ listing: global.LUS });
    const gbpTxn = await Transaction.findOne({ listing: global.LGB });
    for (const txn of [usdTxn, gbpTxn]) {
      const pb = txn.paymentBreakdown;
      const sum = Math.round((pb.sellerEarnings + pb.platformFee + pb.shippingCost + pb.buyerProtectionFee) * 100) / 100;
      expect(pb.totalPaid).toBe(sum);
    }
  });

  test('13. order confirmation shows customer currency + totals', async () => {
    const order = await Order.findById(global.ORDER_ID).populate('items.transaction');
    expect(order).toBeDefined();
    expect(order.currency).toBe('USD');
    expect(order.totalAmount).toBeGreaterThan(0);
    expect(order.shipments.length).toBe(2);
  });

  test('14. CANCELLATION: no leakage — pending clawed back, inventory restored', async () => {
    // cancel the GBP transaction pre-shipment by moving txn to paid (escrow), then cancel
    const gbpTxn = await Transaction.findOne({ listing: global.LGB });
    gbpTxn.status = 'paid';
    await gbpTxn.save();
    const before = await User.findById(seller2._id);
    const cancel = await request(app)
      .post(`/api/orders/${gbpTxn._id}/cancel`)
      .set('Authorization', `Bearer ${bToken}`)
      .send({ reason: 'changed mind' });
    expect(cancel.status).toBe(200);
    const after = await User.findById(seller2._id);
    expect(after.balance.pending).toBeLessThan(before.balance.pending);
    const gbp = await Listing.findById(global.LGB);
    expect(gbp.quantity).toBe(5); // restored
  });
});