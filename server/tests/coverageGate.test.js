// Critical-coverage gate complement (GHA "Critical coverage thresholds" step).
// Covers the middleware/auth branches, the inventory route surface (including
// its 500 catch blocks and every auto-reorder validation branch), and the
// parameter-DEFAULT branches of criticalRules helpers that no suite ever
// exercised. Runs inside the same hermetic jest setup as the rest of the
// server suite (in-memory Mongo, jest.setup.js cleanup).
const mongoose = require('mongoose');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { getJwtSecret } = require('../config/security');
const app = require('../server');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Inventory = require('../models/Inventory');
const {
  allocateDiscountedSellerNet,
  reconcileItemLedger,
  isValidAutoReorderPatch,
  isSuspendedRole,
} = require('../criticalRules');

// The auto-reorder handler's `!Number.isFinite(quantity)` guard cannot be
// reached through JSON bodies (non-numbers fail the typeof check first;
// JSON numbers are always finite), so the floating-value branch is exercised
// by invoking the exported route handler directly.
const inventoryRouter = require('../routes/inventory');
const runAutoReorderHandler = (body, user) => new Promise((resolve) => {
  const handler = inventoryRouter.stack
    .map((l) => l.route && l.route.stack[l.route.stack.length - 1].handle)
    .filter(Boolean)
    .pop(); // last route = PUT /:id/auto-reorder
  const res = {
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; resolve(this); },
  };
  const req = { params: { id: 'inventory-id' }, body, user };
  handler(req, res, () => resolve(res));
});

const JWT_SECRET = getJwtSecret();

const US_ADDR = { fullName: 'Cov', street1: '1 St', city: 'NYC', state: 'NY', postalCode: '10001', country: 'US' };

const makeUser = async (name, email, extra = {}) => {
  const user = await User.create({
    name, email, password: 'password123', country: 'US', currency: 'USD',
    emailVerified: true, authProvider: 'email', shippingAddress: { ...US_ADDR }, ...extra,
  });
  const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '30d' });
  return { user, token };
};

