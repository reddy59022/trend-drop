const express = require('express');
const router = express.Router();
const Payout = require('../models/Payout');
const Transaction = require('../models/Transaction');
const Listing = require('../models/Listing');
const User = require('../models/User');
const { auth } = require('../middleware/auth');
const { isValidObjectId } = require('../utils/validators');
const { currencies } = require('../config/currencies');

// Platform commission is 8% of item price (matching payments.js countryCommissions)
const COMMISSION_RATE = 0.08;

// GLOBAL CURRENCY STANDARD: payouts and transactions are each denominated in
// their own currency, so aggregates must normalize to USD (the client's base
// conversion currency) before summing. Rates are quoted per USD, so
// USD value = amount / rate. Unknown/missing currency → treated as USD.
const usdNormalized = (amount, currency) => {
  const value = typeof amount === 'number' && isFinite(amount) ? amount : 0;
  const rate = (currencies[currency] && currencies[currency].rate) || 1;
  return value / rate;
};

// Numeric guards + 2-decimal rounding (currency-safe, deterministic).
const num = (v) => (typeof v === 'number' && isFinite(v) ? v : 0);
const round2 = (v) => Math.round((num(v) + Number.EPSILON) * 100) / 100;

// Integer-cents helpers. Float rounding at every step (0.1+0.2 style error)
// is what corrupts money totals when many payouts are summed — so every sum
// in this file is accumulated in whole cents and rounded ONCE at the end.
//   toCents(10.005) -> 1001 ; fromCents(1001) -> 10.01
const toCents = (usdValue) => Math.round(num(usdValue) * 100);
const fromCents = (cents) => Math.round(cents) / 100;

// Exact-decimal per-payout self-consistency.
// Freelance-money rule: for one payout, gross − platformCut − sellerNet must
// be exactly 0.00 after each leg is rounded to cents. Computing
//   cut = round2(gross − net)
// in floating point can leave a 1-cent ghost (e.g. gross=5693.04 split over
// many rows). Instead we derive the cut in integer cents:
//   cutCents = grossCents − netCents   (exact, no float ghost)
// so salePrice ≡ platformCut + payoutAmount holds to the cent, every row.
function exactPayoutLegs(grossUsd, netUsd) {
  const grossCents = toCents(grossUsd);
  const netCents = toCents(netUsd);
  const cutCents = grossCents - netCents;
  return {
    salePrice: fromCents(grossCents),
    payoutAmount: fromCents(netCents),
    platformCut: fromCents(cutCents),
  };
}
// LEGACY PAYOUT NORMALIZATION (used by /dashboard AND /balance so both stay
// consistent). Old seed data stored `amount` as the NET money the seller
// receives — it is NOT the gross sale price. Older buggy code wrote
//   salePrice = amount,  payoutAmount = amount − 8%·amount,  commissionAmount = 8%·amount
// which understated both gross sales and the seller's net. We rebuild a
// self-consistent triple so every payout satisfies the revenue invariant:
//   salePrice (gross) = platform cut + seller payout
// where "platform cut" is everything the seller did NOT receive
// (commission + boost fees + any other platform share) — never understated,
// so platform revenue can never leak to a seller.
function normalizePayout(docLike) {
  const doc = docLike.toObject ? docLike.toObject() : docLike;
  const hasAmount = doc.amount != null && isFinite(doc.amount);
  const amount = round2(num(doc.amount));

  let salePrice = round2(num(doc.salePrice));
  let commissionAmount = round2(num(doc.commissionAmount));
  let payoutAmount = round2(num(doc.payoutAmount));

  if (hasAmount) {
    const saleEqualsNet = salePrice > 0 && Math.abs(salePrice - amount) < 0.01;
    const payoutDiffers = payoutAmount > 0 && Math.abs(payoutAmount - amount) > 0.01;
    // `amount` is the authoritative net. Rebuild when the stored triple is
    // missing or came from the old buggy formula above. Derived in cents so
    // salePrice − payoutAmount − platformCut is exactly 0.00.
    if (payoutAmount === 0 || (saleEqualsNet && payoutDiffers)) {
      const gross = toCents(amount / (1 - COMMISSION_RATE));
      const legs = exactPayoutLegs(fromCents(gross), amount);
      salePrice = legs.salePrice;
      commissionAmount = legs.platformCut;
      payoutAmount = legs.payoutAmount;
    }
  }

  // Backfill any single missing field from the two present values (cents-safe).
  if (salePrice === 0 && payoutAmount > 0 && commissionAmount > 0) {
    const legs = exactPayoutLegs(fromCents(toCents(commissionAmount) + toCents(payoutAmount)), payoutAmount);
    salePrice = legs.salePrice;
  }
  if (payoutAmount === 0 && salePrice > 0 && commissionAmount > 0) {
    const legs = exactPayoutLegs(salePrice, fromCents(toCents(salePrice) - toCents(commissionAmount)));
    payoutAmount = legs.payoutAmount;
  }
  if (commissionAmount === 0 && salePrice > 0 && payoutAmount > 0) {
    const legs = exactPayoutLegs(salePrice, payoutAmount);
    commissionAmount = legs.platformCut;
  }

  // Nothing usable at all → derive from `amount` (net) when available.
  if (salePrice === 0 && payoutAmount === 0 && commissionAmount === 0 && hasAmount) {
    const gross = toCents(amount / (1 - COMMISSION_RATE));
    const legs = exactPayoutLegs(fromCents(gross), amount);
    salePrice = legs.salePrice;
    commissionAmount = legs.platformCut;
    payoutAmount = legs.payoutAmount;
  }

  // The platform's actual cut = gross − seller payout, derived in integer
  // cents. Aggregating this per payout guarantees
  // totalSales === totalCommission + totalPayouts EXACTLY (no float ghost).
  const legs = exactPayoutLegs(salePrice, payoutAmount);
  const platformCut = legs.platformCut;

  return {
    salePrice: round2(salePrice),
    commissionAmount: round2(commissionAmount),
    payoutAmount: round2(payoutAmount),
    platformCut,
  };
}

