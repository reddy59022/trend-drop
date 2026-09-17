const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const SellerBadge = require('../models/SellerBadge');
const { auth } = require('../middleware/auth');

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

// GET /api/seller-badges/me - Get current user's badge
router.get('/me', auth, async (req, res) => {
  try {
    const badge = await getOrCreateBadge(req.user._id);
    res.json({ badge });
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch badge' });
  }
});

// GET /api/seller-badges/:userId - Get user's badge (public)
router.get('/:userId', async (req, res) => {
  try {
    const badge = await SellerBadge.findOne({ userId: req.params.userId });
    
    if (!badge) {
      return res.json({ badge: { tier: 'none' } });
    }
    
    res.json({ badge });
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
    
    await badge.save();
    
    res.json({ badge });
  } catch (error) {
    res.status(500).json({ message: 'Failed to verify badge' });
  }
});

// PUT /api/seller-badges/update-stats - Update seller stats (internal/cron)
router.put('/update-stats', auth, async (req, res) => {
  try {
    const badge = await getOrCreateBadge(req.user._id);
    const { salesCount, avgRating, responseRate, returnRate } = req.body;
    const providedStats = { salesCount, avgRating, responseRate, returnRate };
    const validators = {
      salesCount: (value) => Number.isInteger(value) && value >= 0,
      avgRating: (value) => Number.isFinite(value) && value >= 0 && value <= 5,
      responseRate: (value) => Number.isFinite(value) && value >= 0 && value <= 1,
      returnRate: (value) => Number.isFinite(value) && value >= 0 && value <= 1,
    };

    for (const [field, value] of Object.entries(providedStats)) {
      if (value !== undefined && (!validators[field](value) || typeof value !== 'number')) {
        return res.status(400).json({ message: `${field} must be a valid normalized number` });
      }
      if (value !== undefined) badge[field] = value;
    }

    // Calculate tier
    const tiers = SellerBadge.TIERS;
    if (badge.avgRating >= 4.8 && badge.salesCount >= 200 && badge.returnRate <= 0.02) {
      badge.tier = 'platinum';
      badge.benefits.featuredListings = true;
    } else if (badge.avgRating >= 4.7 && badge.salesCount >= 50 && badge.returnRate <= 0.05) {
      badge.tier = 'gold';
      badge.benefits.featuredListings = true;
    } else if (badge.avgRating >= 4.5 && badge.salesCount >= 10 && badge.returnRate <= 0.10) {
      badge.tier = 'silver';
    } else {
      badge.tier = 'bronze';
    }
    
    await badge.save();
    
    res.json({ badge });
  } catch (error) {
    res.status(500).json({ message: 'Failed to update stats' });
  }
});

module.exports = router;