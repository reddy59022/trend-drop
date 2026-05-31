const express = require('express');
const router = express.Router();
const Payout = require('../models/Payout');
const Transaction = require('../models/Transaction');
const Listing = require('../models/Listing');
const { auth } = require('../middleware/auth');

// Platform commission is 5% of item price (matching payments.js countryCommissions)
const COMMISSION_RATE = 0.05;

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

    // Calculate totals from payouts
    const totalEarnings = payouts
      .filter(p => p.status === 'completed')
      .reduce((sum, p) => sum + p.payoutAmount, 0);

    const totalCommission = payouts
      .filter(p => p.status === 'completed')
      .reduce((sum, p) => sum + p.commissionAmount, 0);

    const totalSales = payouts
      .filter(p => p.status === 'completed')
      .reduce((sum, p) => sum + p.salePrice, 0);

    const pendingPayouts = payouts.filter(p => p.status === 'pending');
    const pendingAmount = pendingPayouts.reduce((sum, p) => sum + p.payoutAmount, 0);

    // Include completed transactions not yet in payouts for accurate pending amount
    const pendingFromTransactions = completedTransactions
      .filter(t => !payouts.some(p => p.transaction?.toString() === t._id.toString()))
      .reduce((sum, t) => sum + (t.paymentBreakdown?.sellerEarnings || 0), 0);

    const completedPayouts = payouts.filter(p => p.status === 'completed');

    res.json({
      commissionRate: COMMISSION_RATE,
      commissionPercent: COMMISSION_RATE * 100,
      totalSales,
      totalCommission,
      totalEarnings,
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
      return res.status(400).json({ message: 'Payout already processed for this transaction' });
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

    const availableBalance = completedPayouts.reduce((sum, p) => sum + p.payoutAmount, 0);
    const totalCommissionPaid = completedPayouts.reduce((sum, p) => sum + p.commissionAmount, 0);

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