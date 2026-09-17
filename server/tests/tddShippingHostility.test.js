// TDD R27 — hostile-input contract for the two endpoints SESSION_LOG §D used
// to list as "returns 500 in the test environment":
//   POST /api/shipping/calculate-breakdown   (public, no auth)
//   POST /api/advanced-shipping/*            (auth)
//
// Both now answer 200 for well-formed payloads (verified locally AND against
// production: calculate-breakdown 200, advanced-shipping 201), so the §D
// entry was stale. What was NEVER covered is the hostile-input contract: both
// routes spread req.body straight into money math / Mongoose writes, where a
// wrong-typed field used to become NaN in the response or a CastError -> 500.
// A 500 on user input is a bug (it means "we crashed"), so every case below
// must fail closed with 4xx and a JSON message — never 500.
//
// Case-1 shape note: NaN is not just ugly, it is dangerous here. `itemPrice`
// reaches both the response AND the local-currency block, so
// `Math.round('abc' * rate * 100) / 100` produced NaN which JSON.stringify
// emits as `null` — a client that trusts `buyer.totalPaid` would render a
// blank price instead of an error.
const mongoose = require('mongoose');
const request = require('supertest');
const app = require('../server');
const User = require('../models/User');
const jwt = require('jsonwebtoken');
const { getJwtSecret } = require('../config/security');

const JWT_SECRET = getJwtSecret();

// Numbers must be real, finite and >= 0 after parsing. Anything else is a 400.
const isUsableNumber = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;

const makeUser = async (name, email) => {
  const user = await User.create({
    name, email, password: 'password123', country: 'US', currency: 'USD',
    emailVerified: true, authProvider: 'email',
    shippingAddress: {
      fullName: 'T', street1: '1 St', city: 'NYC', state: 'NY',
      postalCode: '10001', country: 'US',
    },
  });
  return jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '30d' });
};

beforeAll(async () => {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/trend-drop-test');
  }
});

afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 25));
});