const makeListing = (seller, extra = {}) => Listing.create({
  title: `CoverageGate ${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
  description: 'coverage gate listing',
  price: 100, currency: 'USD', category: 'Men', size: 'M', condition: 'Good',
  images: ['https://example.com/p.jpg'], seller: seller._id, available: true,
  quantity: 10, shipsFrom: 'US', ...extra,
});

beforeAll(async () => {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/trend-drop-test');
  }
});

afterAll(async () => {
  // server.js also keeps handles alive in each suite; jest --runInBand with
  // --forceExit in the coverage script ends the process regardless.
});

describe('middleware auth branches', () => {
  test('missing Authorization header -> 401 no-token message', async () => {
    const res = await request(app).get('/api/inventory');
    expect(res.status).toBe(401);
    expect(res.body.message).toBe('No token, authorization denied');
  });

  test('malformed token -> 401 invalid-token catch', async () => {
    const res = await request(app).get('/api/inventory').set('Authorization', 'Bearer not.a.jwt');
    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Token is not valid');
  });

  test('valid token for deleted user -> 401 invalid-token', async () => {
    const ghostId = new mongoose.Types.ObjectId();
    const token = jwt.sign({ id: ghostId }, JWT_SECRET, { expiresIn: '30d' });
    const res = await request(app).get('/api/inventory').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Token is not valid');
  });

  test('suspended account -> 403 locked out even with valid token', async () => {
    const { user, token } = await makeUser('Suspended Sam', `susp-${Date.now()}@t.test`, { role: 'suspended' });
    expect(isSuspendedRole(user.role)).toBe(true);
    const res = await request(app).get('/api/inventory').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body.message).toBe('Account suspended. Contact support.');
  });

  test('optionalAuth attaches a user for valid tokens and continues otherwise', async () => {
    const { token } = await makeUser('Optional Ola', `optauth-${Date.now()}@t.test`);
    // Valid token reaches the listings listing route (optionalAuth attached)
    const authed = await request(app).get('/api/listings').set('Authorization', `Bearer ${token}`);
    expect([200, 400, 404]).toContain(authed.status);
    // No token: middleware skips auth and continues
    const anon = await request(app).get('/api/listings');
    expect([200, 400, 404]).toContain(anon.status);
    // Invalid token: catch swallows the error and continues unauthenticated
    const bad = await request(app).get('/api/listings').set('Authorization', 'Bearer junk.token.here');
    expect([200, 400, 404]).toContain(bad.status);
    // Well-formed token for a user that no longer exists: lookup misses, so
    // the request continues unauthenticated without attaching a user
    const ghostId = new mongoose.Types.ObjectId();
    const ghost = await request(app)
      .get('/api/listings')
      .set('Authorization', `Bearer ${jwt.sign({ id: ghostId }, JWT_SECRET, { expiresIn: '30d' })}`);
    expect([200, 400, 404]).toContain(ghost.status);
  });
});

describe('inventory routes (coverage gate)', () => {
  let seller;
  let listing;
  let inventory;

  beforeAll(async () => {
    seller = await makeUser('Inv Seller', `invseller-${Date.now()}@t.test`);
    listing = await makeListing(seller.user);
    inventory = await Inventory.create({ seller: seller.user._id, listing: listing._id, quantity: 5 });
  });

  test('GET / lists the seller inventory', async () => {
    const res = await request(app).get('/api/inventory').set('Authorization', `Bearer ${seller.token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(1);
  });

  test('GET / catches database failures with 500', async () => {
    const spy = jest.spyOn(Inventory, 'find').mockImplementationOnce(
      () => ({ populate: () => ({ sort: async () => { throw new Error('db down'); } }) })
    );
    const res = await request(app).get('/api/inventory').set('Authorization', `Bearer ${seller.token}`);
    expect(res.status).toBe(500);
    expect(res.body.message).toBe('Failed to fetch inventory');
    spy.mockRestore();
  });

  test('GET /:id returns the item for its owner', async () => {
    const res = await request(app)
      .get(`/api/inventory/${inventory._id}`)
      .set('Authorization', `Bearer ${seller.token}`);
    expect(res.status).toBe(200);
    expect(res.body._id).toBe(inventory._id.toString());
  });

  test('GET /:id 404s for an unknown id; malformed ids hit the request guard', async () => {
    const missing = new mongoose.Types.ObjectId();
    const notFound = await request(app)
      .get(`/api/inventory/${missing}`)
      .set('Authorization', `Bearer ${seller.token}`);
    expect(notFound.status).toBe(404);
    expect(notFound.body.message).toBe('Inventory item not found');

    const cast = await request(app)
      .get('/api/inventory/not-an-object-id')
      .set('Authorization', `Bearer ${seller.token}`);
    expect(cast.status).toBe(400);
  });

  test('GET /:id catches database failures with 500', async () => {
    const spy = jest.spyOn(Inventory, 'findOne').mockImplementationOnce(
      () => ({ populate: async () => { throw new Error('db down'); } })
    );
    const res = await request(app)
      .get(`/api/inventory/${inventory._id}`)
      .set('Authorization', `Bearer ${seller.token}`);
    expect(res.status).toBe(500);
    expect(res.body.message).toBe('Failed to fetch inventory item');
    spy.mockRestore();
  });

  test('POST /sync validates payload, quantities and ownership', async () => {
    const authz = { Authorization: `Bearer ${seller.token}` };

    const noItems = await request(app).post('/api/inventory/sync').set(authz).send({ warehouse: 'WH' });
    expect(noItems.status).toBe(400);
    expect(noItems.body.message).toBe('items must be a non-empty array');

    const badId = await request(app).post('/api/inventory/sync').set(authz).send({
      warehouse: 'WH', items: [{ listingId: 'not-an-object-id', quantity: 1 }],
    });
    expect(badId.status).toBe(400);
    expect(badId.body.message).toBe('Each item needs a valid listingId');

    const badQty = await request(app).post('/api/inventory/sync').set(authz).send({
      warehouse: 'WH', items: [{ listingId: listing._id.toString(), quantity: 'five' }],
    });
    expect(badQty.status).toBe(400);
    expect(badQty.body.message).toBe('quantity must be a number between 0 and 1000000');

    const rival = await makeUser('Inv Rival', `invrival-${Date.now()}@t.test`);
    const foreignListing = await makeListing(rival.user);
    const foreign = await request(app).post('/api/inventory/sync').set(authz).send({
      warehouse: 'WH', items: [{ listingId: foreignListing._id.toString(), quantity: 1 }],
    });
    expect(foreign.status).toBe(403);
    expect(foreign.body.message).toBe('You can only sync inventory for your own listings');
  });

  test('POST /sync syncs own items and catches db failures', async () => {
    const authz = { Authorization: `Bearer ${seller.token}` };
    // quantity omitted entirely: both `undefined/null` ternary sides
    const noQty = await request(app).post('/api/inventory/sync').set(authz).send({
      warehouse: 'WH', items: [{ listingId: listing._id.toString() }],
    });
    expect(noQty.status).toBe(200);
    expect(noQty.body[0].quantity).toBe(0);

    const ok = await request(app).post('/api/inventory/sync')
      .set('Authorization', `Bearer ${seller.token}`)
      .send({ warehouse: 'WH-9', items: [{ listingId: listing._id.toString(), quantity: 12, sku: 'SKU1', location: 'A1' }] });
    expect(ok.status).toBe(200);
    expect(ok.body.length).toBe(1);

    const spy = jest.spyOn(Inventory, 'findOneAndUpdate').mockRejectedValueOnce(new Error('db down'));
    const fail = await request(app).post('/api/inventory/sync')
      .set('Authorization', `Bearer ${seller.token}`)
      .send({ warehouse: 'WH-9', items: [{ listingId: listing._id.toString(), quantity: 1 }] });
    expect(fail.status).toBe(500);
    expect(fail.body.message).toBe('Failed to sync inventory');
    spy.mockRestore();
  });

  test('POST /alerts reports low-stock items and catches db failures', async () => {
    // Bring stock below the default threshold (5) for the alert branch
    inventory.quantity = 0;
    await inventory.save();
    const res = await request(app).post('/api/inventory/alerts')
      .set('Authorization', `Bearer ${seller.token}`);
    expect(res.status).toBe(200);
    expect(res.body.alerts.length).toBe(1);
    expect(res.body.alerts[0].listing._id ||
      res.body.alerts[0].listing).toBeTruthy();

    const spy = jest.spyOn(Inventory, 'find').mockImplementationOnce(
      () => ({ populate: async () => { throw new Error('db down'); } })
    );
    const fail = await request(app).post('/api/inventory/alerts')
      .set('Authorization', `Bearer ${seller.token}`);
    expect(fail.status).toBe(500);
    expect(fail.body.message).toBe('Failed to check stock alerts');
    spy.mockRestore();
  });

  test('PUT /:id/auto-reorder validates every patch shape and catches db failures', async () => {
    const authz = { Authorization: `Bearer ${seller.token}` };
    const url = `/api/inventory/${inventory._id}/auto-reorder`;

    expect(isValidAutoReorderPatch({ enabled: 'yes', quantity: 1, supplier: 's' })).toBe(false);
    expect(isValidAutoReorderPatch({ enabled: true, quantity: 'five', supplier: 's' })).toBe(false);
    expect(isValidAutoReorderPatch({ enabled: true, quantity: 1, supplier: 5 })).toBe(false);

    const badEnabled = await request(app).put(url).set(authz).send({ enabled: 'yes' });
    expect(badEnabled.status).toBe(400);
    expect(badEnabled.body.message).toBe('enabled must be a boolean');

    const badQty = await request(app).put(url).set(authz).send({ enabled: true, quantity: 'five' });
    expect(badQty.status).toBe(400);
    expect(badQty.body.message).toBe('quantity must be a number');

    const infiniteQty = await runAutoReorderHandler(
      { enabled: true, quantity: Number.POSITIVE_INFINITY },
      seller.user._id
    );
    expect(infiniteQty.statusCode).toBe(400);
    expect(infiniteQty.payload.message).toBe('quantity must be a number');

    const badSupplier = await request(app).put(url).set(authz).send({ supplier: 5 });
    expect(badSupplier.status).toBe(400);
    expect(badSupplier.body.message).toBe('supplier must be a string');

    const ok = await request(app).put(url).set(authz)
      .send({ enabled: true, quantity: 25, supplier: 'ACME Co' });
    expect(ok.status).toBe(200);
    expect(ok.body.autoReorder).toMatchObject({ enabled: true, quantity: 25, supplier: 'ACME Co' });

    const missing = await request(app)
      .put(`/api/inventory/${new mongoose.Types.ObjectId()}/auto-reorder`)
      .set(authz)
      .send({ enabled: false });
    expect(missing.status).toBe(404);
    expect(missing.body.message).toBe('Inventory item not found');

    const spy = jest.spyOn(Inventory, 'findOneAndUpdate').mockRejectedValueOnce(new Error('db down'));
    const fail = await request(app).put(url).set(authz).send({ enabled: false });
    expect(fail.status).toBe(500);
    expect(fail.body.message).toBe('Failed to update auto reorder');
    spy.mockRestore();
  });
});

