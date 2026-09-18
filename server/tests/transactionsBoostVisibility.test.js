/**
 * SELLER-ONLY BOOST FEE VISIBILITY + SELF-CLOSING EARNINGS TALLY
 *
 * Reported defect (production, /transactions → Sold tab) for a $30 sale:
 *
 *   Item Price          $30.00
 *   Platform Fee (10%)  -$2.40     <- hardcoded "10%"; the record stores 8%
 *   Shipping Payout      $4.59
 *   Your Earnings       $24.60     <- 30 - 2.40 (8% platform) - 3.00 (boost)
 *
 * The $3.00 boost fee that produced the $24.60 "Your Earnings" was never shown,
 * so the breakdown could not add up. Two independent defects are pinned here:
 *
 *   1. TALLY — `paymentBreakdown.sellerEarnings` is persisted NET of the boost
 *      fee (routes/transactions.js, routes/payments.js, routes/cart.js), but no
 *      client ever rendered that row. The API must therefore expose a canonical,
 *      self-closing seller breakdown (utils/transactionView.js) so the seller
 *      facing column reconciles by construction.
 *
 *   2. PRIVACY — `paymentBreakdown.boostFee` / `boostTier` were returned to the
 *      BUYER on every transaction, order and purchase-receipt payload. How much
 *      a seller spends on advertising is seller-only data and must never reach
 *      a buyer's payload.
 *
 * IMPORTANT: the boost fee stays in the DATABASE exactly as written — it is the
 * ledger the payout and the cancel/return reversal logic read. Only the VIEW
 * changes, so these tests assert BOTH halves: hidden in the payload, intact in
 * the record.
 */
const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const app = require('../server.js');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Transaction = require('../models/Transaction');
const Order = require('../models/Order');
const authorizedPaymentIntent = require('./helpers/authorizedPayment');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';
const PASS = 'password123';
const ADDR = { fullName: 'Boost Buyer', street1: '1 St', city: 'Frisco', state: 'TX', postalCode: '75035', country: 'US' };

const sign = (user) => jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '30d' });
const round2 = (n) => Math.round(n * 100) / 100;

let buyer, seller, outsider, buyerToken, sellerToken, outsiderToken;

const makeUser = async (name, prefix) => User.create({
  name,
  email: `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@test.com`,
  password: PASS,
  emailVerified: true,
  authProvider: 'email',
  country: 'US',
  currency: 'USD',
  shippingAddress: { ...ADDR, fullName: name },
  balance: { available: 0, pending: 0, totalEarned: 0, totalPaidOut: 0, currency: 'USD' },
  stats: { totalSales: 0, totalPurchases: 0, strikes: 0 },
});

// The exact reported sale: $30 item, 8% platform commission ($2.40), a standard
// boost (10% => $3.00) and a $4.59 shipping reimbursement. sellerEarnings is the
// stored NET figure the seller is actually credited: 30 - 2.40 - 3.00 = 24.60.
const REPORTED_SALE = {
  subtotal: 30,
  shippingCost: 4.59,
  buyerProtectionFee: 1.5,
  buyerProtectionPercent: 5,
  tax: 0,
  totalPaid: 36.09,
  platformFee: 2.4,
  platformFeePercent: 8,
  shippingPayout: 4.59,
  sellerEarnings: 24.6,
  boostFee: 3,
  boostTier: 'standard',
};

const makeListing = (overrides = {}) => Listing.create({
  seller: seller._id,
  title: 'Boosted Jacket',
  description: 'Test listing',
  price: 30,
  currency: 'USD',
  category: 'Men',
  brand: 'TestBrand',
  size: 'M',
  condition: 'Good',
  images: [],
  available: true,
  sold: false,
  quantity: 100,
  shipsFrom: 'US',
  boost: { active: true, tier: 'standard' },
  ...overrides,
});

const makeTransaction = async (breakdown = REPORTED_SALE, overrides = {}) => {
  const listing = await makeListing();
  return Transaction.create({
    listing: listing._id,
    buyer: buyer._id,
    seller: seller._id,
    quantity: 1,
    itemPrice: breakdown.subtotal,
    currency: 'USD',
    paymentBreakdown: { ...breakdown },
    status: 'paid',
    shipping: { carrier: 'USPS', trackingNumber: 'US1789610063648EZGJGO', estimatedDelivery: new Date() },
    ...overrides,
  });
};

