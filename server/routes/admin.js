const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const { adminAuth } = require('../middleware/admin');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Transaction = require('../models/Transaction');
const Payout = require('../models/Payout');
const Report = require('../models/Report');
const Offer = require('../models/Offer');

// All admin routes require auth + adminAuth
router.use(auth, adminAuth);

// ============================================================
// DASHBOARD
// ============================================================

// GET /api/admin/dashboard - Platform overview metrics
router.get('/dashboard', async (req, res) => {
  try {
    const [totalUsers, totalListings, totalTransactions, totalReports, totalRevenue] = await Promise.all([
      User.countDocuments(),
      Listing.countDocuments(),
      Transaction.countDocuments(),
      Report.countDocuments({ status: 'pending' }),
      Payout.aggregate([
        { $match: { status: 'completed' } },
        { $group: { _id: null, total: { $sum: '$commissionAmount' } } },
      ]),
    ]);

    const recentTransactions = await Transaction.find()
      .sort({ createdAt: -1 })
      .limit(10)
      .populate('buyer', 'name email')
      .populate('seller', 'name email')
      .populate('listing', 'title price');

    const pendingReports = await Report.find({ status: 'pending' })
      .sort({ createdAt: -1 })
      .limit(20)
      .populate('reporter', 'name email')
      .populate('listing', 'title');

    res.json({
      stats: {
        totalUsers,
        totalListings,
        totalTransactions,
        pendingReports,
        totalCommission: totalRevenue.length > 0 ? totalRevenue[0].total : 0,
      },
      recentTransactions,
      pendingReports,
    });
  } catch (error) {
    console.error('Admin dashboard error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// ============================================================
// USER MANAGEMENT
// ============================================================

// GET /api/admin/users - List all users with filters
router.get('/users', async (req, res) => {
  try {
    const { role, search, page = 1, limit = 20 } = req.query;
    const query = {};
    if (role) query.role = role;
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
      ];
    }

    const users = await User.find(query)
      .select('-password')
      .sort({ createdAt: -1 })
      .limit(Number(limit))
      .skip((Number(page) - 1) * Number(limit));

    const total = await User.countDocuments(query);

    res.json({
      users,
      totalPages: Math.ceil(total / Number(limit)),
      currentPage: Number(page),
      total,
    });
  } catch (error) {
    console.error('Admin list users error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/admin/users/:id - Get user details
router.get('/users/:id', async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password');
    if (!user) return res.status(404).json({ message: 'User not found' });

    const [listings, transactions] = await Promise.all([
      Listing.countDocuments({ seller: req.params.id }),
      Transaction.countDocuments({ $or: [{ buyer: req.params.id }, { seller: req.params.id }] }),
    ]);

    res.json({ user, listingCount: listings, transactionCount: transactions });
  } catch (error) {
    console.error('Admin get user error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// PUT /api/admin/users/:id/role - Update user role
router.put('/users/:id/role', async (req, res) => {
  try {
    const { role } = req.body;
    if (!['user', 'admin', 'moderator'].includes(role)) {
      return res.status(400).json({ message: 'Invalid role' });
    }

    const user = await User.findByIdAndUpdate(
      req.params.id,
      { $set: { role } },
      { new: true }
    ).select('-password');

    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json({ message: `User role updated to ${role}`, user });
  } catch (error) {
    console.error('Admin update role error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/admin/users/:id/suspend - Suspend user (set strikes to 3)
router.post('/users/:id/suspend', async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    user.stats.strikes = 3; // Suspension threshold
    user.role = 'suspended';
    await user.save();

    res.json({ message: 'User suspended', user: { _id: user._id, name: user.name, email: user.email, role: user.role } });
  } catch (error) {
    console.error('Admin suspend user error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/admin/users/:id/unsuspend - Unsuspend user
router.post('/users/:id/unsuspend', async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    user.stats.strikes = 0;
    user.role = 'user';
    await user.save();

    res.json({ message: 'User unsuspended', user: { _id: user._id, name: user.name, email: user.email, role: user.role } });
  } catch (error) {
    console.error('Admin unsuspend user error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// ============================================================
// LISTING MANAGEMENT
// ============================================================

// GET /api/admin/listings - List all listings
router.get('/listings', async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const query = {};
    if (status === 'sold') query.sold = true;
    if (status === 'active') query.sold = false;

    const listings = await Listing.find(query)
      .populate('seller', 'name email')
      .sort({ createdAt: -1 })
      .limit(Number(limit))
      .skip((Number(page) - 1) * Number(limit));

    const total = await Listing.countDocuments(query);

    res.json({
      listings,
      totalPages: Math.ceil(total / Number(limit)),
      currentPage: Number(page),
      total,
    });
  } catch (error) {
    console.error('Admin list listings error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// DELETE /api/admin/listings/:id - Remove listing (admin override)
router.delete('/listings/:id', async (req, res) => {
  try {
    const listing = await Listing.findByIdAndDelete(req.params.id);
    if (!listing) return res.status(404).json({ message: 'Listing not found' });
    res.json({ message: 'Listing removed by admin' });
  } catch (error) {
    console.error('Admin delete listing error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// ============================================================
// REPORT MANAGEMENT
// ============================================================

// GET /api/admin/reports - List all reports
router.get('/reports', async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const query = {};
    if (status) query.status = status;

    const reports = await Report.find(query)
      .populate('reporter', 'name email')
      .populate('listing', 'title seller')
      .sort({ createdAt: -1 })
      .limit(Number(limit))
      .skip((Number(page) - 1) * Number(limit));

    const total = await Report.countDocuments(query);

    res.json({
      reports,
      totalPages: Math.ceil(total / Number(limit)),
      currentPage: Number(page),
      total,
    });
  } catch (error) {
    console.error('Admin list reports error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// PUT /api/admin/reports/:id/status - Update report status
router.put('/reports/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    if (!['resolved', 'dismissed'].includes(status)) {
      return res.status(400).json({ message: 'Invalid status' });
    }

    const report = await Report.findByIdAndUpdate(
      req.params.id,
      { $set: { status } },
      { new: true }
    );

    if (!report) return res.status(404).json({ message: 'Report not found' });
    res.json({ message: `Report ${status}`, report });
  } catch (error) {
    console.error('Admin update report error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// ============================================================
// TRANSACTION MANAGEMENT
// ============================================================

// GET /api/admin/transactions - List all transactions
router.get('/transactions', async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const query = {};
    if (status) query.status = status;

    const transactions = await Transaction.find(query)
      .populate('buyer', 'name email')
      .populate('seller', 'name email')
      .populate('listing', 'title price')
      .sort({ createdAt: -1 })
      .limit(Number(limit))
      .skip((Number(page) - 1) * Number(limit));

    const total = await Transaction.countDocuments(query);

    res.json({
      transactions,
      totalPages: Math.ceil(total / Number(limit)),
      currentPage: Number(page),
      total,
    });
  } catch (error) {
    console.error('Admin list transactions error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/admin/transactions/:id/refund - Force refund (admin)
router.post('/transactions/:id/refund', async (req, res) => {
  try {
    const txn = await Transaction.findById(req.params.id);
    if (!txn) return res.status(404).json({ message: 'Transaction not found' });
    if (txn.status === 'refunded') return res.status(400).json({ message: 'Already refunded' });

    // Issue refund via Stripe
    const { issueRefund, releaseAuthorization } = require('../config/payments');
    const paymentIntentId = txn.payout?.transactionId;
    
    if (paymentIntentId) {
      try {
        const { retrievePaymentIntent } = require('../config/payments');
        const pi = await retrievePaymentIntent(paymentIntentId);
        if (pi.status === 'succeeded') {
          await issueRefund(paymentIntentId);
        } else if (pi.status === 'requires_capture') {
          await releaseAuthorization(paymentIntentId);
        }
      } catch (stripeErr) {
        console.error('Stripe refund error:', stripeErr.message);
      }
    }

    // Remove seller earnings
    const seller = await User.findById(txn.seller);
    if (seller) {
      seller.balance.pending = Math.max(0, (seller.balance.pending || 0) - (txn.paymentBreakdown?.sellerEarnings || 0));
      await seller.save();
    }

    // Restore inventory
    await Listing.findByIdAndUpdate(txn.listing, {
      $inc: { quantity: 1, quantitySold: -1 },
      $set: { sold: false, available: true },
    });

    txn.status = 'refunded';
    txn.payout.status = 'refunded';
    txn.cancellation = {
      cancelledBy: 'admin',
      reason: 'Admin forced refund',
      cancelledAt: new Date(),
      refundAmount: txn.paymentBreakdown?.totalPaid || 0,
    };
    await txn.save();

    res.json({ message: 'Admin refund processed', transaction: txn });
  } catch (error) {
    console.error('Admin refund error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// ============================================================
// AUTO-SUSPENSION CHECK (for users with 3+ strikes)
// ============================================================

// POST /api/admin/auto-suspend - Check and auto-suspend users with 3+ strikes
router.post('/auto-suspend', async (req, res) => {
  try {
    const flaggedUsers = await User.find({ 'stats.strikes': { $gte: 3 }, role: { $ne: 'suspended' } });
    let suspended = 0;

    for (const user of flaggedUsers) {
      user.role = 'suspended';
      user.notifications.unshift({
        type: 'payout',
        message: `Your account has been automatically suspended due to ${user.stats.strikes} strikes. Please contact support.`,
      });
      await user.save();
      suspended++;
    }

    res.json({ message: `Auto-suspension check complete. ${suspended} users suspended.`, suspended });
  } catch (error) {
    console.error('Auto-suspend error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;