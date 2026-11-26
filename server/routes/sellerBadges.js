const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const SellerBadge = require('../models/SellerBadge');
const { auth } = require('../middleware/auth');
const { computeSellerStats, tierForStats } = require('../utils/sellerStats');

const getOrCreateBadge = async (userId) => {
  try {
    return await SellerBadge.findOneAndUpdate(
      { userId },
      { $setOnInsert: { userId } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
  } catch (error) {
    // A unique-index race can still reject one concurrent upsert; return the
    // winner rather than exposing a transient 500 to the buyer or seller.
    if (error && error.code === 11000) {
      return SellerBadge.findOne({ userId });
    }
    throw error;
  }
};

// Recompute every derived field from platform records and persist it. Used by
// the authenticated read and the manual recalculation so both always expose
// the same authoritative tier.
const refreshBadge = async (badge, userId) => {
  const stats = await computeSellerStats(userId);
  badge.salesCount = stats.salesCount;
  badge.avgRating = stats.avgRating;
  badge.responseRate = stats.responseRate;
  badge.returnRate = stats.returnRate;

  const tier = tierForStats(stats);
  badge.tier = tier;
  badge.benefits.featuredListings = tier === 'gold' || tier === 'platinum';
  await badge.save();
  return badge;
};

// GET /api/seller-badges/me - Get current user's badge
// Stats are refreshed on read; otherwise a seller's tier stays frozen at
// whatever it was the last time they manually recalculated.
router.get('/me', auth, async (req, res) => {
  try {
    const badge = await getOrCreateBadge(req.user._id);
    await refreshBadge(badge, req.user._id);
    res.json({ badge });
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch badge' });
  }
});

// GET /api/seller-badges/:userId - Get user's badge (public)
router.get('/:userId', async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.userId)) {
      return res.status(400).json({ message: 'Invalid seller id' });
    }
    const badge = await SellerBadge.findOne({ userId: req.params.userId });
    
    if (!badge) {
      return res.json({ badge: { tier: 'none' } });
    }

    // Legacy badges may still carry stats a seller entered before tiers became
    // server-derived. Refresh at most hourly so profile views repair stale
    // records without turning a public read into an unbounded write path.
    const BADGE_REFRESH_MS = 60 * 60 * 1000;
    const lastUpdated = badge.updatedAt ? new Date(badge.updatedAt).getTime() : 0;
    if (Date.now() - lastUpdated > BADGE_REFRESH_MS) {
      await refreshBadge(badge, badge.userId);
    }

    // Public view: never expose internal review metadata (which admin reviewed
    // the request, private rejection reasons) to arbitrary visitors.
    const publicBadge = badge.toObject();
    delete publicBadge.verificationReviewedBy;
    delete publicBadge.verificationRejectionReason;
    delete publicBadge.verificationReviewedAt;
    delete publicBadge.userId;

    res.json({ badge: publicBadge });
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch badge' });
  }
});

// PUT /api/seller-badges/verify - Request verification (admin triggered)
router.put('/verify', auth, async (req, res) => {
  try {
    const badge = await getOrCreateBadge(req.user._id);

    // A seller may request verification, but cannot self-approve it or grant
    // themselves reduced fees/priority benefits. Admin review must set the
    // authoritative verification fields separately.
    badge.verificationRequested = true;
    // A request is a pending state, never an approval. Clear any stale
    // verification fields/benefits so a seller cannot retain admin-only
    // privileges after submitting a new request.
    badge.isVerified = false;
    badge.verifiedAt = undefined;
    badge.verificationReviewedAt = undefined;
    badge.verificationReviewedBy = undefined;
    badge.verificationRejectionReason = '';
    badge.benefits.reducedFees = false;
    badge.benefits.prioritySupport = false;

    await badge.save();
    
    res.json({ badge });
  } catch (error) {
    res.status(500).json({ message: 'Failed to verify badge' });
  }
});

// PUT /api/seller-badges/update-stats - Recalculate the caller's stats
// Stats are derived from transactions, ratings and realized returns. The
// request body is intentionally ignored: accepting client numbers here let a
// seller self-assign platinum placement, reduced fees and priority support.
router.put('/update-stats', auth, async (req, res) => {
  try {
    const badge = await getOrCreateBadge(req.user._id);
    await refreshBadge(badge, req.user._id);
    res.json({ badge });
  } catch (error) {
    res.status(500).json({ message: 'Failed to update stats' });
  }
});

module.exports = router;