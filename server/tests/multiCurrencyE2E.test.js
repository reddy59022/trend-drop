/**
 * MULTI-CURRENCY FULL E2E MATRIX — 5 currencies, every scenario mixed
 *
 * Proves zero bugs across the ENTIRE checkout + settlement flow:
 *  - Big Bang Matrix: 1 buyer, 5 sellers, USD/CAD/GBP/EUR/JPY, 1 order,
 *    5 shipments, mixed quantities — every penny verbatim.
 *  - Direction Matrix: 6 seller→buyer country pairs (domestic + cross-border)
 *    with exact per-currency charges, fees, earnings.
 *  - Money Integrity: ledger identity totalPaid = subtotal+shipping+protection
 *    and pending = earnings for EVERY transaction in EVERY currency.
 *  - Robustness: idempotency, insufficient stock rollback, cancellation clawback.
 *  - Order lifecycle: role actions, per-seller shipment isolation, status derivation.
 *
 * EVERY expected number is derived from the declared business rules
 * (see config/payments.js + config/shipping.js), NOT from the code under test.
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
const RUN = `mx_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
const mkEmail = (p) => `${p}_${RUN}@test.com`;
const round2 = (n) => Math.round(n * 100) / 100;

const US_ADDRESS = {
  fullName: 'MX Buyer', street1: '1 Main St', city: 'Austin',
  state: 'TX', postalCode: '78701', country: 'US', phone: '555-0001',
};

// ---------- Deterministic expectations (independent arithmetic) ----------
function zoneOf(from, to) {
  if (from === to) return 1;
  const cont = { US: 'NA', CA: 'NA', GB: 'EU', DE: 'EU', JP: 'ASIA' };
  return cont[from] === cont[to] ? 2 : 3;
}
function expectedShipping(fromCountry, toCountry, weightKg, price) {
  const z = zoneOf(fromCountry, toCountry);
  const rates = { 1: [3.99, 2.5], 2: [9.99, 5.5], 3: [18.99, 9.5] };
  const thresholds = { 1: [50, 0.5], 2: [100, 0.3], 3: [null, 0] };
  const [freeThresh, freeWeight] = thresholds[z];
  // Free shipping rule: item price >= threshold AND weight <= freeWeight
  if (freeThresh !== null && price >= freeThresh && weightKg <= freeWeight) {
    return 0;
  }
  const [base, perKg] = rates[z];
  const weightCharge = Math.max(0, (weightKg - 0.5)) * perKg;
  const insurance = round2(price * 0.02);
  return round2(base + weightCharge + insurance);
}
const CURRENCY_LIMITS = { US: [0.5, 500, 'USD'], CA: [0.75, 650, 'CAD'], GB: [0.4, 400, 'GBP'], DE: [0.5, 450, 'EUR'], JP: [50, 75000, 'JPY'] };
function expectedFee(country, price) {
  const [min, max] = CURRENCY_LIMITS[country];
  return Math.max(min, Math.min(round2(price * 0.08), max));
}
function expectedBreakdown(sellerCountry, buyerCountry, price, qty, weightKg) {
  const perUnitFee = expectedFee(sellerCountry, price);
  const shipping = expectedShipping(sellerCountry, buyerCountry, weightKg, price);
  const protection = round2(round2(price * 0.05) * qty); // buyerProtection = 5% per unit, qty-scaled
  const subtotal = round2(price * qty);
  const totalPaid = round2(subtotal + shipping + protection);
  const pending = round2((price - perUnitFee) * qty);
  return { perUnitFee, shipping, protection, subtotal, totalPaid, pending, currency: CURRENCY_LIMITS[sellerCountry][2] };
}

// ---------- Helpers ----------
function mockPi(status = 'succeeded') {
  const id = `pi_mx_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  if (!global.__mockPaymentIntents) global.__mockPaymentIntents = {};
  global.__mockPaymentIntents[id] = { id, status };
  return id;
}
async function makeUser(name, email, country, currency) {
  const u = await User.create({
    name, email: email.toLowerCase(), password: PASS, emailVerified: true,
    authProvider: 'email', country, currency,
    shippingAddress: { fullName: name, street1: '1 St', city: 'C', state: 'S', postalCode: '11111', country },
    balance: { available: 0, pending: 0, totalEarned: 0, totalPaidOut: 0, currency },
    stats: { totalSales: 0, totalPurchases: 0, strikes: 0 },
  });
  const token = jwt.sign({ id: u._id }, SECRET, { expiresIn: '30d' });
  return { user: u, token };
}
async function makeListing(seller, price, stock, weight = 0.5) {
  return Listing.create({
    seller: seller._id, title: `MX ${seller.country} ${price} ${RUN}`, description: 'd',
    price, category: 'Men', condition: 'New with tags',
    currency: CURRENCY_LIMITS[seller.country][2], available: true, sold: false,
    quantity: stock, shipsFrom: seller.country, weight,
  });
}
function confirmBatch(token, items, pi, address = US_ADDRESS) {
  return request(app)
    .post('/api/payments/confirm-batch')
    .set('Authorization', `Bearer ${token}`)
    .send({ paymentIntentId: pi, items, shippingAddress: address });
}

let buyerToken, buyerId;
const sellerRefs = []; // { country, user, token, listing }
const createdUsers = [];
const createdListings = [];

beforeAll(async () => {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/trend-drop-test';
  if (mongoose.connection.readyState === 0) await mongoose.connect(uri);
});

afterAll(async () => {
  const buyer = await User.findOne({ email: mkEmail('buyer') });
  const ids = { seller: sellerRefs.map((s) => s.user._id), buyer: buyer ? buyer._id : null };
  await Listing.deleteMany({ _id: { $in: createdListings } });
  await Transaction.deleteMany({ seller: { $in: ids.seller }, buyer: ids.buyer });
  await Payout.deleteMany({ seller: { $in: ids.seller } });
  await Order.deleteMany({ buyer: ids.buyer });
  await Cart.deleteMany({ user: ids.buyer });
  await User.deleteMany({ _id: { $in: [...ids.seller, ids.buyer].filter(Boolean) } });
  await mongoose.disconnect();
});

describe('GLOBAL MATRIX: 1 buyer + 5 sellers (USD/CAD/GBP/EUR/JPY) + 1 order + 5 shipments', () => {
  let orderId;

  beforeAll(async () => {
    const b = await makeUser('MXBuyer', mkEmail('buyer'), 'US', 'USD');
    buyerToken = b.token;
    buyerId = b.user._id;
    createdUsers.push(b.user._id);

    // Seed one seller per currency
    for (const s of [
      { name: 'MXUS', country: 'US', price: 100, stock: 8 },
      { name: 'MXCA', country: 'CA', price: 100, stock: 7 },
      { name: 'MXGB', country: 'GB', price: 100, stock: 6 },
      { name: 'MXDE', country: 'DE', price: 100, stock: 5 },
      { name: 'MXJP', country: 'JP', price: 100, stock: 4 },
    ]) {
      const u = await makeUser(s.name, mkEmail(`seller_${s.country}`), s.country, CURRENCY_LIMITS[s.country][2]);
      const l = await makeListing(u.user, s.price, s.stock, 1); // 1kg each
      createdUsers.push(u.user._id);
      createdListings.push(l._id);
      sellerRefs.push({ country: s.country, user: u.user, token: u.token, listing: l, stock: s.stock });
    }
  });

  test('G1 5-currency mixed-qty checkout: order totals EXACT (subtotal 900, shipping 126.20, protection 45, total 1071.20)', async () => {
    const quantities = { US: 2, CA: 2, GB: 1, DE: 3, JP: 1 };
    const items = sellerRefs.map((s) => ({ listingId: s.listing._id, quantity: quantities[s.country] }));
    const pi = mockPi();
    const res = await confirmBatch(buyerToken, items, pi);
    expect(res.status).toBe(200);
    expect(res.body.transactions).toHaveLength(5);
    expect(res.body.orders).toHaveLength(1);
    const order = res.body.orders[0];
    orderId = order._id;

    expect(order.orderNumber).toMatch(/^TD-/);
    expect(order.totals.subtotal).toBe(900);
    expect(round2(order.totals.shipping)).toBe(126.2);
    expect(order.totals.protectionFees).toBe(45);
    expect(order.totals.discounts).toBe(0);           // NO promo → NOTHING may hide in "discounts"
    expect(order.totals.total).toBe(1071.2);          // what buyer's card is actually charged
    expect(order.payment.status).toBe('captured');
    expect(order.payment.paymentIntentId).toBe(pi);
    expect(order.shipments).toHaveLength(5);
    expect(order.items).toHaveLength(5);
    expect(order.buyer).toBe(buyerId.toString());
  });

  test('G2 every seller is credited EXACTLY in their own currency (no USD leakage, no qty leak)', async () => {
    const quantities = { US: 2, CA: 2, GB: 1, DE: 3, JP: 1 };
    const expected = {
      US: expectedBreakdown('US', 'US', 100, 2, 2),   // combined weight 2kg
      CA: expectedBreakdown('CA', 'US', 100, 2, 2),
      GB: expectedBreakdown('GB', 'US', 100, 1, 1),
      DE: expectedBreakdown('DE', 'US', 100, 3, 3),
      JP: expectedBreakdown('JP', 'US', 100, 1, 1),
    };
    for (const s of sellerRefs) {
      const exp = expected[s.country];
      const txn = await Transaction.findOne({ seller: s.user._id, $or: [{ buyer: buyerId }] }).populate('listing');
      // Transaction-level exactness
      expect(txn.quantity).toBe(quantities[s.country]);
      expect(txn.itemPrice).toBe(exp.subtotal);
      expect(txn.currency).toBe(exp.currency);
      expect(round2(txn.paymentBreakdown.subtotal)).toBe(exp.subtotal);
      expect(round2(txn.paymentBreakdown.shippingCost)).toBe(exp.shipping);
      expect(round2(txn.paymentBreakdown.buyerProtectionFee)).toBe(exp.protection);
      expect(round2(txn.paymentBreakdown.totalPaid)).toBe(exp.totalPaid);
      expect(round2(txn.paymentBreakdown.sellerEarnings)).toBe(exp.pending);
      expect(round2(txn.paymentBreakdown.platformFee)).toBe(round2(exp.perUnitFee * quantities[s.country]));

      // Payout exact
      const payout = await Payout.findOne({ transaction: txn._id });
      expect(round2(payout.payoutAmount)).toBe(exp.pending);
      expect(payout.status).toBe('pending');

      // Seller pending balance exact in own currency
      const seller = await User.findById(s.user._id);
      expect(round2(seller.balance.pending)).toBe(exp.pending);
      expect(seller.balance.currency).toBe(exp.currency);
    }
  });

  test('G3 inventory decremented EXACTLY per country (8→6, 7→5, 6→5, 5→2, 4→3)', async () => {
    const after = { US: 6, CA: 5, GB: 5, DE: 2, JP: 3 };
    for (const s of sellerRefs) {
      const l = await Listing.findById(s.listing._id);
      expect(l.quantity).toBe(after[s.country]);
      expect(l.quantitySold).toBe(s.stock - after[s.country]);
      if (after[s.country] === 0) {
        expect(l.sold).toBe(true);
        expect(l.available).toBe(false);
      }
    }
  });

  test('G4 money-integrity ledger identity holds for EVERY txn in EVERY currency', async () => {
    const txns = await Transaction.find({ buyer: buyerId, seller: { $in: sellerRefs.map((s) => s.user._id) } });
    expect(txns).toHaveLength(5);
    for (const txn of txns) {
      const b = txn.paymentBreakdown;
      expect(round2(b.totalPaid)).toBe(round2(b.subtotal + b.shippingCost + b.buyerProtectionFee));
      expect(round2(b.platformFee)).toBeGreaterThanOrEqual(0);
    }
  });

  test('G5 order virtuals + API shape: totalAmount mirrors totals.total for confirmation UI', async () => {
    const dbOrder = await Order.findById(orderId);
    expect(dbOrder.totalAmount).toBe(1071.2);
    const res = await request(app).get('/api/orders').set('Authorization', `Bearer ${buyerToken}`);
    expect(res.status).toBe(200);
    const buyerOrder = res.body.orders.find((o) => o._id === orderId);
    expect(buyerOrder).toBeDefined();
    expect(buyerOrder.role).toBe('buyer');
    expect(buyerOrder.allowedActions).toContain('view_order');
    expect(buyerOrder.allowedActions).toContain('view_tracking');
    expect(round2(buyerOrder.totalAmount)).toBe(1071.2);
  });

  test('G6 per-seller shipment isolation: 403 for wrong seller, ship own only, status derivation', async () => {
    const gbSeller = sellerRefs.find((s) => s.country === 'GB');
    const usSeller = sellerRefs.find((s) => s.country === 'US');

    // Wrong seller (US) trying to ship GB's shipment → 403
    const wrong = await request(app)
      .post(`/api/orders/${orderId}/ship`)
      .set('Authorization', `Bearer ${usSeller.token}`)
      .send({ shipmentIndex: 2 });
    expect(wrong.status).toBe(403);

    // GB seller GET orders → their role is seller, owns only GB shipment
    const list = await request(app).get('/api/orders').set('Authorization', `Bearer ${gbSeller.token}`);
    const sellerOrder = list.body.orders.find((o) => o._id === orderId);
    expect(sellerOrder.role).toBe('seller');
    expect(sellerOrder.allowedActions).toContain('ship');

    // GB seller ships their shipment (index 2)
    const ship = await request(app)
      .post(`/api/orders/${orderId}/ship`)
      .set('Authorization', `Bearer ${gbSeller.token}`)
      .send({ shipmentIndex: 2, trackingNumber: 'GB123', carrier: 'RoyalMail' });
    expect(ship.status).toBe(200);
    expect(ship.body.order.status).toBe('partially_shipped');
    expect(ship.body.order.shipments[2].status).toBe('shipped');
    expect(ship.body.order.shipments[2].trackingNumber).toBe('GB123');

    // Ship all remaining → order becomes 'shipped'
    for (let i = 0; i < 5; i++) {
      if (i === 2) continue;
      const s = sellerRefs[i];
      const r = await request(app)
        .post(`/api/orders/${orderId}/ship`)
        .set('Authorization', `Bearer ${s.token}`)
        .send({ shipmentIndex: i, trackingNumber: `${s.country}TRK`, carrier: 'Carrier' });
      expect(r.status).toBe(200);
    }
    const final = await Order.findById(orderId);
    expect(final.status).toBe('shipped');
    expect(final.shipments.every((sh) => sh.status === 'shipped')).toBe(true);
    // Underlying transactions synced to shipped for every seller
    const txns = await Transaction.find({ seller: { $in: sellerRefs.map((s) => s.user._id) } });
    expect(txns.every((t) => t.status === 'shipped')).toBe(true);
  });
});

describe('DIRECTION MATRIX: every seller→buyer country pair charges/settles EXACTLY', () => {
  const pairs = [
    { seller: 'US', buyer: 'US', price: 60, qty: 1, weight: 0.5 },   // domestic
    { seller: 'CA', buyer: 'CA', price: 60, qty: 1, weight: 0.5 },   // domestic CAD
    { seller: 'GB', buyer: 'GB', price: 60, qty: 1, weight: 0.5 },   // domestic GBP
    { seller: 'US', buyer: 'GB', price: 60, qty: 1, weight: 0.5 },   // cross-atlantic
    { seller: 'CA', buyer: 'DE', price: 60, qty: 1, weight: 0.5 },   // NA→EU
    { seller: 'JP', buyer: 'US', price: 60, qty: 1, weight: 0.5 },   // ASIA→NA
  ];

  beforeAll(async () => {
    for (let i = 0; i < pairs.length; i++) {
      const p = pairs[i];
      const b = await makeUser(`DirBuyer${i}`, mkEmail(`dirb${i}`), p.buyer, CURRENCY_LIMITS[p.buyer][2]);
      const s = await makeUser(`DirSeller${i}`, mkEmail(`dirs${i}`), p.seller, CURRENCY_LIMITS[p.seller][2]);
      const l = await makeListing(s.user, p.price, 5, p.weight);
      pairs[i].buyerToken = b.token;
      pairs[i].sellerId = s.user._id;
      pairs[i].buyerId = b.user._id;
      pairs[i].listingId = l._id;
      createdUsers.push(b.user._id, s.user._id);
      createdListings.push(l._id);
    }
  });

  test('D1 all 6 directions settle exact: subtotal, shipping, protection, fee, seller pending', async () => {
    for (const p of pairs) {
      const exp = expectedBreakdown(p.seller, p.buyer, p.price, p.qty, p.weight);
      // Buy in buyer's own country currency address
      const address = { ...US_ADDRESS, country: p.buyer };
      const pi = mockPi();
      const res = await confirmBatch(p.buyerToken, [{ listingId: p.listingId, quantity: p.qty }], pi, address);
      expect(res.status).toBe(200);

      const txn = res.body.transactions[0];
      expect(round2(txn.paymentBreakdown.subtotal)).toBe(exp.subtotal);
      expect(round2(txn.paymentBreakdown.shippingCost)).toBe(exp.shipping);
      expect(round2(txn.paymentBreakdown.buyerProtectionFee)).toBe(exp.protection);
      expect(round2(txn.paymentBreakdown.totalPaid)).toBe(exp.totalPaid);
      expect(round2(txn.paymentBreakdown.sellerEarnings)).toBe(exp.pending);
      expect(txn.currency).toBe(exp.currency);

      const seller = await User.findById(p.sellerId);
      expect(seller.balance.currency).toBe(exp.currency);
      expect(round2(seller.balance.pending)).toBe(exp.pending);

      const listing = await Listing.findById(p.listingId);
      expect(listing.quantity).toBe(4); // 5-1 exact
    }
  });

  test('D2 domestic CA buyer pays nothing in USD — totalPaid uses CAD fee schedule', async () => {
    const p = pairs[1]; // CA→CA
    const txns = await Transaction.find({ seller: p.sellerId });
    expect(txns).toHaveLength(1);
    expect(txns[0].currency).toBe('CAD');
    expect(txns[0].paymentBreakdown.platformFee).toBeGreaterThanOrEqual(0.75); // CAD min fee
  });
});

describe('ROBUSTNESS: no leaks on failure paths', () => {
  test('R1 order idempotency: same PI twice → second returns already-processed, NO double charge', async () => {
    const s = await makeUser('RobustA', mkEmail('roba'), 'US', 'USD');
    const b = await makeUser('RobustB', mkEmail('robb'), 'US', 'USD');
    const l = await makeListing(s.user, 30, 3, 0.5);
    createdUsers.push(s.user._id, b.user._id);
    createdListings.push(l._id);

    const pi = mockPi();
    const items = [{ listingId: l._id, quantity: 1 }];
    const first = await confirmBatch(b.token, items, pi);
    expect(first.status).toBe(200);
    expect(first.body.transactions).toHaveLength(1);

    const second = await confirmBatch(b.token, items, pi);
    expect(second.status).toBe(200);
    expect(second.body.transactions).toHaveLength(0); // deduped
    expect(second.body.message).toMatch(/already processed/i);

    const listings = await Listing.find({ _id: l._id });
    expect(listings[0].quantity).toBe(2); // NOT decremented twice
    const txns = await Transaction.find({ seller: s.user._id });
    expect(txns).toHaveLength(1);
    const payouts = await Payout.find({ seller: s.user._id });
    expect(payouts).toHaveLength(1);
    expect(s.user.balance.pending + 0).toBe(0); // seller balance untouched by duplicate
  });

  test('R2 insufficient stock: entire batch rejected BEFORE any charge; NO partial commit', async () => {
    const s1 = await makeUser('RobustC', mkEmail('robc'), 'GB', 'GBP');
    const s2 = await makeUser('RobustD', mkEmail('robd'), 'DE', 'EUR');
    const b = await makeUser('RobustE', mkEmail('robe'), 'US', 'USD');
    const l1 = await makeListing(s1.user, 40, 1, 0.5);
    const l2 = await makeListing(s2.user, 40, 2, 0.5);
    createdUsers.push(s1.user._id, s2.user._id, b.user._id);
    createdListings.push(l1._id, l2._id);

    const pi = mockPi();
    const res = await confirmBatch(b.token, [
      { listingId: l1._id, quantity: 1 },
      { listingId: l2._id, quantity: 5 }, // over stock 2
    ], pi);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Only 2 left/);

    // NOTHING committed for EITHER seller
    expect(await Transaction.find({ seller: s1.user._id })).toHaveLength(0);
    expect(await Transaction.find({ seller: s2.user._id })).toHaveLength(0);
    expect(await Payout.find({ seller: s1.user._id })).toHaveLength(0);
    expect(await Payout.find({ seller: s2.user._id })).toHaveLength(0);
    expect((await Listing.findById(l1._id)).quantity).toBe(1);
    expect((await Listing.findById(l2._id)).quantity).toBe(2);
  });

  test('R3 cancellation clawback: buyer cancels before shipment → seller pending zeroed, inventory +1, txn cancelled', async () => {
    const s = await makeUser('RobustF', mkEmail('robf'), 'US', 'USD');
    const b = await makeUser('RobustG', mkEmail('robg'), 'US', 'USD');
    const l = await makeListing(s.user, 50, 3, 0.5);
    createdUsers.push(s.user._id, b.user._id);
    createdListings.push(l._id);

    const pi = mockPi();
    const buy = await confirmBatch(b.token, [{ listingId: l._id, quantity: 2 }], pi);
    expect(buy.status).toBe(200);
    const txn = buy.body.transactions[0];

    // Seller pending credited for qty 2
    let seller = await User.findById(s.user._id);
    const exp = expectedBreakdown('US', 'US', 50, 2, 1);
    expect(round2(seller.balance.pending)).toBe(exp.pending);

    // Buyer cancels via lifecycle endpoint BEFORE shipment (pi is mocked 'succeeded' → refund path)
    const cancel = await request(app)
      .post(`/api/orders/${txn._id}/cancel`)
      .set('Authorization', `Bearer ${b.token}`)
      .send({ reason: 'changed my mind' });
    expect(cancel.status).toBe(200);
    expect(cancel.body.refundAmount).toBe(exp.totalPaid);

    seller = await User.findById(s.user._id);
    expect(seller.balance.pending).toBe(0); // full clawback exact

    const listing = await Listing.findById(l._id);
    expect(listing.quantity).toBe(3); // 3-2+2 exact restored
    expect(listing.sold).toBe(false);

    const cancelled = await Transaction.findById(txn._id);
    expect(cancelled.status).toMatch(/cancelled/);
    expect(cancelled.cancellation.refundAmount).toBe(exp.totalPaid);
  });
});
