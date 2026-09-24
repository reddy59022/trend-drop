const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const { auth } = require('../middleware/auth');
const { adminAuth } = require('../middleware/admin');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Transaction = require('../models/Transaction');
const Payout = require('../models/Payout');
const Report = require('../models/Report');
const Offer = require('../models/Offer');
const SellerBadge = require('../models/SellerBadge');
const { clawbackSellerEarnings } = require('../utils/balances');
const { claimTransaction } = require('../utils/claims');
const { findPaymentIntent, retrievePaymentIntent, issueRefund, releaseAuthorization } = require('../config/payments');
const { reverseBoostFeeOwed, markPayoutRefunded, syncOrderFromTransaction } = require('./orderLifecycle');
const { reconcileSettlements } = require('../utils/settlementAudit');

// All admin routes require auth + adminAuth
router.use(auth, adminAuth);

// ============================================================
// SELLER VERIFICATION
// ============================================================

// GET /api/admin/seller-badges/pending - List pending seller verification requests
router.get('/seller-badges/pending', async (req, res) => {
  try {
    const badges = await SellerBadge.find({ verificationRequested: true })
      .sort({ updatedAt: 1 })
      .populate('userId', 'name email country createdAt');
    res.json({ badges });
  } catch (error) {
    console.error('Admin pending seller verification error:', error);
    res.status(500).json({ message: 'Failed to fetch pending seller verifications' });
  }
});