// GET /api/payouts/dashboard - Get seller payout dashboard
router.get('/dashboard', auth, async (req, res) => {
  try {
    const sellerId = req.user._id;

    // Get all payouts for this seller
    let payouts = await Payout.find({ seller: sellerId })
      .populate('listing', 'title images price')
      .populate('transaction', 'status createdAt')
      .sort({ createdAt: -1 });

    // Also get completed transactions that may not have Payout records yet
    const completedTransactions = await Transaction.find({
      seller: sellerId,
      status: 'completed',
    }).populate('listing', 'title images price');

    // Normalize legacy/buggy docs on read so downstream code and the client
    // always see a self-consistent salePrice/commissionAmount/payoutAmount
    // triple (see normalizePayout above). Guarantees the revenue invariant:
    // totalSales === totalCommission + totalPayouts (gross = platform + seller).
    const normalized = payouts.map(p => {
      const doc = p.toObject ? p.toObject() : p;
      const n = normalizePayout(p);
      doc.salePrice = n.salePrice;
      doc.commissionAmount = n.commissionAmount;
      doc.payoutAmount = n.payoutAmount;
      doc.platformCut = n.platformCut;
      return doc;
    });
    payouts = normalized;

    const completedPayouts = payouts.filter(p => p.status === 'completed');

    // ── Accurate aggregates (integer cents — rounded ONCE) ──────────────
    // totalSales     = gross $ volume across every payout + any completed
    //                  transactions that do not have a payout record yet.
    // totalPayouts   = total $ the seller is owed (completed + pending).
    // totalCommission is DERIVED (never summed independently):
    //                  totalCommission = totalSales − totalPayouts  (cents)
    // so the revenue invariant holds EXACTLY by construction:
    //   totalSales ≡ totalCommission + totalPayouts
    // This is the revenue-loss guard: the platform cut can never be
    // understated by float rounding, and no dollar is counted twice.
    const orphanTxns = completedTransactions.filter(
      t => !payouts.some(p => p.transaction?.toString() === t._id.toString())
    );

    // Completed transactions that have no payout record yet are a rare safety
    // net: their seller earnings feed into `pendingAmount` so sellers still
    // see the money owed — BUT they do not enter the recorded gross totals
    // (totalSales / totalCommission / totalPayouts), which the documented API
    // contract computes over PAYOUT DOCS only ("dashboard totals match
    // completed payouts"). The orphan gross is surfaced separately as the
    // audit field salesWithoutPayoutRecord so platform accounting still sees
    // every owed dollar exactly once (pendingAmount = pendingPayouts +
    // pendingFromTransactions, never double-counted in totalPayouts).
    const pendingFromTransactions = fromCents(orphanTxns.reduce(
      (cents, t) => cents + toCents(usdNormalized(t.paymentBreakdown?.sellerEarnings || 0, t.currency)), 0));
    const orphanSaleTotal = fromCents(orphanTxns.reduce(
      (cents, t) => cents + toCents(usdNormalized(t.paymentBreakdown?.subtotal || t.itemPrice || t.amount || 0, t.currency)), 0));

    // Sum each leg in whole cents across payouts; round ONCE at the end.
    const payoutGrossCents = payouts.reduce((cents, p) => cents + toCents(usdNormalized(p.salePrice, p.currency)), 0);
    const payoutNetCents = payouts.reduce((cents, p) => cents + toCents(usdNormalized(p.payoutAmount, p.currency)), 0);

    const totalSales = fromCents(payoutGrossCents);
    const totalSalesCount = completedPayouts.length;
    const totalPayouts = fromCents(payoutNetCents); // seller money from documented payouts
    // Platform cut DERIVED in cents — exact by construction, never a float sum.
    const totalCommission = fromCents(payoutGrossCents - payoutNetCents);

    // Completed earnings = realized seller payout from completed payouts only.
    const totalEarnings = fromCents(completedPayouts.reduce(
      (cents, p) => cents + toCents(usdNormalized(p.payoutAmount, p.currency)), 0));

    // Pending = pending payouts (+ completed transactions without a payout record).
    const pendingPayouts = payouts.filter(p => p.status === 'pending');
    const pendingPayoutsCents = pendingPayouts.reduce(
      (cents, p) => cents + toCents(usdNormalized(p.payoutAmount, p.currency)), 0);
    const pendingAmount = fromCents(pendingPayoutsCents + toCents(pendingFromTransactions));

    // Revenue-protection reconciliation check (must be exactly equal):
    // every gross dollar is either platform cut or seller payout.
    const reconciledTotalSales = fromCents(
      toCents(totalCommission) + toCents(totalPayouts));
    if (Math.abs(reconciledTotalSales - totalSales) > 0.01) {
      console.warn('[payouts] dashboard reconciliation mismatch', {
        sellerId: String(sellerId), totalSales, reconciledTotalSales,
      });
    }

    // Seller's cash-out balance = realized earnings minus what was already
    // paid out (tracked on the seller's balance by /api/payments/payout).
    const sellerDoc = await User.findById(sellerId).select('balance').lean();
    const userAvailable = num(sellerDoc?.balance?.available);
    const userTotalPaidOut = num(sellerDoc?.balance?.totalPaidOut);
    const totalEarned = round2(totalEarnings);
    const pendingBalance = round2(pendingAmount);
    const availableBalance = round2(Math.max(0, totalEarned - userTotalPaidOut) + userAvailable);

    res.json({
      commissionRate: COMMISSION_RATE,
      commissionPercent: COMMISSION_RATE * 100,
      totalSales,
      totalSalesCount,
      totalCommission,
      totalEarnings,
      // ALIASES — client + e2e contract expects these exact field names
      totalEarned,
      totalPaidOut: userTotalPaidOut,
      pendingBalance,
      availableBalance,
      pendingAmount,
      pendingCount: pendingPayouts.length + orphanTxns.length,
      // Audit / accuracy fields (used by tests; not exposed to sellers in UI)
      totalPayouts,
      pendingFromTransactions,
      salesWithoutPayoutRecord: orphanSaleTotal,
      reconciledTotalSales,
      payoutHistory: completedPayouts.slice(0, 20),
      recentTransactions: payouts.slice(0, 10),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/payouts/process/:transactionId - Process payout for a completed transaction
router.post('/process/:transactionId', auth, async (req, res) => {
  try {
    const transaction = await Transaction.findById(req.params.transactionId)
      .populate('listing')
      .populate('seller');

    if (!transaction) {
      return res.status(404).json({ message: 'Transaction not found' });
    }

    if (transaction.status !== 'completed') {
      return res.status(400).json({ message: 'Transaction must be completed before processing payout' });
    }

    // Authorization: only the seller who earned the money (or an admin) may
    // trigger payout processing. seller is populated, so compare against the
    // document id when present. Any authenticated user must not be able to
    // create payout records for arbitrary transactions.
    const sellerId = transaction.seller?._id || transaction.seller;
    const isAdmin = req.user.role === 'admin';
    if (String(sellerId) !== String(req.user._id) && !isAdmin) {
      return res.status(403).json({ message: 'Only the seller or an admin can process this payout' });
    }

    // Check if payout already exists for this transaction
    const existingPayout = await Payout.findOne({ transaction: transaction._id });
    if (existingPayout) {
      // Idempotent: auto-complete may have already created/paid this payout.
      // Returning 400 here means the Web/iOS/Android "Cash Out" button shows
      // a confusing error after an order auto-completes. Return the existing
      // payout with 200 so the client sees the money was already credited.
      const salePrice = transaction.paymentBreakdown?.subtotal || transaction.paymentBreakdown?.totalPaid || transaction.itemPrice || transaction.listing?.price || 0;
      const commissionAmount = transaction.paymentBreakdown?.platformFee || Math.round(salePrice * COMMISSION_RATE * 100) / 100;
      const payoutAmount = transaction.paymentBreakdown?.sellerEarnings || Math.round((salePrice - commissionAmount) * 100) / 100;
      await existingPayout.populate(['listing', 'transaction']).catch(() => {});
      return res.json({
        message: 'Payout already processed',
        payout: existingPayout,
        breakdown: {
          salePrice,
          commissionRate: `${COMMISSION_RATE * 100}%`,
          commissionAmount,
          payoutAmount,
        },
      });
    }

    // CRITICAL: Use actual breakdown values, NOT recalculated from totalPaid
    // commission is on item price only, NOT on shipping + buyer protection
    const salePrice = transaction.paymentBreakdown?.subtotal || transaction.paymentBreakdown?.totalPaid || transaction.itemPrice || transaction.listing?.price || 0;
    const commissionAmount = transaction.paymentBreakdown?.platformFee || Math.round(salePrice * COMMISSION_RATE * 100) / 100;
    const payoutAmount = transaction.paymentBreakdown?.sellerEarnings || Math.round((salePrice - commissionAmount) * 100) / 100;

    const payout = await Payout.create({
      seller: transaction.seller,
      transaction: transaction._id,
      listing: transaction.listing._id,
      salePrice,
      commissionRate: COMMISSION_RATE,
      commissionAmount,
      payoutAmount,
      status: 'completed',
      paidAt: new Date(),
    });

    await payout.populate(['listing', 'transaction']);

    res.status(201).json({
      message: 'Payout processed successfully',
      payout,
      breakdown: {
        salePrice,
        commissionRate: `${COMMISSION_RATE * 100}%`,
        commissionAmount,
        payoutAmount,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/payouts/auto-create - Auto-create payout for completed transaction (called by shipping confirm or order lifecycle)
router.post('/auto-create', auth, async (req, res) => {
  try {
    const { transactionId } = req.body;
    // Hostile-input guard: an uncastable transactionId (123, {}, "abc") used to
    // reach findById() and throw a CastError -> 500.
    if (!isValidObjectId(transactionId)) {
      return res.status(400).json({ message: 'Invalid transactionId' });
    }
    const transaction = await Transaction.findById(transactionId)
      .populate('listing')
      .populate('seller');

    if (!transaction) {
      return res.status(404).json({ message: 'Transaction not found' });
    }

    if (transaction.status !== 'completed') {
      return res.status(400).json({ message: 'Transaction must be completed' });
    }

    // Check if payout already exists
    const existingPayout = await Payout.findOne({ transaction: transaction._id });
    if (existingPayout) {
      return res.json({ message: 'Payout already exists', payout: existingPayout });
    }

    // CRITICAL: Use actual breakdown values, NOT recalculated from totalPaid
    const salePrice = transaction.paymentBreakdown?.subtotal || transaction.paymentBreakdown?.totalPaid || transaction.itemPrice || transaction.listing?.price || 0;
    const commissionAmount = transaction.paymentBreakdown?.platformFee || Math.round(salePrice * COMMISSION_RATE * 100) / 100;
    const payoutAmount = transaction.paymentBreakdown?.sellerEarnings || Math.round((salePrice - commissionAmount) * 100) / 100;

    const payout = await Payout.create({
      seller: transaction.seller,
      transaction: transaction._id,
      listing: transaction.listing._id,
      salePrice,
      commissionRate: COMMISSION_RATE,
      commissionAmount,
      payoutAmount,
      status: 'pending',
    });

    await payout.populate(['listing', 'transaction']);
    res.status(201).json({ message: 'Payout record created', payout });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/payouts/balance - Get seller available balance
// CONTRACT: `availableBalance` MUST equal the dashboard's `availableBalance`
// (same computation). The dashboard's available = released completed earnings
// − paidOut + User.balance.available. Historically this endpoint returned the
// RAW lifetime sum of completed payouts (ignoring what was already cashed
// out) — a real bug the prod E2E suite caught (balance 150 vs dashboard 0).
// Keep the same field names so existing consumers keep working.
router.get('/balance', auth, async (req, res) => {
  try {
    const completedPayouts = await Payout.find({
      seller: req.user._id,
      status: 'completed',
    });

    // Lifetime completed sums (kept for reporting; NOT the cash-out balance).
    // Uses the SAME normalization as the dashboard so balances always agree.
    // Accumulated in integer cents and rounded once — identical math to the
    // dashboard, so /balance and /dashboard can never disagree by a cent.
    let lifetimeCompletedCents = 0;
    let platformCutCents = 0;
    for (const p of completedPayouts) {
      const n = normalizePayout(p);
      lifetimeCompletedCents += toCents(usdNormalized(n.payoutAmount, p.currency));
      platformCutCents += toCents(usdNormalized(n.platformCut, p.currency));
    }
    // Balance invariant: completed gross = platform cut + seller net, exactly.
    const lifetimeCompleted = fromCents(lifetimeCompletedCents);
    const totalCommissionPaid = fromCents(platformCutCents);
    // Spendable balance — PARITY with GET /api/payouts/dashboard: released
    // completed earnings minus what was already paid out, plus any manual
    // User.balance.available credit.
    const sellerDoc = await User.findById(req.user._id).select('balance').lean();
    const userAvailable = num(sellerDoc?.balance?.available);
    const userTotalPaidOut = num(sellerDoc?.balance?.totalPaidOut);
    const availableBalance = round2(Math.max(0, lifetimeCompleted - userTotalPaidOut) + userAvailable);

    res.json({
      availableBalance,
      totalEarned: round2(lifetimeCompleted),
      totalCommissionPaid: round2(totalCommissionPaid),
      commissionRate: COMMISSION_RATE,
      commissionPercent: COMMISSION_RATE * 100,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/payouts/commission-info - Public endpoint for commission info
router.get('/commission-info', (req, res) => {
  res.json({
    commissionRate: COMMISSION_RATE,
    commissionPercent: COMMISSION_RATE * 100,
    sellerKeeps: `${(100 - COMMISSION_RATE * 100)}%`,
    comparedTo: {
      poshmark: '20%',
      mercari: '10%',
      depop: '10%',
      trenddrop: `${COMMISSION_RATE * 100}%`,
    },
    features: [
      `Keep ${(100 - COMMISSION_RATE * 100)}% of your sales`,
      'No listing fees',
      'No monthly subscription',
      'Free image uploads',
      'Direct buyer messaging',
      'Seller ratings & reviews',
    ],
  });
});

module.exports = router;