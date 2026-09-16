/**
 * MONEY PATH AUDIT (TDD round 28)
 *
 * After TDD R26 closed the `cart/checkout` amount-parity hole, every route that
 * commits money was re-audited. The audit has two halves:
 *
 *   PART 1 — a SELF-MAINTAINING structural guard. Any route file that resolves
 *   a CLIENT-SUPPLIED payment intent (findPaymentIntent / retrievePaymentIntent)
 *   takes money on the strength of that intent, so it must prove the intent is
 *   worth what is being charged (verifyIntentAmount). This test reads the route
 *   directory at runtime: a brand-new money path that forgets the check fails
 *   here instead of shipping. It also asserts the audited set is non-empty, so
 *   the guard can never pass vacuously by scanning nothing.
 *
 *   PART 2 — the behavioural hole the audit found. POST /api/loyalty/earn mints
 *   points from a CLIENT-SUPPLIED purchaseAmount with no proof of purchase and
 *   no limit on how many times it may be called, while POST /api/loyalty/redeem
 *   pays out $0.01 per point. Ten calls therefore mint $100 of spendable value
 *   out of nothing, forever, and the tier system (Silver/Gold/Platinum) with
 *   it. Per-event caps already existed; the missing control is a bound on the
 *   rolling window, which these tests pin.
 */

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const request = require('supertest');
const app = require('../server');
const User = require('../models/User');
const jwt = require('jsonwebtoken');
const { getJwtSecret } = require('../config/security');

const JWT_SECRET = getJwtSecret();
const US = { fullName: 'T', street1: '1 St', city: 'NYC', state: 'NY', postalCode: '10001', country: 'US' };
const ROUTES_DIR = path.join(__dirname, '..', 'routes');

const makeUser = async (name, email) => {
  const user = await User.create({
    name, email, password: 'password123', country: 'US', currency: 'USD',
    emailVerified: true, authProvider: 'email',
    shippingAddress: { ...US },
  });
  const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '30d' });
  return { user, token };
};

const earn = (token, body) => request(app)
  .post('/api/loyalty/earn')
  .set('Authorization', `Bearer ${token}`)
  .send(body);

beforeAll(async () => {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/trend-drop-test');
  }
});