beforeAll(async () => {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/trend-drop-test');
  }
  buyer = await makeUser('Boost Buyer', 'txnview_buyer');
  seller = await makeUser('Boost Seller', 'txnview_seller');
  outsider = await makeUser('Nosy Outsider', 'txnview_outsider');
  buyerToken = sign(buyer);
  sellerToken = sign(seller);
  outsiderToken = sign(outsider);
});

beforeEach(async () => {
  await Transaction.deleteMany({});
  await Order.deleteMany({});
  await Listing.deleteMany({});
});

// ============================================================
// 1. SELLER VIEW — the tally must close, boost row must exist
// ============================================================
describe('Seller earnings tally (GET /api/transactions)', () => {
  test('SB.1 the reported sale reconciles: 30.00 - 2.40 - 3.00 = 24.60', async () => {
    await makeTransaction();

    const res = await request(app)
      .get('/api/transactions?type=sold')
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200);

    const txn = res.body.transactions[0];
    expect(txn.viewerRole).toBe('seller');

    // The seller keeps seeing their own ledger row...
    expect(txn.paymentBreakdown.boostFee).toBe(3);
    expect(txn.paymentBreakdown.boostTier).toBe('standard');

    // ...plus the canonical breakdown the UI renders.
    const bd = txn.sellerBreakdown;
    expect(bd).toBeTruthy();
    expect(bd.currency).toBe('USD');
    expect(bd.itemPrice).toBe(30);
    expect(bd.platformFee).toBe(2.4);
    expect(bd.platformFeePercent).toBe(8); // data-driven label, never a literal
    expect(bd.boostFee).toBe(3);
    expect(bd.boostTier).toBe('standard');
    expect(bd.boostTierLabel).toBe('Standard Boost');
    expect(bd.shippingPayout).toBe(4.59);
    expect(bd.sellerEarnings).toBe(24.6);

    // The column closes exactly (this is what "all the amount should be tallied" means).
    expect(round2(bd.itemPrice - bd.platformFee - bd.boostFee)).toBe(bd.sellerEarnings);
    expect(bd.residual).toBe(0);
    expect(bd.reconciled).toBe(true);
    // Shipping is a label-cost reimbursement in this ledger shape, NOT earnings.
    expect(bd.shippingIncludedInEarnings).toBe(false);
  });

  test('SB.2 detail endpoint returns the same canonical seller breakdown', async () => {
    const txn = await makeTransaction();

    const res = await request(app)
      .get(`/api/transactions/${txn._id}`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200);

    expect(res.body.viewerRole).toBe('seller');
    expect(res.body.sellerBreakdown.boostFee).toBe(3);
    expect(res.body.sellerBreakdown.boostTierLabel).toBe('Standard Boost');
    expect(res.body.sellerBreakdown.reconciled).toBe(true);
  });

  test('SB.3 elite tier is labelled and tallied from stored data, not a literal', async () => {
    const elite = {
      ...REPORTED_SALE,
      subtotal: 100,
      platformFee: 8,
      boostFee: 20,
      boostTier: 'elite',
      sellerEarnings: 72, // 100 - 8 - 20
    };
    await makeTransaction(elite);

    const res = await request(app)
      .get('/api/transactions?type=sold')
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200);

    const bd = res.body.transactions[0].sellerBreakdown;
    expect(bd.boostTierLabel).toBe('Elite Boost');
    expect(bd.itemPrice - bd.platformFee - bd.boostFee).toBe(bd.sellerEarnings);
    expect(bd.reconciled).toBe(true);
  });

  test('SB.4 legacy transaction with no boost fields still closes the tally (no NaN)', async () => {
    const legacy = {
      subtotal: 50, shippingCost: 5, buyerProtectionFee: 2.5, buyerProtectionPercent: 5, tax: 0,
      totalPaid: 57.5, platformFee: 4, platformFeePercent: 8, shippingPayout: 5, sellerEarnings: 46,
    };
    await makeTransaction(legacy);

    const res = await request(app)
      .get('/api/transactions?type=sold')
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200);

    const bd = res.body.transactions[0].sellerBreakdown;
    expect(bd.boostFee).toBe(0);
    expect(bd.boostTierLabel).toBe('');
    expect(bd.itemPrice - bd.platformFee - bd.boostFee).toBe(bd.sellerEarnings);
    expect(bd.reconciled).toBe(true);
    expect(Number.isFinite(bd.residual)).toBe(true);
  });

  test('SB.5 shipping-inclusive ledger shape (config/shipping.js) is detected and closes', async () => {
    // routes/shipping.js computes sellerEarnings = price - platformFee + shippingCost,
    // so the same UI must not assume shipping is outside earnings.
    const inclusive = {
      ...REPORTED_SALE,
      sellerEarnings: round2(30 - 2.4 - 3 + 4.59), // 29.19
    };
    await makeTransaction(inclusive);

    const res = await request(app)
      .get('/api/transactions?type=sold')
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200);

    const bd = res.body.transactions[0].sellerBreakdown;
    expect(bd.shippingIncludedInEarnings).toBe(true);
    expect(bd.reconciled).toBe(true);
    expect(round2(bd.itemPrice - bd.platformFee - bd.boostFee + bd.shippingPayout)).toBe(bd.sellerEarnings);
  });

  test('SB.6 an unreconciled legacy record exposes the residual so the column can still close', async () => {
    // A historic record whose stored net cannot be explained by its components
    // (e.g. a pre-boost-era write). The API must surface the gap instead of
    // rendering a column that silently does not add up.
    const drifted = { ...REPORTED_SALE, sellerEarnings: 20 };
    await makeTransaction(drifted);

    const res = await request(app)
      .get('/api/transactions?type=sold')
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200);

    const bd = res.body.transactions[0].sellerBreakdown;
    expect(bd.reconciled).toBe(false);
    expect(bd.residual).toBe(-4.6); // 20 - (30 - 2.40 - 3.00)
    // residual + expected == stored net, i.e. the UI can always balance.
    expect(round2(bd.expectedEarnings + bd.residual)).toBe(bd.sellerEarnings);
  });
});

