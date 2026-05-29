const express = require('express');
const router = express.Router();
const Payout = require('../models/Payout');
const Transaction = require('../models/Transaction');
const { auth } = require('../middleware/auth');

// Platform commission rate - 5% (much lower than Poshmark's 20%)
const COMMISSION_RATE = 0.05;

// GET /api/payouts/dashboard - Get seller payout dashboard
router.get('/dashboard', auth, async (req, res) => {
  try {
    const sellerId = req.user._id;

    // Get all completed payouts for this seller
    const payouts = await Payout.find({ seller: sellerId })
      .populate('listing', 'title images price')
      .populate('transaction', 'status createdAt')
      .sort({ createdAt: -1 });

    // Calculate totals
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

    const completedPayouts = payouts.filter(p => p.status === 'completed');

    res.json({
      commissionRate: COMMISSION_RATE,
      commissionPercent: COMMISSION_RATE * 100,
      totalSales,
      totalCommission,
      totalEarnings,
      pendingAmount,
      pendingCount: pendingPayouts.length,
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

    const salePrice = transaction.totalPrice || transaction.price || transaction.listing?.price || 0;
    const commissionAmount = Math.round(salePrice * COMMISSION_RATE * 100) / 100;
    const payoutAmount = Math.round((salePrice - commissionAmount) * 100) / 100;

    const payout = await Payout.create({
      seller: transaction.seller,
      transaction: transaction._id,
      listing: transaction.listing._id,
      salePrice,
      commissionRate: COMMISSION_RATE,
      commissionAmount,
      payoutAmount,
      status: 'completed', // Auto-complete for demo (in production, would be 'pending' then 'processing')
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
      'Keep 95% of your sales',
      'No listing fees',
      'No monthly subscription',
      'Free image uploads',
      'Direct buyer messaging',
      'Seller ratings & reviews',
    ],
  });
});

module.exports = router;