describe('MONEY PATH AUDIT — structural guard over client-supplied payment intents', () => {
  // "Consuming" an intent = taking a sale on the strength of it. In this
  // codebase that is either binding it to the order (verifyIntentBinding, the
  // auth-only flow: cart / buy-now) or capturing it (confirm-batch / offers).
  // Whatever the mechanism, the amount must then be proved against the order —
  // binding WITHOUT amount parity is exactly the TDD R26 hole.
  const CONSUMES_INTENT = /verifyIntentBinding\s*\(|capturePaymentIntent\s*\(/;
  const RESOLVES_INTENT = /findPaymentIntent\s*\(|retrievePaymentIntent\s*\(/;
  const VERIFIES_AMOUNT = /verifyIntentAmount\s*\(/;
  const stripComments = (source) => source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  const scanRoutes = () => fs.readdirSync(ROUTES_DIR)
    .filter((f) => f.endsWith('.js'))
    .map((file) => ({ file, code: stripComments(fs.readFileSync(path.join(ROUTES_DIR, file), 'utf8')) }));

  test('every route that consumes a client-supplied intent also verifies its amount', () => {
    const audited = [];
    const offenders = [];
    for (const { file, code } of scanRoutes()) {
      if (!CONSUMES_INTENT.test(code)) continue;
      audited.push(file);
      if (!VERIFIES_AMOUNT.test(code)) offenders.push(file);
    }

    try {
      fs.writeFileSync('/tmp/money-path-audit.json',
        JSON.stringify({ consumesIntent: audited, offenders, generatedAt: new Date().toISOString() }, null, 2));
    } catch (err) { /* artifact is best-effort only */ }

    expect(audited.length).toBeGreaterThanOrEqual(3); // anti-vacuity: cart, transactions, payments
    expect(offenders).toEqual([]);
  });

  test('intent readers that never consume it are a reviewed, documented allowlist', () => {
    // These routes resolve a payment intent only to read its STATUS, and the id
    // always comes from our own ledger (txn.payout.transactionId /
    // paymentBreakdown.paymentIntentId) — never from the request body. The
    // money they move is a stored/partial ledger amount, so an amount-parity
    // check would be wrong here. Pinned so that a NEW route cannot join this
    // set without a deliberate review.
    const REVIEWED_STATUS_ONLY = ['admin.js', 'orderLifecycle.js', 'returns.js'];

    const statusOnly = scanRoutes()
      .filter(({ code }) => RESOLVES_INTENT.test(code) && !CONSUMES_INTENT.test(code))
      .map(({ file }) => file)
      .sort();

    expect(statusOnly).toEqual(REVIEWED_STATUS_ONLY);
  });

  test('the amount check is never satisfied by a hard-coded zero expectation', () => {
    const files = fs.readdirSync(ROUTES_DIR).filter((f) => f.endsWith('.js'));
    const offenders = [];
    for (const file of files) {
      const source = fs.readFileSync(path.join(ROUTES_DIR, file), 'utf8');
      const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      // verifyIntentAmount(x, 0) would disable the gate for any real intent.
      if (/verifyIntentAmount\([^)]*,\s*0\s*\)/.test(code)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});

describe('MONEY PATH AUDIT — loyalty points cannot be minted without bound', () => {
  test('a maximum-value purchase event cannot be repeated the same day', async () => {
    const u = await makeUser('AuditLoy1', `auditloy1_${Date.now()}@test.com`);

    const first = await earn(u.token, { reason: 'purchase', purchaseAmount: 10000 });
    expect(first.status).toBe(200);
    expect(first.body.points).toBe(10000); // per-event cap honoured

    // Historically this second call ALSO returned 200 with another 10,000
    // points — repeatable without limit, redeemable at $0.01/point.
    const second = await earn(u.token, { reason: 'purchase', purchaseAmount: 10000 });
    expect(second.status).toBe(429);

    const after = await request(app).get('/api/loyalty').set('Authorization', `Bearer ${u.token}`);
    expect(after.body.points).toBe(10000); // nothing was minted by the rejected call
  });

  test('fixed-value reasons cannot be farmed without bound', async () => {
    const u = await makeUser('AuditLoy2', `auditloy2_${Date.now()}@test.com`);

    let granted = 0;
    let limited = 0;
    for (let i = 0; i < 101; i += 1) {
      const res = await earn(u.token, { reason: 'referral' }); // fixed 100 pts
      if (res.status === 200) granted += 1;
      else if (res.status === 429) limited += 1;
      else throw new Error(`unexpected status ${res.status}: ${JSON.stringify(res.body)}`);
    }

    expect(granted).toBeGreaterThan(0); // legitimate use still works
    expect(limited).toBeGreaterThan(0); // unbounded farming does not
    expect(granted).toBe(100); // 100pts x 100 calls = the daily ceiling

    const after = await request(app).get('/api/loyalty').set('Authorization', `Bearer ${u.token}`);
    expect(after.body.points).toBe(10000);
  });

  test('ordinary activity below the daily ceiling is unaffected', async () => {
    const u = await makeUser('AuditLoy3', `auditloy3_${Date.now()}@test.com`);

    const signup = await earn(u.token, { reason: 'signup' }); // 50
    expect(signup.status).toBe(200);
    const review = await earn(u.token, { reason: 'review' }); // 10
    expect(review.status).toBe(200);
    const purchase = await earn(u.token, { reason: 'purchase', purchaseAmount: 100 }); // 100
    expect(purchase.status).toBe(200);

    expect(purchase.body.points).toBe(160);
    expect(purchase.body.tier).toBe('Silver');
  });

  test('purchase reason still derives points server-side, ignoring client `amount`', async () => {
    const u = await makeUser('AuditLoy4', `auditloy4_${Date.now()}@test.com`);
    const res = await earn(u.token, { reason: 'purchase', amount: 999999999, purchaseAmount: 30 });
    expect(res.status).toBe(200);
    expect(res.body.points).toBe(30);
  });
});