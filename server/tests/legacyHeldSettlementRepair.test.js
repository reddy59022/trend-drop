/**
 * Legacy held-settlement reconciliation (regression suite).
 *
 * Before the new-seller hold was *recorded* on the transaction, the completion
 * paths only skipped the release: the order was finalized, the money stayed in
 * `balance.pending`, and the payout row was written as if the seller had been
 * paid. Nothing on those transactions says the payout was withheld, so they look
 * exactly like genuinely paid sales — unless the audit looks for the traces
 * every release leaves behind and for the funds still sitting in the seller's
 * pending balance.
 *
 * The repair is deliberately one-sided in its risk:
 *   - paying twice is a platform loss and must be impossible,
 *   - never paying is a seller loss and must be *proved*, not guessed,
 *   - buyer money (refunds, returns, buyer protection) is not part of this
 *     question at all and must not move.
 */
const request = require('supertest');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const app = require('../server');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Transaction = require('../models/Transaction');
const Payout = require('../models/Payout');
const { orderStates, timeWindows } = require('../config/orderLifecycle');
const { auditSettlement, reconcileSettlements } = require('../utils/settlementAudit');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';
const generateToken = (userId) => jwt.sign({ id: userId }, JWT_SECRET, { expiresIn: '30d' });

const TEST_RUN_ID = `legacyhold_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const EARNINGS = 92;
const RESERVE = 9.2;
const AVAILABLE = 82.8;
const DAY = 24 * 60 * 60 * 1000;

const daysAgo = (days) => new Date(Date.now() - days * DAY);

/** Copy written ONLY by the withholding branch (both legacy and current). */
const HOLD_NOTICE_LEGACY = 'Payment held: New seller hold is active.';
const HOLD_NOTICE_CURRENT = 'Payment held: New seller hold active until account is 14 days old.';
/** Copy written by every release path. */
const RELEASE_NOTICE = `Payment of ${AVAILABLE} USD released; ${RESERVE} USD held in reserve.`;
const ESCROW_RELEASE_NOTICE = `Escrow released! ${AVAILABLE} USD added to your account. ${RESERVE} USD held in reserve.`;

const makeWorld = async (label, { sellerCreatedAt = null, pending = EARNINGS } = {}) => {
  const seller = await User.create({
    name: `Legacy Seller ${label}`,
    email: `legacyseller_${label}_${TEST_RUN_ID}@test.com`,
    password: 'password123',
    emailVerified: true,
    authProvider: 'email',
    country: 'US',
    currency: 'USD',
    role: 'user',
    stats: { totalSales: 0, totalPurchases: 0, strikes: 0 },
    balance: { available: 0, pending, totalEarned: 0, totalPaidOut: 0, currency: 'USD' },
  });
  if (sellerCreatedAt) {
    // Raw driver write: Mongoose owns `createdAt` on timed models.
    await User.collection.updateOne({ _id: seller._id }, { $set: { createdAt: sellerCreatedAt } });
  }
  const buyer = await User.create({
    name: `Legacy Buyer ${label}`,
    email: `legacybuyer_${label}_${TEST_RUN_ID}@test.com`,
    password: 'password123',
    emailVerified: true,
    authProvider: 'email',
    country: 'US',
    currency: 'USD',
    role: 'user',
    balance: { available: 0, pending: 0, totalEarned: 0, totalPaidOut: 0, currency: 'USD' },
  });
  const listing = await Listing.create({
    seller: seller._id,
    title: `Legacy Item ${label} ${TEST_RUN_ID}`,
    description: 'Fixture listing for legacy held settlement tests',
    price: 100,
    category: 'Men',
    condition: 'New with tags',
    available: true,
    sold: false,
    quantity: 5,
    shipsFrom: 'US',
    weight: 1,
  });
  return { seller: await User.findById(seller._id), buyer, listing };
};

const pushNotice = (userId, { transaction, message }) =>
  User.updateOne(
    { _id: userId },
    { $push: { notifications: { $each: [{ type: 'sale', transaction, message }], $position: 0 } } },
  );

/**
 * The ambiguous legacy row: completed, no `settlementHold`, a payout row that
 * may even claim `completed`, and no release markers — plus whatever notice the
 * completion path left behind.
 */
const makeLegacyRow = async (label, {
  world: reuseWorld = null,
  sellerCreatedAt = null,
  pending = EARNINGS,
  notices = [],
  payoutStatus = 'pending',
  payoutMissing = false,
  settlementKey = false,
  reserveEntry = false,
  escrowStatus = null,
  status = orderStates.COMPLETED,
} = {}) => {
  // A second row for the SAME seller (needed to prove the funds on hand are the
  // ceiling on what any run may pay out).
  const world = reuseWorld
    ? {
      seller: await User.findById(reuseWorld.seller._id),
      buyer: reuseWorld.buyer,
      listing: reuseWorld.listing,
    }
    : await makeWorld(label, { sellerCreatedAt, pending });
  if (reuseWorld) {
    await User.updateOne({ _id: world.seller._id }, { $set: { 'balance.pending': pending } });
  }

  const txn = await Transaction.create({
    listing: world.listing._id,
    buyer: world.buyer._id,
    seller: world.seller._id,
    itemPrice: 100,
    currency: 'USD',
    quantity: 1,
    paymentBreakdown: {
      subtotal: 100,
      shippingCost: 10,
      buyerProtectionFee: 5,
      buyerProtectionPercent: 5,
      tax: 0,
      totalPaid: 115,
      platformFee: 8,
      platformFeePercent: 8,
      shippingPayout: 10,
      sellerEarnings: EARNINGS,
    },
    shipping: {
      carrier: 'USPS',
      trackingNumber: `TRK-${label}-${TEST_RUN_ID}`,
      labelCreated: true,
      labelCreatedDate: daysAgo(20),
      actualDelivery: daysAgo(19),
      trackingHistory: [],
    },
    status,
    buyerConfirmed: { received: true, confirmedAt: daysAgo(18) },
    payout: { status: payoutStatus, transactionId: '' },
    ...(escrowStatus ? { escrow: { status: escrowStatus, amount: 115, initiatedAt: daysAgo(18) } } : {}),
  });

  let payout = null;
  if (!payoutMissing) {
    payout = await Payout.create({
      seller: world.seller._id,
      transaction: txn._id,
      listing: world.listing._id,
      salePrice: 100,
      commissionRate: 0.08,
      commissionAmount: 8,
      payoutAmount: EARNINGS,
      status: payoutStatus,
      ...(payoutStatus === 'completed' ? { paidAt: daysAgo(19) } : {}),
    });
  }

  for (const message of notices) {
    await pushNotice(world.seller._id, { transaction: txn._id, message });
  }

  const balanceOps = {};
  if (settlementKey) {
    balanceOps.$push = { ...(balanceOps.$push || {}), 'balance.settledTransactions': String(txn._id) };
  }
  if (reserveEntry) {
    balanceOps.$push = {
      ...(balanceOps.$push || {}),
      'balance.reserveReleaseDate': {
        amount: RESERVE,
        releaseDate: new Date(Date.now() + 30 * DAY),
        transactionId: txn._id,
      },
    };
    balanceOps.$inc = { 'balance.reserve': RESERVE };
  }
  if (Object.keys(balanceOps).length) {
    await User.updateOne({ _id: world.seller._id }, balanceOps);
  }

  return { ...world, txn, payout };
};

const sellerAfter = (id) => User.findById(id);

/** Fail when one seller's balance update runs (retry-safety fixtures). */
const poisonUserUpdateOnce = (sellerId) => {
  const realUpdateOne = User.updateOne;
  let fired = false;
  jest.spyOn(User, 'updateOne').mockImplementation(function updateOne(filter, ...rest) {
    if (!fired && filter && String(filter._id) === String(sellerId)) {
      fired = true;
      return Promise.reject(new Error('db unavailable'));
    }
    return realUpdateOne.call(User, filter, ...rest);
  });
};

beforeAll(async () => {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/trend-drop-test';
  if (mongoose.connection.readyState === 0) await mongoose.connect(uri);
});

afterAll(async () => {
  await Transaction.deleteMany({});
  await Payout.deleteMany({});
  await Listing.deleteMany({});
  await User.deleteMany({});
});

beforeEach(async () => {
  await Transaction.deleteMany({});
  await Payout.deleteMany({});
  await Listing.deleteMany({});
  await User.deleteMany({});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('classifying a completed order with no settlement record', () => {
  test('LSR.1 a withheld order is identified by the hold notice and the funds still in pending', async () => {
    const row = await makeLegacyRow('classify-held', { notices: [HOLD_NOTICE_LEGACY] });

    const audit = auditSettlement({ txn: row.txn, seller: await sellerAfter(row.seller._id) });

    expect(audit.verdict).toBe('unpaid');
    expect(audit.evidence).toContain('hold_notice');
    expect(audit.earnings).toBeCloseTo(EARNINGS, 2);
  });

  test('LSR.2 a released order is recognised by the trace the release call leaves behind', async () => {
    const row = await makeLegacyRow('classify-paid', {
      notices: [RELEASE_NOTICE],
      pending: 0,
      reserveEntry: true,
      payoutStatus: 'completed',
    });

    const audit = auditSettlement({ txn: row.txn, seller: await sellerAfter(row.seller._id) });

    expect(audit.verdict).toBe('already_paid');
    expect(audit.evidence).toEqual(expect.arrayContaining(['reserve_entry', 'release_notice']));
  });

  test('LSR.3 the release notice alone still proves payment after the reserve entry ages out', async () => {
    // releaseReserves deletes matured reserve entries, so for any sale older
    // than the reserve window the notification is the last durable trace.
    const row = await makeLegacyRow('classify-aged', {
      notices: [RELEASE_NOTICE],
      pending: 0,
      payoutStatus: 'completed',
    });

    const audit = auditSettlement({ txn: row.txn, seller: await sellerAfter(row.seller._id) });

    expect(audit.verdict).toBe('already_paid');
    expect(audit.evidence).toContain('release_notice');
  });

  test('LSR.4 a row an operator has to look at is reported, never paid', async () => {
    // No hold trace, no release trace, nothing in pending: unknowable from the
    // data alone. Guessing here is how a seller gets paid twice.
    const row = await makeLegacyRow('classify-unknown', { pending: 0, sellerCreatedAt: daysAgo(400) });

    const audit = auditSettlement({ txn: row.txn, seller: await sellerAfter(row.seller._id) });

    expect(audit.verdict).toBe('unknown');
    expect(audit.blockers).toContain('hold_impossible');
  });

  test('LSR.5 contradictory traces are escalated instead of resolved', async () => {
    const row = await makeLegacyRow('classify-conflict', {
      notices: [HOLD_NOTICE_CURRENT, RELEASE_NOTICE],
      pending: 0,
      payoutStatus: 'completed',
    });

    const audit = auditSettlement({ txn: row.txn, seller: await sellerAfter(row.seller._id) });

    expect(audit.verdict).toBe('conflict');
    expect(audit.blockers).toContain('conflicting_evidence');
  });

  test('LSR.6 a refunded or escrowed order is out of scope for settlement', async () => {
    const refunded = await makeLegacyRow('classify-refunded', {
      notices: [HOLD_NOTICE_LEGACY],
      payoutStatus: 'refunded',
    });
    const escrowed = await makeLegacyRow('classify-escrow', {
      notices: [HOLD_NOTICE_LEGACY],
      escrowStatus: 'active',
    });

    const refundedAudit = auditSettlement({ txn: refunded.txn, seller: await sellerAfter(refunded.seller._id) });
    const escrowAudit = auditSettlement({ txn: escrowed.txn, seller: await sellerAfter(escrowed.seller._id) });

    expect(refundedAudit.verdict).toBe('out_of_scope');
    expect(refundedAudit.blockers).toContain('payout_refunded');
    expect(escrowAudit.verdict).toBe('out_of_scope');
    expect(escrowAudit.blockers).toContain('escrow_active');
  });
});

describe('repairing the withheld legacy backlog', () => {
  test('LSR.7 a dry run reports the backlog and moves no money', async () => {
    const row = await makeLegacyRow('dry-run', { notices: [HOLD_NOTICE_LEGACY] });

    const report = await reconcileSettlements({ apply: false });

    expect(report.dryRun).toBe(true);
    expect(report.counts.unpaid).toBe(1);
    expect(report.counts.released).toBe(0);
    expect(report.findings[0].action).toBe('would_release');

    // Nothing at all may be written while auditing.
    const untouched = await sellerAfter(row.seller._id);
    expect(untouched.balance.available).toBe(0);
    expect(untouched.balance.pending).toBeCloseTo(EARNINGS, 2);
    const txn = await Transaction.findById(row.txn._id);
    expect(txn.settlementHold?.releasedAt).toBeFalsy();
    expect(txn.settlementAudit?.verdict).toBeFalsy();
    expect(txn.settlementAudit?.reconciledAt).toBeFalsy();
  });

  test('LSR.8 applying pays the seller exactly once and closes the order', async () => {
    const row = await makeLegacyRow('apply', { notices: [HOLD_NOTICE_LEGACY] });
    const buyerBefore = await User.findById(row.buyer._id);

    const report = await reconcileSettlements({ apply: true });

    expect(report.counts.released).toBe(1);
    expect(report.findings[0].action).toBe('released');

    const seller = await sellerAfter(row.seller._id);
    expect(seller.balance.available).toBeCloseTo(AVAILABLE, 2);
    expect(seller.balance.pending).toBe(0);
    expect(seller.balance.reserve).toBeCloseTo(RESERVE, 2);
    expect(seller.balance.reserveReleaseDate).toHaveLength(1);
    expect(String(seller.balance.reserveReleaseDate[0].transactionId)).toBe(String(row.txn._id));
    expect(seller.balance.settledTransactions).toContain(String(row.txn._id));
    // The seller is told the money arrived.
    expect(seller.notifications.some((n) => /released/i.test(n.message || ''))).toBe(true);

    // The payout ledger stops claiming a payment that never happened.
    const payouts = await Payout.find({ transaction: row.txn._id });
    expect(payouts).toHaveLength(1);
    expect(payouts[0].status).toBe('completed');
    expect(payouts[0].paidAt).toBeTruthy();

    // The order is closed and traceable: the recovered hold is recorded like
    // any other hold so no path can come back for it.
    const txn = await Transaction.findById(row.txn._id);
    expect(txn.status).toBe(orderStates.COMPLETED);
    expect(txn.settlementHold.reason).toBe('legacy_hold_recovered');
    expect(txn.settlementHold.releasedAt).toBeTruthy();
    expect(txn.settlementAudit.verdict).toBe('released');
    expect(txn.settlementAudit.earnings).toBeCloseTo(EARNINGS, 2);

    // Buyer money is not part of this question: no refund, no charge, no
    // balance change, and the amounts the buyer paid are untouched.
    const buyer = await User.findById(row.buyer._id);
    expect(buyer.balance.available).toBe(buyerBefore.balance.available);
    expect(buyer.balance.pending).toBe(buyerBefore.balance.pending);
    expect(txn.paymentBreakdown.totalPaid).toBe(115);
    expect(txn.paymentBreakdown.buyerProtectionFee).toBe(5);
    expect(txn.refundAmount).toBeFalsy();
  });

  test('LSR.9 a repaired order is never paid a second time', async () => {
    const row = await makeLegacyRow('apply-twice', { notices: [HOLD_NOTICE_LEGACY] });
    await reconcileSettlements({ apply: true });

    // A reconciled order is terminal: the sweep does not even look at it again.
    const plainRerun = await reconcileSettlements({ apply: true });
    expect(plainRerun.counts.released).toBe(0);
    expect(plainRerun.scanned).toBe(0);

    // ...and even if that closing stamp were lost (restore from backup, an
    // operator edit) the money trace itself must stop a second payout.
    await Transaction.updateOne(
      { _id: row.txn._id },
      { $unset: { settlementAudit: 1 }, $set: { 'settlementHold.releasedAt': null } },
    );

    const second = await reconcileSettlements({ apply: true });

    expect(second.counts.released).toBe(0);
    expect(second.counts.already_paid).toBe(1);
    expect(second.findings[0].action).toBe('none');
    const seller = await sellerAfter(row.seller._id);
    expect(seller.balance.available).toBeCloseTo(AVAILABLE, 2);
    expect(seller.balance.reserveReleaseDate).toHaveLength(1);
    expect(seller.balance.settledTransactions.filter((k) => k === String(row.txn._id))).toHaveLength(1);
  });

  test('LSR.10 a genuinely paid order is left alone even when it looks withheld', async () => {
    // Completed, payout row claiming `completed`, seller balance already
    // drained: the only thing missing is the release trace.
    const row = await makeLegacyRow('paid-no-touch', {
      notices: [RELEASE_NOTICE],
      pending: 0,
      reserveEntry: true,
      payoutStatus: 'completed',
    });

    const report = await reconcileSettlements({ apply: true });

    expect(report.counts.released).toBe(0);
    expect(report.counts.already_paid).toBe(1);
    const seller = await sellerAfter(row.seller._id);
    expect(seller.balance.available).toBe(0);
    expect(seller.balance.pending).toBe(0);
  });

  test('LSR.11 the platform never books out money it is not holding', async () => {
    // Hold trace present but the cash is gone (a clawback or an earlier payout
    // consumed it). Paying here would credit the seller from nothing.
    const row = await makeLegacyRow('insufficient', { notices: [HOLD_NOTICE_LEGACY], pending: 0 });

    const report = await reconcileSettlements({ apply: true });

    expect(report.counts.released).toBe(0);
    expect(report.counts.insufficient_pending).toBe(1);
    expect(report.findings[0].action).toBe('skipped');
    expect(report.findings[0].blockers).toContain('insufficient_pending');

    const seller = await sellerAfter(row.seller._id);
    expect(seller.balance.available).toBe(0);
    expect(seller.balance.pending).toBe(0);
    expect(seller.balance.totalEarned).toBe(0);

    // The refused decision is written down, so finance can see why an operator
    // run left this order unpaid (and the order stays queued for review).
    const txn = await Transaction.findById(row.txn._id);
    expect(txn.settlementAudit.verdict).toBe('unpaid');
    expect(txn.settlementAudit.blockers).toContain('insufficient_pending');
    expect(txn.settlementAudit.reconciledAt).toBeTruthy();
  });

  test('LSR.20 an order whose seller account is gone is escalated, never paid', async () => {
    const row = await makeLegacyRow('orphan', { notices: [HOLD_NOTICE_LEGACY] });
    // The ledger the payout would be credited to does not exist.
    await Transaction.updateOne(
      { _id: row.txn._id },
      { $set: { seller: new mongoose.Types.ObjectId() } },
    );

    const report = await reconcileSettlements({ apply: true });

    expect(report.counts.released).toBe(0);
    expect(report.counts.seller_missing).toBe(1);
    expect(report.findings[0].action).toBe('skipped');

    const seller = await sellerAfter(row.seller._id);
    expect(seller.balance.available).toBe(0);
    expect(seller.balance.pending).toBeCloseTo(EARNINGS, 2);
  });

  test('LSR.12 the funds on hand are the budget: two held orders cannot be paid from one', async () => {
    // Two withheld orders on one account, and the account holds a single payout.
    const first = await makeLegacyRow('budget-a', { notices: [HOLD_NOTICE_LEGACY] });
    await makeLegacyRow('budget-b', { world: first, notices: [HOLD_NOTICE_LEGACY] });

    const report = await reconcileSettlements({ apply: true });

    expect(report.counts.released).toBe(1);
    expect(report.counts.insufficient_pending).toBe(1);

    const seller = await sellerAfter(first.seller._id);
    expect(seller.balance.available).toBeCloseTo(AVAILABLE, 2);
    expect(seller.balance.pending).toBe(0);
  });

  test('LSR.21 the dry run forecasts exactly what an apply run would do', async () => {
    const row = await makeLegacyRow('forecast-a', { notices: [HOLD_NOTICE_LEGACY] });
    await makeLegacyRow('forecast-b', { world: row, notices: [HOLD_NOTICE_LEGACY] });

    const forecast = await reconcileSettlements({ apply: false });

    expect(forecast.counts.released).toBe(0);
    expect(forecast.counts.insufficient_pending).toBe(1);
    expect(forecast.findings.filter((f) => f.action === 'would_release')).toHaveLength(1);

    // The review step is only worth anything if the numbers survive contact.
    const applied = await reconcileSettlements({ apply: true });
    expect(applied.counts.released).toBe(forecast.findings.filter((f) => f.action === 'would_release').length);
    expect(applied.counts.insufficient_pending).toBe(forecast.counts.insufficient_pending);
  });

  test('LSR.13 a failed payment leaves the row queued and the retry pays once', async () => {
    const row = await makeLegacyRow('retry', { notices: [HOLD_NOTICE_LEGACY] });
    poisonUserUpdateOnce(row.seller._id);

    const first = await reconcileSettlements({ apply: true });
    expect(first.counts.failed).toBe(1);
    expect(first.counts.released).toBe(0);

    jest.restoreAllMocks();
    // Queued, not lost: the hold was never stamped, so the next run retries it.
    const pendingTxn = await Transaction.findById(row.txn._id);
    expect(pendingTxn.settlementHold?.releasedAt).toBeFalsy();

    const second = await reconcileSettlements({ apply: true });
    expect(second.counts.released).toBe(1);

    const seller = await sellerAfter(row.seller._id);
    expect(seller.balance.available).toBeCloseTo(AVAILABLE, 2);
    expect(seller.balance.reserveReleaseDate).toHaveLength(1);
  });

  test('LSR.14 refunded and escrowed orders are reported, never paid', async () => {
    const refunded = await makeLegacyRow('scope-refunded', {
      notices: [HOLD_NOTICE_LEGACY],
      payoutStatus: 'refunded',
    });
    const escrowed = await makeLegacyRow('scope-escrow', {
      notices: [HOLD_NOTICE_LEGACY],
      escrowStatus: 'active',
    });

    const report = await reconcileSettlements({ apply: true });

    expect(report.counts.released).toBe(0);
    for (const id of [refunded.seller._id, escrowed.seller._id]) {
      const seller = await sellerAfter(id);
      expect(seller.balance.available).toBe(0);
      expect(seller.balance.pending).toBeCloseTo(EARNINGS, 2);
    }
  });

  test('LSR.15 the sweep is not fooled by the payout row the legacy code wrote', async () => {
    // The completion path wrote `completed`/`paidAt` whether or not it
    // released: the ledger row cannot be treated as proof of payment.
    const row = await makeLegacyRow('liar-payout', {
      notices: [HOLD_NOTICE_LEGACY],
      payoutStatus: 'completed',
    });

    const report = await reconcileSettlements({ apply: true });

    expect(report.counts.released).toBe(1);
    const seller = await sellerAfter(row.seller._id);
    expect(seller.balance.available).toBeCloseTo(AVAILABLE, 2);
  });

  test('LSR.16 a matured hold the daily sweep has not reached yet is paid too', async () => {
    // The reconciler is also the safety net for releaseHeldSettlements: a
    // recorded hold whose release day has passed and that was never stamped
    // must not sit unpaid because the job did not run.
    const matured = await makeLegacyRow('modern-matured', { notices: [HOLD_NOTICE_CURRENT] });
    await Transaction.updateOne(
      { _id: matured.txn._id },
      {
        $set: {
          settlementHold: { reason: 'new_seller', releaseAfter: daysAgo(1), releasedAt: null },
        },
      },
    );

    const report = await reconcileSettlements({ apply: true });

    expect(report.counts.released).toBe(1);
    const seller = await sellerAfter(matured.seller._id);
    expect(seller.balance.available).toBeCloseTo(AVAILABLE, 2);
  });

  test('LSR.17 a hold that has not matured is left for its release date', async () => {
    const active = await makeLegacyRow('modern-active', { notices: [HOLD_NOTICE_CURRENT] });
    await Transaction.updateOne(
      { _id: active.txn._id },
      {
        $set: {
          settlementHold: { reason: 'new_seller', releaseAfter: new Date(Date.now() + 5 * DAY), releasedAt: null },
        },
      },
    );

    const report = await reconcileSettlements({ apply: true });

    expect(report.counts.released).toBe(0);
    expect(report.counts.held_pending).toBe(1);
    const seller = await sellerAfter(active.seller._id);
    expect(seller.balance.available).toBe(0);
    expect(seller.balance.pending).toBeCloseTo(EARNINGS, 2);
  });

  test('LSR.18 the new-seller hold window is respected as the cut-over for the legacy class', async () => {
    // A seller who was already past the hold window when the order was placed
    // cannot have had funds withheld, so the row is reported, not paid.
    const row = await makeLegacyRow('cutover', {
      notices: [],
      pending: 0,
      sellerCreatedAt: new Date(Date.now() - timeWindows.NEW_SELLER_HOLD - 30 * DAY),
    });

    const report = await reconcileSettlements({ apply: true });

    expect(report.counts.released).toBe(0);
    expect(report.counts.unknown).toBe(1);
    expect(report.findings[0].blockers).toContain('hold_impossible');
    const seller = await sellerAfter(row.seller._id);
    expect(seller.balance.available).toBe(0);
  });
});

describe('operator access to the reconciliation', () => {
  test('LSR.19 only an admin can run the reconciliation, and it takes two steps to pay', async () => {
    const row = await makeLegacyRow('operator', { notices: [HOLD_NOTICE_LEGACY] });
    const admin = await User.create({
      name: 'Reconcile Admin',
      email: `reconcile_admin_${TEST_RUN_ID}@test.com`,
      password: 'password123',
      emailVerified: true,
      authProvider: 'email',
      role: 'admin',
      country: 'US',
      currency: 'USD',
    });
    const adminToken = generateToken(admin._id);
    const userToken = generateToken(row.buyer._id);

    const forbidden = await request(app)
      .get('/api/admin/settlements/audit')
      .set('Authorization', `Bearer ${userToken}`);
    expect(forbidden.status).toBe(403);

    const dryRun = await request(app)
      .get('/api/admin/settlements/audit')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(dryRun.status).toBe(200);
    expect(dryRun.body.counts.unpaid).toBe(1);
    const sellerBefore = await sellerAfter(row.seller._id);
    expect(sellerBefore.balance.available).toBe(0);

    // Reporting is safe; paying requires an explicit confirmation.
    const unconfirmed = await request(app)
      .post('/api/admin/settlements/reconcile')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ apply: true });
    expect(unconfirmed.status).toBe(400);

    const applied = await request(app)
      .post('/api/admin/settlements/reconcile')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ apply: true, confirm: true });
    expect(applied.status).toBe(200);
    expect(applied.body.counts.released).toBe(1);

    const seller = await sellerAfter(row.seller._id);
    expect(seller.balance.available).toBeCloseTo(AVAILABLE, 2);
  });
});