// PUT /api/admin/seller-badges/:userId/verification - Review a seller request
router.put('/seller-badges/:userId/verification', async (req, res) => {
  try {
    const { userId } = req.params;
    const { decision, reason } = req.body;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: 'Invalid seller id' });
    }
    if (!['approve', 'reject'].includes(decision)) {
      return res.status(400).json({ message: 'decision must be approve or reject' });
    }
    if (decision === 'reject' && (typeof reason !== 'string' || !reason.trim())) {
      return res.status(400).json({ message: 'A rejection reason is required' });
    }

    const badge = await SellerBadge.findOne({ userId });
    if (!badge) {
      return res.status(404).json({ message: 'Seller badge not found' });
    }
    if (!badge.verificationRequested && decision === 'approve') {
      return res.status(409).json({ message: 'No pending verification request' });
    }

    const approved = decision === 'approve';
    badge.isVerified = approved;
    badge.verificationRequested = false;
    badge.verifiedAt = approved ? new Date() : null;
    badge.verificationReviewedAt = new Date();
    badge.verificationReviewedBy = req.user._id;
    badge.verificationRejectionReason = approved ? '' : reason.trim();
    badge.benefits.reducedFees = approved;
    badge.benefits.prioritySupport = approved;
    await badge.save();

    res.json({ badge });
  } catch (error) {
    console.error('Admin seller verification review error:', error);
    res.status(500).json({ message: 'Failed to review seller verification' });
  }
});

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
    const { asText, asNumber } = require('../utils/validators');
    // Coerce hostile query shapes (?search[$gt]=, ?role[]=x) to scalars:
    // an object reaching $regex throws CastError -> 500, and an object in
    // query.role is a NoSQL operator injection.
    const role = asText(req.query.role);
    const rawSearch = asText(req.query.search);
    const page = Math.max(1, Math.min(asNumber(req.query.page, 1) || 1, 100));
    const limit = Math.max(1, Math.min(asNumber(req.query.limit, 20) || 20, 50));
    const query = {};
    if (role) query.role = role;
    if (rawSearch) {
      const search = rawSearch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
      ];
    }

    const users = await User.find(query)
      .select('-password')
      .sort({ createdAt: -1 })
      .limit(limit)
      .skip((page - 1) * limit);

    const total = await User.countDocuments(query);

    res.json({
      users,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
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
    if (!['user', 'admin', 'moderator', 'legal_counsel'].includes(role)) {
      return res.status(400).json({ message: 'Invalid role' });
    }

    // Self-demotion lockout guard: an admin must never be able to strip
    // their own admin access (accidentally or via CSRF), which could leave
    // the platform with zero administrators.
    if (String(req.params.id) === String(req.user._id) && role !== 'admin') {
      return res.status(400).json({ message: 'You cannot demote your own admin account' });
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
  // Declared OUTSIDE the try: `let` is block-scoped, so a declaration inside
  // the try block is invisible to the catch. The rollback there must be able
  // to see the claimed transaction, or a failed settlement leaves
  // refundProcessing=true forever and the refund can never be retried.
  let txn;
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: 'Invalid transaction ID' });
    }
    txn = await Transaction.findById(req.params.id);
    if (!txn) return res.status(404).json({ message: 'Transaction not found' });
    if (txn.status === 'refunded') return res.status(400).json({ message: 'Already refunded' });

    // Claim the refund atomically before contacting the provider or changing
    // local balances. A duplicate admin click must not issue two refunds or
    // restore inventory twice.
    const claimedTxn = await claimTransaction({
      _id: txn._id,
      flag: 'refundProcessing',
      claimedAt: 'refundClaimedAt',
      extraFilter: { status: { $ne: 'refunded' } },
    });
    if (!claimedTxn) return res.status(400).json({ message: 'Refund is already being processed or has completed' });
    txn = claimedTxn;

    // Issue refund via the provider. A missing/unknown provider reference is
    // a finance reconciliation failure, never permission to perform a local
    // "free refund" that leaves the platform funding the buyer.
    const paymentIntentId = txn.payout?.transactionId || txn.paymentBreakdown?.paymentIntentId || txn.stripePaymentIntentId;
    try {
      if (!paymentIntentId) throw new Error('Payment provider reference is missing');
      const storedIntent = await findPaymentIntent(paymentIntentId);
      if (!storedIntent) throw new Error('Payment provider reference was not found');
      const pi = await retrievePaymentIntent(paymentIntentId);
      if (pi.status === 'succeeded') {
        await issueRefund(paymentIntentId);
      } else if (pi.status === 'requires_capture') {
        await releaseAuthorization(paymentIntentId);
      } else if (!['canceled', 'cancelled', 'refunded'].includes(pi.status)) {
        throw new Error(`Payment provider returned non-settleable status: ${pi.status}`);
      }
    } catch (stripeErr) {
      console.error('Stripe refund error:', stripeErr.message);
      // Do not mark the transaction refunded or claw back seller funds when
      // the provider did not accept the refund. Clear the claim so the admin
      // can safely retry.
      await Transaction.updateOne({ _id: txn._id, refundProcessing: true }, { $set: { refundProcessing: false } });
      return res.status(502).json({ message: 'Refund could not be processed. No ledger changes were made.' });
    }

    // Remove seller earnings atomically so a refund cannot overwrite a
    // concurrent sale/payout balance update.
    await clawbackSellerEarnings(txn.seller, txn.paymentBreakdown?.sellerEarnings || 0);

    // Restore the exact quantity sold. Restoring one unit for a bulk
    // transaction strands inventory and leaves quantitySold inconsistent.
    const restoredQuantity = Number.isInteger(txn.quantity) && txn.quantity > 0 ? txn.quantity : 1;
    await reverseBoostFeeOwed(txn.listing, txn.paymentBreakdown?.boostFee || 0);
    await markPayoutRefunded(txn);
    await Listing.findByIdAndUpdate(txn.listing, {
      $inc: { quantity: restoredQuantity, quantitySold: -restoredQuantity },
      $set: { sold: false, available: true },
    });

    txn.status = 'refunded';
    txn.refundProcessing = false;
    txn.payout.status = 'refunded';
    txn.cancellation = {
      cancelledBy: 'admin',
      reason: 'Admin forced refund',
      cancelledAt: new Date(),
      refundAmount: txn.paymentBreakdown?.totalPaid || 0,
    };
    await txn.save();
    await syncOrderFromTransaction(txn, 'refunded', txn.paymentBreakdown?.totalPaid || 0);

    res.json({ message: 'Admin refund processed', transaction: txn });
  } catch (error) {
    // If local settlement failed after the atomic claim, leave the transaction
    // retryable. Provider refunds are idempotent by payment intent in the
    // payment adapter, so an admin retry can finish reconciliation.
    // The filter below is the actual guard ($set only when the claim is still
    // held) and is a no-op once the refund persisted. Do NOT gate on the
    // in-memory flag: the route clears it before the final save(), so a failed
    // save would look "already settled" and the refund could never be retried.
    if (txn) {
      try {
        await Transaction.updateOne({ _id: txn._id, refundProcessing: true }, { $set: { refundProcessing: false } });
      } catch (restoreError) {
        console.error('Admin refund claim rollback failed:', restoreError.message);
      }
    }
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

// ============================================================
// SETTLEMENT RECONCILIATION
// ============================================================
//
// Orders completed before the new-seller hold was recorded on the transaction
// can leave a seller's earnings stranded in `balance.pending` while the payout
// row claims the money was paid. No code path can decide this from the
// transaction alone, so finance gets an inventory of every affected order with
// the evidence behind each verdict — and the provably-withheld ones can be paid.

// GET /api/admin/settlements/audit - read-only inventory of unaccounted payouts
router.get('/settlements/audit', async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 500, 1), 5000);
    const report = await reconcileSettlements({ apply: false, limit });
    res.json(report);
  } catch (error) {
    console.error('Settlement audit error:', error.message);
    res.status(500).json({ message: 'Failed to audit settlements' });
  }
});

// POST /api/admin/settlements/reconcile - pay the provably-withheld backlog.
// Paying money is a two-step, deliberate action: `apply` alone is not enough.
router.post('/settlements/reconcile', async (req, res) => {
  try {
    const { apply = false, confirm = false, limit } = req.body || {};
    if (apply && confirm !== true) {
      return res.status(400).json({
        message: 'Paying held settlements requires apply: true together with confirm: true. Run the audit first and review the findings.',
      });
    }
    const report = await reconcileSettlements({
      apply: Boolean(apply),
      limit: Math.min(Math.max(parseInt(limit, 10) || 500, 1), 5000),
    });
    res.json(report);
  } catch (error) {
    console.error('Settlement reconciliation error:', error.message);
    res.status(500).json({ message: 'Failed to reconcile settlements' });
  }
});

module.exports = router;