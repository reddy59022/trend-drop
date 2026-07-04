const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const SellerBadge = require('../models/SellerBadge');
const { auth } = require('../middleware/auth');

// GET /api/seller-badges/me - Get current user's badge
router.get('/me', auth, async (req, res) => {
  try {
    let badge = await SellerBadge.findOne({ userId: req.user._id });
    
    if (!badge) {
      badge = new SellerBadge({ userId: req.user._id });
      await badge.save();
    }
    
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
    let badge = await SellerBadge.findOne({ userId: req.user._id });
    
    if (!badge) {
      badge = new SellerBadge({ userId: req.user._id });
    }
    
    badge.isVerified = true;
    badge.verifiedAt = new Date();
    badge.benefits.reducedFees = true;
    badge.benefits.prioritySupport = true;
    
    await badge.save();
    
    res.json({ badge });
  } catch (error) {
    res.status(500).json({ message: 'Failed to verify badge' });
  }
});

// PUT /api/seller-badges/update-stats - Update seller stats (internal/cron)
router.put('/update-stats', auth, async (req, res) => {
  try {
    let badge = await SellerBadge.findOne({ userId: req.user._id });
    
    if (!badge) {
      badge = new SellerBadge({ userId: req.user._id });
    }
    
    const { salesCount, avgRating, responseRate, returnRate } = req.body;
    
    badge.salesCount = salesCount || badge.salesCount;
    badge.avgRating = avgRating || badge.avgRating;
    badge.responseRate = responseRate || badge.responseRate;
    badge.returnRate = returnRate || badge.returnRate;
    
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