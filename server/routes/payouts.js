const express = require('express');
const router = express.Router();
const Payout = require('../models/Payout');
const Transaction = require('../models/Transaction');
const Listing = require('../models/Listing');
const User = require('../models/User');
const { auth } = require('../middleware/auth');

// Platform commission is 8% of item price (matching payments.js countryCommissions)
const COMMISSION_RATE = 0.08;

// GET /api/payouts/dashboard - Get seller payout dashboard
router.get('/dashboard', auth, async (req, res) => {
  try {
    const sellerId = req.user._id;

    // Get all payouts for this seller
    const payouts = await Payout.find({ seller: sellerId })
      .populate('listing', 'title images price')
      .populate('transaction', 'status createdAt')
      .sort({ createdAt: -1 });

    // Also get completed transactions that may not have Payout records yet
    const completedTransactions = await Transaction.find({
      seller: sellerId,
      status: 'completed',
    }).populate('listing', 'title images price');

    const completedPayouts = payouts.filter(p => p.status === 'completed');

    // totalSales = GROSS dollar volume of all sales (original API contract:
    // revenue.test SF.2 asserts totalCommission < totalSales and
    // SellerDashboard renders it via formatPrice). totalSalesCount = NUMBER
    // of completed sales (count contract used by sellerFullFlow and the
    // "N sales" displays). Both are returned so dollar and count consumers
    // stay correct.
    // Legacy payout docs (old seed schema) store `amount` and lack
    // salePrice/commissionAmount/payoutAmount. Fall back to `amount` so the
    // aggregates below stay numeric instead of becoming NaN → null.
    const num = (v) => (typeof v === 'number' && isFinite(v) ? v : 0);
    const payoutSalePrice = (p) => num(p.salePrice ?? p.amount);
    const payoutCommission = (p) => num(p.commissionAmount ?? (p.amount != null ? Math.round(p.amount * COMMISSION_RATE * 100) / 100 : 0));
    const payoutNet = (p) => num(p.payoutAmount ?? (p.amount != null ? p.amount - payoutCommission(p) : 0));

    const totalSales = payouts.reduce((sum, p) => sum + payoutSalePrice(p), 0);
    const totalSalesCount = completedPayouts.length;

    // Completed earnings = only from completed payouts
    const totalEarnings = completedPayouts.reduce((sum, p) => sum + payoutNet(p), 0);

    // Total commission = from all payouts (completed + pending)
    const totalCommission = payouts.reduce((sum, p) => sum + payoutCommission(p), 0);

    // Pending = all pending payouts + transactions without payout records
    const pendingPayouts = payouts.filter(p => p.status === 'pending');
    const pendingAmount = pendingPayouts.reduce((sum, p) => sum + payoutNet(p), 0);

    // Include transactions not yet in payouts for accurate pending amount
    const pendingFromTransactions = completedTransactions
      .filter(t => !payouts.some(p => p.transaction?.toString() === t._id.toString()))
      .reduce((sum, t) => sum + (t.paymentBreakdown?.sellerEarnings || 0), 0);

    // NOTE: totalSales + totalEarnings computed from completedPayouts above.

    // Seller's cash-out balance = earnings released minus what has already been
    // paid out (tracked on the seller's balance by /api/payments/payout).
    const sellerDoc = await User.findById(sellerId).select('balance').lean();
    const userAvailable = sellerDoc?.balance?.available || 0;
    const userTotalPaidOut = sellerDoc?.balance?.totalPaidOut || 0;
    const totalEarned = Math.round(totalEarnings * 100) / 100;
    const pendingBalance = Math.round((pendingAmount + pendingFromTransactions) * 100) / 100;
    const availableBalance = Math.round(
      (Math.max(0, totalEarned - userTotalPaidOut) + userAvailable) * 100
    ) / 100;

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
      pendingAmount: pendingAmount + pendingFromTransactions,
      pendingCount: pendingPayouts.length + completedTransactions.filter(
        t => !payouts.some(p => p.transaction?.toString() === t._id.toString())
      ).length,
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
router.get('/balance', auth, async (req, res) => {
  try {
    const completedPayouts = await Payout.find({
      seller: req.user._id,
      status: 'completed',
    });

    const numB = (v) => (typeof v === 'number' && isFinite(v) ? v : 0);
    const availableBalance = completedPayouts.reduce(
      (sum, p) => sum + numB(p.payoutAmount ?? p.amount), 0);
    const totalCommissionPaid = completedPayouts.reduce(
      (sum, p) => sum + numB(p.commissionAmount), 0);

    res.json({
      availableBalance: Math.round(availableBalance * 100) / 100,
      totalCommissionPaid: Math.round(totalCommissionPaid * 100) / 100,
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