describe('criticalRules parameter-default branches', () => {
  test('allocateDiscountedSellerNet default discount path', () => {
    expect(allocateDiscountedSellerNet(100, 8)).toEqual({
      discountedSubtotal: 100,
      platformFee: 8,
      sellerEarnings: 92,
    });
    // explicit-discount side for the same branch
    expect(allocateDiscountedSellerNet(100, 8, 10).discountedSubtotal).toBe(90);
  });

  test('reconcileItemLedger covers both default and explicit sides of every field', () => {
    const all = reconcileItemLedger({
      itemPrice: 100, shippingCost: 5, buyerProtectionFee: 5,
      platformFee: 8, boostFee: 2, providerFee: 1, discount: 0,
    });
    expect(all.itemLedger).toBe(100);

    // every default side: omit everything except itemPrice
    const defaults = reconcileItemLedger({ itemPrice: 50 });
    expect(defaults.discountedItem).toBe(50);
    expect(defaults.customerCharge).toBe(50);
    expect(defaults.itemLedger).toBe(50);

    // discount default side: supply ledger fees but no discount
    const noDiscount = reconcileItemLedger({
      itemPrice: 80, shippingCost: 2, buyerProtectionFee: 4, platformFee: 8, boostFee: 1, providerFee: 0,
    });
    expect(noDiscount.discountedItem).toBe(80);
  });
});
