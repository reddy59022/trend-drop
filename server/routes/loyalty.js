const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const LoyaltyProgram = require('../models/LoyaltyProgram');
const Listing = require('../models/Listing');
const { isValidObjectId } = require('../utils/validators');

// GET /api/loyalty - Get user loyalty status
router.get('/', auth, async (req, res) => {
  try {
    let loyalty = await LoyaltyProgram.findOne({ user: req.user._id });
    
    if (!loyalty) {
      loyalty = await LoyaltyProgram.create({ user: req.user._id, points: 0, tier: 'Silver' });
    }

    res.json(loyalty);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch loyalty status' });
  }
});

// POST /api/loyalty/earn - Earn points
// Server-authoritative: clients may only declare a whitelisted reason; the
// point amount is derived server-side so balances can never be minted,
// drained, or inflated by crafted requests.
const EARN_RULES = {
  purchase: { pointsPerDollar: 1, maxPerEvent: 10000 },
  referral: { fixed: 100, maxPerEvent: 100 },
  anniversary: { fixed: 500, maxPerEvent: 500 },
  review: { fixed: 10, maxPerEvent: 10 },
  signup: { fixed: 50, maxPerEvent: 50 },
};
router.post('/earn', auth, async (req, res) => {
  try {
    const { amount, reason, listingId, purchaseAmount } = req.body;

    const rule = EARN_RULES[reason];
    if (!rule) {
      return res.status(400).json({ message: 'Invalid or missing earn reason' });
    }

    // Optional listing reference must be a real listing — a garbage id would
    // CastError the $push (500) and a ghost id would leave an orphan entry.
    if (listingId !== undefined && listingId !== null && listingId !== '') {
      if (!isValidObjectId(listingId)) {
        return res.status(400).json({ message: 'Invalid listingId' });
      }
      const listingExists = await Listing.findById(listingId);
      if (!listingExists) {
        return res.status(404).json({ message: 'Listing not found' });
      }
    }

    let points = 0;
    if (rule.pointsPerDollar) {
      const spend = Number(purchaseAmount ?? amount);
      if (!Number.isFinite(spend) || spend <= 0 || spend > 1000000) {
        return res.status(400).json({ message: 'Invalid purchase amount' });
      }
      points = Math.min(Math.floor(spend * rule.pointsPerDollar), rule.maxPerEvent);
    } else {
      points = rule.fixed;
    }
    if (!Number.isFinite(points) || points <= 0 || points > rule.maxPerEvent) {
      return res.status(400).json({ message: 'Invalid points amount' });
    }

    const loyalty = await LoyaltyProgram.findOneAndUpdate(
      { user: req.user._id },
      {
        $inc: { points },
        $push: { pointsHistory: { amount: points, reason, listing: listingId } }
      },
      { new: true, upsert: true }
    );

    // Update tier based on points
    if (loyalty.points >= 10000) loyalty.tier = 'Platinum';
    else if (loyalty.points >= 5000) loyalty.tier = 'Gold';
    else loyalty.tier = 'Silver';
    
    await loyalty.save();

    res.json(loyalty);
  } catch (error) {
    res.status(500).json({ message: 'Failed to earn points' });
  }
});

// POST /api/loyalty/redeem - Redeem points for discount
router.post('/redeem', auth, async (req, res) => {
  try {
    const { amount } = req.body;
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || !Number.isInteger(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({ message: 'Invalid redeem amount' });
    }

    // Atomic: decrement only when the balance covers it, so two concurrent
    // redeems can never spend the same points twice.
    const loyalty = await LoyaltyProgram.findOneAndUpdate(
      { user: req.user._id, points: { $gte: numericAmount } },
      {
        $inc: { points: -numericAmount },
        $push: { pointsHistory: { amount: -numericAmount, reason: 'redemption' } },
      },
      { new: true }
    );
    if (!loyalty) {
      return res.status(400).json({ message: 'Insufficient points' });
    }

    res.json({ discount: numericAmount * 0.01, points: loyalty.points });
  } catch (error) {
    res.status(500).json({ message: 'Failed to redeem points' });
  }
});

// GET /api/loyalty/history - Get points history
router.get('/history', auth, async (req, res) => {
  try {
    const loyalty = await LoyaltyProgram.findOne({ user: req.user._id });
    res.json(loyalty?.pointsHistory || []);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch history' });
  }
});

module.exports = router;