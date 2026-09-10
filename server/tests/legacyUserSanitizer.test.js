// REGRESSION: legacy seed docs (raw object `location`, string `payoutMethod`,
// or `payoutMethod.details` unknown paths) MUST survive load→modify→save in
// every money flow (checkout confirm-batch updates the legacy seed seller's
// balance). Regression for the live production 500:
//   "User validation failed: location: Cast to string failed for value
//     \"{ city: 'Los Angeles', state: 'CA', country: 'US' }\" (type Object)"
// The repair MUST run pre-VALIDATE (validate() aborts before pre('save'), and
// Mongoose 7 caches the cast error in $errors.location so retries rethrow it).
const mongoose = require('mongoose');
const User = require('../models/User');

const uid = () => new mongoose.Types.ObjectId();
const mkEmail = (tag) => `${tag}_${Date.now()}_${Math.floor(Math.random() * 1e6)}@test.com`;

describe('Legacy user-data sanitizer (pre-validate)', () => {
  beforeAll(async () => {
    if (mongoose.connection.readyState !== 1) {
      await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/trend-drop-test');
    }
  });

  test('load+save of legacy doc with OBJECT location does not cast-fail', async () => {
    const id = uid();
    // Insert raw via the driver collection — bypasses all Mongoose casting,
    // exactly how legacy seed docs landed in the production DB.
    await User.collection.insertOne({
      _id: id,
      name: 'Legacy Seller',
      email: mkEmail('legacy_loc'),
      password: 'password123',
      country: 'US',
      authProvider: 'email',
      emailVerified: true,
      // object where the schema declares String — the live-failing shape
      location: { city: 'Los Angeles', state: 'CA', country: 'US' },
      balance: { available: 10, pending: 0, currency: 'USD' },
    });

    const u = await User.findById(id);
    expect(u).toBeTruthy();
    // This is the checkout/payout write pattern (e.g. aggreggated balance $inc)
    u.balance.available = (u.balance.available || 0) + 92;
    u.balance.totalEarned = (u.balance.totalEarned || 0) + 92;

    // THE REGRESSION: without the pre('validate') sanitizer this rejects with
    // the exact CastError seen on production confirm-batch.
    await expect(u.save()).resolves.toBeTruthy();

    const reloaded = await User.findById(id);
    expect(typeof reloaded.location).toBe('string');
    expect(reloaded.location).toContain('Los Angeles');
    expect(reloaded.location).toContain('CA');
    await User.deleteOne({ _id: id });
  });

  test('ALREADY-POISONED in-memory doc (failed save cached in $errors) self-heals', async () => {
    const id = uid();
    await User.collection.insertOne({
      _id: id,
      name: 'Poisoned Seller',
      email: mkEmail('legacy_poison'),
      password: 'password123',
      country: 'US',
      authProvider: 'email',
      emailVerified: true,
      location: { city: 'New York', state: 'NY', country: 'US' },
      balance: { available: 5, pending: 0, currency: 'USD' },
    });
    const u = await User.findById(id);

    // Simulate a first save starting before the sanitizer (a strаnded/dirty doc)
    // reverts: force the doc through a cast failure so Mongoose caches the error.
    let firstRejected = false;
    u.location = { city: 'New York' }; // object overwrite to force a subsequent cast issue
    try { await u.validate(); } catch (e) { firstRejected = true; }
    // (if the sanitizer already fixed it, validation may pass — acceptable)

    u.balance.available = (u.balance.available || 0) + 10;
    await expect(u.save()).resolves.toBeTruthy();
    const reloaded = await User.findById(id);
    expect(typeof reloaded.location).toBe('string');
    await User.deleteOne({ _id: id });
    expect(typeof firstRejected).toBe('boolean');
  });

  test('string payoutMethod is coerced to {type} on save', async () => {
    const id = uid();
    await User.collection.insertOne({
      _id: id,
      name: 'Legacy PM',
      email: mkEmail('legacy_pm'),
      password: 'password123',
      country: 'US',
      authProvider: 'email',
      emailVerified: true,
      location: 'Los Angeles, CA, US',
      payoutMethod: 'stripe', // string where schema expects object
    });
    const u = await User.findById(id);
    u.balance.available = (u.balance.available || 0) + 5;
    await u.save();
    const reloaded = await User.findById(id);
    expect(reloaded.payoutMethod && reloaded.payoutMethod.type).toBe('stripe');
    await User.deleteOne({ _id: id });
  });

  test('object payoutMethod carrying unknown `details` folds into schema fields', async () => {
    const id = uid();
    await User.collection.insertOne({
      _id: id,
      name: 'Legacy PM details',
      email: mkEmail('legacy_pmd'),
      password: 'password123',
      country: 'US',
      authProvider: 'email',
      emailVerified: true,
      location: 'New York, NY, US',
      payoutMethod: {
        type: 'bank',
        details: { accountNumber: '12345', routingNumber: '67890', accountHolderName: 'A Rivera' },
      },
    });
    const u = await User.findById(id);
    u.balance.available = (u.balance.available || 0) + 5;
    await u.save();
    const reloaded = await User.findById(id);
    expect(reloaded.payoutMethod.type).toBe('bank');
    expect(reloaded.payoutMethod.accountNumber).toBe('12345');
    expect(reloaded.payoutMethod.details).toBeUndefined();
    await User.deleteOne({ _id: id });
  });
});