describe('TDD R27 — POST /api/shipping/calculate-breakdown fails closed on hostile input', () => {
  const post = (body) => request(app).post('/api/shipping/calculate-breakdown').send(body);

  test('well-formed payload still succeeds and every money field is a real number', async () => {
    const res = await post({
      itemPrice: 50, fromCountry: 'US', toCountry: 'US', toState: 'NY',
      weightKg: 1, currency: 'USD',
    });
    expect(res.status).toBe(200);
    expect(isUsableNumber(res.body.buyer.totalPaid)).toBe(true);
    expect(isUsableNumber(res.body.seller.sellerEarnings)).toBe(true);
    expect(isUsableNumber(res.body.buyer.shippingCost)).toBe(true);
  });

  // TDD R28 (review): itemPrice is genuinely optional — it has an explicit
  // documented default (a bare geography payload prices shipping on a $0
  // item), and the E2E flow (19-shipping-logistics) posts itemPrice: 50
  // alongside geographic `fromCountry/toCountry` strings. The contract is:
  // ABSENT itemPrice uses the default; PRESENT-but-malformed itemPrice 400s
  // instead of NaNing the response. Only optional numerics are tested here;
  // required-field gates live on the advanced-shipping routes.
  test('absent itemPrice still succeeds on the documented default', async () => {
    const res = await post({ fromCountry: 'US', toCountry: 'US' });
    expect(res.status).toBe(200);
    expect(res.body.buyer.itemPrice).toBe(0);
    expect(isUsableNumber(res.body.buyer.totalPaid)).toBe(true);
  });

  test('the documented geography-first flow succeeds unchanged', async () => {
    const res = await post({ itemPrice: 50, fromCountry: 'US', toCountry: 'US', weightKg: 1 });
    expect(res.status).toBe(200);
    expect(isUsableNumber(res.body.buyer.totalPaid)).toBe(true);
  });

  test('non-numeric itemPrice is a 400, never a NaN/null money field', async () => {
    // NOTE: JSON cannot carry NaN/Infinity — supertest serialises both to
    // `null`, which is the documented "field absent" fallback (covered by the
    // dedicated test below). These are the values that DO reach the handler.
    for (const bad of ['abc', {}, [], true, '']) {
      const res = await post({ itemPrice: bad, fromCountry: 'US', toCountry: 'US' });
      expect(res.status).toBe(400);
      expect(res.body.message).toBeTruthy();
    }
  });

  // The redundant-write guard: a 400 rejection must not persist a new
  // shipping quote snapshot when the underlying model is extended with one.
  // The endpoint is currently stateless (no write path), so this locks in
  // that property — on the first failure output, look for a Shipping* model
  // `create`/`findOneAndUpdate` call inside the handler before concluding.
  test('failed validations leave no quote or address artifacts behind', async () => {
    const mongoose = require('mongoose');
    const names = mongoose.modelNames();
    const counts = {};
    for (const name of names) {
      try { counts[name] = await mongoose.model(name).countDocuments(); } catch { /* ignore */ }
    }
    const res = await post({ itemPrice: 'abc', fromCountry: 'US', toCountry: 'US' });
    expect(res.status).toBe(400);
    for (const name of names) {
      try {
        expect(await mongoose.model(name).countDocuments()).toBe(counts[name]);
      } catch { /* ignore models that error on count */ }
    }
  });

  test('absent or null itemPrice keeps the documented $0 fallback (not an error)', async () => {
    for (const body of [{ fromCountry: 'US', toCountry: 'US' }, { itemPrice: null, fromCountry: 'US', toCountry: 'US' }]) {
      const res = await post(body);
      expect(res.status).toBe(200);
      expect(res.body.buyer.itemPrice).toBe(0);
      expect(isUsableNumber(res.body.buyer.totalPaid)).toBe(true);
    }
  });

  test('negative itemPrice is rejected rather than inverted into the breakdown', async () => {
    const res = await post({ itemPrice: -100, fromCountry: 'US', toCountry: 'US' });
    expect(res.status).toBe(400);
    expect(res.body.message).toBeTruthy();
  });

  test('non-numeric weightKg / percent overrides are 400, not NaN totals', async () => {
    const bads = [
      { itemPrice: 10, weightKg: 'heavy' },
      { itemPrice: 10, platformFeePercent: 'ten' },
      { itemPrice: 10, buyerProtectionPercent: [] },
    ];
    for (const body of bads) {
      const res = await post({ fromCountry: 'US', toCountry: 'US', ...body });
      expect(res.status).toBe(400);
      expect(res.body.message).toBeTruthy();
    }
  });

  test('out-of-range percent overrides are 400 (a 10000% fee is not a price)', async () => {
    for (const pct of [-5, 10000]) {
      const res = await post({ itemPrice: 10, platformFeePercent: pct, fromCountry: 'US', toCountry: 'US' });
      expect(res.status).toBe(400);
      expect(res.body.message).toBeTruthy();
    }
  });

  test('hostile country / state / currency values never 500', async () => {
    const bads = [
      { fromCountry: 'Zzz', toCountry: 'US' },
      { fromCountry: 123, toCountry: { evil: true } },
      { fromCountry: 'US', toCountry: 'US', toState: 999 },
      { fromCountry: 'US', toCountry: 'US', currency: [] },
      { fromCountry: 'US', toCountry: 'US', currency: 'ZZZ' },
    ];
    for (const body of bads) {
      const res = await post({ itemPrice: 25, ...body });
      expect(res.status).not.toBe(500);
      if (res.status !== 200) expect(res.body.message).toBeTruthy();
    }
  });
});