// ============================================================
// 2. BUYER PRIVACY — the seller's advertising spend is not buyer data
// ============================================================
describe('Boost fee is never exposed to the buyer', () => {
  test('SB.7 buyer list payload carries no boost fields at all', async () => {
    await makeTransaction();

    const res = await request(app)
      .get('/api/transactions?type=bought')
      .set('Authorization', `Bearer ${buyerToken}`)
      .expect(200);

    const txn = res.body.transactions[0];
    expect(txn.viewerRole).toBe('buyer');
    expect(txn.paymentBreakdown.boostFee).toBeUndefined();
    expect(txn.paymentBreakdown.boostTier).toBeUndefined();
    expect(txn.sellerBreakdown).toBeUndefined();
    // Belt and braces: the raw payload must not leak the tier anywhere.
    expect(JSON.stringify(res.body)).not.toContain('boostFee');
    expect(JSON.stringify(res.body)).not.toContain('boostTier');
    // The buyer still gets what they paid.
    expect(txn.paymentBreakdown.totalPaid).toBe(36.09);
  });

  test('SB.8 buyer detail payload drops the boost fee; seller keeps it', async () => {
    const txn = await makeTransaction();

    const asBuyer = await request(app)
      .get(`/api/transactions/${txn._id}`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .expect(200);
    expect(asBuyer.body.paymentBreakdown.boostFee).toBeUndefined();
    expect(asBuyer.body.paymentBreakdown.boostTier).toBeUndefined();
    expect(asBuyer.body.sellerBreakdown).toBeUndefined();
    expect(asBuyer.body.viewerRole).toBe('buyer');

    const asSeller = await request(app)
      .get(`/api/transactions/${txn._id}`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200);
    expect(asSeller.body.paymentBreakdown.boostFee).toBe(3);
    expect(asSeller.body.sellerBreakdown.reconciled).toBe(true);
  });

  test('SB.9 a non-participant still gets 403 and no data', async () => {
    const txn = await makeTransaction();
    const res = await request(app)
      .get(`/api/transactions/${txn._id}`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .expect(403);
    expect(JSON.stringify(res.body)).not.toContain('boost');
  });

  test('SB.10 the buyer’s own boost fee is still visible to the seller only (order status endpoint)', async () => {
    const txn = await makeTransaction();

    const asBuyer = await request(app)
      .get(`/api/orders/${txn._id}/status`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .expect(200);
    expect(asBuyer.body.payment.boostFee).toBeUndefined();
    expect(asBuyer.body.payment.boostTier).toBeUndefined();

    const asSeller = await request(app)
      .get(`/api/orders/${txn._id}/status`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200);
    expect(asSeller.body.payment.boostFee).toBe(3);
  });
});

// ============================================================
// 3. CONSOLIDATED ORDERS — embedded transactions obey the same rule
// ============================================================
describe('Consolidated orders (GET /api/orders/:id)', () => {
  const makeOrder = async (txn) => Order.create({
    orderNumber: `TD-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    buyer: buyer._id,
    sellers: [seller._id],
    currency: 'USD',
    items: [{ listing: txn.listing, transaction: txn._id, seller: seller._id, title: 'Boosted Jacket', price: 30, quantity: 1 }],
    shipments: [{ seller: seller._id, items: [txn._id], status: 'pending', currency: 'USD' }],
    totals: { subtotal: 30, shipping: 4.59, protectionFees: 1.5, discounts: 0, total: 36.09 },
    payment: { paymentIntentId: 'pi_test_order', status: 'captured', currency: 'USD', totalHeld: 36.09 },
  });

  test('SB.11 buyer sees the order without the seller’s boost fee', async () => {
    const txn = await makeTransaction();
    const order = await makeOrder(txn);

    const res = await request(app)
      .get(`/api/orders/${order._id}`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .expect(200);

    expect(res.body.order.role).toBe('buyer');
    const embedded = res.body.order.items[0].transaction;
    expect(embedded.paymentBreakdown.boostFee).toBeUndefined();
    expect(embedded.sellerBreakdown).toBeUndefined();
    expect(JSON.stringify(res.body.order)).not.toContain('boostFee');
  });

  test('SB.12 seller sees the same order WITH the boost fee and a reconciled tally', async () => {
    const txn = await makeTransaction();
    const order = await makeOrder(txn);

    const res = await request(app)
      .get(`/api/orders/${order._id}`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200);

    expect(res.body.order.role).toBe('seller');
    const embedded = res.body.order.items[0].transaction;
    expect(embedded.paymentBreakdown.boostFee).toBe(3);
    expect(embedded.sellerBreakdown.reconciled).toBe(true);
    expect(embedded.sellerBreakdown.boostTierLabel).toBe('Standard Boost');
  });

  test('SB.13 the order list endpoint honours the same viewer rule', async () => {
    const txn = await makeTransaction();
    await makeOrder(txn);

    const asBuyer = await request(app)
      .get('/api/orders')
      .set('Authorization', `Bearer ${buyerToken}`)
      .expect(200);
    expect(asBuyer.body.orders[0].role).toBe('buyer');
    expect(JSON.stringify(asBuyer.body.orders)).not.toContain('boostFee');

    const asSeller = await request(app)
      .get('/api/orders')
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200);
    expect(asSeller.body.orders[0].role).toBe('seller');
    const embedded = asSeller.body.orders[0].items[0].transaction;
    expect(embedded.paymentBreakdown.boostFee).toBe(3);
    expect(embedded.sellerBreakdown.reconciled).toBe(true);
  });
});

// ============================================================
// 4. PURCHASE RECEIPTS — the buyer’s own response stays boost-free
// ============================================================
describe('Purchase receipt (POST /api/transactions)', () => {
  test('SB.14 receipt hides the boost fee but the ledger row is still written', async () => {
    const listing = await makeListing();

    const res = await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({
        paymentIntentId: authorizedPaymentIntent(),
        listingId: listing._id,
        shippingAddress: ADDR,
        buyerCountry: 'US',
      })
      .expect(201);

    // Buyer-facing receipt: no boost fields.
    expect(res.body.paymentBreakdown.boostFee).toBeUndefined();
    expect(res.body.paymentBreakdown.boostTier).toBeUndefined();
    expect(res.body.paymentBreakdown.sellerEarnings).toBeDefined(); // money the buyer already pays for

    // Database: the fee that produced the seller’s net earnings is intact and
    // is exactly what the cancel/return reversal logic will read back.
    const stored = await Transaction.findById(res.body._id);
    expect(stored.paymentBreakdown.boostFee).toBe(3);
    expect(stored.paymentBreakdown.boostTier).toBe('standard');

    // Seller-facing view: boost visible and the tally closes.
    const sold = await request(app)
      .get('/api/transactions?type=sold')
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200);
    const view = sold.body.transactions.find(t => String(t._id) === String(stored._id));
    expect(view.paymentBreakdown.boostFee).toBe(3);
    expect(view.sellerBreakdown.reconciled).toBe(true);
    expect(round2(view.sellerBreakdown.itemPrice - view.sellerBreakdown.platformFee - view.sellerBreakdown.boostFee))
      .toBe(view.sellerBreakdown.sellerEarnings);
  });
});

// ============================================================
// 5. VIEW BUILDER — unit contracts the routes depend on
// ============================================================
describe('utils/transactionView contracts', () => {
  const { buildSellerBreakdown, sanitizeTransactionForViewer, sanitizeTransactionsForViewer } =
    require('../utils/transactionView');

  test('SB.15 missing paymentBreakdown never yields NaN', () => {
    const bd = buildSellerBreakdown({ currency: 'USD' });
    expect(bd.itemPrice).toBe(0);
    expect(bd.sellerEarnings).toBe(0);
    expect(bd.residual).toBe(0);
    expect(bd.reconciled).toBe(true);
  });

  test('SB.16 role comes from the record, not from the caller', () => {
    const txn = { buyer: 'b1', seller: 's1' };
    expect(sanitizeTransactionForViewer(txn, 's1').viewerRole).toBe('seller');
    expect(sanitizeTransactionForViewer(txn, 'b1').viewerRole).toBe('buyer');
    expect(sanitizeTransactionForViewer(txn, 'x1').viewerRole).toBe('other');
    expect(sanitizeTransactionForViewer(txn, undefined).viewerRole).toBe('other');
    // populated refs ({_id}) resolve the same way
    expect(sanitizeTransactionForViewer({ buyer: { _id: 'b1' }, seller: { _id: 's1' } }, 's1').viewerRole).toBe('seller');
  });

  test('SB.17 sanitizer never mutates the caller’s document or leaks to non-sellers', () => {
    const original = { currency: 'USD', buyer: 'b1', seller: 's1', paymentBreakdown: { ...REPORTED_SALE } };
    const snapshot = JSON.stringify(original);

    const forBuyer = sanitizeTransactionForViewer(original, 'b1');
    expect(forBuyer.paymentBreakdown.boostFee).toBeUndefined();
    expect(JSON.stringify(original)).toBe(snapshot); // untouched

    const forOther = sanitizeTransactionForViewer(original, 'nobody');
    expect(JSON.stringify(forOther)).not.toContain('boostFee');

    const forSeller = sanitizeTransactionForViewer(original, 's1');
    expect(forSeller.paymentBreakdown.boostFee).toBe(3);
    expect(forSeller.sellerBreakdown.boostTierLabel).toBe('Standard Boost');
  });

  test('SB.18 list sanitizer applies the same rule per transaction', () => {
    const list = [
      { currency: 'USD', buyer: 'b1', seller: 's1', paymentBreakdown: { ...REPORTED_SALE } },
      { currency: 'USD', buyer: 'b2', seller: 's2', paymentBreakdown: { ...REPORTED_SALE } },
    ];
    const out = sanitizeTransactionsForViewer(list, 's1');
    expect(out[0].sellerBreakdown).toBeTruthy();
    expect(out[1].sellerBreakdown).toBeUndefined();
    expect(out[1].paymentBreakdown.boostFee).toBeUndefined();
  });

  test('SB.19 the 8% platform percent is reported from data (labels are never hardcoded)', () => {
    const bd = buildSellerBreakdown({ currency: 'USD', paymentBreakdown: { ...REPORTED_SALE } });
    expect(bd.platformFeePercent).toBe(8);
    const unknown = buildSellerBreakdown({ currency: 'USD', paymentBreakdown: { ...REPORTED_SALE, platformFeePercent: undefined } });
    expect(unknown.platformFeePercent).toBeNull(); // UI falls back, never invents a rate
  });
});
