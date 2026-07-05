const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const LoyaltyProgram = require('../models/LoyaltyProgram');

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
router.post('/earn', auth, async (req, res) => {
  try {
    const { amount, reason, listingId } = req.body;
    
    const loyalty = await LoyaltyProgram.findOneAndUpdate(
      { user: req.user._id },
      {
        $inc: { points: amount },
        $push: { pointsHistory: { amount, reason, listing: listingId } }
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
    
    const loyalty = await LoyaltyProgram.findOne({ user: req.user._id });
    if (!loyalty || loyalty.points < amount) {
      return res.status(400).json({ message: 'Insufficient points' });
    }

    loyalty.points -= amount;
    loyalty.pointsHistory.push({ amount: -amount, reason: 'redemption' });
    await loyalty.save();

    res.json({ discount: amount * 0.01, points: loyalty.points });
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