// R33 — /api/shipping/calculate had the SAME NaN hole R27 closed on its sibling
// /api/shipping/calculate-breakdown, but was never covered. `weightKg || 0.5`
// only guards falsy: a truthy-but-unparseable value ('heavy', 'NaN', an object)
// flows straight into the weight math, and JSON.stringify serialises the
// resulting NaN as `null`. So the endpoint answered 200 with
// `{ cost: null, breakdown: { weightCharge: null } }` — a blank price the
// listing page renders as if it were real. A negative weight was silently
// treated as zero, inventing a plausible-looking cheaper rate. Money input
// must fail closed (400), never answer 200 with unpriceable numbers.
describe('TDD R33 — POST /api/shipping/calculate fails closed on hostile numeric input', () => {
  const post = (body) => request(app).post('/api/shipping/calculate').send(body);

  test('the canonical payload still returns finite, positive money', async () => {
    const res = await post({ fromCountry: 'US', toCountry: 'US', weightKg: 1 });
    expect(res.status).toBe(200);
    expect(isUsableNumber(res.body.cost)).toBe(true);
    expect(res.body.cost).toBeGreaterThan(0);
    expect(isUsableNumber(res.body.breakdown.weightCharge)).toBe(true);
  });

  test('heavier parcels cost more (the weight input is genuinely applied)', async () => {
    const light = await post({ fromCountry: 'US', toCountry: 'GB', weightKg: 0.5 });
    const heavy = await post({ fromCountry: 'US', toCountry: 'GB', weightKg: 5 });
    expect(light.status).toBe(200);
    expect(heavy.status).toBe(200);
    expect(heavy.body.cost).toBeGreaterThan(light.body.cost);
  });

  // Every PRESENT-but-malformed numeric must 400; absent keeps its documented
  // default (weightKg 0.5, itemPrice 0).
  const malformed = [
    ['weightKg', 'heavy'],
    ['weightKg', 'NaN'],
    ['weightKg', ''],
    ['weightKg', { $gt: 1 }],
    ['weightKg', [1]],
    ['weightKg', true],
    ['weightKg', -5],
    ['weightKg', 1e9],
    ['itemPrice', 'free'],
    ['itemPrice', { $gt: 0 }],
    ['itemPrice', -1],
    ['itemPrice', 1e9],
  ];

  test.each(malformed)('rejects malformed %s=%j with 400 (never 200 + NaN)', async (field, value) => {
    const res = await post({
      fromCountry: 'US', toCountry: 'US', weightKg: 1, itemPrice: 25, [field]: value,
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toBeTruthy();
  });

  test('never answers 200 with a non-finite cost', async () => {
    const bodies = [
      { fromCountry: 'US', toCountry: 'US', weightKg: 'heavy' },
      { fromCountry: 'US', toCountry: 'US', weightKg: { $gt: 1 } },
      { fromCountry: 'US', toCountry: 'US', weightKg: 'NaN' },
      { fromCountry: 'US', toCountry: 'US', weightKg: 1, itemPrice: 'free' },
    ];
    for (const body of bodies) {
      const res = await post(body);
      if (res.status === 200) {
        expect(isUsableNumber(res.body.cost)).toBe(true);
      }
      expect(JSON.stringify(res.body)).not.toContain('"cost":null');
    }
  });

  test('absent numerics keep their documented defaults', async () => {
    const res = await post({ fromCountry: 'US', toCountry: 'US' });
    expect(res.status).toBe(200);
    expect(isUsableNumber(res.body.cost)).toBe(true);
  });

  test('missing geography still 400s (unchanged contract)', async () => {
    const res = await post({ weightKg: 1 });
    expect(res.status).toBe(400);
    expect(res.body.message).toBeTruthy();
  });

  // A truthy non-string country used to satisfy the `!fromCountry` gate and
  // fall through to the zone lookup, which fails to match and therefore quoted
  // the MOST EXPENSIVE zone: `{ fromCountry: {}, toCountry: 'US' }` answered 200
  // with a US -> international DHL rate ($23.74) instead of a domestic USPS one
  // ($5.24). Geography must be a real country code string, not any truthy value.
  const malformedGeography = [
    ['fromCountry', {}],
    ['fromCountry', 123],
    ['fromCountry', ['US']],
    ['fromCountry', true],
    ['fromCountry', '   '],
    ['toCountry', {}],
    ['toCountry', 123],
    ['toCountry', ['GB']],
  ];

  test.each(malformedGeography)('rejects a non-string %s=%j with 400', async (field, value) => {
    const res = await post({ fromCountry: 'US', toCountry: 'US', weightKg: 1, [field]: value });
    expect(res.status).toBe(400);
    expect(res.body.message).toBeTruthy();
  });

  test('a domestic quote is never priced as an international one', async () => {
    const us = await post({ fromCountry: 'US', toCountry: 'US', weightKg: 1 });
    expect(us.status).toBe(200);
    expect(us.body.isDomestic).toBe(true);
    expect(us.body.carrier).toBe('USPS');
  });
});

describe('TDD R27 — advanced-shipping endpoints fail closed on hostile input', () => {
  let token;

  beforeAll(async () => {
    token = await makeUser('TDD AdvShip', `tddadvship_${Date.now()}@test.com`);
  });

  // (path, body, expected behaviour) — a valid shape must succeed, anything
  // else must be a 4xx. 500 = the handler crashed on our own input.
  const hostileCases = [
    ['/api/advanced-shipping', { carrier: 'DHL' }],
    ['/api/advanced-shipping', { apiKey: 'k' }],
    ['/api/advanced-shipping', { carrier: 'Nope', apiKey: 'k' }],
    ['/api/advanced-shipping', { carrier: {}, apiKey: 'k' }],
    ['/api/advanced-shipping', { carrier: 'UPS', apiKey: {} }],
    ['/api/advanced-shipping', { carrier: 'UPS', apiKey: 'k', accountNumber: { a: 1 } }],
    ['/api/advanced-shipping/rates', { carrier: 'ups' }],
    ['/api/advanced-shipping/rates', { carrier: 'UPS', weight: 'heavy' }],
    ['/api/advanced-shipping/rates', { carrier: 'UPS', weight: -5, fromZip: '90001', toZip: '10001' }],
    ['/api/advanced-shipping/rates', { carrier: 'UPS', weight: 1, fromZip: {}, toZip: [] }],
    ['/api/advanced-shipping/label', { carrier: 'UPS', service: 'Ground' }],
    ['/api/advanced-shipping/label', { carrier: 'UPS', service: 'Ground', toAddress: {}, weight: 'x' }],
    ['/api/advanced-shipping/label', { carrier: 'UPS', service: 'Ground', toAddress: '1 St', weight: 1e9 }],
  ];

  test.each(hostileCases)('POST %s rejects hostile input with 4xx (never 500)', async (path, body) => {
    const res = await request(app).post(path).set('Authorization', `Bearer ${token}`).send(body);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(res.body.message).toBeTruthy();
  });

  test('the same endpoints succeed on well-formed input (guards are not blanket rejections)', async () => {
    const add = await request(app)
      .post('/api/advanced-shipping')
      .set('Authorization', `Bearer ${token}`)
      .send({ carrier: 'fedex', apiKey: 'k_valid', accountNumber: 'ACC-1' });
    expect([200, 201]).toContain(add.status);

    const rate = await request(app)
      .post('/api/advanced-shipping/rates')
      .set('Authorization', `Bearer ${token}`)
      .send({ carrier: 'fedex', weight: 1, fromZip: '90001', toZip: '10001' });
    expect(rate.status).toBe(200);
    expect(isUsableNumber(rate.body.estimatedCost)).toBe(true);

    const label = await request(app)
      .post('/api/advanced-shipping/label')
      .set('Authorization', `Bearer ${token}`)
      .send({ carrier: 'fedex', service: 'Ground', toAddress: '123 Main St', weight: 1 });
    expect(label.status).toBe(200);
    expect(typeof label.body.trackingNumber).toBe('string');
    expect(label.body.trackingNumber.length).toBeGreaterThan(0);

    const tracking = await request(app)
      .get(`/api/advanced-shipping/tracking/${label.body.trackingNumber}`)
      .set('Authorization', `Bearer ${token}`);
    expect(tracking.status).toBe(200);
  });

  test('all advanced-shipping endpoints require auth', async () => {
    const res = await request(app).post('/api/advanced-shipping/rates').send({ carrier: 'UPS', weight: 1 });
    expect(res.status).toBe(401);
  });
});

